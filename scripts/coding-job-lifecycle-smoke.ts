// Drives the actual supervisor and child process groups. No remote machine or account is used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CODING_JOB_RUNNER } from "../src/backend/agent-tasks/coding-job-runner";

const root = await mkdtemp(join(tmpdir(), "openbot-lifecycle-"));
const checks: string[] = [];
const children: ReturnType<typeof spawn>[] = [];
let cliPid: number | undefined;
const checkpoint = async () => JSON.parse(await readFile(join(root, "checkpoint.json"), "utf8"));
async function phase(expected: string) {
  const watcher = watch(root);
  const deadline = AbortSignal.timeout(15_000);
  try {
    for (;;) {
      try {
        const value = await checkpoint();
        if (value.phase === expected) return value;
      } catch {}
      await once(watcher, "change", { signal: deadline });
    }
  } finally {
    watcher.close();
  }
}
async function control(action: string, deadline = Date.now() + 60_000) {
  await writeFile(join(root, "control.next"), JSON.stringify({ action, deadline }));
  await rename(join(root, "control.next"), join(root, "control.json"));
}
function runner() {
  const child = spawn(process.execPath, [join(root, "runner.cjs")], { cwd: root, stdio: "inherit" });
  children.push(child);
  return child;
}
try {
  await writeFile(join(root, "runner.cjs"), CODING_JOB_RUNNER);
  await writeFile(
    join(root, "job.json"),
    JSON.stringify({
      deadline: Date.now() + 1000,
      testCommand: "setInterval(()=>{},1000); process.on('SIGTERM',()=>process.exit(0))",
    }),
  );
  const first = runner();
  const running = await phase("running");
  cliPid = running.pid;
  assert.ok(cliPid);
  const duplicate = runner();
  await once(duplicate, "exit");
  assert.equal((await checkpoint()).pid, cliPid);
  checks.push("A second supervisor exits without launching another CLI");
  const paused = await phase("paused");
  assert.equal(paused.pid, cliPid);
  process.kill(cliPid, 0);
  checks.push("The deadline saves a paused checkpoint while retaining the CLI process");
  await control("resume");
  const resumed = await phase("running");
  assert.equal(resumed.pid, cliPid);
  assert.equal(resumed.identity, running.identity);
  checks.push("Resume continues the same verified process identity");
  first.kill("SIGKILL");
  await once(first, "exit");
  runner();
  await phase("running");
  await control("stop");
  await phase("stopped");
  // The supervisor owns the whole process group. A recycled PID is never signalled.
  const stoppedPid = cliPid;
  assert.throws(() => process.kill(stoppedPid, 0));
  cliPid = undefined;
  checks.push("A replacement supervisor recovers the process and Stop terminates it");
  const output = resolve(import.meta.dirname, "../.openbot-build/coding-job-lifecycle-smoke");
  await mkdir(output, { recursive: true });
  const report = {
    passed: true,
    checks,
    runtime: process.version,
    platform: process.platform,
    liveRemoteExecution: false,
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  if (cliPid) {
    try {
      process.kill(-cliPid, "SIGCONT");
      process.kill(-cliPid, "SIGKILL");
    } catch {}
  }
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}
