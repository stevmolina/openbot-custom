// A stand-in for `cua-driver mcp` in `remote-computer-use-e2e.ts`: a stdio MCP server with a few tools
// of the same names. `get_desktop_state` answers with the arguments it got, so the test can see the
// screenshot size the desktop app asked for. `set_config` exists so the test can see it blocked.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "fake-cua-driver", version: "1" }, { capabilities: { tools: {} } });
const objectSchema = { type: "object" as const, properties: {} };

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    { name: "get_screen_size", inputSchema: objectSchema },
    {
      name: "get_desktop_state",
      inputSchema: { type: "object" as const, properties: { max_image_dimension: { type: "integer" } } },
    },
    { name: "click", inputSchema: { type: "object" as const, properties: { x: { type: "number" } } } },
    { name: "set_config", inputSchema: objectSchema },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
  if (params.name === "get_screen_size")
    return { content: [{ type: "text" as const, text: JSON.stringify({ width: 1512, height: 982, scale: 2 }) }] };
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ tool: params.name, arguments: params.arguments }) }],
  };
});

await server.connect(new StdioServerTransport());
