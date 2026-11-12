// Local REST fixture shared by the E2E script and the isolated UI demo. No cloud calls.
import { createServer } from "node:http";
import { Schema } from "effect";

const bodySchema = Schema.Struct({
  context: Schema.optional(Schema.String),
  cmd: Schema.optional(Schema.String),
  timeout_s: Schema.optional(Schema.Number),
  cwd: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  filename: Schema.optional(Schema.String),
  confirm: Schema.optional(Schema.Boolean),
});
type FixtureBody = typeof bodySchema.Type;

export const FIXTURE_KEY = "demo_agent_computer_key_000000000000";
export const FIXTURE_LIVE = "https://computer.example.invalid/live/demo-human-only";
export const FIXTURE_BILLING = "https://computer.example.invalid/billing/demo-human-only";
export const FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

export async function startAgentComputerFixture() {
  const requests: { method: string; path: string; body: FixtureBody; authenticated: boolean }[] = [];
  let gate: { entered: () => void; wait: Promise<void> } | null = null;
  let hanging: (() => void) | null = null;
  let cancelled: (() => void) | null = null;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body: FixtureBody = Schema.decodeUnknownSync(bodySchema)(
      chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {},
    );
    const path = req.url ?? "";
    const authenticated = req.headers.authorization === `Bearer ${FIXTURE_KEY}`;
    requests.push({ method: req.method ?? "", path, body, authenticated });
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const fail = (code: string, status: number) => json({ error: { code, message: `Fixture ${code}` } }, status);
    if (!authenticated) return fail("UNAUTHORIZED", 401);
    if (path === "/api/v1/machines") {
      if (gate) {
        const pending = gate;
        gate = null;
        pending.entered();
        await pending.wait;
      }
      return json({
        machines: [
          {
            id: "demo-machine",
            context: "demo-project",
            status: "running",
            deadline_at: "2030-01-01T00:00:00.000Z",
            live_view_url: FIXTURE_LIVE,
            updated_at: null,
          },
        ],
      });
    }
    if (path === "/api/v1/machines/start") {
      if (body.context === "exhausted") return fail("ALLOWANCE_EXHAUSTED", 402);
      if (body.context === "malformed") return json({ id: 4 });
      return json({
        id: "demo-machine",
        context: body.context,
        existing: true,
        resumed: false,
        other_contexts: ["earlier-project"],
        live_view_url: FIXTURE_LIVE,
        deadline_at: "2030-01-01T00:00:00.000Z",
        billing: {
          plan: "free",
          minutes_remaining: body.context === "exempt" ? null : 20,
          upgrade_url: FIXTURE_BILLING,
          manage_url: FIXTURE_BILLING,
        },
        briefing: ["Send the human live_view_url now.", "Read ~/PLAYBOOK.md.", FIXTURE_LIVE, FIXTURE_BILLING],
      });
    }
    if (!path.startsWith("/api/v1/machines/demo-machine/")) return fail("UNKNOWN_MACHINE", 404);
    const action = path.split("/").at(-1);
    if (action === "bash") {
      if (body.cmd === "hang") {
        res.on("close", () => cancelled?.());
        hanging?.();
        return;
      }
      if (body.cmd === "paused") return fail("MACHINE_PAUSED", 409);
      return json({
        stdout: body.cmd === "secret" ? FIXTURE_LIVE : "fixture stdout",
        stderr: "fixture stderr",
        exit_code: body.cmd === "failed" ? 3 : 0,
        timed_out: body.cmd === "timeout",
      });
    }
    if (action === "screenshot") {
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(FIXTURE_PNG);
    }
    if (action === "files") {
      if (body.path === "/missing") return fail("FILE_NOT_FOUND", 404);
      if (body.path === "/large") return fail("FILE_TOO_LARGE", 413);
      res.writeHead(200, { "Content-Type": body.path === "/image.png" ? "image/png" : "text/plain" });
      return res.end(body.path === "/image.png" ? FIXTURE_PNG : "fixture file");
    }
    if (action === "publish")
      return json({
        url: "https://downloads.example.invalid/result",
        bytes: 12,
        expires_at: "2030-01-01T00:00:00.000Z",
      });
    if (action === "stop") return json({ id: "demo-machine", status: "paused" });
    if (action === "destroy")
      return body.confirm === true ? json({ id: "demo-machine", status: "destroyed" }) : fail("CONFIRM_REQUIRED", 400);
    return fail("NOT_FOUND", 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    requests,
    blockList() {
      let entered = () => {};
      let release = () => {};
      const arrived = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { entered, wait };
      return { arrived, release };
    },
    expectCancellation() {
      const entered = new Promise<void>((resolve) => {
        hanging = resolve;
      });
      const closed = new Promise<void>((resolve) => {
        cancelled = resolve;
      });
      return { entered, closed };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

if (import.meta.main) {
  const fixture = await startAgentComputerFixture();
  process.stdout.write(`${fixture.baseUrl}\n`);
  process.once("SIGINT", () => void fixture.close().then(() => process.exit(0)));
}
