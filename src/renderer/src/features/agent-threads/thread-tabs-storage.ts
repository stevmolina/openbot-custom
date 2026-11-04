import { z } from "zod";

/** The side threads that have a tab on this device, in tab order, and the open tab. */
export interface AgentThreadTabs {
  /** The tabs of the chat header. */
  open: string[];
  active: string | null;
  /** The tabs of the side panel, where each thread shows beside the agent's own chat. */
  side: string[];
}

/** Server id → agent id → tabs. */
export type ThreadTabsByServer = Record<string, Record<string, AgentThreadTabs>>;

const THREAD_TABS_STORAGE_KEY = "openbot:thread-tabs:v1";
/** More tabs than this do not fit in a header. */
const MAX_STORED_TABS = 50;

type ThreadTabsStorage = Pick<Storage, "getItem" | "setItem">;

const id = z.string().trim().min(1).max(200);
const idList = z.array(id.nullable().catch(null)).catch([]);
const agentTabsSchema = z.object({
  open: idList,
  active: id.nullable().catch(null),
  side: idList,
});
const threadTabsSchema = z.record(id, z.record(id, agentTabsSchema.nullable().catch(null)).catch({}));

export function readThreadTabs(storage: ThreadTabsStorage = window.localStorage): ThreadTabsByServer {
  try {
    const parsed = threadTabsSchema.safeParse(JSON.parse(storage.getItem(THREAD_TABS_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    const result: ThreadTabsByServer = {};
    for (const [serverId, agents] of Object.entries(parsed.data)) {
      const byAgent: Record<string, AgentThreadTabs> = {};
      for (const [agentId, tabs] of Object.entries(agents)) {
        if (!tabs) continue;
        const side = uniqueIds(tabs.side);
        // `open` also holds the side panel tabs, so an older version shows them in the chat header.
        const open = uniqueIds(tabs.open).filter((tab) => !side.includes(tab));
        if (open.length > 0 || side.length > 0 || tabs.active) byAgent[agentId] = { open, active: tabs.active, side };
      }
      if (Object.keys(byAgent).length > 0) result[serverId] = byAgent;
    }
    return result;
  } catch {
    return {};
  }
}

function uniqueIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.flatMap((tab) => (tab ? [tab] : [])))].slice(0, MAX_STORED_TABS);
}

