import type { Accessor } from "solid-js";
import type { ServerSettingsModalProps } from "./ServerSettingsModal";

/**
 * What the server settings give each section it builds. A section's panel unmounts while
 * another tab is selected, so the dialog creates each section once and the section keeps its state
 * here, not in the panel.
 */
export interface ServerSettingsSectionHost {
  props: ServerSettingsModalProps;
  local: Accessor<boolean>;
  configured: Accessor<boolean>;
  published: Accessor<boolean>;
  /** False while a remote server is offline: nothing can be changed there. */
  actionsAvailable: Accessor<boolean>;
  /** The dialog element, where menus and selects mount so that they stay inside its focus scope. */
  menuMount: Accessor<HTMLElement | undefined>;
  /** The key of an action in flight, or null. An exclusive action (a destructive one, a form save) gates on this. */
  busy: Accessor<string | null>;
  /** Whether an exclusive action is in flight. A concurrent setting only waits for these. */
  blocked: Accessor<boolean>;
  /** Whether this key has its own action in flight, or an exclusive action blocks every control. */
  isBusy(key: string): boolean;
  /**
   * Runs one action, shows its failure as a toast, and says whether it succeeded. A key in
   * `CONCURRENT_ACTION_KEYS` waits only for itself and for exclusive actions; every other key
   * is exclusive and waits for all actions.
   */
  run(key: string, action: () => Promise<void>): Promise<boolean>;
  showCopyError(): void;
}

/**
 * Settings that save on one tap and do not touch each other: a pending save of one must not dim the others
 * or drop a tap on them. Every other action stays exclusive: destructive ones (remove a member, rotate the
 * host key, remove a routine feed), forms (identity, invite, company sign-in) and server-wide changes.
 */
export const CONCURRENT_ACTION_KEYS: ReadonlySet<string> = new Set([
  "timezone",
  "memoryLimit",
  "memoryReview",
  "skillLearning",
  "browsingMemory",
  "personality",
]);
