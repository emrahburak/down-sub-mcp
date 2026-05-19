---
tags:
  - '#downsub-mcp'
  - '#mcp-server'
  - '#spec'
  - '#v2.3'
  - '#bugfix'
title: down-sub-mcp v2.3 — Content-Disposition Türkçe Karakter Düzeltmesi
references: 'https://www.npmjs.com/package/youtube-transcript, https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition'
tarih: 26.05.19
---

# down-sub-mcp v2.3 — Content-Disposition Türkçe Karakter Düzeltmesi

## 🐛 Bug: `/download` endpoint 500 hatası (Türkçe karakterler)

Türkçe karakter içeren video başlıklarında (`ı`, `ğ`, `ü`, `ş`, `ö`, `ç`) `/download` endpoint'i **500 Internal Server Error** döndürüyor.

**Hata:**
```
curl: (22) The requested URL returned error: 500
Server response: {"error":"Invalid character in header content [\"Content-Disposition\"]"}
```

**Örnek tetikleyici:**
```
Video: "Ne Anlatıyorsunuz Oğlum Siz" diyenler için modern futbola giriş rehberi
safeTitle: "ne-anlatıyorsunuz-oglum-siz-diyenler-icin-modern-tr.txt"
→ Content-Disposition header'da Türkçe karakterler → 500
```

---

## 🔍 Kök Neden Analizi

### v2.0'daki bug'lı kod (`index.ts` — `/download` endpoint):

```typescript
// Başlık temizle (header için)
const safeTitle = result.title
  .toLowerCase()
  .replace(/[^a-z0-9ğüşıöçĞÜŞİÖÇ\s-]/g, "")  // ← Türkçe karakterleri KORUYOR
  .replace(/\s+/g, "-")
  .substring(0, 50);

res.writeHead(200, {
  "Content-Type": "text/plain; charset=utf-8",
  "Content-Disposition": `attachment; filename="${safeTitle}-${result.lang}.txt"`,
});
```

### İki sorun var:

#### 1. Regex Türkçe karakterleri koruyor ama HTTP header ASCII-only bekliyor

Node.js `ServerResponse.writeHead()` HTTP header değerlerinde **ASCII olmayan karakterleri** kabul etmez. `Content-Disposition` header'ı RFC 6266'ya göre tanımlanır ve geleneksel formatta ASCII karakter seti kullanılır.

```
"ne-anlatıyorsunuz-oglum-siz-diyenler-icin-modern-tr.txt"
              ↑ ı  → ASCII değil  → Invalid character in header content
```

#### 2. `Content-Disposition` için RFC 5987 encoding kullanılmıyor

RFC 5987, UTF-8 karakterlerin HTTP header'larda güvenli şekilde iletilmesini tanımlar:

```
Content-Disposition: attachment; filename*=UTF-8''ne-anlat%C4%B1yorsunuz...
```

Ama Node.js'in native `http` modülü header değerlerinde **herhangi bir** non-ASCII karakteri reddeder — `filename*` formatı bile olsa. Bu nedenle çözüm: **Türkçe karakterleri ASCII eşdeğerlerine dönüştürmek**.

---

## ✅ Çözüm: ASCII Slugification + RFC 5987 Fallback

### Strateji

1. **Birincil:** Türkçe karakterleri ASCII eşdeğerlerine map'le (`ı→i`, `ğ→g`, `ü→u`, `ş→s`, `ö→o`, `ç→c`)
2. **İkincil:** Tüm non-ASCII karakterleri kaldır (fallback)
3. **Üçüncil:** Başlık boşsa veya tamamen ASCII dışıysa `videoId` kullan

### Değişen Dosyalar

| Dosya | Değişiklik |
|-------|-----------|
| `src/index.ts` | `/download` endpoint'inde `safeTitle` fonksiyonu güncellendi |
| `src/utils/slugify.ts` | **YENİ** — Reusable slugify utility |

---

## 🔧 Kod Değişiklikleri

### 1. `src/utils/slugify.ts` — Yeni Utility

