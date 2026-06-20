# down-sub-mcp — Agent Guide

## Commands

```bash
npm run dev           # Watch mode (tsx) — server auto-reloads
npm run build         # Compile TypeScript to dist/
npm run start         # Run compiled output (node dist/index.js)
```

**No test framework configured.** Do not attempt to run tests.

## Architecture

**Two MCP tools:**
- `get-transcript` — Full transcript text with language fallback
- `get-transcript-info` — Metadata only (title, lang, word count, duration) — ~200 tokens regardless of video length

**Three HTTP endpoints:**
- `GET /health` — Health check
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /download?url=...&lang=...&format=plain` — Raw transcript as text file

**Language fallback:** explicit lang → tr → en → first available

**Auth:** API key via query param `?apiKey=<key>` (priority) or `Authorization: Bearer <key>` header

## Project Structure

```
src/
├── index.ts                    # HTTP server + MCP tool registration
├── tools/
│   ├── get-transcript.ts       # Full transcript fetcher
│   └── get-transcript-info.ts  # Metadata-only tool (v2)
├── utils/
│   └── slugify.ts              # ASCII-safe filename generation
└── types.ts                    # TypeScript interfaces
```

## Code Standards

- **ESM modules only** — Use `.js` extensions in imports (e.g., `import { foo } from "./bar.js"`)
- **TypeScript strict mode** — Enabled in tsconfig.json
- **Error messages in Turkish** — Intentional (e.g., "Gecersiz YouTube URL'si")
- Pure functions where possible
- Explicit error handling (no silent failures)
- All MCP errors return `isError: true` responses (never crash the server)

## Environment

Required: `API_KEY` environment variable (no default)

Optional:
- `PORT` (default: 3000)
- `NODE_ENV` (default: development)

**direnv setup:** `.envrc` exists — run `direnv allow` to auto-load `.env` when entering directory.

## Key Patterns

**Video ID extraction:** Supports youtube.com/watch, youtu.be, youtube.com/shorts, youtube.com/embed, or raw 11-char ID

**Title fetching:** Uses YouTube oEmbed API (free, no API key required)

**Duration calculation:** Handles inconsistent units from youtube-transcript library (seconds vs milliseconds) with fallback logic

**Filename generation:** Turkish/Latin characters mapped to ASCII for HTTP header safety (Content-Disposition)
