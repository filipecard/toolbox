// MyMemory: a free, no-signup, CORS-enabled machine-translation API (not a
// generative LLM — no per-call cost, no API key/provider decision needed,
// same "free public API, called straight from the frontend" pattern as the
// currency converter). Its own free tier caps each request at 500 chars
// and has a shared daily word quota across all anonymous callers, which is
// outside ToolBox's control.
const API_URL = "https://api.mymemory.translated.net/get";
const MAX_CHUNK_CHARS = 480;

interface MyMemoryResponse {
  responseData?: { translatedText?: string; detectedLanguage?: string };
  responseStatus?: number | string;
  responseDetails?: string;
  quotaFinished?: boolean;
}

/** Splits long text into <=maxLen chunks along sentence (then word)
 * boundaries, so a translation longer than MyMemory's 500-char-per-request
 * limit still works — each chunk is translated separately and rejoined. */
function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = "";

  const pushWord = (word: string) => {
    // A single "word" (no spaces — a long URL, a hash, ...) longer than the
    // limit by itself has nothing to split on except raw character count.
    if (word.length > maxLen) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxLen) {
        chunks.push(word.slice(i, i + maxLen));
      }
      return;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  };

  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length > maxLen) {
      sentence.split(" ").forEach(pushWord);
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function translateChunk(
  text: string,
  source: string,
  target: string,
): Promise<{ text: string; detected?: string }> {
  const langpair = `${source}|${target}`;
  const url = `${API_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha na tradução (HTTP ${res.status}).`);
  const data = (await res.json()) as MyMemoryResponse;

  if (data.quotaFinished) {
    throw new Error(
      "Cota gratuita do serviço de tradução esgotada por hoje. Tente novamente mais tarde.",
    );
  }
  if (data.responseStatus != null && Number(data.responseStatus) >= 400) {
    throw new Error(data.responseDetails || "Falha na tradução.");
  }

  return {
    text: data.responseData?.translatedText ?? "",
    detected: data.responseData?.detectedLanguage,
  };
}

export interface TranslateResult {
  translatedText: string;
  detectedLanguage?: string;
}

export async function translateText(
  text: string,
  source: string,
  target: string,
): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { translatedText: "" };

  const chunks = splitIntoChunks(trimmed, MAX_CHUNK_CHARS);
  const parts: string[] = [];
  let detectedLanguage: string | undefined;
  for (const chunk of chunks) {
    const result = await translateChunk(chunk, source, target);
    parts.push(result.text);
    if (result.detected) detectedLanguage = result.detected;
  }
  return { translatedText: parts.join(" "), detectedLanguage };
}
