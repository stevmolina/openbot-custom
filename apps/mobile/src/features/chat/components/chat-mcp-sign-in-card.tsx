import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import Lock from "lucide-react-native/icons/lock";
import Plug from "lucide-react-native/icons/plug";
import { memo, useState } from "react";
import { View, type ViewStyle } from "react-native";
import { useMcpServerList, useMcpSignIns } from "@/features/servers/model/use-server-mcp";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The address of a server without its query, which can hold a key. */
function addressWithoutQuery(address: string): string {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    return address;
  }
}

/**
 * The card of an MCP server that an agent saved and that waits for the user's sign-in, as on
 * desktop. Sign in opens the relayed sign-in of the host; Continue tells the agent to test the
 * server again. A user who cannot sign in from this phone (not an owner or admin, or a host without
 * `sign-in-relay-v1`) gets the reason, not an action that fails. A row this phone cannot read
 * keeps a marker line.
 */
export const ChatMcpSignInCard = memo(function ChatMcpSignInCard({
  serverId,
  mcpServerId,
  canSend,
  muted,
  onContinue,
}: {
  serverId: string;
  mcpServerId: string;
  canSend: boolean;
  muted: ViewStyle["backgroundColor"];
  /** Sends the message that tells the agent to test again. False when it could not be sent now. */
  onContinue: (body: string) => boolean;
}) {
  const { t } = useText();
  const [iconColor] = useThemeColor(["muted"]);
  const { canManage, list } = useMcpServerList(serverId);
  const signIns = useMcpSignIns(serverId, canManage);
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const [sent, setSent] = useState(false);
  const config = list.data?.find((candidate) => candidate.id === mcpServerId && candidate.transport === "http");
  if (!config) {
    // The list is still loading: the card comes with it.
    if (canManage && list.isPending && !list.isError) return null;
    return (
      <View accessible className="flex-row items-center gap-2 py-1">
        <Plug color={String(muted)} size={14} />
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {t("mobile.chat.mcpSignIn.marker")}
        </Typography.Paragraph>
      </View>
    );
  }
  const signedIn = Boolean(signIns.data?.some((state) => state.mcpServerId === config.id && state.signedIn));
  const state = sent ? "sent" : !canRelay ? "unavailable" : signedIn ? "signed-in" : "sign-in";
  return (
    <View
      className="max-w-[92%] self-start gap-2 rounded-[20px] bg-control/60 px-4 py-3"
      style={{ borderCurve: "circular" }}
    >
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-control">
          <Plug color={String(iconColor)} size={18} />
        </View>
        <View className="shrink grow gap-0.5">
          <Typography.Paragraph className="font-medium" numberOfLines={1}>
            {config.name}
          </Typography.Paragraph>
          <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
            {addressWithoutQuery(config.url)}
          </Typography.Paragraph>
        </View>
        {state === "sent" ? (
          <View className="flex-row items-center gap-1" accessibilityRole="text">
            <Check color={String(iconColor)} size={16} />
            <Typography type="body-sm" className="text-text-secondary">
              {t("mobile.chat.mcpSignIn.signedIn")}
            </Typography>
          </View>
        ) : state === "signed-in" ? (
          <Button
            size="sm"
            variant="primary"
            isDisabled={!canSend}
            accessibilityLabel={t("mobile.chat.mcpSignIn.continueNamed", { name: config.name })}
            onPress={() => {
              if (sent) return;
              void haptics.impact();
              // The card shows "sent" at once, so a second press sends nothing. A failed send shows Continue again.
              setSent(true);
              if (!onContinue(t("mobile.chat.mcpSignIn.message", { name: config.name }))) setSent(false);
            }}
          >
            <Button.Label>{t("mobile.chat.mcpSignIn.continue")}</Button.Label>
          </Button>
        ) : state === "sign-in" ? (
          <Button
            size="sm"
            variant="primary"
            accessibilityLabel={t("mobile.chat.mcpSignIn.signInNamed", { name: config.name })}
            onPress={() => {
              void haptics.selection();
              router.push({ pathname: "/mcp-sign-in", params: { serverId, mcpServerId: config.id } });
            }}
          >
            <Button.Label>{t("mobile.chat.mcpSignIn.signIn")}</Button.Label>
          </Button>
        ) : null}
      </View>
      {state === "unavailable" ? (
        <View className="flex-row items-start gap-2">
          <Lock color={String(iconColor)} size={14} style={{ marginTop: 2 }} />
          <Typography.Paragraph type="body-xs" className="shrink text-text-secondary">
            {t("mobile.chat.mcpSignIn.unavailable", { name: config.name })}
          </Typography.Paragraph>
        </View>
      ) : null}
    </View>
  );
});
