#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 确保 Antfarm Dashboard 在指定端口起好；未健康则后台起、轮询到健康。
 * 用法：node .agnx/tools/ensure-antfarm-dashboard.mjs [--port <n>] [--work-dir <dataRoot>] [--force-restart] [--supervised]
 * stdout：末行单行 JSON { ok, port, origin, reused, pid, mode, warnings? }
 *
 * 上游形态：`antfarm dashboard` 默认 3333，内部 spawn `dist/server/daemon.js <port>`，
 *   daemon 再把 pid 写到 `~/.openclaw/antfarm/dashboard.pid`、DB 写死
 *   `~/.openclaw/antfarm/antfarm.db`（src/db.ts 不读环境变量，见 EMBED.md「已知限制」）。
 *
 * 本工具的做法（**不改上游一行**）：
 *   1. 直接 spawn 上游 `dist/server/daemon.js <port>`，与 `antfarm dashboard` 内部完全同一条命令；
 *   2. 用 HOME 重定向把上游的 pid / DB / log 全部落到 $workDir（沙箱化，不污染用户 ~/.openclaw）；
 *   3. 端口 3333 是上游默认值，与奥本机其他服务可能撞号；统一用 8105。
 *   注意：本机已存在 ~/.openclaw 的真实 OpenClaw 安装时，HOME 重定向会让 dashboard
 *   读不到用户原有 antfarm.db（若用户之前用过 antfarm）。这是刻意的隔离选择：Agnx Tab
 *   只展示 Agnx 沙箱内的运行记录，详见 EMBED.md。
 */
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "../..");
const DEFAULT_PORT = 8105;
/** Agnx 主守护进程端口，永不占用。 */
const FORBIDDEN_PORTS = new Set([6767]);
/** 兄弟子应用已分配端口（8100-8112 中除本应用外的全部）。 */
const SIBLING_PORTS = new Set([8100, 8101, 8102, 8103, 8104, 8106, 8107, 8108, 8109, 8110, 8111, 8112]);

const DAEMON_SCRIPT = path.join(appRoot, "dist", "server", "daemon.js");

function trace(phase, fields) {
  process.stderr.write(`[ensure-antfarm] ${JSON.stringify({ phase, ...fields })}\n`);
}

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || path.join(appRoot, ".agnx-runtime");
  let port = DEFAULT_PORT;
  let forceRestart = false;
  let supervised = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) {
        port = Math.floor(n);
      }
      i += 1;
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    } else if (arg === "--supervised") {
      supervised = true;
    }
  }
  return { workDir, port, forceRestart, supervised };
}

function fail(message) {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
}

/**
 * 健康判定：`/` 返回 200 且含 Antfarm 特征，并且 `/api/workflows` 返回 JSON 数组。
 * 两步都过才算「真的是 Antfarm」——避免误复用别家服务。
 */
