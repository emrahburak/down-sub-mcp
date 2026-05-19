---
tags:
  - '#downsub-mcp'
  - '#mcp-server'
  - '#spec'
  - '#v2'
title: down-sub-mcp v2 — İki Aşamalı İndirme Mimarisi Spec
references: >-
  https://github.com/modelcontextprotocol/sdk,
  https://www.npmjs.com/package/youtube-transcript
tarih: 26.05.18
---

# down-sub-mcp v2 — İki Aşamalı İndirme Mimarisi

## 🎯 v2'nin Amacı

v1'de `get-transcript` tool'u tüm transcript içeriğini tool yanıtında döndürüyordu. 2-3 saatlik videolar için bu 50K-100K+ token anlamına geliyor. v2'de transcript içeriği **asla** MCP tool yanıtına dahil edilmiyor; bunun yerine raw HTTP endpoint üzerinden doğrudan dosyaya indirilebiliyor.

**v1 Sorunu:**
```
get-transcript(url) → { title, transcript: "50K token metin...", lang, videoId }
                        ↑ Tüm içerik agent context'ine girer
```

**v2 Çözümü:**
```
get-transcript-info(url) → { title, lang, wordCount, duration, videoId }  (~200 token)
GET /download?url=...&lang=...  → raw transcript stream (dosyaya pipe)
```

---

## 📦 v1'e Göre Değişiklikler

| Bileşen | v1 | v2 |
|---------|----|----|
| `get-transcript` tool | Full transcript döner | **KALDI** (backward compat) |
| `get-transcript-info` tool | Yok | **YENİ** — Sadece metadata |
| `GET /download` endpoint | Yok | **YENİ** — Raw transcript stream |
| `GET /health` endpoint | Var | Var (değişiklik yok) |
| `POST /mcp` endpoint | Var | Var (değişiklik yok) |
| Auth | Bearer token | Bearer token (değişiklik yok) |

---

## 🏗️ Değişen Dosyalar

```
down-sub-mcp/
├── src/
│   ├── index.ts                    # ← DEĞİŞTİ (yeni tool + yeni endpoint)
│   ├── tools/
│   │   ├── get-transcript.ts       # Değişiklik yok
│   │   └── get-transcript-info.ts  # ← YENİ
│   └── types.ts                    # ← DEĞİŞTİ (yeni tipler)
├── package.json                    # Değişiklik yok
├── tsconfig.json                   # Değişiklik yok
├── Dockerfile                      # Değişiklik yok
├── .env.example                    # Değişiklik yok
├── .dockerignore                   # Değişiklik yok
└── README.md                       # ← GÜNCELLENECEK
```

---

## 🔧 Geliştirme Adımları

### Adım 1: `src/types.ts` — Yeni Tipler

v1'deki tiplere ekleme yapılıyor. Mevcut tipler silinmiyor.

```typescript
// ─── v1 (mevcut, dokunma) ────────────────────────────────────────
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

// ─── v2 (yeni) ────────────────────────────────────────────────────
export interface TranscriptInfoRequest {
  url: string;
  lang?: "tr" | "en";
}

export interface TranscriptInfoResponse {
  title: string;
  videoId: string;
  lang: string;
  availableLangs: string[];
  wordCount: number;
  estimatedDuration: string; // "14:25" formatında
  hasTranscript: boolean;
}

export interface DownloadQueryParams {
  url: string;
  lang?: string;
  format?: "plain" | "srt" | "vtt"; // Gelecek için, şimdilik sadece "plain"
}
```

### Adım 2: `src/tools/get-transcript-info.ts` — Yeni Tool

Sadece metadata döndürür. Transcript içeriği **asla** bu tool'un yanıtına dahil edilmez.

