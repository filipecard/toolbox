/** Every ToolBox tool, as the website and the API know it. The desktop
 * app has its own catalog (icons, colors, window loaders) in
 * src/shell/toolCatalog.ts — ids must match. */
export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  /** Sold in plans (Básico/Prata/Gold). False = always free, no plans. */
  paid: boolean;
  /** Extra downloads the tool needs to work (see DEPENDENCIES). */
  dependencies: string[];
}

export const TOOLS: ToolInfo[] = [
  {
    id: "calculator",
    name: "Calculadora",
    description: "Calculadora científica com variáveis, memória e histórico.",
    paid: true,
    dependencies: [],
  },
  { id: "notes", name: "Notas", description: "Bloco de notas com Markdown e busca.", paid: false, dependencies: [] },
  {
    id: "ocr",
    name: "Leitor de imagem",
    description: "Extrai o texto de imagens e prints (OCR).",
    paid: true,
    dependencies: ["tesseract"],
  },
  {
    id: "color-picker",
    name: "Seletor de cor",
    description: "Conta-gotas da tela, conversão de cores e paletas harmônicas.",
    paid: true,
    dependencies: [],
  },
  {
    id: "converter",
    name: "Conversor",
    description: "Unidades de medida e cotação de moedas.",
    paid: false,
    dependencies: [],
  },
  {
    id: "clipboard",
    name: "Clipboard",
    description: "Histórico do que você copia, itens fixados e textos prontos.",
    paid: true,
    dependencies: [],
  },
  {
    id: "devtools",
    name: "Utilitários",
    description: "JSON, Base64, hash, senhas, UUID e testador de regex.",
    paid: false,
    dependencies: [],
  },
  {
    id: "compressor",
    name: "Compressor",
    description: "Comprime e converte imagens e PDFs.",
    paid: true,
    dependencies: [],
  },
  {
    id: "translator",
    name: "Tradutor",
    description: "Tradução de textos entre mais de 30 idiomas.",
    paid: false,
    dependencies: [],
  },
  {
    id: "transcribe",
    name: "Transcrição de áudio",
    description: "Transforma áudios (inclusive do WhatsApp) em texto, no seu computador.",
    paid: true,
    dependencies: ["whisper"],
  },
  {
    id: "reminders",
    name: "Lembretes/Timer",
    description: "Lembretes com notificação e timer pomodoro.",
    paid: true,
    dependencies: [],
  },
  {
    id: "file-search",
    name: "Busca de arquivos",
    description: "Encontra qualquer arquivo do computador instantaneamente.",
    paid: true,
    dependencies: [],
  },
];

export interface DependencyInfo {
  id: string;
  name: string;
  description: string;
  /** Approximate download size, for the download page. */
  approxSizeMb: number;
}

export const DEPENDENCIES: DependencyInfo[] = [
  {
    id: "tesseract",
    name: "Tesseract OCR",
    description: "Motor de reconhecimento de texto usado pelo Leitor de imagem.",
    approxSizeMb: 60,
  },
  {
    id: "whisper",
    name: "Whisper (modelo de voz)",
    description: "Motor e modelo de reconhecimento de voz usados pela Transcrição.",
    approxSizeMb: 150,
  },
];

export const TOOL_IDS = new Set(TOOLS.map((t) => t.id));

export function toolName(id: string): string {
  return TOOLS.find((t) => t.id === id)?.name ?? id;
}