```typescript
/**
 * Türkçe karakterleri ASCII eşdeğerlerine dönüştürür.
 * HTTP header'larında (Content-Disposition vb.) güvenli kullanım için.
 *
 * Node.js http modülü header değerlerinde non-ASCII karakter kabul etmez.
 * Bu fonksiyon tüm Türkçe karakterleri ASCII'ye map'ler.
 */

// Türkçe → ASCII karakter eşleştirmesi
const TURKISH_TO_ASCII: Record<string, string> = {
  'ı': 'i', 'İ': 'I',
  'ğ': 'g', 'Ğ': 'G',
  'ü': 'u', 'Ü': 'U',
  'ş': 's', 'Ş': 'S',
  'ö': 'o', 'Ö': 'O',
  'ç': 'c', 'Ç': 'C',
};

/**
 * Bir string'i HTTP header-safe ASCII slug'a dönüştürür.
 *
 * Adımlar:
 * 1. Türkçe karakterleri ASCII'ye map'le
 * 2. Küçük harfe çevir
 * 3. Alfanümerik olmayan karakterleri tire'ye çevir
 * 4. Ardışık tireleri tekilleştir
 * 5. Baş/son tireleri temizle
 * 6. Maksimum uzunluğa kısalt
 */
export function slugify(input: string, maxLength: number = 50): string {
  if (!input) return '';

  // 1. Türkçe → ASCII
  let slug = input
    .split('')
    .map(char => TURKISH_TO_ASCII[char] ?? char)
    .join('');

  // 2. Küçük harf
  slug = slug.toLowerCase();

  // 3. Alfanümerik olmayanları tire'ye çevir (sadece a-z0-9 ve tire kalacak)
  slug = slug.replace(/[^a-z0-9\s-]/g, '');

  // 4. Boşlukları tire'ye çevir
  slug = slug.replace(/\s+/g, '-');

  // 5. Ardışık tireleri tekilleştir
  slug = slug.replace(/-+/g, '-');

  // 6. Baş/son tireleri temizle
  slug = slug.replace(/^-+|-+$/g, '');

  // 7. Maksimum uzunluk
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    // Son tirede kesme (yarım kelime kalmasın)
    slug = slug.replace(/-[^-]*$/, '');
  }

  return slug;
}

/**
 * Dosya adı oluşturur: {slug}-{lang}.{ext}
 * Boş slug durumunda videoId fallback kullanır.
 */
export function buildFilename(
  title: string,
  lang: string,
  videoId: string,
  ext: string = 'txt',
  maxLength: number = 50
): string {
  const slug = slugify(title, maxLength);
  const base = slug || videoId; // Fallback: videoId
  return `${base}-${lang}.${ext}`;
}
```

### 2. `src/index.ts` — `/download` Endpoint Güncelleme

Mevcut `/download` endpoint'indeki `safeTitle` bloğu değiştiriliyor:

```typescript
// ─── v2.3 DÜZELTME: ASCII-safe slugification ────────────────────
import { buildFilename } from "./utils/slugify.js";

// ... (mevcut kod, videoUrl ve lang extraction)

// Transcript'i çek
const result = await getTranscript({
  url: videoUrl,
  lang: lang as "tr" | "en" | undefined,
});

// v2.3: ASCII-safe dosya adı (Türkçe karakterler map'lenir)
const filename = buildFilename(
  result.title,
  result.lang,
  result.videoId,
  "txt",
  50
);

// Plain text formatında döndür
if (format === "plain") {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(result.transcript);
  return;
}
```

### 3. `src/tools/get-transcript-info.ts` — Title Dönüşü (opsiyonel)

