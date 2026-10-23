// 场景：Antfarm Sub App 入口 — 薄壳 + ensure + iframe。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import { AntfarmIcon } from "./antfarm-icon";
import {
  ANTFARM_APP_ID,
  ANTFARM_ENSURE_DASHBOARD_TOOL_REL,
  ANTFARM_OPEN_COMMAND_ID,
  ANTFARM_PANEL_ID,
} from "./constants";
import { bindAntfarm, AntfarmPanel } from "./panel";

export const appId = ANTFARM_APP_ID;

function openAntfarmTab(
  host: WorkspaceAppHostApi,
  context?: {
    serverId?: string;
    workspaceId?: string;
    currentPathname?: string | null;
  },
): void {
  host.openMiniAppTab({
    appId: ANTFARM_APP_ID,
    panelId: ANTFARM_PANEL_ID,
    serverId: context?.serverId,
    workspaceId: context?.workspaceId,
    currentPathname: context?.currentPathname,
  });
}

export function activate(host: WorkspaceAppHostApi): void {
  bindAntfarm(host);

  host.registerMiniApp({
    id: ANTFARM_PANEL_ID,
    appId: ANTFARM_APP_ID,
    title: "Antfarm",
    icon: AntfarmIcon,
    component: AntfarmPanel,
    iframeShortcutCapture: true,
    isolation: {
      mode: "iframe",
      sidecarTools: [ANTFARM_ENSURE_DASHBOARD_TOOL_REL],
      note: "Tab iframe 加载上游自带 dashboard（沙箱 HOME）；ensure 短跑 sidecar",
    },
  });

  host.registerCommand({
    id: ANTFARM_OPEN_COMMAND_ID,
    appId: ANTFARM_APP_ID,
    title: "Antfarm",
    keywords: ["antfarm", "agent team", "多智能体", "workflow", "planner", "verifier"],
    icon: AntfarmIcon,
    sidebarAction: {
      defaultVisible: true,
      label: "Antfarm",
      order: 62,
    },
    run: (context) => {
      openAntfarmTab(host, context);
    },
  });
}

const moduleExport: WorkspaceAppModule = {
  appId: ANTFARM_APP_ID,
  activate,
};

export default moduleExport;

export { ANTFARM_APP_ID, ANTFARM_OPEN_COMMAND_ID, ANTFARM_PANEL_ID } from "./constants";
export { AntfarmPanel } from "./panel";