```typescript
import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptInfoRequest, TranscriptInfoResponse } from "../types.js";

export async function getTranscriptInfo(
  input: TranscriptInfoRequest
): Promise<TranscriptInfoResponse> {
  const { url, lang } = input;

  // Video ID'yi URL'den çıkar
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Geçersiz YouTube URL'si");
  }

  // Mevcut dilleri kontrol et
  const languages = await YoutubeTranscript.getTranscriptLanguages(videoId);

  if (languages.length === 0) {
    return {
      title: "",
      videoId,
      lang: "",
      availableLangs: [],
      wordCount: 0,
      estimatedDuration: "0:00",
      hasTranscript: false,
    };
  }

  // Dil seçimi: belirtilen dil → mevcut değilse hata
  const langCodes = languages.map(
    (l: any) => l.languageCode || l.lang
  );

  let selectedLang: string;
  if (lang) {
    if (!langCodes.includes(lang)) {
      throw new Error(
        `Dil "${lang}" bu video için mevcut değil. Mevcut diller: ${langCodes.join(", ")}`
      );
    }
    selectedLang = lang;
  } else {
    // Otomatik: önce tr, yoksa en, yoksa ilk dil
    if (langCodes.includes("tr")) selectedLang = "tr";
    else if (langCodes.includes("en")) selectedLang = "en";
    else selectedLang = langCodes[0];
  }

  // Transcript'i çek (sadece metadata için, kelime sayısı hesapla)
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: selectedLang,
  });

  const fullText = transcript.map((t: any) => t.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // Süreyi hesapla (son timestamp + son süre)
  const lastEntry = transcript[transcript.length - 1];
  const totalSeconds = lastEntry
    ? Math.ceil((lastEntry.offsetMs + lastEntry.duration) / 1000)
    : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const estimatedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  // Video başlığını al
  const title = transcript[0]?.videoTitle || "Bilinmeyen Video";

  return {
    title,
    videoId,
    lang: selectedLang,
    availableLangs: langCodes,
    wordCount,
    estimatedDuration,
    hasTranscript: true,
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

### Adım 3: `src/index.ts` — Yeni Tool + Yeni Endpoint

Mevcut `index.ts`'e ekleme yapılıyor. Mevcut kodlar silinmiyor.

```typescript
#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getTranscript } from "./tools/get-transcript.js";
import { getTranscriptInfo } from "./tools/get-transcript-info.js";
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

// ─── URL'den Video ID Çıkarma (shared) ──────────────────────────
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

// ─── MCP Server ─────────────────────────────────────────────────
const server = new McpServer({
  name: "down-sub-mcp",
  version: "2.0.0",
});

// v1 tool — backward compatible (full transcript döner)
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

