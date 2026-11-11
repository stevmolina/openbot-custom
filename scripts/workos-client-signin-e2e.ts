/** Drives the real desktop account manager, HTTP API boundary and loopback callback. */
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CentralAuthState } from "@openbot/contracts/ipc";
import { translateFor } from "@openbot/i18n";
import { Schema } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";

const output = resolve(import.meta.dirname, "../.openbot-build/workos-client-signin");
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(output, "state-"));
const managers: CentralAuthManager[] = [];
const checks: string[] = [];
let provider: "company" | "workos" = "workos";
let origin = "";
let exchanges = 0;
const startSchema = Schema.Struct({
  email: Schema.String,
  returnTo: Schema.String,
  clientState: Schema.String,
  clientChallenge: Schema.String,
});
const exchangeSchema = Schema.Struct({ code: Schema.String, codeVerifier: Schema.String });
type Flow = typeof startSchema.Type;
const flows = new Map<string, Flow>();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health/live") return Response.json({ status: "ok" });
    if (url.pathname === "/v1/auth/email/start")
      return Response.json(
        {
          error: {
            code: provider === "workos" ? "workos_sign_in_required" : "company_sign_in_required",
            message: "Use the browser.",
          },
        },
        { status: 409 },
      );
    const startPath = provider === "workos" ? "/v1/auth/workos/start" : "/v1/auth/company/start";
    const exchangePath = provider === "workos" ? "/v1/auth/workos/exchange" : "/v1/auth/company/exchange";
    if (url.pathname === startPath) {
      const flow = Schema.decodeUnknownSync(startSchema)(await request.json());
      const code = randomBytes(32).toString("base64url");
      flows.set(code, flow);
      return Response.json({ authorizationUrl: `${origin}/provider?flow=${code}` });
    }
    if (url.pathname === "/provider") {
      const code = url.searchParams.get("flow") ?? "";
      const flow = flows.get(code);
      assert(flow);
      const target = new URL(flow.returnTo);
      target.searchParams.set("code", code);
      target.searchParams.set("state", flow.clientState);
      return Response.redirect(target, 303);
    }
    if (url.pathname === exchangePath) {
      const body = Schema.decodeUnknownSync(exchangeSchema)(await request.json());
      const flow = flows.get(body.code);
      assert(flow);
      assert.equal(createHash("sha256").update(body.codeVerifier).digest("base64url"), flow.clientChallenge);
      flows.delete(body.code);
      exchanges++;
      return Response.json({
        sessionToken: randomBytes(32).toString("base64url"),
        user: { id: "local-user", email: flow.email, name: null, avatarUrl: null },
      });
    }
    if (url.pathname === "/v1/auth/logout") return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  },
});
origin = server.url.origin;
function until(
  manager: CentralAuthManager,
  predicate: (state: CentralAuthState) => boolean,
): Promise<CentralAuthState> {
  const current = manager.getState();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolveState, reject) => {
    const deadline = AbortSignal.timeout(10_000);
    const changed = (state: CentralAuthState) => {
      if (!predicate(state)) return;
      manager.off("changed", changed);
      deadline.removeEventListener("abort", aborted);
      resolveState(state);
    };
    const aborted = () => {
      manager.off("changed", changed);
      reject(new Error("No expected account event."));
    };
    manager.on("changed", changed);
    deadline.addEventListener("abort", aborted, { once: true });
  });
}
let sequence = 0;
function manager(open?: (url: string) => Promise<void>) {
  const current = new CentralAuthManager({
    apiUrl: origin,
    storagePath: join(temporary, `session-${++sequence}`),
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
    ...(open
      ? { companySignInBrowser: { open, language: () => ({ locale: "en", translate: translateFor("en") }) } }
      : {}),
  });
  managers.push(current);
  return current;
}
try {
  for (const kind of ["workos", "company"] as const) {
    provider = kind;
    const current = manager(async (page) => {
      const result = await fetch(page);
      assert.equal(result.status, 200);
    });
    assert.equal((await runCauseEffect(current.initialize())).status, "signed_out");
    const signed = until(
      current,
      (state) => state.status === "signed_in" || (state.status === "company_sign_in" && Boolean(state.issue)),
    );
    const opened = await runCauseEffect(current.requestEmailCode("person@example.test"));
    assert.equal(opened.status, "company_sign_in");
    if (opened.status === "company_sign_in") assert.equal(opened.provider, kind === "workos" ? "workos" : undefined);
    const completed = await signed;
    assert.equal(completed.status, "signed_in");
    if (completed.status === "signed_in") assert.equal(completed.user.email, "person@example.test");
    assert((await readFile(join(temporary, `session-${sequence}`), "utf8")).length > 0);
    await runCauseEffect(current.logout());
    assert.equal(current.getState().status, "signed_out");
    checks.push(
      `${kind}: email response selects correct browser start/exchange, loopback PKCE, session storage and sign-out`,
    );
  }

  provider = "workos";
  let didOpen: (url: string) => void = () => undefined;
  const openedPage = new Promise<string>((resolvePage) => {
    didOpen = resolvePage;
  });
  const cancelled = manager(async (page) => {
    didOpen(page);
  });
  await runCauseEffect(cancelled.initialize());
  await runCauseEffect(cancelled.requestEmailCode("cancel@example.test"));
  await openedPage;
  const before = exchanges;
  await runCauseEffect(cancelled.cancelCompanySignIn());
  assert.equal(cancelled.getState().status, "signed_out");
  await runCauseEffect(cancelled.dispose());
  assert.equal(exchanges, before);
  checks.push("WorkOS cancellation returns to sign-out without exchanging a code");

  const unavailable = manager();
  await runCauseEffect(unavailable.initialize());
  const state = await runCauseEffect(unavailable.requestEmailCode("headless@example.test"));
  assert.equal(state.status, "company_sign_in");
  if (state.status === "company_sign_in") {
    assert.equal(state.provider, "workos");
    assert(state.issue);
  }
  await runCauseEffect(unavailable.cancelCompanySignIn());
  assert.equal(unavailable.getState().status, "signed_out");
  checks.push("WorkOS without a browser reports an issue and can be cancelled");

  await writeFile(join(output, "report.json"), `${JSON.stringify({ result: "pass", checks }, null, 2)}\n`);
  // Machine-readable: only behavior and the artifact path are printed.
  process.stdout.write(
    `Passed ${checks.length} client checks. Artifact: .openbot-build/workos-client-signin/report.json\n`,
  );
} finally {
  for (const current of managers) await runCauseEffect(current.dispose());
  server.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
