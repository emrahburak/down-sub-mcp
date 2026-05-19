---
tags:
  - '#downsub-mcp'
  - '#mcp-server'
  - '#spec'
  - '#v2.2'
  - '#bugfix'
title: down-sub-mcp v2.2 — Video Başlığı Düzeltmesi (oEmbed)
references: >-
  https://www.youtube.com/oembed?url=...,
  https://www.npmjs.com/package/youtube-transcript
tarih: 26.05.19
---

# down-sub-mcp v2.2 — Video Başlığı Düzeltmesi (oEmbed)

## 🐛 Bug: Dosya adları video ID kullanıyor

`get-transcript-info` ve `/download` endpoint'i video başlığı yerine video ID kullanıyor.

**Örnek (hatalı):**
```
references/oMA69lwAJdY-en.txt    ← video ID
references/cSzvZiHrruI-en.txt    ← video ID
```

**Beklenen:**
```
references/why-does-ai-context-matter-en.txt     ← video başlığı
```

---

## 🔍 Kök Neden

`youtube-transcript` npm paketi (v1.3.1) `fetchTranscript()` çıktısında **video başlığı döndürmez**. Tip tanımı:

```typescript
export interface TranscriptResponse {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
}
// ↑ title / videoTitle YOK
```

Mevcut kod `transcript[0]?.videoTitle` → **her zaman** `undefined` → `"Bilinmeyen Video"` → DownSubAgent fallback → video ID.

### Zincir

```
get-transcript-info (Coolify)           DownSubAgent
────────────────────────────            ─────────────
videoTitle → undefined                  title "Bilinmeyen Video"
→ "Bilinmeyen Video"        ────────→   → generic → videoId fallback
                                        curl -o "references/{videoId}-en.txt"
```

Bug **Coolify tarafında**. DownSubAgent'ta değişiklik gerekmez — upstream düzgün title dönerse otomatik düzelir.

---

## ✅ Çözüm: YouTube oEmbed API

YouTube'un **ücretsiz, API key gerektirmeyen** oEmbed endpoint'i:

```
GET https://www.youtube.com/oembed?url={videoUrl}&format=json
```

**Yanıt:**
```json
{
  "title": "How Do You Build AI Without Messing Up?",
  "author_name": "Darren",
  "author_url": "https://www.youtube.com/@Darren",
  "type": "video",
  "height": 113,
  "width": 200,
  "version": "1.0",
  "provider_name": "YouTube",
  "provider_url": "https://www.youtube.com/",
  "thumbnail_url": "https://i.ytimg.com/...",
  "thumbnail_width": 480,
  "thumbnail_height": 360,
  "html": "..."
}
```

> **Sınırlama:** oEmbed bazen `title` döndürmez (özellikle kısıtlı/private videolarda). Bu durumda eski fallback zinciri korunur.

---

## 🔧 Kod Değişiklikleri

