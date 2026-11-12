// Drives actual REST, encrypted service, coding adapter, and tools against a local HTTP server.
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { redactSecrets, redactText } from "@openbot/logging";
import { Effect } from "effect";
import { AgentComputerApi } from "../src/backend/agent-computer/agent-computer-api";
import {
  type AgentComputerToolName,
  handleAgentComputerTool,
} from "../src/backend/agent-computer/agent-computer-tools";
import { codingComputer } from "../src/backend/agent-tasks/coding-computer";
import { AgentComputerService } from "../src/main/agent-computer-service";
import {
  decodeAgentComputerMachineListFromHost,
  decodeAgentComputerStatusFromHost,
} from "../src/main/remote-agent-computer-decoding";
import {
  decodeAgentComputerMachineListFromMain,
  decodeAgentComputerStatusFromMain,
} from "../src/preload/agent-computer-decoding";
import {
  FIXTURE_BILLING,
  FIXTURE_KEY,
  FIXTURE_LIVE,
  FIXTURE_PNG,
  startAgentComputerFixture,
} from "./agent-computer-fixture";

const run = Effect.runPromise;
const root = await mkdtemp(join(tmpdir(), "openbot-agent-computer-"));
const out = resolve(".openbot-build/agent-computer-e2e/report.json");
const checks: string[] = [];
const fixture = await startAgentComputerFixture();
const cipherKey = randomBytes(32);
const cipher = {
  encrypt(value: string) {
    const iv = randomBytes(12);
    const encrypt = createCipheriv("aes-256-gcm", cipherKey, iv);
    const encrypted = Buffer.concat([encrypt.update(value, "utf8"), encrypt.final()]);
    return Buffer.concat([iv, encrypt.getAuthTag(), encrypted]);
  },
  decrypt(value: Buffer) {
    const decrypt = createDecipheriv("aes-256-gcm", cipherKey, value.subarray(0, 12));
    decrypt.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decrypt.update(value.subarray(28)), decrypt.final()]).toString("utf8");
  },
};
const path = join(root, "credential.json");
const service = () => new AgentComputerService({ path, cipher, baseUrl: fixture.baseUrl });
const account = service();
const workspace = join(root, "workspace");
await mkdir(workspace);
const tool = (name: AgentComputerToolName, args: unknown, approve = false) =>
  run(
    handleAgentComputerTool(account.api, {
      tool: name,
      arguments: args,
      workspacePath: workspace,
      approve: () => Effect.succeed(approve),
    }),
  );
