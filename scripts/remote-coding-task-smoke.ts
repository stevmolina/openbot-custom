// Drives the real coding-tool handler, SQLite task store and mailbox. No provider or remote machine starts.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { AgentTasks } from "../src/backend/agent-tasks/agent-tasks";
import { AgentThreadStore } from "../src/backend/agent-threads/agent-thread-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { OPENBOT_DYNAMIC_TOOLS } from "../src/backend/openbot-tools";
import type { DynamicToolCallParams } from "../src/backend/protocol";

const root = await mkdtemp(join(tmpdir(), "openbot-coding-smoke-"));
const database = new OpenBotDatabase(root);
const out = resolve(import.meta.dirname, "../.openbot-build/remote-coding-task-smoke");
const checks: string[] = [];
try {
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
  const conversation = new ConversationRuntime(
    new AgentStore(root, root, database),
    () => {},
    () => [agent],
  );
  let queued = 0;
  const tasks = new AgentTasks({
    store,
    mailbox,
    conversation,
    hooks: {
      emit: () => {},
      agent: () => agent,
      hold: () => "task-limit",
      queued: () => {
        queued += 1;
      },
    },
  });
  const caller = { agentId: agent.id, inExecutionThread: true };
  const call: DynamicToolCallParams = {
    namespace: "openbot",
    threadId: "side-thread",
    turnId: "turn-1",
    callId: "call-1",
    tool: "run_coding_task",
    arguments: {
      repository: "example/project",
      title: "Fix a bug",
      task: "Fix the approved bug and run focused checks.",
    },
  };
  assert.ok(OPENBOT_DYNAMIC_TOOLS.tools.some((tool) => tool.name === call.tool));
  assert.equal((await Effect.runPromise(tasks.handleTool(call, caller)))?.success, true);
  const task = tasks.snapshot(agent.id).tasks[0];
  assert.ok(task);
  assert.equal(task.state, "queued");
  assert.equal(task.hold, "task-limit");
  const messages = mailbox.queuedTaskMessages(agent.id, task.id);
  assert.equal(messages.length, 1);
  const brief = messages[0]?.text;
  assert.ok(brief);
  assert.ok(brief.includes("Repository: example/project"));
  assert.ok(brief.includes("checkpoint.json"));
  assert.ok(brief.includes("does not itself kill remote processes"));
  assert.ok(brief.includes("Fix the approved bug"));
  assert.equal(new AgentThreadStore(database).task(task.id)?.title, "Fix a bug");
  checks.push("catalog dispatch creates a persisted visible task and queues its complete recovery brief");
  await Effect.runPromise(tasks.handleTool(call, caller));
  assert.equal(tasks.snapshot(agent.id).tasks.length, 1);
  assert.equal(queued, 1);
  checks.push("retry reuses the task and does not enqueue or start a duplicate");
  for (const repository of ["https://token@github.com/a/b", "a/b;id", "-flag/repo", "a/b/c"]) {
    const result = await Effect.runPromise(
      tasks.handleTool(
        { ...call, callId: repository, arguments: { repository, title: "Invalid", task: "Do work" } },
        caller,
      ),
    );
    assert.equal(result?.success, false);
  }
  assert.equal(tasks.snapshot(agent.id).tasks.length, 1);
  checks.push("credential URLs, command syntax and malformed repository identifiers create no tasks");
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    JSON.stringify({ passed: true, checks, liveRemoteExecution: "not tested: sign-in required" }, null, 2),
  );
  // Machine-readable: focused smoke proof.
  process.stdout.write(`${JSON.stringify({ passed: true, checks })}\n`);
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}
