# down-sub-mcp v3.1.0

**Zero-storage, zero-token YouTube transcript delivery.**  
Metadata via MCP (~200 tokens). Content via HTTP stream (0 tokens).  
Never writes transcript to server disk.

```
YouTube URL → down-sub-mcp ──→ get-transcript-info (MCP, metadata only, ~200 tokens)
                         └──→ /download (HTTP, content stream, 0 tokens)
```

## Architecture

```
┌─────────────────────────────────────────────┐
│              down-sub-mcp (Remote)           │
│                                              │
│  MCP (1 tool)           HTTP                 │
│  ┌──────────────────┐   ┌────────────────┐   │
│  │ get-transcript-  │   │ GET /download   │   │
│  │ info             │   │ → content       │   │
│  │ → title, lang,   │   │   stream        │   │
│  │   wordCount,     │   │ → zero disk     │   │
│  │   videoId, dur.  │   │ → zero token    │   │
│  └──────────────────┘   └────────────────┘   │
│                                              │
│       getTranscript() — shared logic         │
│       YouTube API → in-memory → deliver      │
│       NEVER writes to server disk            │
└─────────────────────────────────────────────┘
```

## Why This Design?

| Approach | Token Cost | Large Videos | Notes |
|----------|-----------|-------------|-------|
| MCP-only (full text) | ~50K | ❌ Context overflow | Most MCP servers do this |
| MCP pagination | ~50K (chunked) | ✅ With cursor | Still puts content in context |
| **MCP info + HTTP /download** | **~200** | **✅ Stream** | **Only this achieves zero token** |

MCP has no mechanism to exclude tool results from LLM context. The only way to keep content out of the context window is to not return it as a tool result — so content flows exclusively through the HTTP `/download` endpoint.

## Features

- **One MCP tool** — `get-transcript-info`: metadata only (title, language, word count, duration, available languages)
- **HTTP `/download` endpoint** — raw transcript stream, zero tokens, write directly to file with `curl -o`
- **Zero server storage** — transcript is fetched in-memory, delivered, then garbage-collected. Never touches disk.
- **Zero token content delivery** — transcript text never enters LLM context
- Automatic language selection (`tr` → `en` → auto)
- API Key authentication (query param or Bearer header)
- Streamable HTTP MCP transport
- Docker-ready (multi-stage Alpine)
- Coolify-compatible

## Quick Start

### Development

```bash
npm install
API_KEY=test-key npm run dev
```

### Build & Run

```bash
npm run build
API_KEY=test-key npm run start
```

### Docker

```bash
docker build -t down-sub-mcp .
docker run -p 3000:3000 -e API_KEY=test-key down-sub-mcp
```

## API Reference

### `GET /health`

```bash
curl "https://downsub.aurensoft.me/health?apiKey=YOUR_KEY"
# {"status":"ok","service":"down-sub-mcp","version":"3.1.0"}
```

### MCP: `get-transcript-info` (only MCP tool)

Returns metadata only — title, language, word count, duration, available languages. Transcript content is **NOT included**.

```bash
curl -X POST "https://downsub.aurensoft.me/mcp?apiKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"tools/call",
    "params":{
      "name":"get-transcript-info",
      "arguments":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","lang":"en"}
    }
  }'
```

**Response (~200 tokens):**
```json
{
  "title": "Rick Astley - Never Gonna Give You Up...",
  "videoId": "dQw4w9WgXcQ",
  "lang": "en",
  "availableLangs": ["en"],
  "wordCount": 487,
  "estimatedDuration": "3:32",
  "hasTranscript": true
}
```

### `GET /download` — Primary Content Delivery

Stream raw transcript to a local file. Zero tokens — content goes directly to disk.

```bash
# Query param auth
curl -s -o transcript.txt \
  "https://downsub.aurensoft.me/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&lang=en&apiKey=YOUR_KEY"

# Bearer token auth
curl -s -o transcript.txt \
  -H "Authorization: Bearer YOUR_KEY" \
  "https://downsub.aurensoft.me/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&lang=en"
```

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `url` | **Yes** | YouTube URL or video ID (`dQw4w9WgXcQ`) |
| `lang` | No | Language: `tr` or `en`. Auto-detects if omitted |
| `format` | No | Output format: `plain` (default). Future: `srt`, `vtt` |

## Agent Workflow (downsub-mimic)

The recommended client pattern:

```
downsub <url>
  │
  ├─ 1. MCP: get-transcript-info → {title, lang, wordCount, videoId}
  │      ~200 tokens
  │
  ├─ 2. Size check: wordCount > 50000 → abort
  │
  ├─ 3. Slug: title → ASCII-safe filename
  │
  ├─ 4. Terminal: curl -o vault/inbox/{slug}-{lang}.txt
  │     "https://downsub.aurensoft.me/download?url=...&lang=..."
  │     Zero tokens — content streams directly to local file
  │
  └─ 5. Report: BIRAKILAN: vault/inbox/{slug}-{lang}.txt
       Content NEVER enters chat
```

## Integration

### Hermes Agent

```xml
<!-- ~/.hermes/agents/downsub-mimic.xml -->
<tool name="mcp_downsub_get_transcript_info">Metadata only</tool>
<tool name="terminal">curl /download → local file</tool>
```

### OpenCode / Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "downsub-mcp": {
      "type": "url",
      "url": "https://downsub.aurensoft.me/mcp?apiKey=YOUR_KEY"
    }
  }
}
```

> **Note:** This gives you only `get-transcript-info`. For content, use `curl` with the `/download` endpoint. This is intentional — content should never enter the LLM context window.

## Deployment (Coolify)

1. Push to GitHub
2. Coolify → **New Resource** → **Application** → connect repo
3. Build Pack: `Dockerfile`
4. Port: `3000`
5. Environment variables:
   - `API_KEY`: generate with `openssl rand -hex 32`
   - `NODE_ENV`: `production`
6. Deploy

## Security

- API key required for all endpoints
- Generate keys: `openssl rand -hex 32`
- Pass via query param (`?apiKey=...`) or `Authorization: Bearer` header
- Never commit `.env` or `.envrc` to git
- Store secrets in Coolify / environment variables
- HTTPS enforced (Cloudflare / Coolify Traefik)
- Zero server storage — no transcript data persisted

## Project Structure

```
down-sub-mcp/
├── src/
│   ├── index.ts                  # HTTP server + 1 MCP tool registration
│   ├── tools/
│   │   ├── get-transcript.ts     # Core fetcher (used by /download, NOT an MCP tool)
│   │   └── get-transcript-info.ts # Metadata-only MCP tool
│   ├── utils/
│   │   └── slugify.ts            # ASCII-safe filename generation
│   └── types.ts                  # TypeScript interfaces
├── SPEC.md                       # Architecture spec (v3.1.0)
├── AGENTS.md                     # AI agent instructions
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── README.md
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.5 | 2026-06-19 | Initial release: `get-transcript` MCP tool |
| v3.0.0 | 2026-06-20 | Zero-storage: added `/download`, `get-transcript-info` |
| **v3.1.0** | **2026-06-20** | **Removed `get-transcript` MCP tool. Single MCP tool: `get-transcript-info`. Content exclusively via HTTP `/download`.** |

## License

MIT
