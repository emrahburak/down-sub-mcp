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

// ─── v2: Metadata-only tool ───────────────────────────────────────

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
  format?: "plain" | "srt" | "vtt";
}
