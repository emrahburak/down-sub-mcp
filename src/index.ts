#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { getTranscript } from "./tools/get-transcript.js";

// ─── API Key Auth ───────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("HATA: API_KEY environment variable tanimlanmali!");
  process.exit(1);
}

function validateApiKey(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization ?? "";
  return authHeader === `Bearer ${API_KEY}`;
}

// ─── MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
  name: "down-sub-mcp",
  version: "1.0.0",
});

server.tool(
  "get-transcript",
  "YouTube videosunun transcript'ini (altyazi/metin) indirir. Dil belirtilmezse otomatik secilir (once tr, sonra en).",
  {
    url: z.string().describe("YouTube video URL'si"),
    lang: z
      .enum(["tr", "en"])
      .optional()
      .describe("Transcript dili (tr veya en). Belirtilmezse otomatik secilir."),
  },
  async ({ url, lang }) => {
    try {
      const result = await getTranscript({ url, lang });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Bilinmeyen hata";
      return {
        content: [
          {
            type: "text",
            text: `Hata: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── HTTP Server (Streamable HTTP) ──────────────────────────────
const PORT = parseInt(process.env.PORT ?? "3000", 10);

const httpServer = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // API Key kontrolu
  if (!validateApiKey(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "down-sub-mcp" }));
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk; });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        await transport.handleRequest(req, res, parsed);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`down-sub-mcp server running on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint: POST /mcp`);
  console.log(`Health check: GET /health`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down...");
  httpServer.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  httpServer.close(() => process.exit(0));
});
