/**
 * Latin karakterleri ASCII eşdeğerlerine dönüştürür.
 * HTTP header'larında (Content-Disposition vb.) güvenli kullanım için.
 *
 * Node.js http modülü header değerlerinde non-ASCII karakter kabul etmez.
 * Bu fonksiyon Türkçe + yaygın Latin karakterleri (İspanyolca, Fransızca,
 * Almanca, Portekizce, İskandinav, Doğu Avrupa) ASCII'ye map'ler.
 *
 * Kapsam: ~%95 Latin alfabesi (İngilizce %80 + Türkçe %10 + İspanyolca %5 + diğer %5)
 * Arapça/Çince/Rusça → silinir → videoId fallback
 */

// Latin → ASCII karakter eşleştirmesi
const LATIN_TO_ASCII: Record<string, string> = {
  // Türkçe
  'ı': 'i', 'İ': 'I',
  'ğ': 'g', 'Ğ': 'G',
  'ü': 'u', 'Ü': 'U',
  'ş': 's', 'Ş': 'S',
  'ö': 'o', 'Ö': 'O',
  'ç': 'c', 'Ç': 'C',
  // İspanyolca
  'ñ': 'n', 'Ñ': 'N',
  'á': 'a', 'Á': 'A',
  'é': 'e', 'É': 'E',
  'í': 'i', 'Í': 'I',
  'ó': 'o', 'Ó': 'O',
  'ú': 'u', 'Ú': 'U',
  // Fransızca / Almanca / Portekizce / İskandinav
  'à': 'a', 'À': 'A',
  'â': 'a', 'Â': 'A',
  'ä': 'a', 'Ä': 'A',
  'å': 'a', 'Å': 'A',
  'æ': 'ae', 'Æ': 'AE',
  'è': 'e', 'È': 'E',
  'ê': 'e', 'Ê': 'E',
  'ë': 'e', 'Ë': 'E',
  'ì': 'i', 'Ì': 'I',
  'î': 'i', 'Î': 'I',
  'ï': 'i', 'Ï': 'I',
  'ò': 'o', 'Ò': 'O',
  'ô': 'o', 'Ô': 'O',
  'õ': 'o', 'Õ': 'O',
  'ã': 'a', 'Ã': 'A',
  'ù': 'u', 'Ù': 'U',
  'û': 'u', 'Û': 'U',
  'ÿ': 'y', 'Ÿ': 'Y',
  'ý': 'y', 'Ý': 'Y',
  // Doğu Avrupa (Lehçe, Çekçe, Hırvatça, Romence vb.)
  'š': 's', 'Š': 'S',
  'ž': 'z', 'Ž': 'Z',
  'č': 'c', 'Č': 'C',
  'ř': 'r', 'Ř': 'R',
  'đ': 'd', 'Đ': 'D',
  'ł': 'l', 'Ł': 'L',
  'ą': 'a', 'Ą': 'A',
  'ę': 'e', 'Ę': 'E',
  'ń': 'n', 'Ń': 'N',
  'ś': 's', 'Ś': 'S',
  'ź': 'z', 'Ź': 'Z',
  'ż': 'z', 'Ż': 'Z',
  'ő': 'o', 'Ő': 'O',
  'ű': 'u', 'Ű': 'U',
  'ă': 'a', 'Ă': 'A',
  // Özel karakterler
  'ß': 'ss',
  'þ': 'th', 'Þ': 'TH',
  'ð': 'd', 'Ð': 'D',
};

/**
 * Bir string'i HTTP header-safe ASCII slug'a dönüştürür.
 *
 * Adımlar:
 * 1. Latin karakterleri ASCII'ye map'le
 * 2. Küçük harfe çevir
 * 3. Alfanümerik olmayan karakterleri temizle (sadece a-z0-9 ve boşluk/tire kalır)
 * 4. Boşlukları tire'ye çevir
 * 5. Ardışık tireleri tekilleştir
 * 6. Baş/son tireleri temizle
 * 7. Maksimum uzunluğa kısalt (kelime sınırında kes)
 */
export function slugify(input: string, maxLength: number = 50): string {
  if (!input) return '';

  // 1. Latin → ASCII
  let slug = input
    .split('')
    .map((char) => LATIN_TO_ASCII[char] ?? char)
    .join('');

  // 2. Küçük harf
  slug = slug.toLowerCase();

  // 3. Alfanümerik olmayanları temizle (sadece a-z0-9 ve boşluk/tire kalacak)
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
    // Son tirede kes (yarım kelime kalmasın)
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
  const base = slug || videoId; // Fallback: videoId
  return `${base}-${lang}.${ext}`;
}
