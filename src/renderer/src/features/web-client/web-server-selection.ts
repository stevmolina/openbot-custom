import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import type { RemoteTeamHost } from "@openbot/team-client/remote-directory";

/** Keep the last server in this browser, separately for each account. */
export function readWebServerSelection(accountId: string): string | null {
  try {
    return window.localStorage.getItem(`openbot.web.selected-server:${accountId}`);
  } catch {
    return null;
  }
}

export function writeWebServerSelection(accountId: string, hostId: string): void {
  try {
    window.localStorage.setItem(`openbot.web.selected-server:${accountId}`, hostId);
  } catch {
    // A UI preference must not block a connection when storage is unavailable.
  }
}

function savedHostKey(accountId: string): string {
  return `openbot.web.selected-server-host:${accountId}`;
}

/**
 * The server that this browser opened last, as the account service listed it. A new page connects to
 * it while it reads the server list, and the list then confirms, updates or removes it.
 */
export function readWebServerSelectionHost(accountId: string): RemoteTeamHost | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(savedHostKey(accountId)) ?? "null");
    const selected = readWebServerSelection(accountId);
    if (!isDynamicRecord(value) || value.hostId !== selected) return null;
    const { hostId, name, logoKey, devicePublicKey, membershipId, role } = value;
    if (
      !isString(hostId) ||
      !isString(name) ||
      !(logoKey === null || isString(logoKey)) ||
      !isString(devicePublicKey) ||
      !isString(membershipId) ||
      (role !== "owner" && role !== "admin" && role !== "member")
    )
      return null;
    return {
      hostId,
      name,
      logoKey,
      devicePublicKey,
      membershipId,
      role,
      ...(isNumber(value.memberLimit) ? { memberLimit: value.memberLimit } : {}),
      ...(isBoolean(value.hosted) ? { hosted: value.hosted } : {}),
      ...(isBoolean(value.restartAvailable) ? { restartAvailable: value.restartAvailable } : {}),
      ...(isNumber(value.storageGb) ? { storageGb: value.storageGb } : {}),
      ...(isNumber(value.keyChangedAt) ? { keyChangedAt: value.keyChangedAt } : {}),
    };
  } catch {
    return null;
  }
}

export function writeWebServerSelectionHost(accountId: string, host: RemoteTeamHost): void {
  try {
    window.localStorage.setItem(savedHostKey(accountId), JSON.stringify(host));
  } catch {
    // A UI preference must not block a connection when storage is unavailable.
  }
}
