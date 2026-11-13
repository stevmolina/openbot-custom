// The keys of the saved workspace frames and their deletion. The web client deletes the frames on
// sign-out before it loads the workspace code, so this file imports no contract validators.

export type FrameStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const FRAME_KEY_PREFIX = "openbot:remote-frame:v1:";

export function frameKey(accountId: string, serverId: string): string {
  return `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(serverId)}`;
}

/** The last channel rows written for each frame. A channel list comes on each channel event. */
export const savedChannelRows = new Map<string, string>();

/** The last unread counts written for each frame. The counts come again on each read of the host. */
export const savedUnreadCounts = new Map<string, string>();

function frameKeys(storage: FrameStorage, prefix: string): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * Deletes the frames of an account. With `keepServerIds`, the frames of those servers stay; without
 * it, the frames of every account go, as after a sign-out.
 */
export function deleteRemoteWorkspaceFrames(
  accountId: string | null,
  keepServerIds: readonly string[] = [],
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.clear();
  savedUnreadCounts.clear();
  try {
    const prefix = accountId === null ? FRAME_KEY_PREFIX : `${FRAME_KEY_PREFIX}${encodeURIComponent(accountId)}:`;
    const kept = new Set(accountId === null ? [] : keepServerIds.map((serverId) => frameKey(accountId, serverId)));
    for (const key of frameKeys(storage, prefix)) if (!kept.has(key)) storage.removeItem(key);
  } catch {
    // Blocked storage holds no frame.
  }
}

export function deleteRemoteWorkspaceFrame(
  accountId: string,
  serverId: string,
  storage: FrameStorage = window.localStorage,
): void {
  savedChannelRows.delete(frameKey(accountId, serverId));
  savedUnreadCounts.delete(frameKey(accountId, serverId));
  try {
    storage.removeItem(frameKey(accountId, serverId));
  } catch {
    // Blocked storage holds no frame.
  }
}
