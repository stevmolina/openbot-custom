// The built-in Agent Computer tools: every agent can start a cloud Ubuntu desktop, run commands on it,
// look at it, pull a file into its workspace, publish a file, pause it, and delete it. They call the
// REST API with the key of this OpenBot server, so no MCP server or Composio connection is needed.

import { mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { DynamicToolResult } from "../protocol";
import {
  AGENT_COMPUTER_BASH_TIMEOUT_MAX,
  AGENT_COMPUTER_CONTEXT_PATTERN,
  type AgentComputerApi,
  type AgentComputerFailed,
} from "./agent-computer-api";

const machineId = z.string().trim().min(1).max(200).describe("The machine id, from computer_start or computer_list.");
const remotePath = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .describe("An absolute path on the machine, such as /home/user/out.mp4.");

const startSchema = z.strictObject({
  context: z
    .string()
    .trim()
    .regex(AGENT_COMPUTER_CONTEXT_PATTERN)
    .describe(
      "A label for the machine: lowercase letters, digits and -, up to 32. The same label resumes the same machine, with its files and logins. Reuse a label from other_contexts or computer_list; a new label creates a new machine.",
    ),
});
const bashSchema = z.strictObject({
  id: machineId,
  cmd: z.string().min(1).max(100_000).describe("The command. It runs in bash -lc."),
  timeout_s: z
    .number()
    .int()
    .min(1)
    .max(AGENT_COMPUTER_BASH_TIMEOUT_MAX)
    .optional()
    .describe(
      `Seconds to wait, 1-${AGENT_COMPUTER_BASH_TIMEOUT_MAX}. The default is 120. Run longer jobs with nohup … & and poll.`,
    ),
  cwd: z.string().trim().min(1).max(4_096).optional().describe("The working directory. The default is /home/user."),
});
const idSchema = z.strictObject({ id: machineId });
const getFileSchema = z.strictObject({
  id: machineId,
  path: remotePath,
  saveAs: z
    .string()
    .trim()
    .min(1)
    .max(1_024)
    .optional()
    .describe("Where to save it, relative to your workspace. The default is computer-files/<file name>."),
});
const publishSchema = z.strictObject({
  id: machineId,
  path: remotePath,
  filename: z.string().trim().min(1).max(255).optional().describe("The download name. The default is the file name."),
});

const MACHINE_RULES =
  "A cloud computer is an Ubuntu desktop with passwordless sudo that belongs to the user's Agent Computer account; install and change anything on it. It pauses itself at deadline_at with everything kept: publish what the user needs before then, and call computer_start with the same context to go on. Runtime minutes are billed on the user's plan.";

export const AGENT_COMPUTER_TOOL_DEFINITIONS = [
  {
    name: "computer_list",
    description:
      "List the cloud computers of this OpenBot server's Agent Computer account: id, context, status (running or paused), deadline_at and updated_at. Read-only; it wakes nothing.",
    shape: {},
  },
  {
    name: "computer_start",
    description: `Start or resume the cloud computer for a context, and get its id. ${MACHINE_RULES} The result has live_view_url, a page where the user watches and controls the desktop: send it to the user in this chat first, never in a file, a pull request or a log. Work in visible windows ($DISPLAY is set) so the live view shows the work. Read ~/PLAYBOOK.md on the machine before a big task. briefing has more rules.`,
    shape: startSchema.shape,
  },
  {
    name: "computer_bash",
    description:
      "Run a shell command on a running cloud computer and wait for it: stdout, stderr, exit_code, timed_out. After MACHINE_PAUSED, call computer_start with the same context, then run it again.",
    shape: bashSchema.shape,
  },
  {
    name: "computer_screenshot",
    description:
      "See the desktop of a running cloud computer now, as an image. Only you see it; it is not posted in the chat.",
    shape: idSchema.shape,
  },
  {
    name: "computer_get_file",
    description:
      "Copy one file, up to 1 MiB, from a cloud computer into your workspace. The result has the saved path, and the text of a small text file. Attach it to your answer with attach_files_to_response. For a larger file, use computer_publish.",
    shape: getFileSchema.shape,
  },
  {
    name: "computer_publish",
    description:
      "Upload one file from a cloud computer and get a download link that expires (expires_at). Use it for a large result, such as a video, that the user needs.",
    shape: publishSchema.shape,
  },
  {
    name: "computer_stop",
    description:
      "Pause a cloud computer when the work is done or waits for the user. Everything on it is kept, and runtime billing stops. computer_start with the same context resumes it.",
    shape: idSchema.shape,
  },
  {
    name: "computer_destroy",
    description:
      "Delete a cloud computer and everything on it, including its files and logins. It cannot be undone. Only when the user asks for it; to end work, use computer_stop. The user approves it.",
    shape: idSchema.shape,
  },
] as const;

export type AgentComputerToolName = (typeof AGENT_COMPUTER_TOOL_DEFINITIONS)[number]["name"];

const TOOL_NAMES: ReadonlySet<string> = new Set(AGENT_COMPUTER_TOOL_DEFINITIONS.map(({ name }) => name));

export function isAgentComputerTool(tool: string): tool is AgentComputerToolName {
  return TOOL_NAMES.has(tool);
}

export interface AgentComputerToolRequest {
  tool: AgentComputerToolName;
  arguments: unknown;
  /** The calling agent's workspace, where `computer_get_file` saves. */
  workspacePath: string;
  /** Asks the user to approve a change, with `reason` as the question. True when approved. */
  approve: (reason: string) => Effect.Effect<boolean>;
}

/** A small text file comes back as text too, so the agent need not read it again. */
const TEXT_PREVIEW_LIMIT = 64 * 1024;

/**
 * Runs one tool. A failure of the API, bad arguments and a refused approval are all results that
 * the agent reads and corrects; nothing here throws for them.
 */
export const handleAgentComputerTool = Effect.fn("AgentComputerTools.handle")(function* (
  api: AgentComputerApi,
  request: AgentComputerToolRequest,
) {
  const outcome: Effect.Effect<DynamicToolResult, AgentComputerFailed | z.ZodError | Error> = Effect.gen(function* () {
    switch (request.tool) {
      case "computer_list": {
        const machines = yield* api.list();
        return textResult({
          machines: machines.map(({ id, context, status, deadline_at, updated_at }) => ({
            id,
            context,
            status,
            deadline_at,
            updated_at,
          })),
        });
      }
      case "computer_start": {
        const input = yield* parse(startSchema, request.arguments);
        return textResult(yield* api.start(input.context));
      }
      case "computer_bash": {
        const input = yield* parse(bashSchema, request.arguments);
        return textResult(yield* api.bash(input.id, input));
      }
      case "computer_screenshot": {
        const input = yield* parse(idSchema, request.arguments);
        const image = yield* api.screenshot(input.id);
        return {
          success: true,
          contentItems: [
            { type: "inputText", text: JSON.stringify({ id: input.id, bytes: image.bytes.length }) },
            { type: "inputImage", imageUrl: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` },
          ],
        };
      }
      case "computer_get_file": {
        const input = yield* parse(getFileSchema, request.arguments);
        const file = yield* api.file(input.id, input.path);
        const target = yield* Effect.try({
          try: () =>
            workspaceTarget(request.workspacePath, input.saveAs ?? join("computer-files", basename(input.path))),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(resolve(target, ".."), { recursive: true });
            await writeFile(target, file.bytes);
          },
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
        const text = textPreview(file.bytes, file.mimeType);
        const result = {
          path: target,
          bytes: file.bytes.length,
          mimeType: file.mimeType,
          ...(text === null ? {} : { text }),
        };
        if (!file.mimeType.startsWith("image/")) return textResult(result);
        return {
          success: true,
          contentItems: [
            { type: "inputText", text: JSON.stringify(result) },
            { type: "inputImage", imageUrl: `data:${file.mimeType};base64,${file.bytes.toString("base64")}` },
          ],
        };
      }
      case "computer_publish": {
        const input = yield* parse(publishSchema, request.arguments);
        return textResult(yield* api.publish(input.id, input.path, input.filename));
      }
      case "computer_stop": {
        const input = yield* parse(idSchema, request.arguments);
        return textResult(yield* api.stop(input.id));
      }
      case "computer_destroy": {
        const input = yield* parse(idSchema, request.arguments);
        const approved = yield* request.approve(
          sourceText("status.agent.agentComputerDestroyApproval", { id: input.id }),
        );
        if (!approved) return failure(sourceText("error.agent.agentComputerDestroyDeclined"));
        return textResult(yield* api.destroy(input.id));
      }
    }
  });
  return yield* outcome.pipe(
    Effect.catch((error) =>
      Effect.succeed(
        error instanceof z.ZodError
          ? failure(z.prettifyError(error))
          : "_tag" in error && error._tag === "AgentComputerFailed"
            ? failure(`${error.code}: ${error.message}`, error.code)
            : failure(error.message),
      ),
    ),
  );
});

function parse<T extends z.ZodType>(schema: T, value: unknown): Effect.Effect<z.infer<T>, z.ZodError> {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? Effect.succeed(parsed.data) : Effect.fail(parsed.error);
}

function textResult(value: unknown): DynamicToolResult {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function failure(message: string, code?: string): DynamicToolResult {
  return {
    success: false,
    contentItems: [{ type: "inputText", text: JSON.stringify({ error: message, ...(code ? { code } : {}) }) }],
  };
}

/** A path inside the workspace. A path that leaves it is refused. */
function workspaceTarget(workspace: string, path: string): string {
  const root = resolve(workspace);
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const inside = relative(root, target);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error(sourceText("error.agent.agentComputerPathOutside"));
  return target;
}

function textPreview(bytes: Buffer, mimeType: string): string | null {
  if (bytes.length > TEXT_PREVIEW_LIMIT || mimeType.startsWith("image/") || bytes.includes(0)) return null;
  const text = bytes.toString("utf8");
  return text.includes("�") ? null : text;
}