// v2 tool — sadece metadata döner, transcript içeriği dahil değil
server.tool(
  "get-transcript-info",
  "YouTube videosunun transcript metadata'sını döner (başlık, dil, kelime sayısı, süre). Transcript içeriği dahil DEĞİLDİR — içerik için /download endpoint'ini kullanın.",
  {
    url: z.string().describe("YouTube video URL'si"),
    lang: z
      .enum(["tr", "en"])
      .optional()
      .describe("Transcript dili (tr veya en). Belirtilmezse otomatik seçilir."),
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

// ─── HTTP Server (Streamable HTTP + Download Endpoint) ──────────
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
    res.end(JSON.stringify({ status: "ok", service: "down-sub-mcp", version: "2.0.0" }));
    return;
  }

  // ─── v2: Raw Download Endpoint ────────────────────────────────
  // GET /download?url=...&lang=...&format=plain
  // Transcript'i raw text olarak döner. curl -o ile dosyaya pipe edilebilir.
  if (req.method === "GET" && req.url?.startsWith("/download")) {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const videoUrl = parsedUrl.searchParams.get("url");
      const lang = parsedUrl.searchParams.get("lang") || undefined;
      const format = parsedUrl.searchParams.get("format") || "plain";

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
    } catch (error: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
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

    req.pipe(transport.writable);
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
```

### Adım 4: `src/tools/get-transcript.ts` — Refactor

Mevcut dosyadaki `extractVideoId` fonksiyonu `index.ts`'e taşındı (shared utility). Bu dosyada sadece fonksiyonun kendisi kalıyor, URL çıkarma artık parametre olarak alınıyor.

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

// extractVideoId artık index.ts'te shared utility olarak tanımlı
// Bu dosya kendi extractVideoId'sini kullanmaya devam ediyor (backward compat)
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

> **Not:** `extractVideoId` fonksiyonu hem `get-transcript.ts` hem `get-transcript-info.ts` hem de `index.ts`'te (download endpoint) kullanılıyor. İleride `src/utils.ts` dosyasına taşınabilir. Şimdilik her dosyada kendi kopyası var (DRY ihlali kabul edilebilir — küçük proje, 3 dosya).

---

## 🔌 Yeni API Referansı

### MCP Tool: `get-transcript-info`

**Açıklama:** Video transcript'inin sadece metadata'sını döner. İçerik dahil değildir.

**Parametreler:**
| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `url` | string | ✅ | YouTube video URL'si |
| `lang` | "tr" \| "en" | ❌ | Transcript dili. Belirtilmezse otomatik |

**Yanıt:**
```json
{
  "title": "Why Your Understanding of AI Context is Probably WRONG",
  "videoId": "BUIpHp2qLSI",
  "lang": "en",
  "availableLangs": ["en", "tr", "de"],
  "wordCount": 2847,
  "estimatedDuration": "14:25",
  "hasTranscript": true
}
```

**Token maliyeti:** ~200 token (sabit, video uzunluğundan bağımsız)

### HTTP Endpoint: `GET /download`

**Açıklama:** Transcript'i raw text olarak döner. `curl -o` ile doğrudan dosyaya yazılabilir.

**Parametreler:**
| Parametre | Tip | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `url` | string | ✅ | YouTube video URL'si |
| `lang` | string | ❌ | Transcript dili. Belirtilmezse otomatik |
| `format` | string | ❌ | "plain" (varsayılan). Gelecek: "srt", "vtt" |

**Örnek kullanım:**
```bash
# Basit indirme
curl -s -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  "https://downsub.aurensoft.me/download?url=https://youtube.com/watch?v=BUIpHp2qLSI&lang=en" \
  -o "references/why-your-understanding-of-ai-context-en.txt"

# Başlık ile indirme (Content-Disposition header'dan)
curl -s -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  -OJ \
  "https://downsub.aurensoft.me/download?url=https://youtube.com/watch?v=BUIpHp2qLSI&lang=en"
```

**Yanıt header'ları:**
```
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="why-your-understanding-of-ai-context-en.txt"
```

**Hata yanıtları:**
| Durum | Açıklama |
|-------|----------|
| 400 | `url` parametresi eksik veya geçersiz format |
| 401 | API key eksik veya geçersiz |
| 404 | Video bulunamadı veya transcript mevcut değil |
| 500 | Sunucu hatası |

---

## 📋 OpenCoder Agent'a Talimat

Bu dosyayı okuyan OpenCoder agent aşağıdaki sırayla ilerlemelidir:

1. **Mevcut kodu oku** — `src/index.ts`, `src/tools/get-transcript.ts`, `src/types.ts` dosyalarını incele
2. **Yeni dosyayı oluştur** — `src/tools/get-transcript-info.ts`
3. **Mevcut dosyaları güncelle** — `src/types.ts` (yeni tipler), `src/index.ts` (yeni tool + download endpoint)
4. **Build et ve test et** — `npm run build`
5. **Manuel test** — Aşağıdaki test komutlarını çalıştır
6. **Git'e commit et** — `git add . && git commit -m "feat: v2 two-stage download architecture"`

### Kullanılacak Modeller

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

# Health check (v2)
curl http://localhost:3000/health
# Beklenen: {"status":"ok","service":"down-sub-mcp","version":"2.0.0"}

# MCP test — get-transcript-info (yeni tool)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get-transcript-info",
      "arguments": {
        "url": "https://www.youtube.com/watch?v=BUIpHp2qLSI"
      }
    }
  }'

# Download endpoint test (raw transcript)
curl -s -H "Authorization: Bearer test-key" \
  "http://localhost:3000/download?url=https://www.youtube.com/watch?v=BUIpHp2qLSI&lang=en" \
  -o test-transcript.txt

# Dosya içeriğini kontrol et
head -5 test-transcript.txt
rm test-transcript.txt

# Backward compat test — eski get-transcript hala çalışıyor mu?
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get-transcript",
      "arguments": {
        "url": "https://www.youtube.com/watch?v=BUIpHp2qLSI",
        "lang": "en"
      }
    }
  }'
```

---

## 🔒 Güvenlik Notları

- [x] API key doğrulaması `/download` endpoint'inde de geçerli
- [x] `/download` endpoint'i sadece `GET` metodunu kabul eder
- [x] URL parametresi zorunlu, eksikse 400 döner
- [x] Content-Disposition header ile dosya adı sağlanır
- [x] Backward compat: v1 `get-transcript` tool'u değişmedi

---

## 📊 Token Maliyeti Karşılaştırması

| Senaryo | v1 (`get-transcript`) | v2 (`get-transcript-info` + `/download`) |
|---------|----------------------|------------------------------------------|
| 5 dakikalık video | ~2,000 token | ~200 token (info) + 0 (download) |
| 30 dakikalık video | ~10,000 token | ~200 token (info) + 0 (download) |
| 2 saatlik video | ~50,000 token | ~200 token (info) + 0 (download) |
| 3 saatlik video | ~80,000 token | ~200 token (info) + 0 (download) |

**Sonuç:** v2'de token maliyeti video uzunluğundan bağımsız olarak sabit ~200 token. Transcript içeriği agent context'ine hiç girmiyor.

---

## ⚠️ Bilinen Sınırlamalar

1. **`extractVideoId` tekrarı** — 3 dosyada aynı fonksiyon var. İleride `src/utils.ts`'e taşınmalı.
2. **`/download` endpoint'i senkron** — Büyük videolarda uzun sürebilir. İleride streaming veya async pattern eklenebilir.
3. **Format desteği** — Şimdilik sadece `plain` format var. `srt` ve `vtt` gelecekte eklenebilir.
4. **Rate limiting yok** — Tek kullanıcı olduğu için gerekmez, ama ileride eklenirse `express-rate-limit` kullanılabilir.
