import { ConfirmDialog } from "@openbot/ui";
import { AgentUpdateDialog } from "@openbot/ui/features/marketplace/AgentUpdateDialog";
import { McpConnectDialog } from "@openbot/ui/features/settings/McpConnectDialog";
import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { PluginUninstallDialog } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, Show } from "solid-js";
import type { MarketplaceController, MarketplaceControllerProps, PendingSkillConfirm } from "./marketplace-controller";

/**
 * Follows each available connector while the Marketplace or a connect step is open: Slack, Discord,
 * Telegram and WhatsApp change with no event from main.
 */
export function watchConnectors(props: Pick<MarketplaceControllerProps, "open" | "connectors">) {
  createEffect(
    () => (props.open ? props.connectors?.available() : undefined),
    (controllers) => {
      const stops = (controllers ?? []).map((connector) => connector.watch());
      return () => {
        for (const stop of stops) stop();
      };
    },
  );
}

/**
 * The dialogs that a Marketplace controller opens: the uninstall and skill confirmations, the agent
 * update question, and the connect step of an app with its sign-in. The Marketplace page and the
 * connect step of a chat suggestion show them.
 */
export function MarketplaceDialogs(props: {
  controller: MarketplaceController;
  /** The joined server that keeps an app's credential. Absent when this computer keeps it. */
  hostName?: string | undefined;
  /** The joined server in `hostName` relays its sign-ins to this computer. */
  relay?: boolean | undefined;
}) {
  const { t } = useText();
  const skillConfirmTitle = (confirm: PendingSkillConfirm) =>
    t(confirm.kind === "replace" ? "skill.confirm.replaceTitle" : "skill.confirm.removeTitle");
  const skillConfirmBody = (confirm: PendingSkillConfirm) =>
    `${t(confirm.kind === "replace" ? "skill.confirm.replaceBody" : "skill.confirm.removeModifiedBody")} ${t(
      "skill.marketplace.confirmAgents",
      { agents: confirm.agents },
    )}`;
  const skillConfirmLabel = (confirm: PendingSkillConfirm) =>
    t(confirm.kind === "replace" ? "skill.confirm.replace" : "skill.confirm.remove");
  const skillConfirmTone = (confirm: PendingSkillConfirm) => (confirm.kind === "replace" ? "default" : "destructive");
  return (
    <>
      <Show when={props.controller.uninstalling()} keyed>
        {(plugin) => (
          <PluginUninstallDialog
            open={true}
            plan={props.controller.uninstallPlan(plugin)}
            busy={props.controller.uninstallBusy(plugin)}
            onConfirm={() => void props.controller.uninstallPlugin(plugin)}
            onCancel={props.controller.cancelUninstall}
          />
        )}
      </Show>
      <Show when={props.controller.skillConfirm()} keyed>
        {(confirm) => (
          <ConfirmDialog
            open={true}
            onCancel={() => confirm.settle(false)}
            onConfirm={() => confirm.settle(true)}
            title={skillConfirmTitle(confirm)}
            description={skillConfirmBody(confirm)}
            tone={skillConfirmTone(confirm)}
            confirmLabel={skillConfirmLabel(confirm)}
            initialFocus="cancel"
          />
        )}
      </Show>
      <Show when={props.controller.agentUpdate()} keyed>
        {(pending) => (
          <AgentUpdateDialog
            agentName={pending.agentName}
            changed={pending.changed}
            othersCount={pending.othersCount}
            onCancel={() => pending.settle(null)}
            onConfirm={(replaceSkillIds) => pending.settle(replaceSkillIds)}
          />
        )}
      </Show>
      <Show when={props.controller.connecting()} keyed>
        {(pending) => (
          <McpConnectDialog
            subject={pending.subject}
            flows={pending.flows}
            onTest={props.controller.testPluginApp}
            onSignIn={props.controller.signInPluginApp}
            onConnected={(config) => pending.settle(config)}
            onCancel={() => pending.settle(null)}
            onOpenUrl={props.controller.openPluginUrl}
            hostName={props.hostName}
            signInHostName={props.relay ? props.hostName : undefined}
            onCancelSignIn={props.controller.cancelSignIn}
            signInExtra={
              /* The page opens in this computer's browser; the paste field is the way back when the
                 browser cannot reach this computer's listener. */
              <Show when={props.controller.signInRelayed()} keyed>
                {(relay) => (
                  <McpSignInRelayDialog
                    name={pending.subject.name}
                    iconUrl={pending.subject.iconUrl}
                    hostName={props.hostName ?? ""}
                    page={relay.page}
                    onOpen={props.controller.openSignInRelay}
                    onPaste={props.controller.pasteSignInRelay}
                    onCancel={props.controller.cancelSignIn}
                  />
                )}
              </Show>
            }
          />
        )}
      </Show>
    </>
  );
}
