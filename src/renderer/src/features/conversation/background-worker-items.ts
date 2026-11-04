import type { BackgroundWorker } from "@openbot/ui/features/conversation/BackgroundWorkers";
import type { agentAwaitingReplies } from "../../awaiting-replies";

type Reply = ReturnType<typeof agentAwaitingReplies>[number];
type Subagent = { id: string; title: string; status: string; startedAt: string };
type Task = { id: string; title: string; createdAt: string; state: string };

/** One list of the workers that run for a conversation or a side thread: provider subagents, background tasks, and teammates that were asked or work. */
export function backgroundWorkerItems(input: {
  agent: BackgroundWorker["agent"];
  messages: readonly { turnId?: string | undefined; subagents?: readonly Subagent[] | undefined }[];
  activeTurnId: string | null | undefined;
  tasks: readonly Task[];
  excludeTaskId?: string | undefined;
  replies: Iterable<Reply>;
  onOpenSubagent: (id: string) => void;
  onOpenTask: (id: string) => void;
  onOpenAgent: (id: string) => void;
}): BackgroundWorker[] {
  return [
    ...input.messages
      .filter((message) => input.activeTurnId && message.turnId === input.activeTurnId)
      .flatMap((message) =>
        (message.subagents ?? [])
          .filter((worker) => worker.status === "running")
          .map((worker) => ({
            id: `subagent:${worker.id}`,
            agent: input.agent,
            title: worker.title,
            since: worker.startedAt,
            state: "running" as const,
            onOpen: () => input.onOpenSubagent(worker.id),
          })),
      ),
    ...input.tasks
      .filter((task) => task.id !== input.excludeTaskId)
      .map((task) => ({
        id: task.id,
        agent: input.agent,
        title: task.title,
        since: task.createdAt,
        state: task.state === "queued" ? ("queued" as const) : ("running" as const),
        onOpen: () => input.onOpenTask(task.id),
      })),
    ...Array.from(input.replies)
      .filter((item) => (item.state === "working" || item.state === "asked") && !item.wait && item.agent)
      .map((item) => ({
        id: item.id,
        agent: item.agent,
        title: item.taskTitle?.trim() || item.preview?.trim() || item.name,
        since: item.since ?? "",
        state: item.state === "asked" ? ("queued" as const) : ("running" as const),
        onOpen: () => {
          if (item.agent) input.onOpenAgent(item.agent.id);
        },
      })),
  ];
}
