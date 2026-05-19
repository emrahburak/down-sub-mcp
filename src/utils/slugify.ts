/**
 * Türkçe karakterleri ASCII eşdeğerlerine dönüştürür.
 * HTTP header'larında (Content-Disposition vb.) güvenli kullanım için.
 *
 * Node.js http modülü header değerlerinde non-ASCII karakter kabul etmez.
 * /download endpoint'inde tr/en dışındaki diller en olarak çekildiğinden
 * sadece Türkçe karakter map'i yeterlidir.
 */

// Türkçe + yaygın Latin karakter → ASCII eşleştirmesi
const LATIN_TO_ASCII: Record<string, string> = {
  // Türkçe
  'ı': 'i', 'İ': 'I',
  'ğ': 'g', 'Ğ': 'G',
  'ü': 'u', 'Ü': 'U',
  'ş': 's', 'Ş': 'S',
  'ö': 'o', 'Ö': 'O',
  'ç': 'c', 'Ç': 'C',
  // İspanyolca / Fransızca / Almanca / Portekizce
  'ñ': 'n', 'Ñ': 'N',
  'á': 'a', 'Á': 'A',
  'à': 'a', 'À': 'A',
  'â': 'a', 'Â': 'A',
  'ä': 'a', 'Ä': 'A',
  'ã': 'a', 'Ã': 'A',
  'é': 'e', 'É': 'E',
  'è': 'e', 'È': 'E',
  'ê': 'e', 'Ê': 'E',
  'ë': 'e', 'Ë': 'E',
  'í': 'i', 'Í': 'I',
  'î': 'i', 'Î': 'I',
  'ï': 'i', 'Ï': 'I',
  'ó': 'o', 'Ó': 'O',
  'ô': 'o', 'Ô': 'O',
  'õ': 'o', 'Õ': 'O',
  'ú': 'u', 'Ú': 'U',
  'ù': 'u', 'Ù': 'U',
  'û': 'u', 'Û': 'U',
  'ß': 'ss',
};

/**
 * Bir string'i HTTP header-safe ASCII slug'a dönüştürür.
 *
 * Adımlar:
 * 1. Türkçe karakterleri ASCII'ye map'le
 * 2. Küçük harfe çevir
 * 3. Alfanümerik olmayan karakterleri temizle
 * 4. Boşlukları tire'ye çevir
 * 5. Ardışık tireleri tekilleştir
 * 6. Baş/son tireleri temizle
 * 7. Maksimum uzunluğa kısalt (kelime sınırında kes)
 */
export function slugify(input: string, maxLength: number = 50): string {
  if (!input) return '';

  // 1. Türkçe → ASCII
  let slug = input
    .split('')
    .map((char) => LATIN_TO_ASCII[char] ?? char)
    .join('');

  // 2. Küçük harf
  slug = slug.toLowerCase();

  // 3. Alfanümerik olmayanları temizle
  slug = slug.replace(/[^a-z0-9\s-]/g, '');

  // 4. Boşlukları tire'ye çevir
  slug = slug.replace(/\s+/g, '-');

  // 5. Ardışık tireleri tekilleştir
  slug = slug.replace(/-+/g, '-');

  // 6. Baş/son tireleri temizle
  slug = slug.replace(/^-+|-+$/g, '');

  // 7. Maksimum uzunluk (kelime sınırında kes)
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
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
  maxLength: number = 50,
): string {
  const slug = slugify(title, maxLength);
  const base = slug || videoId;
  return `${base}-${lang}.${ext}`;
}
