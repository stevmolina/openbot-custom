import { Effect, Schema } from "effect";
import type { AgentComputerApi } from "../agent-computer/agent-computer-api";

export class CodingComputerFailed extends Schema.TaggedError<CodingComputerFailed>()("CodingComputerFailed", {
  cause: Schema.Defect(),
}) {}

export interface CodingMachine {
  id: string;
  deadline_at: string;
  live_view_url: string;
}

export interface CodingCommandResult {
  stdout: string;
  stderr: string;
}

/** The three calls a coding job makes on its machine. */
export interface CodingComputerPort {
  start(context: string): Effect.Effect<CodingMachine, CodingComputerFailed>;
  bash(id: string, cmd: string, timeoutSeconds: number): Effect.Effect<CodingCommandResult, CodingComputerFailed>;
  stop(id: string): Effect.Effect<void, CodingComputerFailed>;
}

/** Coding jobs on the Agent Computer REST API, with the key of this OpenBot server. */
export function codingComputer(api: AgentComputerApi): CodingComputerPort {
  const failed = Effect.mapError((cause: unknown) => new CodingComputerFailed({ cause }));
  return {
    start: (context) =>
      api.start(context).pipe(
        Effect.map(({ id, deadline_at, live_view_url }) => ({ id, deadline_at, live_view_url })),
        failed,
      ),
    bash: (id, cmd, timeoutSeconds) =>
      api.bash(id, { cmd, timeout_s: timeoutSeconds }).pipe(
        Effect.map(({ stdout, stderr }) => ({ stdout, stderr })),
        failed,
      ),
    stop: (id) => api.stop(id).pipe(Effect.asVoid, failed),
  };
}
