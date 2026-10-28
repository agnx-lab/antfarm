# Antfarm 接入 Agnx

## 上游嵌入

- 上游：`snarktank/antfarm` @ commit `a442ad7dcb8cf8746175cc4a2e2dcafd501156cf`（main，2026-02-26），v0.5.1；**不在 npm**（README 明确说明，npm 上的 `antfarm` 是无关包）；许可证 **MIT**
- 上游原生平台：桌面 ✅ | 网页 ✅ | 移动 ❌
  - 依据：`src/server/` 自带 HTTP dashboard（`dashboard.ts` 用 `node:http` 起服务 + `index.html` 单页），浏览器直接可开；`bin/antfarm` 是 bash 包装的 Node CLI。上游没有 Electron / Capacitor / RN 工程，故 `platforms.mobile = "unsupported"`。
- 工作方式：**Wrap + Sidecar**（上游自带 dashboard 原样 iframe + 薄胶水面板 + ensure sidecar）
- 上游改动清单：**无**（`git status` 为空；端口通过上游 `dist/server/daemon.js <port>` 的**既有位置参数**传，未改源码）

## 「是不是纯 CLI」——不是

线索原以为 Antfarm 可能是纯 CLI，实际**它有原生 web dashboard**：

```
antfarm dashboard              # 默认 3333
antfarm dashboard --port N
antfarm dashboard stop / status
```

实现：`src/cli/cli.ts` → `startDaemon(port)` → spawn `dist/server/daemon.js <port>` → `startDashboard(port)`。
所以**不需要自画平行 UI**，也不存在「无可嵌入 web UI」的情况。

dashboard 提供的能力（`src/server/dashboard.ts` 路由表）：

| 路由 | 作用 |
| --- | --- |
| `GET /` | 单页看板（`src/server/index.html`，33 KB，含内联 CSS/JS） |
| `GET /api/workflows` | 内置工作流列表（feature-dev / security-audit / bug-fix） |
| `GET /api/runs`、`/api/runs/:id` | 运行列表与详情 |
| `GET /api/runs/:id/steps`、`/stories`、`/events` | 步骤 / 故事 / 事件流 |
| `GET /api/medic/status`、`/checks` | 健康看护 cron 状态 |

看板 UI 形态：按工作流的**阶段列**（plan / setup / implement / verify / test / pr / review）铺开卡片，30s 自动刷新，带主题切换与 Medic 健康入口。

## 启动

```
ensureTool = .agnx/tools/ensure-antfarm-dashboard.mjs
默认端口    = 8105
上游命令    = node <antfarm>/dist/server/daemon.js 8105
              （env: HOME=<workDir>/home  ← 沙箱）
```

### 构建前置（一次性）

```bash
cd ~/.agnx-dev/apps/antfarm && npm install && npm run build
```

上游 `build` = `tsc && cp src/server/index.html dist/server/index.html && chmod +x dist/cli/cli.js && node scripts/inject-version.js`。
ensure-tool 检查 `dist/server/daemon.js` 是否存在，缺失时报可读错误。

## ⚠️ 上游把状态目录写死在 `~/.openclaw`（本接入的隔离选择）

- `src/db.ts:6` → `DB_DIR = path.join(os.homedir(), ".openclaw", "antfarm")`，**不读任何环境变量**
- `src/server/daemonctl.ts:9-15` → pid / log 同样写 `~/.openclaw/antfarm/`
- `src/installer/paths.ts` 的多数路径**会**读 `OPENCLAW_STATE_DIR`，但 dashboard 读的 db 恰好不读

本接入**不改上游一行**，改用 **HOME 重定向**把上游全部状态关进数据根：

```
$AGNX_HOME/apps/data/antfarm/
  home/.openclaw/antfarm/dashboard.pid   ← 上游 daemon 自写
  home/.openclaw/antfarm/antfarm.db      ← 上游 SQLite（WAL）
  antfarm.json                            ← ensure 状态（pid/fingerprint）
  logs/dashboard.out.log                  ← ensure 捕获的 stdout/stderr
```

实测：跑完后用户 `~/.openclaw/antfarm` **不存在**（零污染）；探针期间误建的那份已删除复原。

代价：如果用户机器上本来就有 `~/.openclaw/antfarm/antfarm.db`（本机**没有**），Agnx Tab 不展示那些历史运行。ensure-tool 会检测该文件存在并写进 `warnings`。这是刻意的隔离选择——Agnx 子应用不应把运行记录混进用户的全局 OpenClaw 状态。

## 挂载

- `guest.kind = "web"`、`guest.auth = "none"`、`preferStrategy = "auto"`、能力 `cookies`
- **不需要 websocket**：dashboard 是纯 HTTP + 30s 轮询，无 WebSocket（这一点比 Bytebot / Omnigent 都轻）
- 面板与 Tab：`antfarm.main`（走 ensureTool），命令 `antfarm.open`，侧栏按钮 order 62
- 数据落盘：`$AGNX_HOME/apps/data/antfarm/`（见上）

## 验收证据

