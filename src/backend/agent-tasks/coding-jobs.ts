import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Semaphore } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../effect-boundary";
import { CodingComputerFailed, type CodingComputerPort, computerValues } from "./coding-computer";
import { CODING_JOB_RUNNER } from "./coding-job-runner";

const stateSchema = z.object({
  taskId: z.string(),
  context: z.string(),
  repository: z.string(),
  task: z.string(),
  machine: z.string().optional(),
  liveViewUrl: z.string().url().optional(),
  deadline: z.number().optional(),
  phase: z.enum(["starting", "running", "paused", "stopped", "blocked", "completed"]),
});
type Job = z.infer<typeof stateSchema>;
const machineSchema = z.object({
  id: z.string().min(1),
  deadline_at: z.string().datetime({ offset: true }),
  live_view_url: z.string().url(),
});
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Owns local job registration, serialized remote controls and deadline timers. No credentials persist here. */
export class CodingJobs {
  #owner: string | null = null;
  readonly #machineLock = Semaphore.makeUnsafe(1);
  readonly #locks = new Map<string, ReturnType<typeof Semaphore.makeUnsafe>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    readonly computer: CodingComputerPort,
    readonly failed: (agentId: string, taskId: string) => void,
  ) {}

  #folder(workspace: string) {
    return join(workspace, ".openbot", "coding-jobs");
  }
  #path(workspace: string, taskId: string) {
    return join(this.#folder(workspace), `${encodeURIComponent(taskId)}.json`);
  }
  #read(workspace: string, taskId: string) {
    try {
      return stateSchema.parse(JSON.parse(readFileSync(this.#path(workspace, taskId), "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }
  #save(workspace: string, job: Job) {
    mkdirSync(this.#folder(workspace), { recursive: true, mode: 0o700 });
    const path = this.#path(workspace, job.taskId);
    writeFileSync(`${path}.next`, JSON.stringify(job), { mode: 0o600 });
    renameSync(`${path}.next`, path);
  }
  #remote(job: Job) {
    return `openbot-coding-jobs/${encodeURIComponent(job.taskId)}`;
  }

  readonly start = Effect.fn("CodingJobs.start")(function* (
    this: CodingJobs,
    agentId: string,
    workspace: string,
    taskId: string,
    repository: string,
    task: string,
  ) {
    if (this.#owner && this.#owner !== taskId)
      return yield* Effect.fail(new CodingComputerFailed({ cause: "Another coding job owns Agent Computer" }));
    this.#owner = taskId;
    yield* Effect.try({
      try: () => this.#save(workspace, { taskId, repository, task, context: "openbot-coding-jobs", phase: "starting" }),
      catch: (cause) => new CodingComputerFailed({ cause }),
    });
    return yield* this.control(agentId, workspace, taskId, "resume");
  });

  readonly control = Effect.fn("CodingJobs.control")(function* (
    this: CodingJobs,
    agentId: string,
    workspace: string,
    taskId: string,
    action: "resume" | "stop" | "pause",
  ) {
    let lock = this.#locks.get(taskId);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      this.#locks.set(taskId, lock);
    }
    return yield* this.#machineLock.withPermit(
      lock.withPermit(
        Effect.gen({ self: this }, function* () {
          const job = yield* Effect.try({
            try: () => this.#read(workspace, taskId),
            catch: (cause) => new CodingComputerFailed({ cause }),
          });
          if (!job) return null;
          if (this.#owner && this.#owner !== taskId)
            return yield* Effect.fail(new CodingComputerFailed({ cause: "Another coding job owns Agent Computer" }));
          this.#owner = taskId;
          if (job.phase === "completed" || job.phase === "stopped") {
            this.#owner = null;
            return job;
          }
          clearTimeout(this.#timers.get(taskId));
          this.#timers.delete(taskId);
          const started = yield* this.computer.call(agentId, "CUSTOM_COMPUTER_COMPUTER_START", {
            context: job.context,
          });
          const machine = findMachine(started);
          if (!machine)
            return yield* Effect.fail(
              new CodingComputerFailed({ cause: "Agent Computer returned no validated machine deadline" }),
            );
          job.machine = machine.id;
          job.liveViewUrl = machine.live_view_url;
          job.deadline = Date.parse(machine.deadline_at) - 60_000;
          yield* Effect.try({
            try: () => this.#save(workspace, job),
            catch: (cause) => new CodingComputerFailed({ cause }),
          });
          const directory = this.#remote(job);
          const payload = Buffer.from(
            JSON.stringify({
              repository: job.repository,
              task: job.task,
              branch: `coding/${job.taskId}`,
              deadline: job.deadline,
            }),
          ).toString("base64");
          const runner = Buffer.from(CODING_JOB_RUNNER).toString("base64");
          const expected =
            action === "resume"
              ? ["running", "completed", "blocked"]
              : [action === "stop" ? "stopped" : "paused", "completed", "blocked"];
          const probe = `const fs=require('fs');const end=Date.now()+15000;const t=setInterval(()=>{if(fs.existsSync('checkpoint.json')){const s=JSON.parse(fs.readFileSync('checkpoint.json'));if(${JSON.stringify(expected)}.includes(s.phase)){clearInterval(t);process.stdout.write('OPENBOT_CODING_CHECKPOINT='+JSON.stringify(s)+'\\n');return}}if(Date.now()>end)process.exit(1)},100)`;
          const command =
            action === "resume"
              ? `mkdir -p ${shellQuote(directory)} && cd ${shellQuote(directory)} && printf %s ${shellQuote(payload)} | base64 -d > job.json && printf %s ${shellQuote(runner)} | base64 -d > runner.cjs && printf %s ${shellQuote(JSON.stringify({ action, deadline: job.deadline }))} > control.next && mv control.next control.json && (nohup node runner.cjs >> runner.log 2>&1 < /dev/null &) && node -e ${shellQuote(probe)}`
              : `cd ${shellQuote(directory)} && printf %s ${shellQuote(JSON.stringify({ action }))} > control.next && mv control.next control.json && node -e ${shellQuote(probe)}`;
          const response = yield* this.computer.call(agentId, "CUSTOM_COMPUTER_COMPUTER_BASH", {
            id: machine.id,
            cmd: command,
            timeout_s: 20,
          });
          const checkpoint = readCheckpoint(response);
          if (!checkpoint || !expected.includes(checkpoint.phase))
            return yield* Effect.fail(new CodingComputerFailed({ cause: "Remote checkpoint was not confirmed" }));
          job.phase = action === "resume" ? "running" : action === "stop" ? "stopped" : "paused";
          if (checkpoint.phase === "completed" || checkpoint.phase === "blocked") job.phase = checkpoint.phase;
          if (action !== "resume" || job.phase !== "running")
            yield* this.computer.call(agentId, "CUSTOM_COMPUTER_COMPUTER_STOP", { id: machine.id });
          yield* Effect.try({
            try: () => this.#save(workspace, job),
            catch: (cause) => new CodingComputerFailed({ cause }),
          });
          if (job.phase === "completed" || job.phase === "stopped" || job.phase === "blocked") this.#owner = null;
          if (action === "resume" && job.phase === "running") {
            this.#schedule(agentId, workspace, job);
          }
          return { ...job, live_view_url: machine.live_view_url };
        }),
      ),
    );
  });

  #schedule(agentId: string, workspace: string, job: Job) {
    this.#timers.set(
      job.taskId,
      setTimeout(
        () => {
          void runCauseEffect(this.#tick(agentId, workspace, job.taskId)).catch(() => this.failed(agentId, job.taskId));
        },
        Math.max(0, Math.min(10_000, (job.deadline ?? Date.now()) - Date.now())),
      ),
    );
  }

  readonly #tick = Effect.fn("CodingJobs.tick")(function* (
    this: CodingJobs,
    agentId: string,
    workspace: string,
    taskId: string,
  ) {
    const job = yield* Effect.try({
      try: () => this.#read(workspace, taskId),
      catch: (cause) => new CodingComputerFailed({ cause }),
    });
    if (job?.phase !== "running" || !job.machine) return;
    if (Date.now() >= (job.deadline ?? 0)) {
      yield* this.control(agentId, workspace, taskId, "pause");
      return;
    }
    const command = `cd ${shellQuote(this.#remote(job))} && node -e ${shellQuote("process.stdout.write('OPENBOT_CODING_CHECKPOINT='+require('fs').readFileSync('checkpoint.json','utf8')+'\\n')")}`;
    const response = yield* this.computer.call(agentId, "CUSTOM_COMPUTER_COMPUTER_BASH", {
      id: job.machine,
      cmd: command,
      timeout_s: 10,
    });
    const checkpoint = readCheckpoint(response);
    if (!checkpoint) return yield* Effect.fail(new CodingComputerFailed({ cause: "Remote checkpoint unavailable" }));
    if (["completed", "blocked", "paused", "stopped"].includes(checkpoint.phase)) {
      yield* this.control(agentId, workspace, taskId, "pause");
      return;
    }
    this.#schedule(agentId, workspace, job);
  });

  readonly resumePaused = Effect.fn("CodingJobs.resumePaused")(function* (
    this: CodingJobs,
    agentId: string,
    workspace: string,
    taskId: string,
  ) {
    const job = yield* Effect.try({
      try: () => this.#read(workspace, taskId),
      catch: (cause) => new CodingComputerFailed({ cause }),
    });
    if (job && (job.phase === "paused" || job.phase === "blocked" || job.phase === "starting"))
      return yield* this.control(agentId, workspace, taskId, "resume");
    return null;
  });

  readonly recover = Effect.fn("CodingJobs.recover")(function* (
    this: CodingJobs,
    agents: readonly { id: string; workspacePath: string }[],
  ) {
    for (const agent of agents) {
      const jobs = yield* Effect.try({
        try: () => {
          try {
            return readdirSync(this.#folder(agent.workspacePath))
              .filter((name) => name.endsWith(".json"))
              .map((name) =>
                stateSchema.parse(JSON.parse(readFileSync(join(this.#folder(agent.workspacePath), name), "utf8"))),
              );
          } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
            throw error;
          }
        },
        catch: (cause) => new CodingComputerFailed({ cause }),
      });
      for (const job of jobs) {
        if (job.phase === "paused") {
          if (!this.#owner) this.#owner = job.taskId;
          continue;
        }
        if (job.phase !== "running" && job.phase !== "starting") continue;
        // Recovery checkpoints first. It never launches a replacement CLI after a host crash.
        yield* this.control(agent.id, agent.workspacePath, job.taskId, "pause").pipe(
          Effect.catch(() => Effect.sync(() => this.failed(agent.id, job.taskId))),
        );
      }
    }
  });

  dispose() {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}

function findMachine(value: z.infer<ReturnType<typeof z.json>>): z.infer<typeof machineSchema> | null {
  for (const item of computerValues(value)) {
    const parsed = machineSchema.safeParse(item);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function readCheckpoint(value: z.infer<ReturnType<typeof z.json>>) {
  for (const item of computerValues(value))
    if (typeof item === "string") {
      for (const line of item.split("\n"))
        if (line.startsWith("OPENBOT_CODING_CHECKPOINT=")) {
          try {
            return z.object({ phase: z.string() }).parse(JSON.parse(line.slice("OPENBOT_CODING_CHECKPOINT=".length)));
          } catch {
            return null;
          }
        }
    }
  return null;
}
