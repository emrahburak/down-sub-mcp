# down-sub-mcp

A lightweight **MCP Server** that extracts transcripts (subtitles/text) from YouTube videos.

Designed to provide AI assistants (Claude, Cursor, OpenCode, etc.) with YouTube video content as text. Give it a URL, get the transcript — language selection is automatic.

## How It Works

```
YouTube URL → down-sub-mcp → Transcript text → AI assistant
```

## Features

- Extract transcript from any YouTube video URL
- Automatic language fallback (tr → en → default)
- API Key authentication (Bearer token)
- Streamable HTTP transport (MCP standard)
- Docker-ready with multi-stage Alpine build
- Coolify deployment support

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | Node.js + TypeScript |
| MCP SDK | @modelcontextprotocol/sdk |
| Transport | Streamable HTTP |
| Transcript | youtube-transcript (npm) |
| Auth | API Key (Bearer token) |
| Container | Docker (multi-stage, Alpine) |

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

## Usage

### Health Check

```bash
curl http://localhost:3000/health
```

### MCP Tool Call

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-transcript","arguments":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}}'
```

### OpenCode Integration

Add to your `opencode.jsonc`:

```json
"mcp": {
  "down-sub": {
    "type": "remote",
    "url": "https://downsub.your-domain.com/mcp",
    "headers": {
      "Authorization": "Bearer {env:DOWN_SUB_API_KEY}"
    },
    "enabled": true
  }
}
```

Set the key in `.env.local`:

```env
DOWN_SUB_API_KEY=<same-api-key-from-coolify>
```

## Coolify Deployment

1. Push to GitHub
2. Coolify → **New Resource** → **Application** → connect repo
3. **Build Pack**: `Dockerfile`
4. **Port**: `3000`
5. **Environment Variables**:
   - `API_KEY`: generate with `openssl rand -hex 32`
   - `NODE_ENV`: `production`
6. **Deploy**

## Security

- Generate API key with `openssl rand -hex 32`
- Never commit `.env.local` to git
- Store secrets in Coolify environment variables
- HTTPS required (Coolify/Traefik handles automatically)

## Project Structure

```
down-sub-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   └── get-transcript.ts # Transcript fetcher
│   └── types.ts              # TypeScript type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example
├── .dockerignore
└── README.md
```
