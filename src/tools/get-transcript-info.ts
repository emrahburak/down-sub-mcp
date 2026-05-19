import { fetchTranscript, YoutubeTranscriptNotAvailableLanguageError } from "youtube-transcript";
import type { TranscriptInfoRequest, TranscriptInfoResponse } from "../types.js";

/**
 * Extracts YouTube video ID from URL or returns as-is if already an ID.
 */
function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetches video title from YouTube oEmbed API.
 * Free, no API key required. Returns empty string on failure.
 */
async function fetchVideoTitle(url: string): Promise<string> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const resp = await fetch(oembedUrl);
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.title || "";
  } catch {
    return "";
  }
}

/**
 * Returns transcript metadata without including the full text content.
 * Useful for checking word count, duration, and available languages
 * before deciding to download the full transcript.
 */
export async function getTranscriptInfo(
  input: TranscriptInfoRequest,
): Promise<TranscriptInfoResponse> {
  const { url, lang } = input;

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Gecersiz YouTube URL'si");
  }

  // Fetch video title from oEmbed (independent of transcript fetch)
  const oembedTitle = await fetchVideoTitle(url);

  // Discover available languages by attempting a fetch with an invalid lang
  // The error message contains the actual available languages
  let availableLangs: string[] = [];
  try {
    await fetchTranscript(videoId, { lang: "__invalid__" });
  } catch (error) {
    if (error instanceof YoutubeTranscriptNotAvailableLanguageError) {
      // Error message format: "No transcripts are available in __invalid__ this video (xxx). Available languages: en, tr, de"
      const match = error.message.match(/Available languages:\s*(.+)/);
      if (match) {
        availableLangs = match[1].split(",").map((s: string) => s.trim());
      }
    }
  }

  if (availableLangs.length === 0) {
    return {
      title: "Bilinmeyen Video",
      videoId,
      lang: "",
      availableLangs: [],
      wordCount: 0,
      estimatedDuration: "0:00",
      hasTranscript: false,
    };
  }

  // Language selection: explicit → tr → en → first available
  let selectedLang: string;
  if (lang) {
    if (!availableLangs.includes(lang)) {
      throw new Error(
        `Dil "${lang}" bu video icin mevcut degil. Mevcut diller: ${availableLangs.join(", ")}`,
      );
    }
    selectedLang = lang;
  } else {
    if (availableLangs.includes("tr")) selectedLang = "tr";
    else if (availableLangs.includes("en")) selectedLang = "en";
    else selectedLang = availableLangs[0];
  }

  // Fetch transcript to calculate metadata
  const segments = await fetchTranscript(videoId, { lang: selectedLang });

  if (segments.length === 0) {
    return {
      title: "Bilinmeyen Video",
      videoId,
      lang: selectedLang,
      availableLangs,
      wordCount: 0,
      estimatedDuration: "0:00",
      hasTranscript: false,
    };
  }

  // Calculate word count
  const fullText = segments.map((s) => s.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // ─── v2.1 Düzeltme: Esnek birim tespiti ile süre hesaplama ──────
  // youtube-transcript kütüphanesi offset ve duration birimlerini
  // açıkça belirtmiyor. İlk segment offset'ine bakarak birim tahmini
  // yapıyoruz: < 100 → saniye, < 100,000 → ms, > 100,000 → muhtemelen ms
  // ama çok büyükse düzeltme uygulanır.
  const lastEntry = segments[segments.length - 1];
  let estimatedDuration = "0:00";

  if (lastEntry) {
    const rawOffset = lastEntry.offset;
    const rawDuration = lastEntry.duration;

    // duration birimini tahmin et: tek segment genelde 1-15 saniye
    const durationInMs = rawDuration > 1000
      ? rawDuration
      : rawDuration * 1000;

    let totalMs = rawOffset + durationInMs;

    // 24 saatten uzun süre imkansız → offset birimi farklı olabilir
    if (totalMs > 86400000) {
      // offset muhtemelen saniye cinsinden → ms'ye çevir
      totalMs = rawOffset * 1000 + durationInMs;
    }

    // Hala çok büyükse offset zaten ms ama video süresi abartılı
    if (totalMs > 86400000) {
      console.warn(
        `[get-transcript-info] Anormal süre: rawOffset=${rawOffset}, rawDuration=${rawDuration}, totalMs=${totalMs}`,
      );
    }

    const totalSeconds = Math.ceil(totalMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    estimatedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  return {
    title: oembedTitle || "Bilinmeyen Video",
    videoId,
    lang: selectedLang,
    availableLangs,
    wordCount,
    estimatedDuration,
    hasTranscript: true,
  };
}
