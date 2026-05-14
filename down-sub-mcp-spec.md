---
tags: #⚠️-etiket-ekle
title: down-sub-mcp — YouTube Transcript MCP Server
references: ⚠️
tarih: 14.05.26
---

# down-sub-mcp — YouTube Transcript MCP Server

## 🎯 Proje Tanımı

Coolify üzerinde çalışan, YouTube videolarının transcript'ini (altyazı/metin) indiren bir **MCP Server**. Bu servis sadece tek bir kullanıcı (ben) tarafından kullanılacak ve OpenCode üzerinden remote MCP olarak bağlanacak.

---

## 📦 Kullanılacak Skill'ler

OpenCoder agent, aşağıdaki skill'leri referans alarak kodu üretmelidir:

| Skill | Install | Kullanım Amacı |
|-------|---------|----------------|
| `github/awesome-copilot@typescript-mcp-server-generator` | 10K | MCP server yapısı, tool tanımı, Streamable HTTP transport |
| `bobmatnyc/claude-mpm-skills@nodejs-backend-typescript` | 739 | Node.js + TypeScript backend kalıpları |
| `mcollina/skills@node` | 2K | Node.js production best practices |

**Kurulum (OpenCoder agent çalışmadan önce):**
```bash
npx skills add github/awesome-copilot@typescript-mcp-server-generator -g -y
npx skills add bobmatnyc/claude-mpm-skills@nodejs-backend-typescript -g -y
npx skills add mcollina/skills@node -g -y
```

---

## 🏗️ Teknoloji Yığını

| Katman | Teknoloji | Versiyon |
|--------|-----------|----------|
| **Dil** | Node.js + TypeScript | Node 20+, TS 5+ |
| **MCP SDK** | `@modelcontextprotocol/sdk` | latest |
| **Transport** | Streamable HTTP | (SSE deprecated) |
| **Transcript Kaynağı** | `youtube-transcript` (npm) | latest |
| **Auth** | API Key (Bearer token) | Middleware |
| **Container** | Docker (multi-stage build) | Alpine base |
| **Hosting** | Coolify (Git push auto-deploy) | — |

---

## 📁 Proje Yapısı

```
down-sub-mcp/
├── src/
│   ├── index.ts              # MCP server entry point (Streamable HTTP + Auth)
│   ├── tools/
│   │   └── get-transcript.ts # Transcript indirme tool'u
│   └── types.ts              # TypeScript tip tanımları
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
├── .dockerignore
└── README.md
```

---

## 🔧 Geliştirme Adımları

### Adım 1: Proje İskeleti

```bash
mkdir -p ~/Genel/repo/down-sub-mcp/src/tools
cd ~/Genel/repo/down-sub-mcp
npm init -y
npm install @modelcontextprotocol/sdk youtube-transcript
npm install -D typescript @types/node
npx tsc --init
```

### Adım 2: `package.json`

```json
{
  "name": "down-sub-mcp",
  "version": "1.0.0",
  "description": "YouTube transcript MCP server for private use",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "youtube-transcript": "^1.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

### Adım 3: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Adım 4: `src/types.ts`

```typescript
export interface TranscriptRequest {
  url: string;
  lang?: "tr" | "en";
}

export interface TranscriptResponse {
  title: string;
  transcript: string;
  lang: string;
  videoId: string;
}

export interface ErrorResponse {
  error: string;
  details?: string;
}
```

### Adım 5: `src/tools/get-transcript.ts`

```typescript
import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptRequest, TranscriptResponse } from "../types.js";

export async function getTranscript(
  input: TranscriptRequest
): Promise<TranscriptResponse> {
  const { url, lang } = input;

  // Video ID'yi URL'den çıkar
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Geçersiz YouTube URL'si");
  }

  // Mevcut dilleri kontrol et
  const languages = await YoutubeTranscript.getTranscriptLanguages(videoId);

  if (languages.length === 0) {
    throw new Error("Bu video için transcript mevcut değil");
  }

  // Dil seçimi: belirtilen dil → mevcut değilse ilk mevcut dil
  let selectedLang = lang;
  if (lang) {
    const langExists = languages.some(
      (l: any) => l.languageCode === lang || l.lang === lang
    );
    if (!langExists) {
      throw new Error(
        `Dil "${lang}" bu video için mevcut değil. Mevcut diller: ${languages
          .map((l: any) => l.languageCode || l.lang)
          .join(", ")}`
      );
    }
  } else {
    // Otomatik: önce tr, yoksa en, yoksa ilk dil
    const langCodes = languages.map((l: any) => l.languageCode || l.lang);
    if (langCodes.includes("tr")) selectedLang = "tr";
    else if (langCodes.includes("en")) selectedLang = "en";
    else selectedLang = langCodes[0];
  }

  // Transcript'i çek
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: selectedLang,
  });

  // Metni birleştir (timestamp olmadan)
  const text = transcript.map((t: any) => t.text).join(" ");

  return {
    title: transcript[0]?.videoTitle || "Bilinmeyen Video",
    transcript: text,
    lang: selectedLang,
    videoId,
  };
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
```

### Adım 6: `src/index.ts` — MCP Server (Streamable HTTP + API Key Auth)

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTranscript } from "./tools/get-transcript.js";
import { createServer } from "http";
import { IncomingMessage } from "http";

// ─── API Key Auth ───────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("HATA: API_KEY environment variable tanımlanmalı!");
  process.exit(1);
}

function validateApiKey(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization || "";
  return authHeader === `Bearer ${API_KEY}`;
}

// ─── MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
  name: "down-sub-mcp",
  version: "1.0.0",
});

server.tool(
  "get-transcript",
  "YouTube videosunun transcript'ini (altyazı/metin) indirir. Dil belirtilmezse otomatik seçilir (önce tr, sonra en).",
  {
    url: z.string().describe("YouTube video URL'si"),
    lang: z
      .enum(["tr", "en"])
      .optional()
      .describe("Transcript dili (tr veya en). Belirtilmezse otomatik seçilir."),
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
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Hata: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ─── HTTP Server (Streamable HTTP) ──────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);

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

  // API Key kontrolü
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
      sessionIdGenerator: undefined, // Stateless
    });

    await server.connect(transport);

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });

    const reader = req.pipe(transport.writable);
    // Streamable HTTP handles the rest
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
```

