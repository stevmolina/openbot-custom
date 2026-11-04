import { describe, expect, it } from "vitest";
import { backgroundWorkerItems } from "./background-worker-items";

const base = {
  agent: undefined,
  activeTurnId: null,
  messages: [],
  tasks: [],
  replies: [],
  onOpenSubagent: () => undefined,
  onOpenTask: () => undefined,
  onOpenAgent: () => undefined,
};
const sub = (status: string, background?: true) => ({
  id: "toolu_1",
  title: "Audit worker rows",
  status,
  startedAt: "2026-11-04T17:00:00.000Z",
  ...(background ? { background } : {}),
});
const titles = (messages: Parameters<typeof backgroundWorkerItems>[0]["messages"], activeTurnId: string | null) =>
  backgroundWorkerItems({ ...base, messages, activeTurnId }).map((item) => `${item.title}:${item.state}`);

describe("backgroundWorkerItems subagents", () => {
  it("keeps a background subagent after its turn ended", () => {
    expect(titles([{ turnId: "turn-1", subagents: [sub("running", true)] }], null)).toEqual([
      "Audit worker rows:running",
    ]);
  });
  it("drops the row once the subagent finished", () => {
    expect(titles([{ turnId: "turn-1", subagents: [sub("completed", true)] }], null)).toEqual([]);
  });
  it("uses the latest state when a later message reports the end", () => {
    expect(
      titles(
        [
          { turnId: "turn-1", subagents: [sub("running", true)] },
          { turnId: "turn-2", subagents: [sub("stopped", true)] },
        ],
        "turn-2",
      ),
    ).toEqual([]);
  });
  it("shows a foreground subagent only in the active turn", () => {
    const messages = [{ turnId: "turn-1", subagents: [sub("running")] }];
    expect(titles(messages, "turn-1")).toEqual(["Audit worker rows:running"]);
    expect(titles(messages, null)).toEqual([]);
  });
});
