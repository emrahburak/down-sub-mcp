#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import { getTranscript } from "./tools/get-transcript.js";
import { getTranscriptInfo } from "./tools/get-transcript-info.js";

// ─── API Key Auth ───────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("HATA: API_KEY environment variable tanimlanmali!");
  process.exit(1);
}

function validateApiKey(req: IncomingMessage): boolean {
  // 1. Query parameter (priority)
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const queryKey = url.searchParams.get("apiKey");
    if (queryKey && queryKey === API_KEY) {
      return true;
    }
  } catch {
    // Ignore URL parse errors
  }

  // 2. Authorization header
  const authHeader = req.headers.authorization ?? "";
  return authHeader === `Bearer ${API_KEY}`;
}

// ─── MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
  name: "down-sub-mcp",
  version: "2.0.0",
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

// v2 tool — sadece metadata döner, transcript içeriği dahil değil
server.tool(
  "get-transcript-info",
  "YouTube videosunun transcript metadata'sini dondurur (baslik, dil, kelime sayisi, sure). Transcript icerigi dahil DEGILDIR — icerik icin /download endpoint'ini kullanin.",
  {
    url: z.string().describe("YouTube video URL'si"),
    lang: z
      .enum(["tr", "en"])
      .optional()
      .describe("Transcript dili (tr veya en). Belirtilmezse otomatik secilir."),
  },
  async ({ url, lang }) => {
    try {
      const result = await getTranscriptInfo({ url, lang });
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
  // Parse URL for routing and query params
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

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
  if (req.method === "GET" && path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "down-sub-mcp", version: "2.0.0" }));
    return;
  }

  // ─── v2: Raw Download Endpoint ────────────────────────────────
  // GET /download?url=...&lang=...&format=plain
  // Transcript'i raw text olarak döner. curl -o ile dosyaya pipe edilebilir.
  if (req.method === "GET" && path === "/download") {
    try {
      const videoUrl = url.searchParams.get("url");
      const lang = url.searchParams.get("lang") || undefined;
      const format = url.searchParams.get("format") || "plain";

      if (!videoUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "url parametresi zorunlu" }));
        return;
      }

      // Transcript'i çek
      const result = await getTranscript({
        url: videoUrl,
        lang: lang as "tr" | "en" | undefined,
      });

      // Başlık temizle (header için)
      const safeTitle = result.title
        .toLowerCase()
        .replace(/[^a-z0-9ğüşıöçĞÜŞİÖÇ\s-]/g, "")
        .replace(/\s+/g, "-")
        .substring(0, 50);

      // Plain text formatında döndür
      if (format === "plain") {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeTitle}-${result.lang}.txt"`,
        });
        res.end(result.transcript);
        return;
      }

      // Gelecek: srt, vtt formatları
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Desteklenmeyen format: ${format}` }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Internal server error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  // MCP endpoint
  if (req.method === "POST" && path === "/mcp") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);

    try {
      const body = await new Promise<string>((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: Buffer) => { data += chunk; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
      });

      const parsed = JSON.parse(body);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    } finally {
      await transport.close();
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`down-sub-mcp v2 server running on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint: POST /mcp`);
  console.log(`Download endpoint: GET /download?url=...&lang=...`);
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
