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
- **v2:** `get-transcript-info` tool — metadata only (~200 tokens, independent of video length)
- **v2:** `GET /download` endpoint — raw transcript streaming to file
- API Key authentication (Bearer token or query param)
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
| Auth | API Key (Bearer token or query param) |
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
# Query param
curl "http://localhost:3000/health?apiKey=test-key"

# Bearer header
curl http://localhost:3000/health -H "Authorization: Bearer test-key"
```

### MCP Tool Call

#### `get-transcript` — Full transcript

```bash
curl -X POST "http://localhost:3000/mcp?apiKey=test-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-transcript","arguments":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}}'
```

#### `get-transcript-info` — Metadata only (v2)

Returns title, language, word count, duration, and available languages — without the full transcript text.

```bash
curl -X POST "http://localhost:3000/mcp?apiKey=test-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-transcript-info","arguments":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}}}'
```

### Download Transcript to File (v2)

Stream raw transcript text directly to a file:

```bash
# Download to specific filename
curl -s -H "Authorization: Bearer test-key" \
  "http://localhost:3000/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&lang=en" \
  -o transcript.txt

# Auto-filename from Content-Disposition header
curl -s -OJ -H "Authorization: Bearer test-key" \
  "http://localhost:3000/download?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&lang=en"
```

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `url` | Yes | YouTube video URL or video ID |
| `lang` | No | Language code (`tr`, `en`). Auto-selects if omitted |
| `format` | No | `plain` (default). Future: `srt`, `vtt` |

## OpenCode Integration

Add to your `opencode.jsonc`:

```json
"mcp": {
  "downsub-mcp": {
    "type": "remote",
    "url": "https://downsub.your-domain.com/mcp?apiKey={env:DOWNSUB_API_KEY}",
    "enabled": true
  }
}
```

Set the key in your `.env` file:

```env
DOWNSUB_API_KEY=<same-api-key-from-coolify>
```

> **Note:** OpenCode resolves `{env:VAR_NAME}` from the shell environment, not from `.env` files. Use `direnv` to auto-load variables when entering your project directory:
>
> 1. Create `.envrc` with `dotenv`
> 2. Run `direnv allow`
>
> Or source manually before launching: `source .env && opencode`

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
- Never commit `.env` to git
- Store secrets in Coolify environment variables
- HTTPS required (Coolify/Traefik handles automatically)

## Project Structure

```
down-sub-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── tools/
│   │   ├── get-transcript.ts # Full transcript fetcher
│   │   └── get-transcript-info.ts  # Metadata-only tool (v2)
│   └── types.ts              # TypeScript type definitions
├── package.json
├── tsconfig.json
├── Dockerfile
├── .env.example              # Environment template
├── .envrc                    # direnv auto-load config
├── .dockerignore
└── README.md
```
