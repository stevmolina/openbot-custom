// Checks Web Push for the web client (`push-notifications-web-v1`) from the host to a push service.
//
// A real `TeamApiServer` with the real notification service and its file store runs the host. The
// account service route runs in this process: `relayWebNotification` and `WebPushRelaySender` of
// `apps/auth-api`, the code of `POST /v2/remote/hosts/:hostId/web-notification`, behind a loopback
// HTTP server, with a VAPID key pair made for this run. Only the host credential and the session
// check are stand-ins (one token, one open session). A second loopback server stands in for the push
// service of a browser.
//
// Checks: (a) the config answer gives the public key; (b) a web client registers and removes its
// subscription through the Team API, and the host file keeps and drops it; (c) an agent event makes the
// host encrypt a notification, the relay signs and forwards it, and the push service gets it with a
// valid VAPID token and `Content-Encoding: aes128gcm`; the check opens the body with the private key of
// the subscription, with its own WebCrypto code, and reads the payload; (d) a push service that answers
// 410 makes the host forget the registration; (e) the relay refuses an endpoint that is not a known
// push service. The encryption also matches the example of RFC 8291 Appendix A.
//
// Not checked: a real browser subscription (headless Chromium has no push service connection), the
// Worker runtime itself (`vite dev` did not start in the memory budget of the VPS), and the real
// D1 session check.
//
// Run: bun scripts/web-push-e2e.ts (Bun 1.4 or later, for `node:sqlite`).
// Writes .openbot-build/web-push/report.json.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V9,
  TEAM_PROTOCOL_VERSION_HEADER,
  teamCapabilitiesForProtocol,
} from "@openbot/contracts/team-protocol";
import {
  WEB_PUSH_NOTIFICATIONS_CAPABILITY,
  WEB_PUSH_NOTIFICATIONS_ROUTES,
} from "@openbot/contracts/team-protocol/push-notifications-web-v1";
import { WEB_PUSH_CONFIG_ROUTE, webPushOpenTarget } from "@openbot/contracts/web-push";
import { createOpenBotLogger } from "@openbot/logging";
import { plugin } from "bun";
import { Effect } from "effect";
import { importJWK, jwtVerify } from "jose";
import { relayWebNotification, WebPushRelaySender } from "../apps/auth-api/src/server/web-push-relay";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { PushNotificationStore } from "../src/main/push-notification-store";
import type { NotificationRelayRequest } from "../src/main/push-notifications";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";
import { encryptWebPush } from "../src/main/web-push-encryption";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, ".openbot-build/web-push");
const APP_VERSION = "0.0.0-e2e";
const STEP_DEADLINE_MS = 60_000;
const OWNER = { username: "owner-user", password: "owner-password-123" };
const SERVER_ID = "web-push-e2e-server";
const VAPID_SUBJECT = "mailto:web-push-e2e@example.com";
const logger = createOpenBotLogger("web-push-e2e");

// The main process imports Electron. No check here opens a window.
plugin({
  name: "web-push-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => APP_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: class extends Inert {
          static getAllWindows() {
            return [];
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {
          static isSupported() {
            return false;
          }
        },
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});
const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { PushNotificationSendFailure, PushNotificationService } = await import("../src/main/push-notifications");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "A real browser subscription: headless Chromium has no push service connection, so pushManager.subscribe fails there.",
    "The service worker that shows the notification (worker A's app-sw.js). The check reads the payload that it gets.",
    "A real push service (Firebase, Mozilla, Apple, Windows). A loopback server stands in; only `vite dev` and this check allow it.",
    "The Worker runtime and its D1 credential and session checks: the route code runs in this process with stand-ins for those two.",
    "A request over WebRTC. The check sends over HTTP; both paths run the same route codec.",
  ],
  steps: [],
};

