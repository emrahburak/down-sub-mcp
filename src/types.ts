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
