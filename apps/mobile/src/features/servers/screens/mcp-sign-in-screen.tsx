import type { McpSignInState } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Lock from "lucide-react-native/icons/lock";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { McpRelaySignInSteps } from "@/features/servers/components/mcp-relay-sign-in-steps";
import { useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useMcpServerList } from "@/features/servers/model/use-server-mcp";
import { SettingsNote } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * The sign-in of one saved http MCP server of a host, from the Sign in card of a chat. The host
 * starts the sign-in and keeps the grant (`sign-in-relay-v1`); the phone opens the page. The card
 * then shows Continue, which tells the agent to test the server again.
 */
export function McpSignInScreen() {
  const { t, errorMessage } = useText();
  const [muted] = useThemeColor(["muted"]);
  const { serverId, mcpServerId } = useLocalSearchParams<{ serverId: string; mcpServerId: string }>();
  const { canManage, list } = useMcpServerList(serverId);
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const relay = useMcpSignInRelay(serverId, setError);
  const config = list.data?.find((candidate) => candidate.id === mcpServerId && candidate.transport === "http");
  usePreventRemove(phase === "working" && relay.state.phase === "idle", () => undefined);
  useEffect(() => {
    if (phase === "done") router.back();
  }, [phase]);

  if (!config || !canManage || !canRelay)
    return (
      <SheetScrollView
        className="bg-sheet"
        contentContainerClassName="px-4 pt-5"
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsNote>
          {!canManage
            ? t("mobile.server.mcp.unavailable")
            : config
              ? t("mobile.chat.mcpSignIn.unavailable", { name: config.name })
              : list.isPending && !list.isError
                ? t("mobile.server.mcp.loading")
                : t("mobile.server.mcp.gone")}
        </SettingsNote>
      </SheetScrollView>
    );

  async function signIn() {
    if (!config || phase !== "idle") return;
    setError(null);
    setPhase("working");
    try {
      await relay.signIn(config);
      if (!relay.mounted.current) return;
      // The card reads this list. The host's answer replaces it when the list is read again.
      const key = queryKeys.mcpSignIns(queryScope, serverId);
      queryClient.setQueryData<McpSignInState[]>(key, (states = []) => [
        ...states.filter((state) => state.mcpServerId !== config.id),
        { mcpServerId: config.id, signedIn: true },
      ]);
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
      void haptics.notification("success");
      setPhase("done");
    } catch (cause) {
      if (!relay.mounted.current) return;
      void haptics.notification("error");
      setError(errorMessage(cause, t("mobile.marketplace.app.connectFailed")));
      setPhase("idle");
    }
  }

  return (
    <SheetScrollView
      className="bg-sheet"
      contentContainerClassName="gap-6 px-4 pb-safe-offset-5 pt-5"
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t("mobile.chat.mcpSignIn.signInNamed", { name: config.name }) }} />
      <McpRelaySignInSteps
        name={config.name}
        state={relay.state.phase === "idle" ? { phase } : relay.state}
        working={phase === "working" || relay.state.phase === "waiting"}
        onStart={() => void signIn()}
        onPaste={(address) => void relay.paste(address)}
        onReopen={relay.reopen}
      />
      {error ? (
        <Typography.Paragraph accessibilityRole="alert" className="px-1 text-danger-text">
          {error}
        </Typography.Paragraph>
      ) : null}
      <View className="flex-row items-start justify-center gap-2 px-4">
        <Lock color={String(muted)} size={14} strokeWidth={2} style={{ marginTop: 2 }} />
        <Typography.Paragraph type="body-xs" className="shrink text-grouped-secondary">
          {t("mobile.marketplace.app.signInIntro")}
        </Typography.Paragraph>
      </View>
    </SheetScrollView>
  );
}
