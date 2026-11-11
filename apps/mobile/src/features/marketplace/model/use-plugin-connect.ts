import type { McpServerConfig } from "@openbot/contracts/ipc";
import { applyMcpFlow, type McpAuthValues } from "@openbot/contracts/mcp-connect-flows";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type McpSignInRelayState, useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import type { MobilePluginApp } from "./plugin-catalog.generated";
import { type PluginConnectMethod, pluginAppConfig, pluginKeyLinkError } from "./plugin-connect";

/**
 * Where the connect step of one app is. `waiting` and `signIn` are the steps of a relayed sign-in
 * (`McpSignInRelayState`).
 */
export type PluginConnectState =
  | { phase: "idle" }
  | { phase: "working" }
  | Exclude<McpSignInRelayState, { phase: "idle" }>
  | { phase: "done" };

/**
 * Connects one plugin app on the host, as the desktop connect step does for a joined host: a key is
 * tested before it is saved, and a browser sign-in is relayed (`sign-in-relay-v1`) so that the host
 * keeps the grant. The host saves the configuration that connected, never the listing's alone.
 */
export function usePluginConnect(serverId: string, app: MobilePluginApp | null, method: PluginConnectMethod | null) {
  const { t, sourceText, errorMessage } = useText();
  const { saveMcpServer, testMcpServer } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [own, setState] = useState<Extract<PluginConnectState, { phase: "idle" | "working" | "done" }>>({
    phase: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const relay = useMcpSignInRelay(serverId, setError);
  const { mounted } = relay;
  // While a sign-in runs, its step is the state of the connect step.
  const state: PluginConnectState = own.phase === "working" && relay.state.phase !== "idle" ? relay.state : own;

  async function save(config: McpServerConfig) {
    const list = await saveMcpServer(config, serverId);
    queryClient.setQueryData(queryKeys.mcpServers(queryScope, serverId), list);
  }

  /** A failed test or sign-in, in the words of the host. It fails the operation, so analytics counts it. */
  const hostFailure = (message: string) => new Error(sourceText(message));

  async function run(operation: () => Promise<void>) {
    setError(null);
    setState({ phase: "working" });
    try {
      await mobileAnalytics.operation("marketplace_action", { entity: "plugin", action: "install" }, operation);
      if (!mounted.current) return;
      void haptics.notification("success");
      setState({ phase: "done" });
    } catch (cause) {
      if (!mounted.current) return;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      setState({ phase: "idle" });
    }
  }

  /** Adds an app that asks for nothing, or tests and adds one with the typed key. */
  function connect(values: McpAuthValues = {}) {
    if (!app || !method || state.phase !== "idle") return;
    const base = pluginAppConfig(app);
    if (method.kind === "none") return run(() => save(base));
    if (method.kind === "key") {
      const invalidLink = pluginKeyLinkError(base, method.flow, values);
      if (invalidLink) {
        setError(t("mobile.marketplace.app.linkInvalid", { hostname: new URL(base.url).hostname }));
        return;
      }
      const config = applyMcpFlow(base, method.flow, values);
      return run(async () => {
        const result = await testMcpServer(config, serverId);
        if (result.error) throw hostFailure(result.error);
        await save(config);
      });
    }
    // The relayed sign-in: the host keeps the grant, then saves the app.
    if (method.kind === "link")
      return run(async () => {
        await relay.signIn(base);
        await save(base);
      });
  }

  return { state, error, connect, paste: relay.paste, reopen: relay.reopen };
}
