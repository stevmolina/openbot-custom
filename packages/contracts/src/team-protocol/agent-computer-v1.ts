// Frozen optional agent-computer-v1 wire contract.
//
// An owner or admin of a joined server connects the host's Agent Computer account (computer.mcpbox.dev)
// from their own computer, so the host's agents can start cloud computers. `connect` carries the API
// key to the host once; no answer carries it. The host tests the key, then keeps it in its encrypted
// store. A member cannot use any route; `requireAdmin` on the host is the only gate.
//
// `status`, `connect`, `test` and `disconnect` answer the host's status: `connected`, the first
// characters of the key (`keyHint`), and the last failure as a sentence (`error`). `machines` answers
// the registry of the account, with each machine's live view link: a bearer link that only the
// admin's own screen shows.
import { AGENT_COMPUTER_KEY_INPUT_LIMIT, AGENT_COMPUTER_MACHINE_LIMIT } from "../ipc-agent-computer";
import { adminRoute, boolean, empty, fields, list, nullable, type OptionalRouteCodec, string } from "./admin-wire";

export const AGENT_COMPUTER_CAPABILITY = "agent-computer-v1";

export const AGENT_COMPUTER_ROUTES = {
  status: "/v1/admin/agent-computer/status",
  connect: "/v1/admin/agent-computer/connect",
  test: "/v1/admin/agent-computer/test",
  disconnect: "/v1/admin/agent-computer/disconnect",
  machines: "/v1/admin/agent-computer/machines",
} as const;

const status = fields({
  connected: boolean,
  keyHint: nullable(string(64)),
  error: nullable(string(2_000)),
});

const machine = fields({
  id: string(256),
  context: string(64),
  status: string(64),
  deadlineAt: nullable(string(64)),
  liveViewUrl: nullable(string(2_048)),
  updatedAt: nullable(string(64)),
});

export const AGENT_COMPUTER_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_COMPUTER_ROUTES.status, adminRoute(empty, status)],
  [AGENT_COMPUTER_ROUTES.connect, adminRoute(fields({ apiKey: string(AGENT_COMPUTER_KEY_INPUT_LIMIT) }), status)],
  [AGENT_COMPUTER_ROUTES.test, adminRoute(empty, status)],
  [AGENT_COMPUTER_ROUTES.disconnect, adminRoute(empty, status)],
  [
    AGENT_COMPUTER_ROUTES.machines,
    adminRoute(empty, fields({ machines: list(machine, AGENT_COMPUTER_MACHINE_LIMIT) })),
  ],
]);
