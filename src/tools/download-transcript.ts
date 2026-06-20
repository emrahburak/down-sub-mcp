import * as fs from "fs";
import * as path from "path";
import { extractVideoId, fetchVideoTitle, fetchWithFallback } from "./get-transcript.js";
import { buildFilename } from "../utils/slugify.js";
import type { DownloadTranscriptRequest, DownloadTranscriptResponse } from "../types.js";

/**
 * Downloads YouTube transcript and writes it directly to a file.
 * Returns only metadata (filename, path, wordCount, lang) — transcript content
 * never enters the MCP response, keeping token cost constant (~200 tokens).
 */
export async function downloadTranscript(
  input: DownloadTranscriptRequest,
): Promise<DownloadTranscriptResponse> {
  const { url, lang, output_dir } = input;
  const defaultDir = output_dir || "references";

  // Extract video ID from URL
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error("Gecersiz YouTube URL'si");
  }

  // Fetch video title from oEmbed (for filename generation)
  const title = await fetchVideoTitle(url);

  // Fetch transcript with language fallback
  const { segments, lang: detectedLang } = await fetchWithFallback(videoId, lang);

  if (segments.length === 0) {
    throw new Error("Bu video icin transcript mevcut degil");
  }

  // Join all text segments
  const text = segments.map((s) => s.text).join(" ");
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  // Build filename using existing utility
  const videoTitle = title || "Bilinmeyen Video";
  const filename = buildFilename(videoTitle, detectedLang, videoId, "txt", 50);
  const filepath = path.join(defaultDir, filename);

  // Create directory if it doesn't exist
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write transcript to file
  fs.writeFileSync(filepath, text, "utf-8");

  return {
    filename,
    path: filepath,
    wordCount,
    lang: detectedLang,
    status: "success",
  };
}
