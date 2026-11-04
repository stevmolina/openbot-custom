import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Effect, Schema } from "effect";
import { z } from "zod";
import type { McpGateway } from "../agent/mcp-gateway";

export class CodingComputerFailed extends Schema.TaggedError<CodingComputerFailed>()("CodingComputerFailed", {
  cause: Schema.Defect(),
}) {}

const envelope = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

export interface CodingComputerPort {
  call(
    agentId: string,
    slug: string,
    args: Record<string, string | number>,
  ): Effect.Effect<z.infer<ReturnType<typeof z.json>>, CodingComputerFailed>;
}

/** Uses the configured MCP OAuth proxy. It never reads or copies account credentials. */
export class CodingComputer {
  constructor(readonly gateway: McpGateway) {}

  readonly call = Effect.fn("CodingComputer.call")(function* (
    this: CodingComputer,
    agentId: string,
    slug: string,
    args: Record<string, string | number>,
  ) {
    const configs = this.gateway.enabled().filter((row) => row.name.toLowerCase().includes("composio"));
    const config = configs[0];
    if (configs.length !== 1 || !config || config.transport !== "http")
      return yield* Effect.fail(
        new CodingComputerFailed({ cause: "One enabled HTTP Composio connection is required" }),
      );
    const endpoint = yield* this.gateway
      .endpoint(config, agentId)
      .pipe(Effect.mapError((failure) => new CodingComputerFailed({ cause: failure.cause })));
    if ("error" in endpoint) return yield* Effect.fail(new CodingComputerFailed({ cause: endpoint.error }));
    const headers: Record<string, string> = endpoint.proxied
      ? {}
      : Object.fromEntries(config.headers.map((pair) => [pair.key, pair.value]));
    if (endpoint.authorization) headers.Authorization = endpoint.authorization;
    return yield* Effect.acquireUseRelease(
      Effect.try({
        try: () => new Client({ name: "openbot-coding-jobs", version: "1" }, { capabilities: {} }),
        catch: (cause) => new CodingComputerFailed({ cause }),
      }),
      (client) =>
        Effect.tryPromise({
          try: async (signal) => {
            await client.connect(
              new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers } }),
              { signal },
            );
            const discovery = envelope.parse(
              await client.callTool(
                {
                  name: "COMPOSIO_SEARCH_TOOLS",
                  arguments: {
                    queries: [{ use_case: "custom_computer start bash pause remote coding job" }],
                    session: { generate_id: true },
                  },
                },
                undefined,
                { signal },
              ),
            );
            if (discovery.isError) throw new Error("Composio discovery refused");
            const search = z
              .object({
                data: z.object({
                  session: z.object({ id: z.string() }),
                  toolkit_connection_statuses: z.array(
                    z.object({ toolkit: z.string(), has_active_connection: z.boolean() }),
                  ),
                }),
              })
              .parse(JSON.parse(discovery.content.find((part) => part.text)?.text ?? "null"));
            if (
              !search.data.toolkit_connection_statuses.some(
                (row) => row.toolkit === "custom_computer" && row.has_active_connection,
              )
            )
              throw new Error("Agent Computer connection is not active");
            const response = envelope.parse(
              await client.callTool(
                {
                  name: "COMPOSIO_MULTI_EXECUTE_TOOL",
                  arguments: {
                    session_id: search.data.session.id,
                    tools: [{ tool_slug: slug, arguments: args }],
                    sync_response_to_workbench: false,
                  },
                },
                undefined,
                { signal },
              ),
            );
            if (response.isError) throw new Error("Agent Computer operation refused");
            const payload = z.json().parse(JSON.parse(response.content.find((part) => part.text)?.text ?? "null"));
            for (const item of computerValues(payload)) {
              if (
                item &&
                typeof item === "object" &&
                !Array.isArray(item) &&
                (item.successful === false || item.success === false || item.isError === true)
              )
                throw new Error("Agent Computer refused the operation");
            }
            return payload;
          },
          catch: (cause) => new CodingComputerFailed({ cause }),
        }),
      (client) => Effect.promise(() => client.close()).pipe(Effect.ignore),
    );
  });
}

/** Unwraps MCP text blocks and Composio envelopes without trusting their payload. */
export function* computerValues(
  value: z.infer<ReturnType<typeof z.json>>,
): Generator<z.infer<ReturnType<typeof z.json>>> {
  yield value;
  if (Array.isArray(value)) {
    for (const item of value) yield* computerValues(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) yield* computerValues(item);
  } else if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
    try {
      yield* computerValues(z.json().parse(JSON.parse(value)));
    } catch {
      /* Plain tool text is not a JSON envelope. */
    }
  }
}
