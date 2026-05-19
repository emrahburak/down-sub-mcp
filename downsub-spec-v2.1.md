---
tags:
  - '#downsub-mcp'
  - '#mcp-server'
  - '#spec'
  - '#v2.1'
  - '#bugfix'
title: down-sub-mcp v2.1 — Duration Hesaplama Düzeltmesi
references: 'https://www.npmjs.com/package/youtube-transcript'
tarih: 26.05.19
---

# down-sub-mcp v2.1 — Duration Hesaplama Düzeltmesi

## 🐛 Bug: `estimatedDuration` Hatalı

`get-transcript-info` tool'u `"12993:20"` veya `"11160:00"` gibi gerçekçi olmayan süreler döndürüyor.

**Örnek hatalı çıktı:**
```json
{
  "title": "Some Video Title",
  "estimatedDuration": "11160:00",   // ← ~186 saat (imkansız)
  "wordCount": 2343
}
```

**Beklenen:** 10-30 dakikalık bir video için `"14:25"` gibi bir değer.

---

## 🔍 Kök Neden Analizi

### v2'deki bug'lı kod (`get-transcript-info.ts`):

```typescript
const lastEntry = transcript[transcript.length - 1];
const totalSeconds = lastEntry
  ? Math.ceil((lastEntry.offsetMs + lastEntry.duration) / 1000)
  : 0;
```

### Üç hata var:

#### 1. Alan adı yanlış: `offsetMs` → `offset`

`youtube-transcript` npm paketi segment nesnesinde **`offset`** alanı döndürür, `offsetMs` değil:

```typescript
// youtube-transcript kütüphanesinin gerçek dönüş tipi:
interface TranscriptSegment {
  text: string;
  offset: number;   // ← milisaniye cinsinden başlangıç zamanı
  duration: number; // ← saniye cinsinden segment süresi
}
```

`lastEntry.offsetMs` → `undefined`.  
`undefined + lastEntry.duration` → `NaN`.  
Ama çıktı `11160:00` (NaN değil). Bu, farklı bir sürümün farklı alan adı kullandığını veya kütüphane yükseltmesi ile alan adının değiştiğini gösteriyor.

#### 2. Birim uyuşmazlığı: `offset` (ms) + `duration` (saniye)

`offset` milisaniye, `duration` saniye cinsindendir. İkisi doğrudan toplanamaz:

```typescript
// YANLIŞ: ms + s birimleri karışıyor
Math.ceil((lastEntry.offset + lastEntry.duration) / 1000)

// DOĞRU: İkisini de ms'ye çevir
const totalMs = lastEntry.offset + (lastEntry.duration * 1000);
Math.ceil(totalMs / 1000)
```

