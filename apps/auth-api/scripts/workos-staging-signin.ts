/** Local live-provider check. Staging credentials never go to the production Worker. */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { exportJWK, generateKeyPair } from "jose";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { AuthService, AuthServiceError } from "../src/server/auth-service";
import { type BrowserApiServices, handleBrowserApi } from "../src/server/browser-api";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import { RemoteControlPlane } from "../src/server/remote-control-plane";
import type { WorkerBindings } from "../src/server/types";
import { WorkosSignInError, WorkosSignInService } from "../src/server/workos-sign-in";

const issuer = process.env.WORKOS_STAGING_OIDC_ISSUER;
const clientId = process.env.WORKOS_STAGING_OIDC_CLIENT_ID;
const clientSecret = process.env.WORKOS_STAGING_OIDC_CLIENT_SECRET;
const email = process.env.WORKOS_STAGING_TEST_EMAIL;
if (!issuer || !clientId || !clientSecret || !email || !/^https:\/\/[a-z0-9-]+-staging\.authkit\.app$/u.test(issuer))
  throw new Error("Set the staging OIDC values and WORKOS_STAGING_TEST_EMAIL. Production values are refused.");

const root = resolve(import.meta.dirname, "../../..");
const state = join(root, ".openbot-build", "workos-staging");
await mkdir(state, { recursive: true });
const configPath = join(state, "wrangler.jsonc");
await writeFile(
  configPath,
  JSON.stringify({
    name: "workos-staging-local",
    compatibility_date: "2026-08-18",
    d1_databases: [
      { binding: "DB", database_name: "workos-staging-local", database_id: "00000000-0000-0000-0000-000000000002" },
    ],
    r2_buckets: ["AVATARS", "SKILLS", "SITES"].map((binding) => ({
      binding,
      bucket_name: `workos-staging-${binding.toLowerCase()}`,
    })),
    ratelimits: [
      "MARKETPLACE_INGRESS_RATE_LIMITER",
      "MARKETPLACE_MUTATION_RATE_LIMITER",
      "MARKETPLACE_UPLOAD_RATE_LIMITER",
      "SITE_REPORT_RATE_LIMITER",
      "GITHUB_TOKEN_RATE_LIMITER",
    ].map((name, index) => ({ name, namespace_id: String(9100 + index), simple: { limit: 100, period: 60 } })),
  }),
);
const platform = await getPlatformProxy<WorkerBindings>({
  configPath,
  persist: false,
  remoteBindings: false,
  envFiles: [],
});
try {
  for (const name of (await readdir(join(root, "apps/auth-api/migrations"))).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = await readFile(join(root, "apps/auth-api/migrations", name), "utf8");
    await platform.env.DB.batch(unstable_splitSqlQuery(sql).map((statement) => platform.env.DB.prepare(statement)));
  }
} catch (error) {
  await platform.dispose();
  throw error;
}
const auth = new AuthService({
  repository: new D1AuthRepository(platform.env.DB),
  delivery: null,
  workosSignInRequired: true,
});
const workos = new WorkosSignInService({
  DB: platform.env.DB,
  WORKOS_OIDC_ISSUER: issuer,
  WORKOS_OIDC_CLIENT_ID: clientId,
  WORKOS_OIDC_CLIENT_SECRET: clientSecret,
});
const key = await generateKeyPair("ES256", { extractable: true });
const remote = new RemoteControlPlane({
  DB: platform.env.DB,
  REMOTE_TICKET_KEY_ID: "local-staging",
  REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({
    ...(await exportJWK(key.privateKey)),
    kid: "local-staging",
    alg: "ES256",
  }),
  REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({
    keys: [{ ...(await exportJWK(key.publicKey)), kid: "local-staging", alg: "ES256" }],
  }),
});
const unused = () => {
  throw new Error("This staging check does not expose that operation.");
};
function errorResponse(error: unknown): Response {
  if (error instanceof WorkosSignInError || error instanceof AuthServiceError)
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  return Response.json({ error: { code: "staging_check_failed" } }, { status: 500 });
}
const services: BrowserApiServices = {
  auth,
  remote,
  workosSignIn: () => workos,
  companySignIn: unused,
  hostLogo: unused,
  hosting: unused,
  inviteEmailDelivery: () => null,
  attribution: unused,
  billing: () => null,
  avatarBucket: unused,
  hostedSites: unused,
  sourceIp: () => "local-live-check",
  errorResponse,
};
let allowedHost = "";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Host") !== allowedHost) return new Response(null, { status: 403 });
    if (url.pathname.startsWith("/api/browser/")) return handleBrowserApi(request, services);
    if (url.pathname === "/v1/auth/workos/callback") {
      try {
        const target = await runApiEffect(workos.finish(url.searchParams, request.url));
        return target
          ? new Response(null, {
              status: 303,
              headers: {
                Location: target,
                "Cache-Control": "no-store",
                "Referrer-Policy": "no-referrer",
              },
            })
          : new Response("The sign-in expired. Open the local start page again.", { status: 410 });
      } catch (error) {
        return errorResponse(error);
      }
    }
    if (url.pathname === "/") {
      const response = await handleBrowserApi(
        new Request(`${url.origin}/api/browser/workos/start`, {
          method: "POST",
          headers: { Origin: url.origin, "X-OpenBot-Browser": "1", "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }),
        services,
      );
      if (!response.ok) return response;
      const body = Schema.decodeUnknownSync(Schema.Struct({ authorizationUrl: Schema.String }))(await response.json());
      return new Response(null, {
        status: 303,
        headers: {
          Location: body.authorizationUrl,
          "Set-Cookie": response.headers.get("Set-Cookie") ?? "",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (url.pathname === "/app") {
      const session = await handleBrowserApi(
        new Request(`${url.origin}/api/browser/session`, { headers: request.headers }),
        services,
      );
      const user = session.ok
        ? Schema.decodeUnknownSync(Schema.Struct({ user: Schema.Struct({ email: Schema.String }) }))(
            await session.json(),
          ).user
        : null;
      const report = {
        result: user ? "pass" : "pending",
        issuer,
        email: user?.email ?? null,
        workosError: url.searchParams.get("workosSignInError"),
        localOnly: true,
        checkedAt: new Date().toISOString(),
      };
      await writeFile(join(root, ".openbot-build/workos-staging-signin.json"), `${JSON.stringify(report, null, 2)}\n`);
      return Response.json(report, { headers: { "Cache-Control": "no-store" } });
    }
    return new Response(null, { status: 404 });
  },
});
allowedHost = `localhost:${server.port}`;
const origin = `http://${allowedHost}`;
await writeFile(
  join(state, "runtime.json"),
  `${JSON.stringify({ origin, redirectUri: `${origin}/v1/auth/workos/callback` }, null, 2)}\n`,
);
// Machine-readable: the local URLs contain no credential or sign-in state.
process.stdout.write(`${JSON.stringify({ origin, redirectUri: `${origin}/v1/auth/workos/callback` })}\n`);
async function stop() {
  server.stop(true);
  await platform.dispose();
  process.exit(0);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
