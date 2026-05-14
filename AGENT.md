# down-sub-mcp — Agent Guide

## Project Overview

A lightweight MCP Server that extracts transcripts from YouTube videos. Built with Node.js + TypeScript, deployed via Docker on Coolify.

## Tech Stack

- **Runtime**: Node.js 20+ (ESM)
- **Language**: TypeScript 5+
- **MCP SDK**: `@modelcontextprotocol/sdk` (Streamable HTTP)
- **Transcript**: `youtube-transcript` (npm)
- **Validation**: `zod`
- **Container**: Docker multi-stage (Alpine)

## Project Structure

```
down-sub-mcp/
├── src/
│   ├── index.ts              # MCP server entry (HTTP + auth + tool registration)
│   ├── tools/
│   │   └── get-transcript.ts # Core transcript fetcher with language fallback
│   └── types.ts              # TypeScript interfaces
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
└── .dockerignore
```

## Key Patterns

### Language Fallback Strategy

```
explicit lang → tr → en → first available
```

The `get-transcript` tool tries languages in order. If a requested language isn't available, it throws a clear error listing available languages.

### Error Handling

- All errors return MCP `isError: true` responses (never crash the server)
- Specific `youtube-transcript` error types are caught and converted to user-friendly messages
- API key validation returns 401 before reaching MCP layer

### Auth

- Bearer token via `API_KEY` environment variable
- Validated on every request before MCP processing
- Health check also requires auth

## Development

```bash
npm install
API_KEY=test-key npm run dev    # watch mode
npm run build                    # compile to dist/
API_KEY=test-key npm run start   # run compiled output
```

## Testing

```bash
# Health check
curl http://localhost:3000/health -H "Authorization: Bearer test-key"

# MCP initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Tool call
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-transcript","arguments":{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}}}'
```

## Docker

```bash
docker build -t down-sub-mcp .
docker run -p 3000:3000 -e API_KEY=your-key down-sub-mcp
```

## Coolify Deployment

1. Connect GitHub repo
2. Build Pack: `Dockerfile`
3. Port: `3000`
4. Env vars: `API_KEY` (generate with `openssl rand -hex 32`), `NODE_ENV=production`

## Code Standards

- Pure functions where possible
- Explicit error handling (no silent failures)
- Small, focused modules (< 50 lines per function)
- TypeScript strict mode
- ESM modules only (`.js` extensions in imports)