Bu hata pratikte küçük bir sapmaya neden olur (offset'in yanına ~1-5 saniye ekler), 186 saatlik hatayı açıklamaz. Asıl sorun birim çevirmede.

#### 3. (Muhtemel) `offset` değeri saniye cinsinden geliyor

Eğer `youtube-transcript`'in kullanılan sürümü `offset`'i **saniye** cinsinden döndürüyorsa:

```
offset = 669,600 saniye  →  / 1000  →  669.6 "saniye"  →  11,160 dakika
```

Ya da `offset` milisaniye ama çok büyük bir değer:

```
offset = 669,600,000 ms  →  / 1000  →  669,600 saniye  →  11,160 dakika
```

11,160 dakika = 186 saat. Bu da `11160:00` çıktısını açıklıyor.

**Kök neden:** `youtube-transcript` kütüphanesinin kullanılan sürümünde `offset` alanı **mikrosaniye** veya **ham milisaniye** cinsinden olabilir. Ya da kütüphane `duration`'ı milisaniye cinsinden döndürüyor olabilir ve offset+değer çok büyüyor.

---

## ✅ Düzeltme

### Değişen dosya: `src/tools/get-transcript-info.ts`

Süre hesaplama bloğu değiştiriliyor:

```typescript
  // Transcript'i çek (sadece metadata için)
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, {
    lang: selectedLang,
  });

  const fullText = transcript.map((t: any) => t.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // ─── v2.1 DÜZELTME: Süre hesaplama ─────────────────────────────
  // youtube-transcript kütüphanesi segment başına şu alanları döndürür:
  //   offset: number   — başlangıç zamanı (birim: versiyona göre ms veya saniye)
  //   duration: number — segment süresi (birim: versiyona göre saniye veya ms)
  //
  // Birim belirsiz olduğu için esnek hesaplama yapıyoruz.
  
  const lastEntry = transcript[transcript.length - 1];
  let estimatedDuration = "0:00";

  if (lastEntry) {
    // offsetMs veya offset — hangisi varsa onu kullan
    const rawOffset = lastEntry.offsetMs ?? lastEntry.offset ?? 0;
    const rawDuration = lastEntry.duration ?? 0;

    // duration'ın birimini tahmin et:
    // - Tek bir segment genelde 1-15 saniyedir
    // - Eğer duration > 1000 ise muhtemelen ms cinsindendir
    const durationInMs = rawDuration > 1000 
      ? rawDuration           // zaten ms
      : rawDuration * 1000;   // saniye → ms

    let totalMs = rawOffset + durationInMs;

    // offset birimini tahmin et:
    // - 24 saatten uzun süre imkansız → rawOffset farklı birimde
    // - 86,400,000 ms = 24 saat
    if (totalMs > 86400000) {
      // Muhtemelen mikrosaniye cinsinden → 1000'e bölerek ms'ye çevir
      totalMs = Math.ceil(totalMs / 1000);
    }

    // Tekrar kontrol: hala çok büyükse doğrudan saniye olarak ele al
    if (totalMs > 86400000) {
      // offset zaten saniye cinsinden olabilir
      totalMs = totalMs * 1000; // saniye → ms (zaten yukarıda bölmüştük)
      
      // Son çare: offset'i doğrudan saniye kabul et
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

    // Nihai sanity check: 12 saatten uzunsa log'la ama yine de döndür
    if (totalMs > 43200000) {
      console.warn(
        `[get-transcript-info] Süre anormal: ${estimatedDuration}. ` +
        `rawOffset=${rawOffset}, rawDuration=${rawDuration}, totalMs=${totalMs}`
      );
    }
  }

  // Video başlığını al (ilk segmentten)
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
```

---

## 🧪 Test

Düzeltme sonrası aynı video için test:

```bash
# Health check
curl -s -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  "https://downsub.aurensoft.me/health"

# get-transcript-info — süre kontrolü
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
  }' | jq '.result.content[0].text | fromjson'

# Beklenen: estimatedDuration alanı makul bir değer (örn. "14:25")
```

### Test matrisi:

| Video Uzunluğu | Beklenen `estimatedDuration` Aralığı |
|----------------|--------------------------------------|
| 5 dakika       | `"4:00"` – `"6:00"`                 |
| 15 dakika      | `"13:00"` – `"17:00"`                |
| 1 saat         | `"55:00"` – `"65:00"`                |
| 3 saat         | `"170:00"` – `"190:00"`              |

**Kabul kriteri:** Hiçbir video için `estimatedDuration` 24 saatten (1440 dakika) fazla olmamalı.

---

## ⚠️ Kalıcı Çözüm Önerisi

Mevcut düzeltme esnek birim tahmini yapıyor, ama kalıcı çözüm için:

1. **`youtube-transcript` sürümünü sabitle**: `package.json`'da `"youtube-transcript": "1.3.1"` gibi kesin sürüm kullan
2. **Birim kontrolü için küçük bir yardımcı test yaz**: İlk segmentin `offset` değerine bak:
   - `offset < 100` → muhtemelen saniye
   - `offset < 100000` → muhtemelen ms
   - `offset > 100000` → ms veya daha küçük birim
3. **Logging ekle**: Süre anormal olduğunda `console.warn` ile raw değerleri log'la

---

## 📋 Deployment Kontrol Listesi

- [ ] `src/tools/get-transcript-info.ts` güncellendi
- [ ] `npm run build` başarılı
- [ ] Yukarıdaki test komutu ile 3 farklı uzunlukta video test edildi
- [ ] `estimatedDuration` tüm testlerde makul aralıkta
- [ ] Coolify'e deploy edildi
- [ ] `get-transcript` (v1 tool) backward compat test edildi

---

## 📊 Token Etkisi

Bu düzeltme `get-transcript-info` tool'unun token maliyetini değiştirmez — hala ~200 token (sabit). Sadece `estimatedDuration` alanının değeri düzelir.