try {
  await run(account.load());
  assert.equal(account.status().connected, false);
  assert.equal((await run(account.connect("invalid"))).connected, false);
  assert.equal((await run(account.connect(FIXTURE_KEY))).connected, true);
  assert.ok(!(await readFile(path, "utf8")).includes(FIXTURE_KEY));
  const reloaded = service();
  await run(reloaded.load());
  assert.equal(reloaded.key(), FIXTURE_KEY);
  await run(reloaded.test());
  assert.equal((await run(reloaded.machines())).machines.length, 1);
  checks.push("connect, test, list and authenticated encrypted reload");
  const refused = await run(account.connect("wrong_key_that_is_long_enough"));
  assert.equal(account.key(), FIXTURE_KEY);
  assert.match(refused.error ?? "", /UNAUTHORIZED/u);
  checks.push("failed connect preserves the saved key and exact REST error");
  const started = await tool("computer_start", { context: "demo-project" });
  assert.equal(started.success, true);
  for (const secret of [FIXTURE_KEY, FIXTURE_LIVE, FIXTURE_BILLING]) {
    assert.ok(!JSON.stringify(started).includes(secret));
    assert.ok(!redactText(`diagnostic ${secret}`).includes(secret));
    assert.ok(!redactSecrets(`send ${secret}`).includes(secret));
  }
  assert.match(JSON.stringify(started), /PLAYBOOK/u);
  assert.equal((await run(account.api.start("exempt"))).billing?.minutes_remaining, null);
  assert.ok(!JSON.stringify(await tool("computer_list", {})).includes(FIXTURE_LIVE));
  assert.ok(!JSON.stringify(await tool("computer_bash", { id: "demo-machine", cmd: "secret" })).includes(FIXTURE_LIVE));
  checks.push("start/list/bash results, logs, exports and send redaction keep human bearer links private");
  const exhausted = JSON.stringify(await tool("computer_start", { context: "exhausted" }));
  assert.match(exhausted, /ALLOWANCE_EXHAUSTED/u);
  assert.ok(!exhausted.includes("billing/demo-human-only"));
  assert.ok(!redactText(`log ${FIXTURE_BILLING}?t=signed`).includes("demo-human-only"));
  const hugeItem = (await tool("computer_bash", { id: "demo-machine", cmd: "huge" })).contentItems[0];
  const huge = JSON.parse(hugeItem?.type === "inputText" ? hugeItem.text : "{}");
  assert.equal(huge.truncated, true);
  assert.ok(huge.stdout.length <= 64 * 1024 && huge.stdout.endsWith("END"));
  assert.equal(fixture.requests.filter((request) => request.body.context === "exhausted").length, 1);
  assert.match(JSON.stringify(await tool("computer_start", { context: "malformed" })), /BAD_RESPONSE/u);
  assert.match(JSON.stringify(await tool("computer_start", { context: "INVALID" })), /error/u);
  assert.match(JSON.stringify(await tool("computer_bash", { id: "demo-machine", cmd: "paused" })), /MACHINE_PAUSED/u);
  assert.equal((await run(account.api.bash("demo-machine", { cmd: "ok", timeout_s: 600, cwd: "/tmp" }))).exit_code, 0);
  assert.ok(fixture.requests.some((r) => r.body.timeout_s === 600 && r.body.cwd === "/tmp"));
  checks.push(
    "input, malformed response, allowance without billing link, output cap, paused machine and 600-second command contract",
  );
  assert.deepEqual((await run(account.api.screenshot("demo-machine"))).bytes, FIXTURE_PNG);
  assert.equal((await tool("computer_screenshot", { id: "demo-machine" })).contentItems[1]?.type, "inputImage");
  assert.equal((await tool("computer_get_file", { id: "demo-machine", path: "/result.txt" })).success, true);
  assert.equal(await readFile(join(workspace, "computer-files/result.txt"), "utf8"), "fixture file");
  assert.match(
    JSON.stringify(await tool("computer_get_file", { id: "demo-machine", path: "/result.txt" })),
    /result \(2\)\.txt/u,
  );
  assert.equal(await readFile(join(workspace, "computer-files/result (2).txt"), "utf8"), "fixture file");
  assert.equal(
    (await tool("computer_get_file", { id: "demo-machine", path: "/image.png" })).contentItems[1]?.type,
    "inputImage",
  );
  assert.match(
    JSON.stringify(await tool("computer_get_file", { id: "demo-machine", path: "/large" })),
    /FILE_TOO_LARGE/u,
  );
  assert.match(
    JSON.stringify(await tool("computer_get_file", { id: "demo-machine", path: "/missing" })),
    /FILE_NOT_FOUND/u,
  );
  assert.equal(
    (await tool("computer_publish", { id: "demo-machine", path: "/result.txt", filename: "report.txt" })).success,
    true,
  );
  assert.equal((await tool("computer_stop", { id: "demo-machine" })).success, true);
  checks.push("PNG, binary/text files, file errors, publish and pause endpoints");
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "existing.txt"), "unchanged");
  await symlink(outside, join(workspace, "linked"));
  assert.equal(
    (await tool("computer_get_file", { id: "demo-machine", path: "/existing.txt", saveAs: "linked/existing.txt" }))
      .success,
    false,
  );
  assert.equal(await readFile(join(outside, "existing.txt"), "utf8"), "unchanged");
  await symlink(join(outside, "existing.txt"), join(workspace, "file-link"));
  assert.equal(
    (await tool("computer_get_file", { id: "demo-machine", path: "/result.txt", saveAs: "file-link" })).success,
    false,
  );
  assert.equal(
    (await tool("computer_get_file", { id: "demo-machine", path: "/result.txt", saveAs: "../escaped.txt" })).success,
    false,
  );
  await assert.rejects(access(join(root, "escaped.txt")));
  assert.equal(await readFile(join(outside, "existing.txt"), "utf8"), "unchanged");
  if (process.platform !== "win32") {
    assert.equal(
      (
        await tool("computer_get_file", {
          id: "demo-machine",
          path: "/result.txt",
          saveAs: "folder\\..\\..\\backslash.txt",
        })
      ).success,
      true,
    );
    assert.equal(await readFile(join(workspace, "folder\\..\\..\\backslash.txt"), "utf8"), "fixture file");
    await assert.rejects(access(join(root, "backslash.txt")));
  }
  checks.push("linked directories, linked targets and traversal refused; outside file unchanged");
  const before = fixture.requests.length;
  assert.equal((await tool("computer_destroy", { id: "demo-machine" })).success, false);
  assert.equal(fixture.requests.length, before);
  assert.equal((await tool("computer_destroy", { id: "demo-machine" }, true)).success, true);
  assert.deepEqual(fixture.requests.at(-1)?.body, { confirm: true });
  checks.push("explicit destruction approval, refused request does not reach API; fixture-only destroy");
  const coding = codingComputer(account.api);
  assert.equal((await run(coding.bash("demo-machine", "ok", 1))).stdout, "fixture stdout");
  for (const cmd of ["timeout", "failed"])
    assert.equal(await run(coding.bash("demo-machine", cmd, 1).pipe(Effect.isFailure)), true);
  checks.push("coding adapter preserves successful output and fails on timeout/nonzero exit");
  const cancellation = fixture.expectCancellation();
  const controller = new AbortController();
  const pending = run(account.api.bash("demo-machine", { cmd: "hang" }), { signal: controller.signal });
  const cancelled = assert.rejects(pending);
  await cancellation.entered;
  controller.abort();
  await cancelled;
  await cancellation.closed;
  checks.push("Effect interruption aborts actual HTTP request");
  await rm(path);
  await mkdir(path);
  assert.equal(await run(account.disconnect().pipe(Effect.isFailure)), true);
  assert.equal(account.key(), FIXTURE_KEY);
  await rm(path, { recursive: true });
  await run(account.connect(FIXTURE_KEY));
  const gate = fixture.blockList();
  const connecting = run(account.connect(FIXTURE_KEY));
  await gate.arrived;
  const disconnecting = run(account.disconnect());
  gate.release();
  await Promise.all([connecting, disconnecting]);
  assert.equal(account.key(), null);
  await assert.rejects(access(path));
  const after = service();
  await run(after.load());
  assert.equal(after.key(), null);
  checks.push(
    "failed disconnect keeps the key; queued disconnect cannot restore a pending connect in memory or on disk",
  );
  await writeFile(path, "unreadable");
  await run(after.load());
  assert.equal(after.status().connected, false);
  assert.ok(after.status().error);
  const badCipher = new AgentComputerService({
    path,
    baseUrl: fixture.baseUrl,
    cipher: {
      encrypt() {
        throw new Error("fixture cipher failure");
      },
      decrypt: cipher.decrypt,
    },
  });
  assert.equal(await run(badCipher.connect(FIXTURE_KEY).pipe(Effect.isFailure)), true);
  assert.equal(badCipher.key(), null);
  checks.push("corrupt envelope and encryption failures fail closed");
  for (const decode of [decodeAgentComputerStatusFromHost, decodeAgentComputerStatusFromMain])
    assert.throws(() => decode({ connected: "yes" }));
  for (const decode of [decodeAgentComputerMachineListFromHost, decodeAgentComputerMachineListFromMain])
    assert.throws(() => decode({ machines: [{ id: 4 }] }));
  const noKey = new AgentComputerApi({ key: () => null, baseUrl: fixture.baseUrl });
  assert.equal(await run(noKey.list().pipe(Effect.isFailure)), true);
  checks.push("independent host/main boundaries reject malformed values; missing key sends no request");
  await mkdir(resolve(out, ".."), { recursive: true });
  await writeFile(out, `${JSON.stringify({ passed: true, checks, requests: fixture.requests.length }, null, 2)}\n`);
  process.stdout.write(`${checks.length} checks passed. ${out}\n`);
} finally {
  await fixture.close();
  await rm(root, { recursive: true, force: true });
}
