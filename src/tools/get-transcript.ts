import { fetchTranscript, YoutubeTranscriptNotAvailableLanguageError } from "youtube-transcript";
import type { TranscriptRequest, TranscriptResponse } from "../types.js";

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
 * Fetches transcript with language fallback strategy:
 * specified lang → tr → en → default (first available)
 */
async function fetchWithFallback(
  videoId: string,
  lang?: string,
): Promise<{ segments: Array<{ text: string }>; lang: string }> {
  // Explicit language requested
  if (lang) {
    const segments = await fetchTranscript(videoId, { lang });
    return { segments, lang };
  }

  // Auto-select: try tr first
  try {
    const segments = await fetchTranscript(videoId, { lang: "tr" });
    return { segments, lang: "tr" };
  } catch (error) {
    if (!(error instanceof YoutubeTranscriptNotAvailableLanguageError)) {
      throw error;
    }
  }

  // Try en
  try {
    const segments = await fetchTranscript(videoId, { lang: "en" });
    return { segments, lang: "en" };
  } catch (error) {
    if (!(error instanceof YoutubeTranscriptNotAvailableLanguageError)) {
      throw error;
    }
  }

  // Fall back to default (first available language)
  const segments = await fetchTranscript(videoId);
  const defaultLang = segments[0]?.lang ?? "unknown";
  return { segments, lang: defaultLang };
}

export async function getTranscript(
  input: TranscriptRequest,
): Promise<TranscriptResponse> {
  const { url, lang } = input;

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Gecersiz YouTube URL'si");
  }

  const { segments, lang: detectedLang } = await fetchWithFallback(videoId, lang);

  if (segments.length === 0) {
    throw new Error("Bu video icin transcript mevcut degil");
  }

  // Join all text segments (without timestamps)
  const text = segments.map((s) => s.text).join(" ");

  return {
    title: "YouTube Video",
    transcript: text,
    lang: detectedLang,
    videoId,
  };
}
