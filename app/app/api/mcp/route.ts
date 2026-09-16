import { NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/marketing/mcp/server";
import { resolveKey } from "@/lib/marketing/agent/route-helpers";

// POST /api/mcp
//
// The same substrate as /api/agent/v1, spoken as MCP so an assistant can use it
// without anyone writing integration code.
//
// The Web Standard transport, not the Node one: it takes a Request and returns
// a Response, which is exactly the App Router route-handler contract. (The Node
// class is a thin wrapper around this one, so nothing is lost.)
export const maxDuration = 30;

export async function POST(request: Request) {
  // Authenticated before a single byte of MCP is parsed. The key is this
  // connection's whole identity: there is no session, and no OAuth handshake.
  const key = await resolveKey();
  if (!key) {
    return NextResponse.json(
      {
        // JSON-RPC shape as well as the HTTP status, because some clients read
        // the body before they look at the status line.
        jsonrpc: "2.0",
        error: { code: -32001, message: "That API key is not valid." },
        id: null,
      },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  /**
   * A new server and a new transport per request.
   *
   * Both are stateful objects — the transport tracks whether it has already
   * handled a request — and the key differs per caller. Hoisting either to
   * module scope would serve the second caller with the first one's
   * permissions, which is the worst bug available in this file.
   */
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: this runs on serverless functions with no memory shared
    // between invocations, so a session id would name state that does not
    // exist by the time the next request arrives.
    sessionIdGenerator: undefined,
    // Plain JSON back rather than an SSE stream. Nothing here takes long
    // enough to stream, and a held-open stream on a serverless function is a
    // timeout waiting to happen.
    enableJsonResponse: true,
  });

  const server = buildMcpServer(key);

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("MCP request error:", error);
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      },
      { status: 500 }
    );
  } finally {
    // Stateless means nothing survives the response, so both are closed here
    // rather than left for a session teardown that never comes.
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

// In stateless mode there is no stream to resume and no session to delete, so
// the two verbs a stateful MCP server would answer are refused plainly rather
// than left to 404 as a missing route.
export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

function methodNotAllowed() {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "This MCP server is stateless. Use POST.",
      },
      id: null,
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}