| 项 | 结果 |
| --- | --- |
| `ensure-antfarm-dashboard.mjs --port 8105 --work-dir /tmp/antfarm-probe` | `{"ok":true,"reused":false,"port":8105,"origin":"http://127.0.0.1:8105","mode":"dashboard"}` |
| 复用路径 | `ok=true reused=true pid=22984` |
| 强制重启（`--force-restart`） | 旧 pid 杀死 → 新 pid 23627 → `/` 200；`ps` 确认**无残留进程** |
| 端口守卫（`--port 6767`） | `{"ok":false,"error":"端口 6767 是 Agnx 主守护进程专用端口…"}` exit 1 |
| 兄弟端口守卫（`--port 8103`） | `{"ok":false,"error":"端口 8103 已分配给其他 Agnx 子应用…"}` exit 1 |
| `curl -o /dev/null -w '%{http_code}' 127.0.0.1:8105/` | **200** |
| 首屏 `<title>` | **Antfarm Dashboard** |
| `/api/workflows` | 200，返回 `bug-fix` / `feature-dev` / `security-audit` 三个内置工作流 |
| 无头浏览器首屏 | 完整渲染：下拉选择工作流、主题切换、Medic、Auto-refresh: 30s；**console error = 0** |
| 选工作流后 | 看板铺开 7 阶段列 `PLAN / SETUP / IMPLEMENT / VERIFY / TEST / PR / REVIEW`，各列 `No runs`（未安装 workflow 的正确空态） |
| **跨域 iframe 内嵌**（模拟 Agnx Tab：本地异源宿主页 + iframe） | guest 完整渲染，主题按钮 `☀️` 正常（说明 `localStorage` 在真实跨域 iframe 下可用），**pageerror = 0** |
| `node .agnx/scripts/build.mjs` | 产出 `.agnx/dist/index.js`（5.3 KB），含 `antfarm.main` / `antfarm.open` |
| `python3 -m json.tool` × manifest / config / package | 全部通过 |

## 已知限制

1. **dashboard 只负责「看」**：Antfarm 的真正执行依赖 **OpenClaw 网关**（`/tools/invoke` + cron 轮询）与 `gh` CLI。dashboard 里没有「新建 run」入口——这是上游设计（run 由 `antfarm workflow run` 从 CLI 发起，或在 OpenClaw 里让 agent 发起）。所以本 Tab 是**监控面**，不是发起面。
2. **未安装 workflow 时列表会空**：`/api/workflows` 读的是**仓内** `workflows/`（`resolveBundledWorkflowsDir`），所以下拉永远有 3 个；但 `runs` 需要有真实运行记录才有卡片。要跑起来需 `antfarm install`（会写 OpenClaw workspace 与 cron，属于改变用户全局环境，本接入不代做）。
3. **沙箱 HOME 的取舍**：见上节。若要复用用户全局 `~/.openclaw` 的 antfarm 数据，需去掉 `HOME` 重定向，但同时会污染用户目录且多个实例会抢同一 pid 文件——故保持隔离。
4. **Node 版本**：上游要求 Node ≥ 22（`node:sqlite`）。本机 v22.22.1 ✅。启动日志会有 `ExperimentalWarning: SQLite is an experimental feature`，无害。
5. **端口**：上游默认 3333，本机若已有其他服务占用需注意；本接入固定 8105。
6. **移动端**：`platforms.mobile = "unsupported"`。看板是桌面宽度分列的布局，上游无移动壳。

## 嵌页宿主能力缺口

| 上游能力 | 信号位置 | 嵌后风险 | 处置 | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Workflow 发起（`antfarm workflow run`） | `src/cli/cli.ts` | dashboard 无发起入口，用户可能误以为要在 Tab 里点「新建」 | 面板错误文案与 EMBED 明确「dashboard 只展示」；未自画发起 UI | iframe | 发起面=CLI / OpenClaw，按能力上限不替上游造 |
| OpenClaw 网关依赖（cron 轮询、`/tools/invoke`） | `src/installer/gateway-api.ts` | 未装 OpenClaw 或未 install 时，看板恒为 No runs，像是「坏了」 | ensure-tool 在 `warnings` 里说明依赖；不改上游 | — | 本机 OpenClaw 存在（2026-03 安装）但未装 antfarm workflow |
| 全局状态目录写死 `~/.openclaw/antfarm` | `src/db.ts:6`、`src/server/daemonctl.ts:9` | 多实例抢同一 pid / 污染用户目录 | HOME 重定向沙箱化（不改上游） | ensure sidecar | 已知取舍 |
| 主题偏好 `localStorage` | `src/server/index.html:600` | 若 iframe 被设 `sandbox`（无 `allow-same-origin`）会抛 SecurityError 并中断主题初始化 | 未处理；实测真实跨域 iframe（无 sandbox 属性）下正常 | iframe | 宿主若加 `sandbox` 需补 `allow-same-origin` |
| Google Fonts 外链（Inter / Geist Mono） | `src/server/index.html` `<link href="fonts.googleapis.com">` | 离线环境字体回退，不影响功能 | 未处理 | iframe | 纯观感 |
| Medic 健康看护 | `/api/medic/*` | 依赖上游 cron 安装 | 看板只读展示 | iframe | — |
| 移动端 | 无 | — | `platforms.mobile = "unsupported"` | — | 上游能力上限 |