function isHealthy(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/", timeout: 3000 },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 200_000) {
            res.destroy();
          }
        });
        res.on("end", () => {
          if (!/antfarm/i.test(body)) {
            resolve(false);
            return;
          }
          const apiReq = http.get(
            { host: "127.0.0.1", port, path: "/api/workflows", timeout: 3000 },
            (apiRes) => {
              let apiBody = "";
              apiRes.setEncoding("utf8");
              apiRes.on("data", (c) => {
                apiBody += c;
              });
              apiRes.on("end", () => {
                try {
                  resolve(Array.isArray(JSON.parse(apiBody)));
                } catch {
                  resolve(false);
                }
              });
              apiRes.on("error", () => resolve(false));
            },
          );
          apiReq.on("error", () => resolve(false));
          apiReq.on("timeout", () => {
            apiReq.destroy();
            resolve(false);
          });
        });
        res.on("error", () => resolve(false));
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(1200);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) {
    return false;
  }
  try {
    process.kill(n, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function stopPid(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) {
    return;
  }
  try {
    process.kill(n, "SIGTERM");
  } catch {
    // 进程已退出
  }
}

async function readState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

/** 沙箱 HOME：上游把 pid / DB / log 全落在 $HOME/.openclaw/antfarm。 */
function sandboxHome(workDir) {
  return path.join(workDir, "home");
}

/**
 * 后台起服务：stdout/stderr 重定向到日志文件（不用 pipe，避免宿主退出后子进程失联）。
 */
function spawnDetached(command, args, { cwd, env, logFile }) {
  const out = openSync(logFile, "a");
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  closeSync(out);
  child.unref();
  return {
    child,
    readLog: () => {
      try {
        return readFileSync(logFile, "utf8").slice(-12000);
      } catch {
        return "";
      }
    },
  };
}

async function waitForHealth(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));

  if (FORBIDDEN_PORTS.has(cfg.port)) {
    fail(`端口 ${cfg.port} 是 Agnx 主守护进程专用端口，Antfarm 一律改走 ${DEFAULT_PORT}。`);
    return;
  }
  if (SIBLING_PORTS.has(cfg.port)) {
    fail(`端口 ${cfg.port} 已分配给其他 Agnx 子应用，Antfarm 固定使用 ${DEFAULT_PORT}。`);
    return;
  }

  if (!existsSync(DAEMON_SCRIPT)) {
    fail(
      `未找到上游 dashboard 产物：${DAEMON_SCRIPT}。请先在仓根执行 npm install && npm run build（上游 tsc 构建）。`,
    );
    return;
  }

  await mkdir(cfg.workDir, { recursive: true });
  const home = sandboxHome(cfg.workDir);
  await mkdir(home, { recursive: true });
  const statePath = path.join(cfg.workDir, "antfarm.json");
  const logFile = path.join(cfg.workDir, "logs", "dashboard.out.log");
  await mkdir(path.dirname(logFile), { recursive: true });

  const origin = `http://127.0.0.1:${cfg.port}`;
  const fingerprint = JSON.stringify({ port: cfg.port, daemon: DAEMON_SCRIPT });
  const existing = await readState(statePath);

  const warnings = [];
  const openclawStateDir = path.join(process.env.HOME || "", ".openclaw", "antfarm");
  if (existsSync(path.join(openclawStateDir, "antfarm.db"))) {
    warnings.push(
      "本机 ~/.openclaw/antfarm 存在既有 antfarm 数据库；Agnx Tab 使用沙箱 HOME，不展示那些历史运行（隔离选择，见 EMBED.md）。",
    );
  }
  warnings.push(
    "Antfarm 的 workflow 执行依赖 OpenClaw 网关（cron 轮询）。dashboard 只负责展示；未安装 workflow 时列表为空、无可运行任务。",
  );

  trace("start", { port: cfg.port, forceRestart: cfg.forceRestart, home });

  if (!cfg.forceRestart && (await isHealthy(cfg.port))) {
    const samePidAlive = existing?.pid ? isPidAlive(existing.pid) : false;
    trace("reuse", { port: cfg.port, pid: existing?.pid ?? null, samePidAlive });
    console.log(
      JSON.stringify({
        ok: true,
        reused: true,
        port: cfg.port,
        origin,
        pid: samePidAlive ? existing.pid : null,
        mode: "dashboard",
        warnings,
      }),
    );
    return;
  }

  if (!cfg.forceRestart && (await isPortBusy(cfg.port))) {
    fail(
      `端口 ${cfg.port} 已被其他进程占用且不是 Antfarm Dashboard。请先释放（lsof -nP -iTCP:${cfg.port} -sTCP:LISTEN）。`,
    );
    return;
  }

  if (existing?.pid && isPidAlive(existing.pid)) {
    trace("stop-stale", { pid: existing.pid });
    stopPid(existing.pid);
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && isPidAlive(existing.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  // 上游 daemon 自己写 pid 文件，残留 pid 会干扰；清掉沙箱内的旧 pid。
  const upstreamPid = path.join(home, ".openclaw", "antfarm", "dashboard.pid");
  if (existsSync(upstreamPid)) {
    const stalePid = Number(readFileSync(upstreamPid, "utf8").trim());
    if (Number.isFinite(stalePid) && isPidAlive(stalePid) && stalePid !== process.pid) {
      stopPid(stalePid);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const args = [DAEMON_SCRIPT, String(cfg.port)];
  const env = {
    ...process.env,
    HOME: home,
    ANTFARM_AGNX_SANDBOX: "1",
  };

  if (cfg.supervised) {
    console.log(
      JSON.stringify({
        ok: true,
        reused: false,
        plan: {
          command: process.execPath,
          args,
          cwd: appRoot,
          env,
          fingerprint,
          healthUrl: `${origin}/`,
          port: cfg.port,
          mode: "dashboard",
          launchMode: "dev",
          iframeOriginStderrPrefix: "ensure-antfarm: ",
        },
      }),
    );
    return;
  }

  trace("spawn", { bin: process.execPath, args: args.join(" "), home });
  const { child, readLog } = spawnDetached(process.execPath, args, { cwd: appRoot, env, logFile });

  const ready = await waitForHealth(cfg.port, 60_000);
  if (!ready) {
    const tail = readLog().trim();
    stopPid(child.pid);
    fail(
      `Antfarm Dashboard 启动超时（端口 ${cfg.port}）。${
        tail ? `最近输出：${tail.slice(-500)}` : "无输出，请检查 dist/server/daemon.js 是否存在。"
      }`,
    );
    return;
  }

  await writeFile(
    statePath,
    JSON.stringify(
      {
        fingerprint,
        port: cfg.port,
        pid: child.pid ?? null,
        origin,
        home,
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify({
      ok: true,
      reused: false,
      port: cfg.port,
      origin,
      pid: child.pid ?? null,
      mode: "dashboard",
      warnings,
    }),
  );
}

main()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
  });
