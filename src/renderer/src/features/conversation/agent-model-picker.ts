import { foreignProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentPermissionLevel,
  agentNextProviderAccountId,
  agentPermissionLevel,
  DEFAULT_AGENT_ACCESS,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import { useText } from "@openbot/ui/text";
import type { ComponentProps } from "@solidjs/web";
import { usePlatform } from "../../platform";
import { shortcutPlatform } from "../shortcuts/shortcut-platform";
import { useConversationViewScope } from "./conversation-scope";

const ACCESS_LABEL = {
  workspace: "agentSettings.access.workspace",
  ask: "agentSettings.access.ask",
  full: "agentSettings.access.full",
} as const satisfies Record<AgentPermissionLevel, AppTextKey>;

/**
 * The model picker of the open agent, in the message box. A model, effort, provider or account
 * chosen during a turn applies from the next turn.
 */
export function useAgentModelPicker(): () => ComponentProps<typeof ProviderModelPicker> {
  const { t } = useText();
  const platform = usePlatform();
  const {
    fastMode,
    ultrafast,
    fastModeChange,
    props,
    selectAndConfirmModel,
    selectAndConfirmReasoning,
    setActiveRightPanel,
    settingsModel,
    settingsProvider,
    settingsReasoning,
  } = useConversationViewScope();
  const access = () => {
    const agent = props.agent;
    // An agent whose approvals this app does not know shows no level, so the footer never guesses.
    if (!agent || props.agentAutoApproves === undefined) return undefined;
    const level = agentPermissionLevel({
      access: agent.access ?? DEFAULT_AGENT_ACCESS,
      autoApprove: props.agentAutoApproves,
    });
    return { label: t(ACCESS_LABEL[level]), onOpen: () => setActiveRightPanel("settings") };
  };
  /**
   * The keyboard: the one that main reports on desktop. The web client has a fixed app info, so the
   * browser's guess counts there.
   */
  const keyboard = () => shortcutPlatform(platform.appInfoLoadedFromHost() ? platform.appInfo()?.platform : undefined);
  return () => {
    return {
      variant: "composer",
      provider: settingsProvider(),
      foreignProvider: props.agent ? foreignProvider(props.agent.provider) : undefined,
      value: settingsModel(),
      reasoningEffort: settingsReasoning(),
      modelOptions: props.modelOptions,
      agentStatus: props.agentStatus,
      runtimeStatuses: props.providerRuntimeStatuses,
      customProviders: props.customProviders,
      customAgents: props.customAgents,
      onDownloadProvider: props.onDownloadProvider,
      onCancelProviderDownload: props.onCancelProviderDownload,
      onConnectProvider: props.onConnectProvider,
      canConnectProvider: props.canConnectProvider,
      onManageProviders: props.onManageProviders,
      disabledReason: t("conversation.header.modelsUnavailable"),
      accountChoice: true,
      providerAccountId: props.agent ? agentNextProviderAccountId(props.agent) : undefined,
      accountUsage: props.accountUsage,
      onChange: (model, provider, accountId, effort) => void selectAndConfirmModel(model, provider, accountId, effort),
      onReasoningEffortChange: (effort) => void selectAndConfirmReasoning(effort),
      fastMode: fastMode(),
      ultrafast: ultrafast(),
      onFastModeChange: fastModeChange(),
      shortcutPlatform: keyboard(),
      access: access(),
    };
  };
}
