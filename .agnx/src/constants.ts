// 场景：Antfarm Sub App 常量（AppId / 命令 / 面板 / ensure / 默认端口）。
export const ANTFARM_APP_ID = "com.agnx.antfarm";
export const ANTFARM_PANEL_ID = "antfarm.main";
export const ANTFARM_OPEN_COMMAND_ID = "antfarm.open";

/** 短跑 sidecar：复用或拉起上游 dist/server/daemon.js（沙箱 HOME）。 */
export const ANTFARM_ENSURE_DASHBOARD_TOOL_REL = ".agnx/tools/ensure-antfarm-dashboard.mjs";

export const DEFAULT_ANTFARM_PORT = 8105;

/** Agnx 主守护进程端口，子应用永不占用。 */
export const AGNX_DAEMON_PORT = 6767;
