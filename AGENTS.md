# down-sub-mcp — Agent Guide

## Project Overview

A lightweight MCP Server that extracts transcripts from YouTube videos. Built with Node.js + TypeScript, deployed via Docker on Coolify. Single-user service with API key authentication.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (optional, for containerized deployment)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/emrahburak/down-sub-mcp.git
cd down-sub-mcp
npm install

# 2. Set environment variable
export API_KEY=test-key

# 3. Run in development mode (watch)
npm run dev

# Or build and run production
npm run build
npm run start
```

Server starts on `http://localhost:3000`.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript 5+ (strict mode) |
| MCP SDK | `@modelcontextprotocol/sdk` |
| Transport | Streamable HTTP |
| Transcript | `youtube-transcript` (npm) |
| Validation | `zod` |
| Container | Docker multi-stage (Alpine) |
| Hosting | Coolify (Git push auto-deploy) |

## Architecture

### Request Flow

```
Client (OpenCode/Claude)
  │
  ├─ POST /mcp (Authorization: Bearer <API_KEY>)
  │
  ▼
HTTP Server (src/index.ts)
  │
  ├─ API Key validation → 401 if invalid
  │
  ▼
MCP Server (StreamableHTTPServerTransport)
  │
  ├─ tools/call → get-transcript
  │
  ▼
Transcript Fetcher (src/tools/get-transcript.ts)
  │
  ├─ Extract video ID from URL
  ├─ Fetch transcript with language fallback
  │
  ▼
Response → MCP JSON → Client
```

### Project Structure

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
├── .dockerignore
├── AGENTS.md
└── README.md
```

## API Reference

### Tool: `get-transcript`

Extracts transcript text from a YouTube video.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | YouTube video URL or video ID (11 chars) |
| `lang` | `"tr"` \| `"en"` | No | Preferred transcript language |

**Language Fallback:**

```
explicit lang → tr → en → first available
```

**Response Format:**

```json
{
  "title": "YouTube Video",
  "transcript": "Full transcript text joined from all segments...",
  "lang": "tr",
  "videoId": "dQw4w9WgXcQ"
}
```

**Error Responses:**

| Error | Description |
|-------|-------------|
| `Gecersiz YouTube URL'si` | URL format not recognized |
| `Bu video icin transcript mevcut degil` | No transcript available |
| Language error from youtube-transcript | Language not available for this video |

### HTTP Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | Required | Health check |
| `POST` | `/mcp` | Required | MCP Streamable HTTP endpoint |

## Key Patterns

### Language Fallback Strategy

The `get-transcript` tool attempts languages in order. If a requested language isn't available, it throws a clear error listing available languages.

### Error Handling

- All errors return MCP `isError: true` responses (never crash the server)
- Specific `youtube-transcript` error types are caught and converted to user-friendly messages
- API key validation returns 401 before reaching MCP layer

### Auth

- Bearer token via `API_KEY` environment variable
- Validated on every request before MCP processing
- Health check also requires auth

## Development

### Scripts

```bash
npm install           # Install dependencies
npm run dev           # Watch mode (tsx)
npm run build         # Compile to dist/
npm run start         # Run compiled output
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | Yes | — | Bearer token for authentication |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Node environment |

## Testing

```bash
# Health check
curl http://localhost:3000/health \
  -H "Authorization: Bearer test-key"

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
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get-transcript","arguments":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}}'
```

## Docker

```bash
# Build
docker build -t down-sub-mcp .

# Run
docker run -p 3000:3000 -e API_KEY=your-key down-sub-mcp

# Health check
curl http://localhost:3000/health
```

## Coolify Deployment

1. Connect GitHub repository
2. **Build Pack**: `Dockerfile`
3. **Port**: `3000`
4. **Environment Variables**:

| Key | Value |
|-----|-------|
| `API_KEY` | `openssl rand -hex 32` output |
| `NODE_ENV` | `production` |

5. Deploy

### OpenCode Integration

Add to `opencode.jsonc`:

```json
"mcp": {
  "down-sub": {
    "type": "remote",
    "url": "https://your-domain.com/mcp",
    "headers": {
      "Authorization": "Bearer {env:DOWN_SUB_API_KEY}"
    },
    "enabled": true
  }
}
```

Set in `.env.local`:

```env
DOWN_SUB_API_KEY=<same-api-key-from-coolify>
```

## Security Notes

- Generate API key with `openssl rand -hex 32`
- Never commit `.env` or `.env.local` to git
- Store secrets in Coolify environment variables
- HTTPS required (Coolify/Traefik handles automatically)
- Single user = single API key, no OAuth needed

## Code Standards

- Pure functions where possible
- Explicit error handling (no silent failures)
- Small, focused modules (< 50 lines per function)
- TypeScript strict mode
- ESM modules only (`.js` extensions in imports)
- Naming: lowercase-with-dashes for files, camelCase for functions
