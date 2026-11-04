import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationRuntime } from "../agent/conversation-runtime";
import { AgentStore } from "../agent-store";
import { AgentThreadStore } from "../agent-threads/agent-thread-store";
import { runCauseEffect } from "../effect-boundary";
import { MailboxStore } from "../mailbox-store";
import { OpenBotDatabase } from "../openbot-database";
import type { DynamicToolCallParams } from "../protocol";
import { AgentTasks } from "./agent-tasks";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "openbot-task-tool-"));
  const database = new OpenBotDatabase(root);
  cleanup.push(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  await runCauseEffect(database.initialize());
  const agent: AgentSummary = {
    id: "chief",
    provider: "codex",
    name: "Chief",
    title: "Coordinator",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: "openbot-thread-chief",
    workspacePath: root,
    preview: "",
    updatedAt: "2026-11-04T00:00:00.000Z",
    avatarSeed: "chief",
    avatarHue: null,
    avatarUrl: null,
  };
  database.replaceAgents("seed", [agent], "agents.updated");
  const mailbox = new MailboxStore(root, join(root, "shared"), database);
  await runCauseEffect(mailbox.initialize());
  const store = new AgentThreadStore(database);
  const conversation = new ConversationRuntime(new AgentStore(root, root, database), vi.fn(), () => [agent]);
  const queued = vi.fn();
  const tasks = new AgentTasks({
    store,
    mailbox,
    conversation,
    hooks: {
      emit: vi.fn(),
      agent: () => agent,
      hold: () => "task-limit",
      queued,
    },
  });
  return { tasks, store, mailbox, conversation, queued };
}

function call(threadId: string, callId = "start-1"): DynamicToolCallParams {
  return {
    threadId,
    turnId: "turn-1",
    callId,
    namespace: "openbot",
    tool: "start_task",
    arguments: { title: "Research", brief: "Inspect the docs and report the result here." },
  };
}

it.each(["own-chat", "task-thread", "channel-thread", "messaging-thread"])(
  "starts a visible independent task from %s",
  async (threadId) => {
    const { tasks, mailbox, conversation, queued } = await fixture();
    const caller = { agentId: "chief", inExecutionThread: threadId !== "own-chat" };
    const result = await Effect.runPromise(tasks.handleTool(call(threadId), caller));
    expect(result?.success).toBe(true);
    const snapshot = tasks.snapshot("chief");
    expect(snapshot.tasks).toHaveLength(1);
    const task = snapshot.tasks[0];
    expect(task).toMatchObject({ agentId: "chief", title: "Research", state: "queued", hold: "task-limit" });
    expect(task?.threadId).not.toBe(threadId);
    expect(conversation.isTaskThread(task?.threadId ?? null)).toBe(true);
    expect(mailbox.queuedTaskMessages("chief", task?.id ?? "")).toHaveLength(1);
    expect(queued).toHaveBeenCalledWith("chief");
  },
);

it("shares the eight-task cap across callers and returns the same task on retry at the cap", async () => {
  const { tasks, store } = await fixture();
  const caller = { agentId: "chief", inExecutionThread: true };
  const first = await Effect.runPromise(tasks.handleTool(call("task-thread"), caller));
  for (let index = 1; index < 8; index++) {
    const result = await Effect.runPromise(tasks.handleTool(call(`thread-${index}`, `call-${index}`), caller));
    expect(result?.success).toBe(true);
  }
  expect(await Effect.runPromise(tasks.handleTool(call("channel-thread", "over-cap"), caller))).toMatchObject({
    success: false,
  });
  expect(await Effect.runPromise(tasks.handleTool(call("task-thread"), caller))).toEqual(first);
  expect(store.openTaskIds("chief")).toHaveLength(8);
});
