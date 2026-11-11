import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { WorkosOidc } from "../apps/auth-api/src/server/workos-oidc";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "local-key", alg: "RS256", use: "sig" };
let token = "";
const received: { tokenRequest: URLSearchParams | null } = { tokenRequest: null };
let metadataIssuer = "";
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: metadataIssuer,
        authorization_endpoint: `${metadataIssuer}/authorize`,
        token_endpoint: `${metadataIssuer}/token`,
        jwks_uri: `${metadataIssuer}/jwks`,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    }
    if (url.pathname === "/jwks") return Response.json({ keys: [publicJwk] });
    if (url.pathname === "/token") {
      received.tokenRequest = new URLSearchParams(await request.text());
      return Response.json({ id_token: token });
    }
    return new Response(null, { status: 404 });
  },
});
const issuer = server.url.origin;
metadataIssuer = issuer;
const oidc = new WorkosOidc({ allowLoopback: true });
const checks: string[] = [];
try {
  const metadata = await Effect.runPromise(oidc.discover(issuer));
  checks.push("discovery");
  const sign = async (claims: { nonce: string; email: string; email_verified?: boolean }, audience = "client") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "local-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("person-1")
      .setExpirationTime("5m")
      .sign(privateKey);
  const input = {
    metadata,
    clientId: "client",
    clientSecret: "local-secret",
    redirectUri: "https://example.test/v1/auth/workos/callback",
    code: "provider-code",
    verifier: "pkce-verifier",
    nonce: "expected-nonce",
  };
  token = await sign({ nonce: input.nonce, email: "Person@Example.com", email_verified: true });
  assert.deepEqual(await Effect.runPromise(oidc.redeem(input)), { subject: "person-1", email: "person@example.com" });
  assert.equal(received.tokenRequest?.get("client_secret"), "local-secret");
  assert.equal(received.tokenRequest?.get("code_verifier"), "pkce-verifier");
  checks.push("verified identity and token request");
  for (const [name, claims, audience] of [
    ["nonce", { nonce: "wrong", email: "person@example.com", email_verified: true }, "client"],
    ["unverified email", { nonce: input.nonce, email: "person@example.com", email_verified: false }, "client"],
    ["missing verification", { nonce: input.nonce, email: "person@example.com" }, "client"],
    ["audience", { nonce: input.nonce, email: "person@example.com", email_verified: true }, "other"],
  ] as const) {
    token = await sign(claims, audience);
    await assert.rejects(Effect.runPromise(oidc.redeem(input)));
    checks.push(`reject ${name}`);
  }
  token = "invalid.token.signature";
  await assert.rejects(Effect.runPromise(oidc.redeem(input)));
  checks.push("reject invalid signature");
  metadataIssuer = "https://other.example";
  await assert.rejects(Effect.runPromise(oidc.discover(issuer)));
  await assert.rejects(Effect.runPromise(new WorkosOidc().discover(issuer)));
  checks.push("reject issuer mismatch and insecure endpoint");
  await mkdir(".openbot-build", { recursive: true });
  await writeFile(".openbot-build/workos-oidc-e2e.json", `${JSON.stringify({ checks }, null, 2)}\n`);
  process.stdout.write(`Passed ${checks.length} checks. Artifact: .openbot-build/workos-oidc-e2e.json\n`);
} finally {
  server.stop(true);
}