/** Runs one check. `summarize` keeps live objects out of the report. */
async function step<T>(
  name: string,
  runStep: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
  deadlineMs = STEP_DEADLINE_MS,
) {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    // A bound on failure only: each check waits for its event, and a missing event must fail.
    const value = await Promise.race([
      runStep(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${deadlineMs} ms.`)), deadlineMs);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

// The VAPID key pair of this run ----------------------------------------------------------------
const vapid = (() => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  assert.ok(jwk.x && jwk.y && jwk.d);
  const publicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]).toString("base64url");
  return {
    privateKey: JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }),
    publicJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
    publicKey,
  };
})();

// The subscription of a browser: its P-256 key pair and auth secret -----------------------------
const subscriber = await (async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  const auth = randomBytes(16);
  return { pair, p256dh: raw.toString("base64url"), auth: auth.toString("base64url"), authBytes: auth, raw };
})();

/**
 * Opens an `aes128gcm` body as a browser does (RFC 8291, RFC 8188), with WebCrypto, apart from the
 * host's `node:crypto` code. Returns the plaintext.
 */
async function decryptWebPush(body: Buffer): Promise<string> {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const keyIdLength = body.readUInt8(20);
  assert.equal(keyIdLength, 65, "The key id is not a P-256 public key.");
  const senderKey = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength);
  assert.ok(ciphertext.length <= recordSize, "The record is larger than the record size.");
  const sender = await webcrypto.subtle.importKey("raw", senderKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await webcrypto.subtle.deriveBits({ name: "ECDH", public: sender }, subscriber.pair.privateKey, 256);
  const hkdf = async (saltBytes: Uint8Array, ikm: ArrayBuffer | Uint8Array, info: Uint8Array, bytes: number) => {
    const key = await webcrypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: saltBytes, info }, key, bytes * 8);
  };
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), subscriber.raw, senderKey]);
  const ikm = await hkdf(subscriber.authBytes, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const aes = await webcrypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = Buffer.from(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  // The last record ends with 0x02 and zero or more 0x00.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  assert.equal(padded[end], 0x02, "The record has no last-record delimiter.");
  return padded.subarray(0, end).toString("utf8");
}

// The stand-in push service -------------------------------------------------------------------
interface PushRequest {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}
const pushRequests: PushRequest[] = [];
const pushWaiters = new Set<() => void>();
let pushStatus = 201;
const accountService = createServer();
const pushService = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    pushRequests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      headers: request.headers,
      body: Buffer.concat(chunks),
    });
    response.statusCode = pushStatus;
    response.end();
    for (const wake of [...pushWaiters]) wake();
  });
});
function nextPush(): Promise<PushRequest> {
  const from = pushRequests.length;
  return new Promise((done) => {
    const check = () => {
      const request = pushRequests[from];
      if (!request) return;
      pushWaiters.delete(check);
      done(request);
    };
    pushWaiters.add(check);
    check();
  });
}

/** Waits until `condition` holds, checking after each turn of the event loop. */
async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((done) => setImmediate(done));
}

/** One HTTP request of a protocol 9 web client that advertises the current capabilities. */
async function wire(
  port: number,
  input: { method: string; path: string; body?: unknown; token?: string },
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers({
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: APP_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
  });
  if (input.body !== undefined) headers.set("Content-Type", "application/json");
  if (input.token) headers.set("Authorization", `Bearer ${input.token}`);
  const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
    method: input.method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const root = await mkdtemp(join(tmpdir(), "openbot-web-push-"));
const userData = join(root, "user-data");
const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  importSignIn: unused,
};

const HOST_ID = "web-push-e2e-host";
const MACHINE_TOKEN = randomBytes(32).toString("base64url");
const SESSION_ID = "web-push-e2e-session";
/** The sessions that the stand-in account service counts as open. */
const openSessions = new Set([SESSION_ID]);
let database: OpenBotDatabase | undefined;
let agents: AgentService | undefined;
let server: InstanceType<typeof TeamApiServer> | undefined;
let phones: InstanceType<typeof PushNotificationService> | undefined;
const sends: { platform: string; result: string }[] = [];

try {
  await step("The encryption matches the example of RFC 8291 Appendix A", async () => {
    const body = encryptWebPush(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
        senderPrivateKey: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
      },
    );
    assert.ok(body);
    assert.equal(
      Buffer.from(body).toString("base64url"),
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
    return { bytes: body.length };
  });

  const { origin, pushOrigin } = await step("Start the push service and the account service route", async () => {
    await new Promise<void>((done) => pushService.listen(0, "127.0.0.1", done));
    const pushAddress = pushService.address();
    assert.ok(pushAddress && typeof pushAddress === "object");
    const sender = new WebPushRelaySender(
      { privateKey: JSON.parse(vapid.privateKey), publicKey: vapid.publicKey, subject: VAPID_SUBJECT },
      (input, init) => fetch(input, init),
    );
    accountService.on("request", (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        void (async () => {
          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          let answer: Response;
          if (request.method === "GET" && url.pathname === WEB_PUSH_CONFIG_ROUTE) {
            answer = Response.json({ publicKey: sender.publicKey });
          } else {
            const match = /^\/v2\/remote\/hosts\/([^/]+)\/web-notification$/u.exec(url.pathname);
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            answer = !match?.[1]
              ? new Response(null, { status: 404 })
              : await Effect.runPromise(
                  relayWebNotification(match[1], isDynamicRecord(body) ? body : {}, {
                    relay: { sender, allowLoopback: true, allowNotification: () => Effect.succeed(true) },
                    authenticateHost: (hostId, token) =>
                      hostId === HOST_ID && token === MACHINE_TOKEN
                        ? Effect.void
                        : Effect.fail(new Error("unauthorized")),
                    sessionOpen: (_hostId, sessionId) => Effect.succeed(openSessions.has(sessionId)),
                  }).pipe(
                    Effect.catch(() =>
                      Effect.succeed(Response.json({ error: { code: "unauthorized" } }, { status: 401 })),
                    ),
                  ),
                );
          }
          response.statusCode = answer.status;
          response.end(Buffer.from(await answer.arrayBuffer()));
        })();
      });
    });
    await new Promise<void>((done) => accountService.listen(0, "127.0.0.1", done));
    const address = accountService.address();
    assert.ok(address && typeof address === "object");
    return { origin: `http://127.0.0.1:${address.port}`, pushOrigin: `http://127.0.0.1:${pushAddress.port}` };
  });

  await step("(a) The config route gives the VAPID public key", async () => {
    const response = await fetch(`${origin}${WEB_PUSH_CONFIG_ROUTE}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(isDynamicRecord(body));
    assert.equal(body.publicKey, vapid.publicKey);
    return { publicKey: body.publicKey };
  });

  await step("(e) The relay refuses an endpoint that is not a known push service", async () => {
    const encrypted = Buffer.from(
      encryptWebPush(new TextEncoder().encode("{}"), { p256dh: subscriber.p256dh, auth: subscriber.auth }) ??
        new Uint8Array(),
    ).toString("base64url");
    const attempt = async (endpoint: string) => {
      const response = await fetch(`${origin}/v2/remote/hosts/${SERVER_ID}/web-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineToken: "not-a-real-token",
          endpoint,
          sessionId: "web-session",
          body: encrypted,
          ttl: 60,
          urgency: "normal",
          timestamp: Math.floor(Date.now() / 1_000),
        }),
      });
      const body = await response.json();
      const code = isDynamicRecord(body) && isDynamicRecord(body.error) ? body.error.code : null;
      return { status: response.status, code };
    };
    const results = {
      otherHost: await attempt("https://push.example.com/send/abc"),
      lookalike: await attempt("https://fcm.googleapis.com.example.com/fcm/send/abc"),
      otherPort: await attempt("https://fcm.googleapis.com:8443/fcm/send/abc"),
      plainHttp: await attempt("http://fcm.googleapis.com/fcm/send/abc"),
      remoteHttp: await attempt("http://192.0.2.1/push"),
    };
    for (const [name, result] of Object.entries(results)) {
      assert.deepEqual(result, { status: 400, code: "invalid_notification" }, `${name} was not refused.`);
    }
    // A known push service passes the endpoint check and fails only at the host credential.
    const known = await attempt("https://fcm.googleapis.com/fcm/send/abc");
    assert.notEqual(known.code, "invalid_notification", "A known push service was refused.");
    return { ...results, knownPushService: known };
  });

  /** As `CentralAuthManager.sendPushNotification` sends it: the host credential and the push, 410 is gone. */
  const relaySend = async (request: NotificationRelayRequest): Promise<"sent" | "gone"> => {
    assert.equal(request.platform, "web");
    const response = await fetch(`${origin}/v2/remote/hosts/${HOST_ID}/web-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineToken: MACHINE_TOKEN, ...request.push }),
    });
    if (response.status === 410) return "gone";
    if (!response.ok) throw new Error(`The account service answered ${response.status}.`);
    return "sent";
  };

  const setup = await step(
    "Start the host with the notification service and sign in a web client",
    async () => {
      database = new OpenBotDatabase(userData);
      const agentStore = new AgentStore(userData, join(root, "home"), database);
      const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
      const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
      const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
      await runCauseEffect(sidebar.initialize());
      // The stores only: `AgentService.initialize` would start the provider CLIs, which no step needs.
      await runCauseEffect(agentStore.initialize());
      await runCauseEffect(mailbox.initialize());
      await runCauseEffect(team.initialize());
      const agent = await runCauseEffect(
        agentStore.createAgent({
          name: "Push fixture",
          description: "Synthetic agent for the Web Push check",
          avatarSeed: "web-push",
          avatarHue: null,
        }),
      );
      agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
      await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
      const ownerId = team.getOwnerMemberId();
      assert.ok(ownerId, "The host has no owner.");
      const store = new PushNotificationStore(join(userData, "openbot-push-notifications-v1.json"));
      await runCauseEffect(store.load());
      // As `HostService` wires it: each send goes to the account service route.
      phones = new PushNotificationService({
        agents,
        store,
        send: (request: NotificationRelayRequest) =>
          Effect.tryPromise({
            try: () => relaySend(request),
            catch: (cause) => new PushNotificationSendFailure({ cause }),
          }).pipe(Effect.tap((result) => Effect.sync(() => sends.push({ platform: request.platform, result })))),
        hiddenAgentIds: () => new Set(),
        memberActive: () => true,
        lastUseElsewhere: () => null,
        atHostComputer: () => false,
        liveActivityShows: () => false,
        randomBytes: (size) => new Uint8Array(randomBytes(size)),
        logger,
      });
      server = new TeamApiServer({
        store: team,
        agents,
        mailbox,
        browser: teamBrowser,
        sidebarLayout: sidebar,
        appVersion: APP_VERSION,
        pushNotifications: phones,
      });
      const port = await Effect.runPromise(server.start());
      phones.start();
      const login = await wire(port, { method: "POST", path: "/v1/auth/login", body: OWNER });
      assert.equal(login.status, 200, `Login failed: ${JSON.stringify(login.body)}`);
      assert.ok(isDynamicRecord(login.body) && typeof login.body.sessionToken === "string");
      return {
        port,
        token: login.body.sessionToken,
        ownerId,
        agentId: agent.id,
        threadId: agent.threadId ?? "push-thread",
        store,
        file: join(userData, "openbot-push-notifications-v1.json"),
      };
    },
    ({ agentId }) => ({ agentId }),
  );
  const { port, token, ownerId, agentId, threadId, store, file } = setup;
  assert.ok(phones && agents);
  const service = agents;
  const notifier = phones;

  await step("The host advertises push-notifications-web-v1 to a protocol 9 web client", async () => {
    const compatibility = await wire(port, { method: "GET", path: TEAM_API_ROUTES.compatibility });
    assert.ok(isDynamicRecord(compatibility.body) && Array.isArray(compatibility.body.capabilities));
    assert.ok(compatibility.body.capabilities.includes(WEB_PUSH_NOTIFICATIONS_CAPABILITY));
    return { advertised: true };
  });

  await step("(b) A web client registers through the Team API, and removes the registration", async () => {
    const registration = {
      serverId: SERVER_ID,
      endpoint: "https://fcm.googleapis.com/fcm/send/web-push-e2e-subscription",
      p256dh: subscriber.p256dh,
      auth: subscriber.auth,
      locale: "en",
      away: false,
      level: "all",
      mutedUntil: null,
      preview: true,
    };
    const refused = await wire(port, {
      method: "POST",
      path: WEB_PUSH_NOTIFICATIONS_ROUTES.register,
      body: { ...registration, endpoint: "http://fcm.googleapis.com/fcm/send/plain" },
      token,
    });
    assert.notEqual(refused.status, 200, "The host took an endpoint that is not https.");
    const registered = await wire(port, {
      method: "POST",
      path: WEB_PUSH_NOTIFICATIONS_ROUTES.register,
      body: registration,
      token,
    });
    assert.equal(registered.status, 200, `Register failed: ${JSON.stringify(registered.body)}`);
    await until(() => existsSync(file) && readFileSync(file, "utf8").includes(registration.endpoint));
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(isDynamicRecord(saved) && Array.isArray(saved.registrations));
    const entry = saved.registrations.find((item: unknown) => isDynamicRecord(item) && item.platform === "web");
    assert.ok(isDynamicRecord(entry) && isDynamicRecord(entry.value), "The host file has no web registration.");
    // The host keeps no `away: false` across a restart: a restarted host counts the client as away.
    assert.equal(entry.value.away, true);
    assert.equal(entry.memberId, ownerId);
    const removed = await wire(port, { method: "POST", path: WEB_PUSH_NOTIFICATIONS_ROUTES.remove, body: {}, token });
    assert.equal(removed.status, 200, `Remove failed: ${JSON.stringify(removed.body)}`);
    await until(() => !readFileSync(file, "utf8").includes(registration.endpoint));
    return {
      refusedPlainHttp: refused.status,
      registered: registered.status,
      savedPlatform: entry.platform,
      removed: removed.status,
      leftInFile: store.list().filter((item) => item.platform === "web").length,
    };
  });

  const event = (turnId: string): AgentEvent => ({
    type: "turn-completed",
    agentId,
    threadId,
    turnId,
    status: "failed",
  });
  const endpoint = `${pushOrigin}/push/web-push-e2e-subscription`;
  const registerDirect = () =>
    notifier.register(
      SESSION_ID,
      { memberId: ownerId, protocol: TEAM_PROTOCOL_V9, capabilities: new Set(teamCapabilitiesForProtocol(9)) },
      {
        platform: "web",
        value: {
          serverId: SERVER_ID,
          endpoint,
          p256dh: subscriber.p256dh,
          auth: subscriber.auth,
          locale: "en",
          away: true,
          level: "all",
          mutedUntil: null,
          preview: true,
        },
      },
    );

  await step("(c) An agent event reaches the push service, signed and encrypted", async () => {
    pushStatus = 201;
    // The registration of a session that the account service knows. The Team API codec takes only
    // `https:`; the loopback push service is for `vite dev` alone.
    registerDirect();
    const received = nextPush();
    service.emit("event", event("turn-push"));
    const request = await received;
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/push/web-push-e2e-subscription");
    assert.equal(request.headers["content-encoding"], "aes128gcm");
    assert.equal(request.headers.ttl, "86400");
    assert.equal(request.headers.urgency, "normal");
    const authorization = String(request.headers.authorization ?? "");
    const match = /^vapid t=([^,\s]+), k=([A-Za-z0-9_-]+)$/u.exec(authorization);
    assert.ok(match, `The Authorization header is not VAPID: ${authorization.slice(0, 12)}…`);
    const [, jwt, key] = match;
    assert.equal(key, vapid.publicKey);
    const verified = await jwtVerify(jwt ?? "", await importJWK(vapid.publicJwk, "ES256"), {
      audience: pushOrigin,
      subject: VAPID_SUBJECT,
      algorithms: ["ES256"],
    });
    const now = Math.floor(Date.now() / 1_000);
    const expiresIn = (verified.payload.exp ?? 0) - now;
    assert.ok(expiresIn > 0 && expiresIn <= 12 * 60 * 60 + 60, `The token lives ${expiresIn} s.`);
    assert.ok(request.body.length <= 4_096, "The body is larger than 4096 bytes.");
    const plaintext = await decryptWebPush(request.body);
    const payload = JSON.parse(plaintext);
    assert.ok(isDynamicRecord(payload));
    assert.equal(payload.v, 1);
    assert.equal(payload.title, "Push fixture");
    assert.ok(typeof payload.body === "string" && payload.body.length > 0);
    assert.ok(typeof payload.path === "string");
    const target = webPushOpenTarget(new URL(payload.path, "https://openbot.example").search);
    assert.deepEqual(target, { serverId: SERVER_ID, agentId, channelId: null });
    assert.ok(payload.path.startsWith("/app?"));
    // The account service and the push service see no text: the body holds no word of the payload.
    assert.ok(!request.body.includes(Buffer.from("Push fixture")), "The body has the agent name in clear.");
    await until(() => sends.some((send) => send.platform === "web" && send.result === "sent"));
    return {
      contentEncoding: request.headers["content-encoding"],
      urgency: request.headers.urgency,
      vapidAudience: verified.payload.aud,
      vapidSubject: verified.payload.sub,
      tokenLifetimeSeconds: expiresIn,
      bodyBytes: request.body.length,
      payload,
    };
  });

  await step("(d) A push service that answers 410 makes the host forget the web client", async () => {
    pushStatus = 410;
    const received = nextPush();
    service.emit("event", event("turn-gone"));
    await received;
    await until(() => !store.list().some((item) => item.sessionId === SESSION_ID));
    await until(() => !readFileSync(file, "utf8").includes(endpoint));
    return { forgotten: true, sends };
  });

  report.passed = true;
} catch (error) {
  logger.error("Web Push check failed.", error instanceof Error ? error.message : String(error));
} finally {
  if (phones) await Effect.runPromise(phones.dispose()).catch(() => undefined);
  if (server) await Effect.runPromise(server.stop()).catch(() => undefined);
  if (agents) await runCauseEffect(agents.stop()).catch(() => undefined);
  database?.close();
  pushService.close();
  accountService.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
}

if (!report.passed) process.exitCode = 1;