### Adım 7: `.env.example`

```env
# API Key — MCP'ye erişim için Bearer token
# Güvenli bir token üretin: openssl rand -hex 32
API_KEY=your-secret-api-key-here

# Server port (varsayılan: 3000)
PORT=3000

# Node environment
NODE_ENV=production
```

### Adım 8: `Dockerfile` (Multi-stage, Alpine)

```dockerfile
# ─── Build Stage ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Production Stage ───────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Built files
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### Adım 9: `.dockerignore`

```
node_modules
dist
.env
.env.local
.git
*.md
```

---

## 🚀 Coolify Deployment

### 1. GitHub Repository

```bash
cd ~/Genel/repo/down-sub-mcp
git init
git add .
git commit -m "Initial commit: down-sub-mcp server"
git remote add origin git@github.com:<kullanici>/down-sub-mcp.git
git push -u origin main
```

### 2. Coolify'de Resource Oluşturma

1. **New Project** → `down-sub`
2. **New Resource** → **Application** → GitHub repo'yu bağla
3. **Build Pack**: `Dockerfile`
4. **Port**: `3000`
5. **Environment Variables** ekle:

| Key | Value |
|-----|-------|
| `API_KEY` | `openssl rand -hex 32` ile üretilmiş güvenli token |
| `NODE_ENV` | `production` |

6. **Deploy**

### 3. Domain (Opsiyonel)

Coolify'de uygulama ayarlarından custom domain ekle:
```
https://downsub.sizin-alaniniz.com
```

Traefik otomatik HTTPS sağlar.

---

## 🔌 OpenCode Entegrasyonu (my-notes dizini)

### `opencode.jsonc` — Remote MCP Ekleme

```json
"mcp": {
  "down-sub": {
    "type": "remote",
    "url": "https://downsub.sizin-alaniniz.com/mcp",
    "headers": {
      "Authorization": "Bearer {env:DOWN_SUB_API_KEY}"
    },
    "enabled": true
  }
}
```

### `.env.local` — API Key

```env
DOWN_SUB_API_KEY=<coolify-de-girilen-ayni-api-key>
```

### `.gitignore` — Güvenlik

```
.env.local
```

---

## 📋 OpenCoder Agent'a Talimat

Bu dosyayı okuyan OpenCoder agent aşağıdaki sırayla ilerlemelidir:

1. **Skill'leri yükle** (yukarıdaki `npx skills add` komutları)
2. **Proje iskeletini oluştur** (`package.json`, `tsconfig.json`, klasör yapısı)
3. **Kod dosyalarını yaz** (`src/index.ts`, `src/tools/get-transcript.ts`, `src/types.ts`)
4. **Docker dosyalarını yaz** (`Dockerfile`, `.dockerignore`, `.env.example`)
5. **Build et ve test et** (`npm run build`, `npm run dev`)
6. **README.md oluştur** (kurulum + kullanım talimatları)
7. **Git'e commit et**

### Kullanılacak Modeller

OpenCode'da `opencode-go` provider kullanılmalıdır:

| Görev | Model |
|-------|-------|
| Kod üretimi | `opencode-go/qwen3.6-plus` veya eşdeğeri |
| Code review | `opencode-go` available model |

### Test Komutları

```bash
# Build
npm run build

# Development (watch mode)
API_KEY=test-key npm run dev

# Docker build
docker build -t down-sub-mcp .

# Docker run
docker run -p 3000:3000 -e API_KEY=test-key down-sub-mcp

# Health check
curl http://localhost:3000/health

# MCP test (Streamable HTTP)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

---

## 🔒 Güvenlik Notları

- [ ] API key'i `openssl rand -hex 32` ile üret
- [ ] `.env.local` asla git'e push edilmez
- [ ] Coolify environment variables ile saklanır
- [ ] HTTPS zorunlu (Coolify/Traefik otomatik)
- [ ] Tek kullanıcı = tek API key yeterli, OAuth gerekmez
