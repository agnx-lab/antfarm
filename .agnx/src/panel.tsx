// 场景：Antfarm 薄壳面板 — host.guest.mount 嵌入上游自带 dashboard。
// 上游 dashboard 是纯静态 HTML + /api/* JSON 轮询（无 WebSocket），嵌页成本最低。
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  WorkspaceAppBrandLogoLoaderPanelProps,
  WorkspaceAppHostApi,
} from "@agnx-lab/app-sdk";
import {
  ANTFARM_APP_ID,
  ANTFARM_ENSURE_DASHBOARD_TOOL_REL,
  DEFAULT_ANTFARM_PORT,
} from "./constants";
import { bindAntfarmHost, requireBoundHost } from "./host-bind";

const WEB_ROOT_STYLE: CSSProperties = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  backgroundColor: "transparent",
};

const GUEST_HOST_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const BOOT_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)",
};

const ERROR_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9,9,11,0.88)",
};

const ERROR_FALLBACK_STYLE: CSSProperties = {
  ...ERROR_LAYER_STYLE,
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
};

const RETAIN_REASON = "antfarm-open";

const styles = StyleSheet.create((theme) => ({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    backgroundColor: "transparent",
  },
  fallbackText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

export function bindAntfarm(host: WorkspaceAppHostApi): void {
  bindAntfarmHost(host);
}

function getHost(): WorkspaceAppHostApi {
  return requireBoundHost();
}

function canUseGuestSurface(): boolean {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}

export function AntfarmPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const guestHostRef = useRef<HTMLDivElement | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = getHost();
    host.background?.requestRetain?.({
      appId: ANTFARM_APP_ID,
      active: true,
      reason: RETAIN_REASON,
    });
    return () => {
      host.background?.requestRetain?.({
        appId: ANTFARM_APP_ID,
        active: false,
        reason: RETAIN_REASON,
      });
    };
  }, []);

  useEffect(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("当前平台暂不支持嵌入 Antfarm Dashboard，请使用 Agnx 桌面端。");
      return;
    }

    const host = getHost();
    if (!host.guest?.mount) {
      setBooting(false);
      setError("宿主未提供 host.guest（需升级 Agnx 并重新扫描子应用）");
      return;
    }

    let cancelled = false;
    const unmountGuest = host.guest.mount({
      container: guestHostRef.current as HTMLDivElement,
      ensureTool: ANTFARM_ENSURE_DASHBOARD_TOOL_REL,
      ensureArgs: ["--port", String(DEFAULT_ANTFARM_PORT)],
      timeoutMs: 90_000,
      bootOverlay: false,
      onReady: () => {
        if (!cancelled) {
          setError(null);
          window.setTimeout(() => {
            if (!cancelled) {
              setBooting(false);
            }
          }, 200);
        }
      },
      onError: (detail) => {
        if (!cancelled) {
          setBooting(false);
          setError(`${detail.code}: ${detail.message}`);
        }
      },
    });

    return () => {
      cancelled = true;
      unmountGuest?.();
    };
  }, []);

  if (!canUseGuestSurface()) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{error ?? "加载中…"}</Text>
      </View>
    );
  }

  const BrandPanel = getHost().ui?.BrandLogoLoaderPanel as
    | ComponentType<WorkspaceAppBrandLogoLoaderPanelProps>
    | undefined;

  return (
    <div style={WEB_ROOT_STYLE} data-testid="workspace-mini-app-antfarm-root">
      <div
        ref={guestHostRef}
        data-agnx-guest-surface-host="true"
        style={GUEST_HOST_STYLE}
      />
      {booting && !error && BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={BOOT_LAYER_STYLE} role="status">
          <BrandPanel
            title="正在启动 Antfarm…"
            description="正在准备嵌入面"
            testID="antfarm-boot-overlay"
          />
        </div>
      ) : null}
      {booting && !error && !BrandPanel ? (
        <div
          data-agnx-guest-boot-overlay="true"
          style={{ ...BOOT_LAYER_STYLE, ...ERROR_FALLBACK_STYLE }}
          role="status"
        >
          正在启动 Antfarm…
        </div>
      ) : null}
      {error && BrandPanel ? (
        <div style={ERROR_LAYER_STYLE} role="alert">
          <BrandPanel
            title={error}
            description="Antfarm 需先在仓根 npm install && npm run build。dashboard 只做展示，跑 workflow 还要 OpenClaw 网关。"
            testID="antfarm-mount-error"
          />
        </div>
      ) : null}
      {error && !BrandPanel ? (
        <div style={ERROR_FALLBACK_STYLE} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