export function writeThreadTabs(tabs: ThreadTabsByServer, storage: ThreadTabsStorage = window.localStorage): void {
  const stored = Object.fromEntries(
    Object.entries(tabs).map(([serverId, agents]) => [
      serverId,
      Object.fromEntries(
        Object.entries(agents).map(([agentId, agent]) => [
          agentId,
          { open: [...agent.open, ...agent.side], active: agent.active, side: agent.side },
        ]),
      ),
    ]),
  );
  try {
    storage.setItem(THREAD_TABS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A UI preference must not block navigation when browser storage is unavailable.
  }
}

/**
 * One tab of the tabs of all agents: an agent's own chat (`main`), its new thread (`draft`) or one of
 * its side threads. The tabs of all agents show in the chat header in the order the user opened them,
 * as in a browser.
 */
export interface OpenThreadTab {
  agentId: string;
  threadId: string;
}

/** Server id → tabs of all agents, in tab order. */
export type OpenTabsByServer = Record<string, OpenThreadTab[]>;

/** Version 1 kept a tab list per agent in `openbot:thread-tabs:v1`, which still holds the side panel tabs. */
const OPEN_TABS_STORAGE_KEY = "openbot:open-tabs:v1";

const openTabSchema = z.object({ agentId: id, threadId: id });
const openTabsSchema = z.record(id, z.array(openTabSchema.nullable().catch(null)).catch([]));

function uniqueTabs(tabs: readonly (OpenThreadTab | null)[]): OpenThreadTab[] {
  const seen = new Set<string>();
  const result: OpenThreadTab[] = [];
  for (const tab of tabs) {
    if (!tab) continue;
    const key = `${tab.agentId}/${tab.threadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ agentId: tab.agentId, threadId: tab.threadId });
  }
  return result.slice(0, MAX_STORED_TABS);
}

/**
 * Reads the tabs of all agents. Before the first write, the side thread tabs of each agent from
 * version 1 are the tabs, agent after agent, so no open tab is lost.
 */
export function readOpenTabs(storage: ThreadTabsStorage = window.localStorage): OpenTabsByServer {
  try {
    const raw = storage.getItem(OPEN_TABS_STORAGE_KEY);
    if (raw === null) {
      const result: OpenTabsByServer = {};
      for (const [serverId, agents] of Object.entries(readThreadTabs(storage))) {
        const tabs = uniqueTabs(
          Object.entries(agents).flatMap(([agentId, agent]) => agent.open.map((threadId) => ({ agentId, threadId }))),
        );
        if (tabs.length > 0) result[serverId] = tabs;
      }
      return result;
    }
    const parsed = openTabsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    const result: OpenTabsByServer = {};
    for (const [serverId, tabs] of Object.entries(parsed.data)) {
      const unique = uniqueTabs(tabs);
      if (unique.length > 0) result[serverId] = unique;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeOpenTabs(tabs: OpenTabsByServer, storage: ThreadTabsStorage = window.localStorage): void {
  try {
    storage.setItem(OPEN_TABS_STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // A UI preference must not block navigation when browser storage is unavailable.
  }
}

/** A side thread that is archived and waits for the end of its Undo time before the delete. */
export interface PendingThreadDelete {
  serverId: string;
  agentId: string;
  threadId: string;
  /** Epoch milliseconds. After this time, any window of this device can finish the delete. */
  deadline: number;
  /** The thread was not archived before the delete, so Undo restores it. */
  restore: boolean;
}

const THREAD_DELETES_STORAGE_KEY = "openbot:thread-deletes:v1";
/** A device does not delete more threads than this in one Undo time. */
const MAX_STORED_DELETES = 200;

const pendingDeleteSchema = z.object({
  serverId: id,
  agentId: id,
  threadId: id,
  deadline: z.number().finite(),
  restore: z.boolean(),
});
const pendingDeletesSchema = z.array(pendingDeleteSchema.nullable().catch(null)).catch([]);

export function readPendingThreadDeletes(storage: ThreadTabsStorage = window.localStorage): PendingThreadDelete[] {
  try {
    const parsed = pendingDeletesSchema.parse(JSON.parse(storage.getItem(THREAD_DELETES_STORAGE_KEY) ?? "[]"));
    return parsed.flatMap((entry) => (entry ? [entry] : [])).slice(0, MAX_STORED_DELETES);
  } catch {
    return [];
  }
}

function writePendingThreadDeletes(deletes: readonly PendingThreadDelete[], storage: ThreadTabsStorage): void {
  try {
    storage.setItem(THREAD_DELETES_STORAGE_KEY, JSON.stringify(deletes.slice(-MAX_STORED_DELETES)));
  } catch {
    // Without browser storage, a delete still runs at the end of its Undo time in this window.
  }
}

const sameDelete = (a: PendingThreadDelete, b: Pick<PendingThreadDelete, "serverId" | "threadId">) =>
  a.serverId === b.serverId && a.threadId === b.threadId;

export function addPendingThreadDelete(
  entry: PendingThreadDelete,
  storage: ThreadTabsStorage = window.localStorage,
): void {
  writePendingThreadDeletes(
    [...readPendingThreadDeletes(storage).filter((stored) => !sameDelete(stored, entry)), entry],
    storage,
  );
}

/** Removes a stored delete. Returns false when another window removed it first. */
export function takePendingThreadDelete(
  entry: Pick<PendingThreadDelete, "serverId" | "threadId">,
  storage: ThreadTabsStorage = window.localStorage,
): boolean {
  const stored = readPendingThreadDeletes(storage);
  const kept = stored.filter((candidate) => !sameDelete(candidate, entry));
  if (kept.length === stored.length) return false;
  writePendingThreadDeletes(kept, storage);
  return true;
}

/** Removes the stored deletes of a deleted agent: its threads went with it. */
export function forgetPendingThreadDeletes(
  serverId: string,
  agentId: string,
  storage: ThreadTabsStorage = window.localStorage,
): void {
  const stored = readPendingThreadDeletes(storage);
  const kept = stored.filter((entry) => entry.serverId !== serverId || entry.agentId !== agentId);
  if (kept.length !== stored.length) writePendingThreadDeletes(kept, storage);
}
