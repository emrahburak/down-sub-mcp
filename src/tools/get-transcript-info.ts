import { fetchTranscript } from "youtube-transcript";
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
 *
 * v2.4: Try-fetch strategy — instead of asking "does a transcript exist?"
 * (unreliable for auto-generated), just try to fetch it.
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

  // ─── v2.4 FIX: Try-fetch strategy ─────────────────────────────
  // Determine which language(s) to try
  const langsToTry: string[] = lang ? [lang] : ["tr", "en"];

  let selectedLang = "";
  let segments: Array<{ text: string; offset: number; duration: number }> = [];

  // Try each language in priority order
  for (const tryLang of langsToTry) {
    try {
      const result = await fetchTranscript(videoId, { lang: tryLang });
      if (result && result.length > 0) {
        segments = result;
        selectedLang = tryLang;
        break;
      }
    } catch {
      // Continue to next language
    }
  }

  // If no explicit lang worked and no lang was specified, try auto-detect
  if (segments.length === 0 && !lang) {
    try {
      const result = await fetchTranscript(videoId);
      if (result && result.length > 0) {
        segments = result;
        selectedLang = result[0]?.lang ?? "auto";
      }
    } catch {
      // Still nothing
    }
  }

  // No transcript found
  if (segments.length === 0) {
    return {
      title: oembedTitle || "Bilinmeyen Video",
      videoId,
      lang: "",
      availableLangs: [],
      wordCount: 0,
      estimatedDuration: "0:00",
      hasTranscript: false,
    };
  }

  // ─── Transcript found — compute metadata ──────────────────────
  const fullText = segments.map((s) => s.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  // Duration calculation (v2.1 fix — flexible unit detection)
  const lastEntry = segments[segments.length - 1];
  let estimatedDuration = "0:00";

  if (lastEntry) {
    const rawOffset = lastEntry.offset;
    const rawDuration = lastEntry.duration;

    const durationInMs = rawDuration > 1000
      ? rawDuration
      : rawDuration * 1000;

    let totalMs = rawOffset + durationInMs;

    // 24 saatten uzun süre imkansız → offset birimi farklı olabilir
    if (totalMs > 86400000) {
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
    availableLangs: [selectedLang],
    wordCount,
    estimatedDuration,
    hasTranscript: true,
  };
}
