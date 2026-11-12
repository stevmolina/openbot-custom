import { isDynamicRecord, isString } from "./runtime-values";

/**
 * The Agent Computer connection of a server: the cloud computers that its agents start
 * (computer.mcpbox.dev). Only state crosses to the renderer; the API key never does.
 */
export interface AgentComputerStatus {
  connected: boolean;
  /** The first characters of the saved key, such as `cmk_Ab3dEf6h`, to tell keys apart. Null when not connected. */
  keyHint: string | null;
  /** The last failure, as a sentence, or null. */
  error: string | null;
}

export const DISCONNECTED_AGENT_COMPUTER: AgentComputerStatus = { connected: false, keyHint: null, error: null };

/** One cloud computer, as the registry lists it. `liveViewUrl` is a bearer link for the person only. */
export interface AgentComputerMachine {
  id: string;
  context: string;
  /** `running` or `paused`; a later state is shown as it comes. */
  status: string;
  deadlineAt: string | null;
  liveViewUrl: string | null;
  updatedAt: string | null;
}

export interface AgentComputerMachineList {
  machines: AgentComputerMachine[];
}

/** Bounds shared by the IPC decoders and the `agent-computer-v1` codecs. */
export const AGENT_COMPUTER_KEY_INPUT_LIMIT = 4_096;
export const AGENT_COMPUTER_MACHINE_LIMIT = 200;

const nullableString = (value: unknown): value is string | null => value === null || isString(value);

/** Throws for a value that is not a status. */
export function decodeAgentComputerStatus(value: unknown): AgentComputerStatus {
  if (
    !isDynamicRecord(value) ||
    typeof value.connected !== "boolean" ||
    !nullableString(value.keyHint) ||
    !nullableString(value.error)
  )
    throw new Error("Invalid Agent Computer status.");
  return { connected: value.connected, keyHint: value.keyHint, error: value.error };
}

/** Throws for a value that is not a machine list. */
export function decodeAgentComputerMachineList(value: unknown): AgentComputerMachineList {
  if (!isDynamicRecord(value) || !Array.isArray(value.machines) || value.machines.length > AGENT_COMPUTER_MACHINE_LIMIT)
    throw new Error("Invalid Agent Computer machine list.");
  return {
    machines: value.machines.map((row: unknown) => {
      if (
        !isDynamicRecord(row) ||
        !isString(row.id) ||
        !isString(row.context) ||
        !isString(row.status) ||
        !nullableString(row.deadlineAt) ||
        !nullableString(row.liveViewUrl) ||
        !nullableString(row.updatedAt)
      )
        throw new Error("Invalid Agent Computer machine.");
      return {
        id: row.id,
        context: row.context,
        status: row.status,
        deadlineAt: row.deadlineAt,
        liveViewUrl: row.liveViewUrl,
        updatedAt: row.updatedAt,
      };
    }),
  };
}
