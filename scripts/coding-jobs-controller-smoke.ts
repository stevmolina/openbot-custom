// Runs the actual controller, remote shell commands and supervisor against a local machine fixture.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { CodingComputerFailed, type CodingComputerPort } from "../src/backend/agent-tasks/coding-computer";
import { CodingJobs } from "../src/backend/agent-tasks/coding-jobs";

const root = await mkdtemp(join(tmpdir(), "coding-controller-"));
const bin = join(root, "bin");
await mkdir(bin);
const cli = `#!/bin/sh\nif [ "$1" = login ]; then exit 0; fi\nexec node -e 'setInterval(()=>{},1000);process.on("SIGTERM",()=>process.exit(0))'\n`;
const git = '#!/bin/sh\ncase "$1" in clone) mkdir repo;; -C) mkdir worktree;; diff) printf "fixture diff";; esac\n';
for (const [name, value] of Object.entries({ codex: cli, gh: "#!/bin/sh\nexit 0\n", git })) {
  await writeFile(join(bin, name), value);
  await chmod(join(bin, name), 0o700);
}
const exec = promisify(execFile);
const operations: string[] = [];
let failures = 0;
let refuseStop = false;
const port: CodingComputerPort = {
  start: () => {
    operations.push("START");
    return Effect.succeed({
      id: "fixture",
      deadline_at: new Date(Date.now() + 120_000).toISOString(),
      live_view_url: "https://example.invalid/live",
    });
  },
  stop: () => {
    operations.push("STOP");
    return Effect.void;
  },
  bash: (_id, cmd) => {
    operations.push("BASH");
    if (refuseStop && cmd.includes('"action":"stop"'))
      return Effect.fail(new CodingComputerFailed({ cause: "fixture refusal" }));
    return Effect.tryPromise({
      try: async () => {
        const output = await exec("bash", ["-c", cmd], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          timeout: 25_000,
        });
        return { stdout: output.stdout, stderr: output.stderr };
      },
      catch: (cause) => new CodingComputerFailed({ cause }),
    });
  },
};
const jobs = new CodingJobs(port, () => failures++);
const workspace = join(root, "workspace");
const checkpointPath = join(root, "openbot-coding-jobs", "job1", "checkpoint.json");
const checkpoint = async () => JSON.parse(await readFile(checkpointPath, "utf8"));
let pid: number | undefined;
try {
  const started = await Effect.runPromise(jobs.start("agent", workspace, "job1", "example/project", "Fixture task"));
  assert.equal(started?.phase, "running");
  pid = (await checkpoint()).pid;
  assert.ok(pid);
  const conflicting = await Effect.runPromise(
    jobs.start("agent", workspace, "job2", "example/other", "Other").pipe(Effect.result),
  );
  assert.equal(conflicting._tag, "Failure");
  await Effect.runPromise(jobs.control("agent", workspace, "job1", "pause"));
  assert.equal((await checkpoint()).phase, "paused");
  assert.equal(operations.at(-1), "STOP");
  jobs.dispose();
  const recovered = new CodingJobs(port, () => failures++);
  await Effect.runPromise(recovered.recover([{ id: "agent", workspacePath: workspace }]));
  await Effect.runPromise(recovered.resumePaused("agent", workspace, "job1"));
  assert.equal((await checkpoint()).pid, pid);
  refuseStop = true;
  const stops = operations.filter((name) => name.endsWith("STOP")).length;
  const refused = await Effect.runPromise(recovered.control("agent", workspace, "job1", "stop").pipe(Effect.result));
  assert.equal(refused._tag, "Failure");
  assert.equal(operations.filter((name) => name.endsWith("STOP")).length, stops);
  assert.equal(JSON.parse(await readFile(join(workspace, ".openbot/coding-jobs/job1.json"), "utf8")).phase, "running");
  refuseStop = false;
  await Effect.runPromise(recovered.control("agent", workspace, "job1", "stop"));
  assert.equal((await checkpoint()).phase, "stopped");
  assert.throws(() => process.kill(pid ?? 0, 0));
  pid = undefined;
  recovered.dispose();
  assert.equal(failures, 0);
  const out = resolve(import.meta.dirname, "../.openbot-build/coding-jobs-controller-smoke");
  await mkdir(out, { recursive: true });
  const report = {
    passed: true,
    operations,
    checks: [
      "native launch",
      "single machine ownership",
      "verified pause before machine Stop",
      "persisted recovery",
      "same PID resume",
      "native Stop confirmation",
      "refused Stop never reports stopped or pauses the machine",
    ],
    liveRemoteExecution: false,
  };
  await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  jobs.dispose();
  if (pid) {
    try {
      process.kill(-pid, "SIGCONT");
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
}
