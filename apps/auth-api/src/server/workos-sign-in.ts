import { MOBILE_COMPANY_SIGN_IN_RETURN } from "@openbot/contracts/company-sign-in";
import { isAvatarColor } from "@openbot/contracts/ipc";
import { normalizeEmailAddress } from "@openbot/contracts/validation";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { randomToken, sha256 } from "./crypto";
import { mobileSessionStatements } from "./d1-auth-repository";
import { PERSISTENT_SESSION_EXPIRES_AT } from "./session-policy";
import type { AuthUser, MobileAuthDeviceIdentity, WorkerBindings } from "./types";
import { WorkosOidc, type WorkosOidcError } from "./workos-oidc";

const FLOW_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 2 * 60_000;
const RATE_WINDOW_MS = 15 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CALLBACK_PATH = "/v1/auth/workos/callback";
export const WORKOS_WEB_RETURN_PATH = "/api/browser/workos/return";
type Bindings = Pick<
  WorkerBindings,
  "DB" | "WORKOS_OIDC_ISSUER" | "WORKOS_OIDC_CLIENT_ID" | "WORKOS_OIDC_CLIENT_SECRET"
>;

export class WorkosSignInError extends Schema.TaggedError<WorkosSignInError>()("WorkosSignInError", {
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}
class WorkosSignInOperationError extends Schema.TaggedError<WorkosSignInOperationError>()(
  "WorkosSignInOperationError",
  {},
) {}
type WorkosSignInFailure = WorkosSignInError | WorkosSignInOperationError;

/** Partial configuration also closes email sign-in. Missing credentials must not open another route. */
export function workosSignInEnabled(bindings: Omit<Bindings, "DB">): boolean {
  return [bindings.WORKOS_OIDC_ISSUER, bindings.WORKOS_OIDC_CLIENT_ID, bindings.WORKOS_OIDC_CLIENT_SECRET].some(
    (value) => value !== undefined,
  );
}
const configured = Effect.fn("WorkosSignIn.configuration")(function* (bindings: Bindings) {
  const issuer = bindings.WORKOS_OIDC_ISSUER?.trim();
  const clientId = bindings.WORKOS_OIDC_CLIENT_ID?.trim();
  const clientSecret = bindings.WORKOS_OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) {
    return yield* new WorkosSignInError(
      503,
      "workos_sign_in_not_configured",
      sourceText("error.auth.workosSignInUnavailable"),
    );
  }
  return { issuer, clientId, clientSecret };
});
function hash(value: string) {
  return sha256(value).pipe(Effect.mapError(() => new WorkosSignInOperationError({})));
}
function storeCall<A>(operation: () => Promise<A>): Effect.Effect<A, WorkosSignInOperationError> {
  return Effect.tryPromise({ try: operation, catch: () => new WorkosSignInOperationError({}) });
}
function providerError(error: WorkosOidcError): WorkosSignInError {
  if (error.code === "configuration")
    return new WorkosSignInError(
      503,
      "workos_sign_in_not_configured",
      sourceText("error.auth.workosSignInUnavailable"),
    );
  if (error.code === "token")
    return new WorkosSignInError(401, "workos_token_invalid", sourceText("error.auth.workosSignInTokenInvalid"));
  return new WorkosSignInError(502, "workos_provider_rejected", sourceText("error.auth.workosSignInProviderRejected"));
}
function invalid() {
  return new WorkosSignInError(400, "invalid_workos_sign_in_code", sourceText("error.auth.workosSignInFailed"));
}
interface FlowRow {
  issuer: string;
  client_id: string;
  verifier: string;
  nonce: string;
  return_to: string;
  redirect_uri: string;
  client_state: string;
  client_challenge: string;
  mobile: number;
  expires_at: number;
}
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  analytics_enabled: number | null;
  chat_color: string | null;
}
function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    analyticsEnabled: row.analytics_enabled === null ? null : row.analytics_enabled === 1,
    chatColor: isAvatarColor(row.chat_color) ? row.chat_color : null,
  };
}

