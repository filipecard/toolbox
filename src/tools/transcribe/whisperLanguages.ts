export interface WhisperLanguage {
  code: string;
  name: string;
}

/** Plain ISO 639-1-ish codes, matching what whisper.cpp's `-l` flag
 * expects — a different (simpler, no region suffix) code set than the
 * translator's languages.ts, which uses MyMemory's codes. */
export const WHISPER_LANGUAGES: WhisperLanguage[] = [
  { code: "auto", name: "Detectar automaticamente" },
  { code: "pt", name: "Português" },
  { code: "en", name: "Inglês" },
  { code: "es", name: "Espanhol" },
  { code: "fr", name: "Francês" },
  { code: "de", name: "Alemão" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "Japonês" },
  { code: "ko", name: "Coreano" },
  { code: "zh", name: "Chinês" },
  { code: "ru", name: "Russo" },
  { code: "ar", name: "Árabe" },
  { code: "nl", name: "Holandês" },
  { code: "pl", name: "Polonês" },
  { code: "tr", name: "Turco" },
  { code: "hi", name: "Hindi" },
];