### Etkilenen Dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/tools/get-transcript-info.ts` | `fetchVideoTitle()` ekle, title'ı oEmbed'den al |
| `src/tools/get-transcript.ts` | Aynı düzeltme (`/download` endpoint'i için) |

### 1. `src/tools/get-transcript-info.ts` — Yeni `fetchVideoTitle()` + title mantığı

```typescript
import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptInfoRequest, TranscriptInfoResponse } from "../types.js";

/**
 * YouTube oEmbed API'den video başlığını alır.
 * Ücretsiz, API key gerektirmez. Herkese açık tüm videolarda çalışır.
 * Başarısız olursa boş string döner (hata fırlatmaz).
 */
async function fetchVideoTitle(url: string): Promise<string> {
  try {
    const oembedUrl =
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const resp = await fetch(oembedUrl);
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.title || "";
  } catch {
    return ""; // Ağ hatası, timeout vb. → sessizce fallback
  }
}

export async function getTranscriptInfo(
  input: TranscriptInfoRequest
): Promise<TranscriptInfoResponse> {
  const { url, lang } = input;

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Geçersiz YouTube URL'si");
  }

  // Video başlığını oEmbed'den al (transcript'ten ÖNCE — bağımsız)
  const oembedTitle = await fetchVideoTitle(url);

  const languages = await YoutubeTranscript.getTranscriptLanguages(videoId);
  if (languages.length === 0) {
    return {
      title: oembedTitle || "",
      videoId,
      lang: "",
      availableLangs: [],
      wordCount: 0,
      estimatedDuration: "0:00",
      hasTranscript: false,
    };
  }

  // Dil seçimi (değişiklik yok)
  const langCodes = languages.map((l: any) => l.languageCode || l.lang);
  let selectedLang: string;
  if (lang) {
    if (!langCodes.includes(lang)) {
      throw new Error(
        `Dil "${lang}" bu video için mevcut değil. Mevcut diller: ${langCodes.join(", ")}`
      );
    }
    selectedLang = lang;
  } else {
    if (langCodes.includes("tr")) selectedLang = "tr";
    else if (langCodes.includes("en")) selectedLang = "en";
    else selectedLang = langCodes[0];
  }

  // Transcript'i çek
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: selectedLang,
  });

  const fullText = transcript.map((t: any) => t.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // ─── v2.1 DÜZELTME: Süre hesaplama (esnek birim) ────────────
  const lastEntry = transcript[transcript.length - 1];
  let estimatedDuration = "0:00";

  if (lastEntry) {
    const rawOffset = lastEntry.offsetMs ?? lastEntry.offset ?? 0;
    const rawDuration = lastEntry.duration ?? 0;

    // duration birimi: > 1000 ise ms, değilse saniye
    const durationInMs = rawDuration > 1000 ? rawDuration : rawDuration * 1000;
    let totalMs = rawOffset + durationInMs;

    // offset birimi: 24 saatten uzun (86,400,000 ms) → muhtemelen μs
    if (totalMs > 86400000) {
      totalMs = Math.ceil(totalMs / 1000); // μs → ms
    }

    if (totalMs > 86400000) {
      // Hala çok büyük → rawOffset zaten saniye olabilir
      const totalSeconds = Math.ceil(rawOffset);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      estimatedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    } else {
      const totalSeconds = Math.ceil(totalMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      estimatedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }
  }

  // ─── v2.2 DÜZELTME: Title önceliği ──────────────────────────
  // 1. oEmbed'den gelen başlık (en güvenilir)
  // 2. Transcript'te videoTitle varsa (bazı kütüphane sürümlerinde olabilir)
  // 3. "Bilinmeyen Video" (son çare)
  const title =
    oembedTitle ||
    transcript[0]?.videoTitle ||
    "Bilinmeyen Video";

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

// extractVideoId (değişiklik yok)
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

### 2. `src/tools/get-transcript.ts` — Aynı `fetchVideoTitle()` mantığı

`/download` endpoint'inin `Content-Disposition` header'ı da doğru başlık kullansın diye:

```typescript
import { YoutubeTranscript } from "youtube-transcript";
import type { TranscriptRequest, TranscriptResponse } from "../types.js";

/**
 * YouTube oEmbed API'den video başlığını al.
 */
async function fetchVideoTitle(url: string): Promise<string> {
  try {
    const oembedUrl =
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const resp = await fetch(oembedUrl);
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.title || "";
  } catch {
    return "";
  }
}

export async function getTranscript(
  input: TranscriptRequest
): Promise<TranscriptResponse> {
  const { url, lang } = input;

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Geçersiz YouTube URL'si");
  }

  // Video başlığını oEmbed'den al (transcript'ten ÖNCE)
  const oembedTitle = await fetchVideoTitle(url);

  const languages = await YoutubeTranscript.getTranscriptLanguages(videoId);
  if (languages.length === 0) {
    throw new Error("Bu video için transcript mevcut değil");
  }

  // Dil seçimi (değişiklik yok)
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
    const langCodes = languages.map((l: any) => l.languageCode || l.lang);
    if (langCodes.includes("tr")) selectedLang = "tr";
    else if (langCodes.includes("en")) selectedLang = "en";
    else selectedLang = langCodes[0];
  }

  // Transcript'i çek
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: selectedLang,
  });

  const text = transcript.map((t: any) => t.text).join(" ");

  // ─── v2.2 DÜZELTME: Title önceliği ──────────────────────────
  const title =
    oembedTitle ||
    transcript[0]?.videoTitle ||
    "Bilinmeyen Video";

  return {
    title,
    transcript: text,
    lang: selectedLang!,
    videoId,
  };
}

// extractVideoId (değişiklik yok)
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

---

## 🧪 Test

### oEmbed manuel test (Coolify'den bağımsız):

```bash
# Herhangi bir video için oEmbed testi
curl -s "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=oMA69lwAJdY&format=json" | jq '.title'

# Beklenen: Video başlığı (örn: "Some Video Title")
# Değilse: null → bu video için oEmbed çalışmıyor, fallback devreye girer
```

### MCP server test (deploy sonrası):

```bash
# get-transcript-info — title kontrolü
curl -s -X POST "https://downsub.aurensoft.me/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get-transcript-info",
      "arguments": {
        "url": "https://www.youtube.com/watch?v=oMA69lwAJdY"
      }
    }
  }' | jq '.result.content[0].text | fromjson | {title, wordCount, estimatedDuration}'

# Beklenen: title alanı video ID değil, gerçek başlık olmalı
```

### DownSubAgent uçtan uca test:

```
/down-sub https://www.youtube.com/watch?v=oMA69lwAJdY
```

Beklenen dosya adı: `{temizlenmis-baslik}-en.txt` (video ID DEĞİL)

---

## 📊 v2.0 → v2.2 Değişiklik Özeti

| Versiyon | Değişiklik | Dosya |
|----------|-----------|-------|
| v2.0 | İki aşamalı mimari, `get-transcript-info`, `/download` | `index.ts`, `get-transcript-info.ts` |
| v2.1 | Duration hesaplama düzeltmesi (esnek birim) | `get-transcript-info.ts` |
| v2.2 | Video başlığı oEmbed'den alınıyor | `get-transcript-info.ts`, `get-transcript.ts` |

---

## ⚠️ oEmbed Sınırlamaları

| Durum | Sonuç |
|-------|-------|
| Herkese açık video | ✅ Title döner |
| Unlisted video | ✅ Title döner |
| Private video | ❌ Title dönmez → `"Bilinmeyen Video"` fallback |
| Yaş kısıtlamalı video | ❌ Title dönmez → `"Bilinmeyen Video"` fallback |
| Silinmiş video | ❌ 404 → `"Bilinmeyen Video"` fallback |

Fallback durumunda DownSubAgent `videoId` kullanmaya devam eder — kabul edilebilir (private videolar zaten edge case).

---

## 📋 Deployment Kontrol Listesi

- [ ] `src/tools/get-transcript-info.ts` — `fetchVideoTitle()` eklendi, title önceliği güncellendi
- [ ] `src/tools/get-transcript.ts` — Aynı değişiklikler
- [ ] `npm run build` başarılı
- [ ] oEmbed manuel test geçti
- [ ] MCP `get-transcript-info` title testi geçti  
- [ ] DownSubAgent uçtan uca test: dosya adı title kullanıyor
- [ ] Coolify'e deploy
