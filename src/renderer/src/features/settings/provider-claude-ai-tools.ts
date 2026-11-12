import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderClaudeAiTools } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createHostSetting } from "./host-setting-state";

/** The "Use claude.ai tools" calls of one server's host. The desktop reaches them through main. */
export type HostClaudeAiToolsCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getClaudeAiTools" | "setClaudeAiTools">;

export interface HostClaudeAiToolsOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostClaudeAiToolsCalls;
}

export interface ProviderClaudeAiToolsSource extends HostClaudeAiToolsOptions {
  serverId: string;
  /** A joined server: the tools are the ones of the host's Claude sign-in. */
  remote: boolean;
}

/**
 * The Claude page's "Use claude.ai tools" switch of this computer or a joined server
 * (`claude-ai-tools-v1`). The host checks the role again. Undefined while `source` is.
 *
 * Each new value of `status` reads the setting again: the host sends a status event after a change.
 */
export function createProviderClaudeAiTools(
  source: () => ProviderClaudeAiToolsSource | undefined,
  status: () => unknown,
): () => ProviderClaudeAiTools | undefined {
  const { t } = useText();
  const calls = (): HostClaudeAiToolsCalls => source()?.calls ?? window.openbot.hostAdmin;
  const setting = createHostSetting<boolean, boolean>({
    serverId: () => source()?.serverId,
    status,
    read: async (serverId) => (await calls().getClaudeAiTools(serverId)).enabled,
    save: async (enabled, serverId) => (await calls().setClaudeAiTools(enabled, serverId)).enabled,
    loadFailed: () => t("provider.settings.claudeAiToolsLoadFailed"),
  });
  const tools: ProviderClaudeAiTools = {
    get value() {
      return setting.state.value;
    },
    get pending() {
      return setting.state.pending;
    },
    get error() {
      return setting.state.error;
    },
    get remote() {
      return source()?.remote === true;
    },
    onChange: (next) => void setting.choose(next),
  };
  return () => (source() ? tools : undefined);
}
