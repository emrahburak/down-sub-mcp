# down-sub-mcp v3.1.0 — Zero-Storage Architecture Spec

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   down-sub-mcp (Remote)                  │
│                                                         │
│  MCP Layer (Streamable HTTP)     HTTP Layer              │
│  ┌──────────────────────────┐   ┌──────────────────┐    │
│  │ get-transcript-info      │   │ GET /download     │    │
│  │ → metadata only (~200tk) │   │ → content stream  │    │
│  │ → title, lang, wordCount│   │ → zero disk       │    │
│  │ → videoId, duration      │   │ → zero token      │    │
│  └──────────────────────────┘   └──────────────────┘    │
│            │                            │                │
│            ▼                            ▼                │
│  ┌──────────────────────────────────────────────────┐    │
│  │          getTranscript() — Shared Logic          │    │
│  │          YouTube API → in-memory → deliver       │    │
│  │          NEVER writes to server disk             │    │
│  └──────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
   Hermes Agent                    Hermes Agent
   MCP tool call              terminal: curl -o
   (metadata only)            (content → local file)
```

## 2. Core Principle

> The MCP server is a **stateless content fetcher**. It fetches transcripts from YouTube
> and delivers them to the client. It **NEVER** stores transcript content on disk.
> All content is delivered in-memory and garbage-collected after the response.

## 3. Components

### 3.1 MCP Tool (1 tool)

| Tool | Returns | Token Cost |
|------|---------|-----------|
| `get-transcript-info` | Metadata JSON (title, lang, wordCount, videoId, estimatedDuration, availableLanguages) | ~200 |

**REMOVED in v3.1.0:** `get-transcript` — full transcript text via MCP was removed because:
- MCP tool results always enter the LLM context window
- 50K+ token transcripts bloat context and incur cost
- Content delivery moved exclusively to HTTP `/download` endpoint

**REMOVED in v3.0.0:** `download-transcript` — file-writing MCP tool was removed because:
- Remote MCP servers write files to their own filesystem, not the client's
- Zero-storage principle: server disk must never contain transcript files

### 3.2 HTTP Endpoints

| Endpoint | Method | Purpose | Token Cost |
|----------|--------|---------|-----------|
| `/health` | GET | Health check, version info | 0 |
| `/mcp` | POST | MCP Streamable HTTP transport | N/A |
| `/download?url=&lang=&format=plain` | GET | **Primary content delivery** — raw transcript streamed via HTTP response | **0** |

### 3.3 Shared Logic

`src/tools/get-transcript.ts` — `getTranscript()` function:
- Called by `/download` HTTP endpoint
- Fetches from YouTube API, formats, returns in-memory
- **Not exposed as MCP tool** (registration removed in v3.1.0)

## 4. Client-Side Workflow (downsub-mimic agent)

```
downsub <url>
  │
  ├── ① MCP: get-transcript-info → {title, lang, wordCount, videoId}
  │     ~200 tokens, metadata only
  │
  ├── ② Size check: wordCount > 50000 → abort E006
  │
  ├── ③ Slug: title → ASCII-safe filename
  │
  ├── ④ Terminal: curl -fsSL -o vault/inbox/{slug}-{lang}.txt
  │     "https://downsub.aurensoft.me/download?url=...&lang=...&apiKey=..."
  │     Zero tokens — content streams directly to local file
  │     Timeout: 300s
  │
  └── ⑤ Report: BIRAKILAN: vault/inbox/{slug}-{lang}.txt
       Content NEVER enters chat
```

## 5. Design Decisions

### 5.1 Why MCP + HTTP Hybrid?

| Approach | Token Cost | Large Videos | Architecture |
|----------|-----------|-------------|-------------|
| MCP-only (get-transcript) | ~50K tokens | ❌ Context overflow | Single channel |
| MCP pagination (jkawamoto-style) | ~50K tokens (chunked) | ✅ With next_cursor | Single channel, slow |
| **MCP info + HTTP /download (ours)** | **~200 tokens** | **✅ Stream** | Two channels |

**Decision:** MCP for metadata (low token), HTTP for content (zero token). This is the only
approach that achieves zero token cost for transcript content.

### 5.2 Why not pagination?

Pagination (like jkawamoto/mcp-youtube-transcript) still puts content in context,
just in chunks. Each chunk consumes tokens. For a 50K-word transcript:
- Pagination: ~50K tokens total (all chunks)
- HTTP download: 0 tokens

### 5.3 Why remove get-transcript from MCP?

MCP protocol has no mechanism to exclude tool results from context. Every `CallToolResult`
is injected into the LLM's context window. The only way to prevent content from entering
context is to not return it as a tool result.

### 5.4 Comparison with other MCP servers

| Server | ⭐ | Tools | Content Strategy | Token Cost |
|--------|---|-------|-----------------|-----------|
| kimtaeyoon83/mcp-server-youtube-transcript | 563 | 1 (get_transcript) | Full text in MCP response | High |
| jkawamoto/mcp-youtube-transcript | 409 | 3 + pagination | Chunked in MCP response | High (chunked) |
| egoist/fetch-mcp | 156 | 2 | Full text in MCP response | High |
| **down-sub-mcp (ours)** | - | **1 (info only)** | **HTTP stream** | **~200** |

We are the only MCP server that separates metadata (MCP) from content (HTTP).

## 6. Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.5 | 2026-06-19 | Added download-transcript MCP tool (remote file write — bug) |
| v3.0.0 | 2026-06-20 | Removed download-transcript; zero-storage architecture; /download as primary |
| **v3.1.0** | **2026-06-20** | **Removed get-transcript MCP tool; single MCP tool (info only)** |

## 7. Project Structure

```
src/
├── index.ts                    # HTTP server + MCP tool registration (1 tool)
├── tools/
│   ├── get-transcript.ts       # Core transcript fetcher (used by /download endpoint)
│   └── get-transcript-info.ts  # Metadata-only MCP tool
├── utils/
│   └── slugify.ts              # ASCII-safe filename generation
└── types.ts                    # TypeScript interfaces

REMOVED:
  src/tools/download-transcript.ts   (v3.0.0)
  DownloadTranscriptRequest          (v3.0.0, from types.ts)
  DownloadTranscriptResponse         (v3.0.0, from types.ts)
  get-transcript MCP registration    (v3.1.0, from index.ts)
```

## 8. Environment

Required: `API_KEY` environment variable (no default)

Optional:
- `PORT` (default: 3000)
- `NODE_ENV` (default: development)

## 9. Security

- **Auth:** API key via query param `?apiKey=<key>` (priority) or `Authorization: Bearer <key>`
- **Zero storage:** No transcript content ever written to server disk
- **Stateless:** No session state, no cached transcripts
- **Input validation:** URL format validation, language enum constraint (`tr` | `en`)

## 10. Error Handling

| Scenario | HTTP Status | MCP Response |
|----------|------------|-------------|
| Missing API key | 401 | isError: true |
| Invalid URL | 400 | isError: true |
| Transcript unavailable | 500 | isError: true |
| Network timeout | 500 | isError: true |
| Unknown format | 400 | N/A |

All MCP errors return `isError: true` — the server never crashes.
