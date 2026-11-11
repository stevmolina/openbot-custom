import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { Effect, Schema } from "effect";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

const TIMEOUT_MS = 10_000;
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class WorkosOidcError extends Schema.TaggedError<WorkosOidcError>()("WorkosOidcError", {
  code: Schema.Literals(["configuration", "provider", "token"]),
}) {}

export interface WorkosMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** Provider-only operations. This adapter does not create accounts or grant server membership. */
export class WorkosOidc {
  readonly #fetch: Fetch;
  readonly #allowLoopback: boolean;

  constructor(options: { fetch?: Fetch; allowLoopback?: boolean } = {}) {
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#allowLoopback = options.allowLoopback ?? false;
  }

  #validUrl(value: string): boolean {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" ||
        (this.#allowLoopback && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    );
  }

  readonly discover = Effect.fn("WorkosOidc.discover")(function* (this: WorkosOidc, issuer: string) {
    if (!this.#validUrl(issuer) || new URL(issuer).search || issuer.endsWith("/")) {
      return yield* new WorkosOidcError({ code: "configuration" });
    }
    const document = yield* Effect.tryPromise({
      try: async () => {
        const response = await this.#fetch(`${issuer}/.well-known/openid-configuration`, {
          headers: { Accept: "application/json" },
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error("discovery failed");
        return response.json();
      },
      catch: () => new WorkosOidcError({ code: "provider" }),
    });
    if (
      !isDynamicRecord(document) ||
      document.issuer !== issuer ||
      !isString(document.authorization_endpoint) ||
      !isString(document.token_endpoint) ||
      !isString(document.jwks_uri) ||
      ![document.authorization_endpoint, document.token_endpoint, document.jwks_uri].every((url) =>
        this.#validUrl(url),
      ) ||
      (Array.isArray(document.token_endpoint_auth_methods_supported) &&
        !document.token_endpoint_auth_methods_supported.includes("client_secret_post"))
    ) {
      return yield* new WorkosOidcError({ code: "configuration" });
    }
    return {
      issuer,
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      jwksUri: document.jwks_uri,
    } satisfies WorkosMetadata;
  });

  readonly redeem = Effect.fn("WorkosOidc.redeem")(function* (
    this: WorkosOidc,
    input: {
      metadata: WorkosMetadata;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      code: string;
      verifier: string;
      nonce: string;
    },
  ) {
    const response = yield* Effect.tryPromise({
      try: async () => {
        const result = await this.#fetch(input.metadata.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: input.code,
            redirect_uri: input.redirectUri,
            code_verifier: input.verifier,
            client_id: input.clientId,
            client_secret: input.clientSecret,
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!result.ok) throw new Error("token exchange failed");
        return result.json();
      },
      catch: () => new WorkosOidcError({ code: "provider" }),
    });
    if (!isDynamicRecord(response) || !isString(response.id_token)) {
      return yield* new WorkosOidcError({ code: "token" });
    }
    const idToken = response.id_token;
    const fetchImplementation = this.#fetch;
    const keys = createRemoteJWKSet(new URL(input.metadata.jwksUri), {
      timeoutDuration: TIMEOUT_MS,
      [customFetch]: (url, options) => fetchImplementation(url, options),
    });
    const verified = yield* Effect.tryPromise({
      try: () =>
        jwtVerify(idToken, keys, {
          issuer: input.metadata.issuer,
          audience: input.clientId,
          algorithms: ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"],
          requiredClaims: ["exp", "sub"],
          clockTolerance: 60,
        }),
      catch: () => new WorkosOidcError({ code: "token" }),
    });
    const claims = verified.payload;
    const email = isString(claims.email) ? normalizeEmailAddress(claims.email) : null;
    if (
      !isString(claims.sub) ||
      !claims.sub ||
      claims.nonce !== input.nonce ||
      claims.email_verified !== true ||
      !email
    ) {
      return yield* new WorkosOidcError({ code: "token" });
    }
    return { subject: claims.sub, email };
  });
}