`get-transcript-info` tool'u title'ı olduğu gibi döndürmeye devam eder (oEmbed'den gelen orijinal başlık). Slugification sadece `/download` endpoint'inde uygulanır. Bu, agent'ın gerçek başlığı görmesini sağlar.

---

## 🧪 Test

### Slugify unit test:

```typescript
import { slugify, buildFilename } from "./utils/slugify.js";

// Türkçe karakter testleri
console.log(slugify("Ne Anlatıyorsunuz Oğlum Siz"));
// → "ne-anlatiyorsunuz-oglum-siz"

console.log(slugify("Türkçe karakterler: ğüşiöçĞÜŞİÖÇ"));
// → "turkce-karakterler-gusio cgusio c"

console.log(slugify(""));
// → ""

console.log(buildFilename("Ne Anlatıyorsunuz Oğlum Siz", "tr", "bwsUNBYQsps"));
// → "ne-anlatiyorsunuz-oglum-siz-tr.txt"

console.log(buildFilename("", "tr", "bwsUNBYQsps"));
// → "bwsUNBYQsps-tr.txt" (fallback: videoId)
```

### `/download` endpoint test (deploy sonrası):

```bash
# Türkçe başlıklı video — artık 500 vermemeli
curl -s -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  "https://downsub.aurensoft.me/download?url=https://www.youtube.com/watch?v=bwsUNBYQsps&lang=tr" \
  -o "test-transcript.txt"

# Beklenen: 200 OK, dosya kaydedildi
# Dosya adı: ne-anlatiyorsunuz-oglum-siz-tr.txt

# Başka bir Türkçe video
curl -s -H "Authorization: Bearer $DOWNSUB_API_KEY" \
  "https://downsub.aurensoft.me/download?url=https://www.youtube.com/watch?v=oMA69lwAJdY&lang=en" \
  -o "test-transcript-2.txt"

head -5 test-transcript.txt
rm test-transcript.txt test-transcript-2.txt
```

### Test matrisi:

| Video Başlığı | Beklenen Dosya Adı |
|---------------|-------------------|
| "Ne Anlatıyorsunuz Oğlum Siz" | `ne-anlatiyorsunuz-oglum-siz-tr.txt` |
| "Türkçe Öğreniyorum" | `turkce-ogreniyorum-tr.txt` |
| "Çözülemeyen Şifre" | `cozulemeyen-sifre-tr.txt` |
| "İstanbul'da Bir Gün" | `istanbulda-bir-gun-tr.txt` |
| "" (boş başlık) | `{videoId}-tr.txt` |
| "English Title" | `english-title-en.txt` |

---

## 📊 v2.0 → v2.3 Değişiklik Özeti

| Versiyon | Değişiklik | Dosya |
|----------|-----------|-------|
| v2.0 | İki aşamalı mimari, `get-transcript-info`, `/download` | `index.ts`, `get-transcript-info.ts` |
| v2.1 | Duration hesaplama düzeltmesi (esnek birim) | `get-transcript-info.ts` |
| v2.2 | Video başlığı oEmbed'den alınıyor | `get-transcript-info.ts`, `get-transcript.ts` |
| **v2.3** | **Content-Disposition Türkçe karakter → ASCII map** | `index.ts`, `src/utils/slugify.ts` (YENİ) |

---

## 📋 Deployment Kontrol Listesi

- [ ] `src/utils/slugify.ts` oluşturuldu
- [ ] `src/index.ts` — `/download` endpoint'inde `buildFilename` kullanılıyor
- [ ] `npm run build` başarılı
- [ ] Slugify unit testleri geçti
- [ ] Türkçe başlıklı video ile `/download` endpoint testi (200 OK)
- [ ] İngilizce başlıklı video ile `/download` endpoint testi (geriye uyumlu)
- [ ] Boş başlık fallback testi (videoId kullanımı)
- [ ] Coolify'e deploy edildi
- [ ] DownSubAgent uçtan uca test: dosya adı ASCII-safe

---

## ⚠️ Bilinen Sınırlamalar

1. **Türkçe dışı diller:** Şu an sadece Türkçe karakterler map'leniyor. Arapça, Çince, Rusça vb. karakterler için `slugify` fonksiyonu bunları silecektir (fallback: videoId). Gelecekte `unidecode` benzeri bir kütüphane eklenebilir.

2. **`filename*` RFC 5987 kullanılmıyor:** Node.js native `http` modülü non-ASCII header değerlerini reddettiği için `filename*` formatı da çalışmaz. ASCII map'leme en güvenilir çözüm.

3. **`extractVideoId` tekrarı:** v2.0'dan beri 3+ dosyada aynı fonksiyon var. `src/utils/slugify.ts` ile birlikte `src/utils/extract-video-id.ts` de oluşturulup DRY ihlali giderilebilir (v2.4 adayı).