/** WorkOS authenticates an account. Server membership still requires the existing invitation checks. */
export class WorkosSignInService {
  readonly #bindings: Bindings;
  readonly #database: D1Database;
  readonly #provider: WorkosOidc;
  readonly #now: () => number;
  readonly #flushSessionRevocations: () => Effect.Effect<void>;
  constructor(
    bindings: Bindings,
    options: {
      provider?: WorkosOidc;
      now?: () => number;
      flushSessionRevocations?: () => Effect.Effect<void>;
    } = {},
  ) {
    this.#bindings = bindings;
    this.#database = bindings.DB;
    this.#provider = options.provider ?? new WorkosOidc();
    this.#now = options.now ?? Date.now;
    this.#flushSessionRevocations = options.flushSessionRevocations ?? (() => Effect.void);
  }

  readonly startSignIn = Effect.fn("WorkosSignIn.startSignIn")(function* (
    this: WorkosSignInService,
    input: { email: string; returnTo: string; clientState: string; clientChallenge: string; sourceIp: string },
    requestUrl: string,
    webOrigin?: string,
  ): Effect.fn.Return<{ authorizationUrl: string }, WorkosSignInFailure> {
    const configuration = yield* configured(this.#bindings);
    const email = normalizeEmailAddress(input.email);
    if (
      !email ||
      !TOKEN_PATTERN.test(input.clientState) ||
      !CHALLENGE_PATTERN.test(input.clientChallenge) ||
      !URL.canParse(input.returnTo)
    )
      return yield* invalid();
    const target = new URL(input.returnTo);
    const mobile = input.returnTo === MOBILE_COMPANY_SIGN_IN_RETURN;
    const loopback =
      target.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(target.hostname) &&
      target.port !== "" &&
      target.pathname === "/company-sign-in";
    const web =
      webOrigin !== undefined &&
      target.origin === webOrigin &&
      target.pathname === WORKOS_WEB_RETURN_PATH &&
      webOrigin === new URL(requestUrl).origin;
    if ((!mobile && !loopback && !web) || target.username || target.password || target.search || target.hash)
      return yield* invalid();
    // No per-email limit: the email is only a login hint, so a limit on it would let anyone block a person.
    yield* this.#enforceRateLimit(`workos:start:ip:${input.sourceIp}`, 20);
    const metadata = yield* this.#provider.discover(configuration.issuer).pipe(Effect.mapError(providerError));
    const state = randomToken(32);
    const verifier = randomToken(48);
    const nonce = randomToken(24);
    const redirectUri = new URL(CALLBACK_PATH, requestUrl).toString();
    const now = this.#now();
    const stateHash = yield* hash(state);
    yield* storeCall(() =>
      this.#database
        .prepare(
          "INSERT INTO workos_sign_in_flows(state_hash, issuer, client_id, verifier, nonce, return_to, redirect_uri, client_state, client_challenge, mobile, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          stateHash,
          configuration.issuer,
          configuration.clientId,
          verifier,
          nonce,
          input.returnTo,
          redirectUri,
          input.clientState,
          input.clientChallenge,
          mobile ? 1 : 0,
          now,
          now + FLOW_TTL_MS,
        )
        .run(),
    );
    const url = new URL(metadata.authorizationEndpoint);
    const values = {
      response_type: "code",
      client_id: configuration.clientId,
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: yield* hash(verifier),
      code_challenge_method: "S256",
      login_hint: email,
    };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    return { authorizationUrl: url.toString() };
  });

  readonly finish = Effect.fn("WorkosSignIn.finish")(function* (
    this: WorkosSignInService,
    params: URLSearchParams,
    requestUrl: string,
  ): Effect.fn.Return<string | null, WorkosSignInFailure> {
    const state = params.get("state");
    if (!state || !TOKEN_PATTERN.test(state)) return null;
    const stateHash = yield* hash(state);
    const flow = yield* storeCall(() =>
      this.#database
        .prepare("DELETE FROM workos_sign_in_flows WHERE state_hash = ? RETURNING *")
        .bind(stateHash)
        .first<FlowRow>(),
    );
    if (!flow || flow.expires_at <= this.#now()) return null;
    const back = new URL(flow.return_to);
    back.searchParams.set("state", flow.client_state);
    const completed = yield* this.#completeFlow(flow, params, requestUrl).pipe(
      Effect.map((code) => ({ code })),
      Effect.catchTag("WorkosSignInError", (error) => Effect.succeed({ error: error.code })),
      Effect.catch(() => Effect.succeed({ error: "workos_sign_in_failed" })),
    );
    for (const [key, value] of Object.entries(completed)) back.searchParams.set(key, value);
    return back.toString();
  });

  readonly #completeFlow = Effect.fn("WorkosSignIn.completeFlow")(function* (
    this: WorkosSignInService,
    flow: FlowRow,
    params: URLSearchParams,
    requestUrl: string,
  ): Effect.fn.Return<string, WorkosSignInFailure> {
    const configuration = yield* configured(this.#bindings);
    if (
      flow.issuer !== configuration.issuer ||
      flow.client_id !== configuration.clientId ||
      flow.redirect_uri !== new URL(CALLBACK_PATH, requestUrl).toString()
    )
      return yield* invalid();
    if (params.has("error"))
      return yield* new WorkosSignInError(401, "workos_provider_refused", sourceText("error.auth.workosSignInRefused"));
    const code = params.get("code");
    if (!code || code.length > 4096) return yield* invalid();
    const metadata = yield* this.#provider.discover(configuration.issuer).pipe(Effect.mapError(providerError));
    if (params.has("iss") && params.get("iss") !== metadata.issuer) return yield* invalid();
    const identity = yield* this.#provider
      .redeem({
        metadata,
        clientId: configuration.clientId,
        clientSecret: configuration.clientSecret,
        redirectUri: flow.redirect_uri,
        code,
        verifier: flow.verifier,
        nonce: flow.nonce,
      })
      .pipe(Effect.mapError(providerError));
    const userId = yield* this.#accountFor(configuration.issuer, identity);
    const exchangeCode = randomToken(32);
    const codeHash = yield* hash(exchangeCode);
    const configurationHash = yield* hash(`${configuration.issuer}\n${configuration.clientId}`);
    const now = this.#now();
    yield* storeCall(() =>
      this.#database
        .prepare(
          "INSERT INTO workos_sign_in_codes(code_hash, user_id, client_challenge, configuration_hash, mobile, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(codeHash, userId, flow.client_challenge, configurationHash, flow.mobile, now, now + CODE_TTL_MS)
        .run(),
    );
    return exchangeCode;
  });

  readonly #enforceRateLimit = Effect.fn("WorkosSignIn.enforceRateLimit")(function* (
    this: WorkosSignInService,
    key: string,
    limit: number,
  ): Effect.fn.Return<void, WorkosSignInFailure> {
    const windowStart = Math.floor(this.#now() / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const keyHash = yield* sha256(key).pipe(Effect.mapError(() => new WorkosSignInOperationError({})));
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `INSERT INTO auth_rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)
           ON CONFLICT(key_hash, window_start) DO UPDATE SET attempts = attempts + 1
           RETURNING attempts`,
        )
        .bind(keyHash, windowStart)
        .first<{ attempts: number }>(),
    );
    if ((row?.attempts ?? limit + 1) > limit) {
      return yield* new WorkosSignInError(429, "rate_limited", sourceText("error.auth.workosSignInFailed"));
    }
  });

  readonly exchange = Effect.fn("WorkosSignIn.exchange")(function* (
    this: WorkosSignInService,
    input: { code: string; codeVerifier: string; device?: MobileAuthDeviceIdentity },
  ): Effect.fn.Return<{ sessionToken: string; user: AuthUser }, WorkosSignInFailure> {
    const configuration = yield* configured(this.#bindings);
    const configurationHash = yield* hash(`${configuration.issuer}\n${configuration.clientId}`);
    const failed = new WorkosSignInError(
      400,
      "invalid_workos_sign_in_code",
      sourceText("error.auth.workosSignInFailed"),
    );
    if (!TOKEN_PATTERN.test(input.code) || !VERIFIER_PATTERN.test(input.codeVerifier)) return yield* failed;
    const codeHash = yield* hash(input.code);
    const challenge = yield* hash(input.codeVerifier);
    const now = this.#now();
    const session = { id: crypto.randomUUID(), token: randomToken() };
    const tokenHash = yield* hash(session.token);
    // The session row is made only by the exchange that spent the code with the right verifier. One
    // batch: a session without its mobile row would count as a desktop session.
    const [spent, , registered] = yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `UPDATE workos_sign_in_codes SET redeemed_at = ?, session_id = ?
             WHERE code_hash = ? AND client_challenge = ? AND redeemed_at IS NULL AND expires_at > ? AND configuration_hash = ? AND mobile = ?`,
          )
          .bind(now, session.id, codeHash, challenge, now, configurationHash, input.device ? 1 : 0),
        this.#database
          .prepare(
            `INSERT INTO auth_sessions(id, user_id, token_hash, expires_at, created_at, last_used_at)
             SELECT ?, user_id, ?, ?, ?, ? FROM workos_sign_in_codes WHERE code_hash = ? AND session_id = ?`,
          )
          .bind(session.id, tokenHash, PERSISTENT_SESSION_EXPIRES_AT, now, now, codeHash, session.id),
        ...(input.device ? mobileSessionStatements(this.#database, { now, session, device: input.device }, null) : []),
      ]),
    );
    if (spent?.meta.changes !== 1) return yield* failed;
    if (input.device) {
      if (registered?.meta.changes !== 1) return yield* new WorkosSignInOperationError({});
      // The revocation of the earlier session is written, and the cron delivers it again.
      yield* this.#flushSessionRevocations().pipe(Effect.catch(() => Effect.void));
    }
    const row = yield* storeCall(() =>
      this.#database
        .prepare(
          `SELECT users.id, users.email, users.name, users.avatar_url, users.analytics_enabled, users.chat_color
           FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE auth_sessions.id = ?`,
        )
        .bind(session.id)
        .first<UserRow>(),
    );
    if (!row) return yield* failed;
    return { sessionToken: session.token, user: mapUser(row) };
  });

  readonly #accountFor = Effect.fn("WorkosSignIn.accountFor")(function* (
    this: WorkosSignInService,
    issuer: string,
    identity: { subject: string; email: string },
  ): Effect.fn.Return<string, WorkosSignInFailure> {
    const linked = yield* storeCall(() =>
      this.#database
        .prepare("SELECT user_id FROM workos_sign_in_identities WHERE issuer = ? AND subject = ?")
        .bind(issuer, identity.subject)
        .first<{ user_id: string }>(),
    );
    if (linked) return linked.user_id;
    const now = this.#now();
    yield* storeCall(() =>
      this.#database.batch([
        this.#database
          .prepare(
            `INSERT INTO users(id, identity_key, email, name, avatar_url, created_at, updated_at)
             VALUES (?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT DO NOTHING`,
          )
          .bind(crypto.randomUUID(), `email:${identity.email}`, identity.email, now, now),
        this.#database
          .prepare(
            `INSERT INTO workos_sign_in_identities(issuer, subject, user_id, created_at)
             SELECT ?, ?, id, ? FROM users WHERE email = ? ON CONFLICT DO NOTHING`,
          )
          .bind(issuer, identity.subject, now, identity.email),
      ]),
    );
    const row = yield* storeCall(() =>
      this.#database
        .prepare("SELECT user_id FROM workos_sign_in_identities WHERE issuer = ? AND subject = ?")
        .bind(issuer, identity.subject)
        .first<{ user_id: string }>(),
    );
    if (!row) return yield* new WorkosSignInOperationError({});
    return row.user_id;
  });
}
