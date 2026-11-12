import { type ClaudeAiToolsSetting, DEFAULT_CLAUDE_AI_TOOLS } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { PreferenceStore } from "./preference-file";

/**
 * Whether the Claude agents of this computer get the Artifact tools and the claude.ai connectors of
 * the Claude Code sign-in. A Claude process reads it when it starts, so a change applies to the next
 * process, not to a running turn. A file without the switch reads as the default, off.
 */
export type ClaudeAiToolsPreferenceStore = PreferenceStore<ClaudeAiToolsSetting>;

export function createClaudeAiToolsPreferenceStore(path: string): ClaudeAiToolsPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_CLAUDE_AI_TOOLS,
    decode: (parsed) =>
      isDynamicRecord(parsed) && parsed.version === 1 && isBoolean(parsed.enabled) ? { enabled: parsed.enabled } : null,
  });
}

/** The switch as Settings and a joined server's admin change it: a change tells `changed`. */
export type ClaudeAiToolsControl = ReturnType<typeof claudeAiToolsControl>;

/**
 * The switch with its change event. `changed` sends the provider status event, so that every open
 * settings page, on this computer and on a joined client, reads the switch again.
 */
export function claudeAiToolsControl(store: ClaudeAiToolsPreferenceStore, changed: () => void) {
  return {
    get: () => store.get(),
    set: Effect.fn("ClaudeAiTools.set")(function* (enabled: boolean) {
      const before = store.get().enabled;
      const next = yield* store.set({ enabled });
      if (before !== enabled) changed();
      return next;
    }),
  };
}
