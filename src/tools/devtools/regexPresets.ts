export interface RegexPreset {
  id: string;
  label: string;
  description: string;
  pattern: string;
  flags: string;
  /** "validate": anchored with ^...$, checks whether the WHOLE test string
   * matches (0 or 1 result) — for form-field-style validation. "find":
   * unanchored + global, returns every matching chunk found anywhere in the
   * text — for pulling values out of a larger string. Mixing the two up is
   * the single most common confusion with these presets (e.g. picking a
   * "validate" preset expecting it to pull matches out of mixed text). */
  kind: "validate" | "find";
}

export const REGEX_PRESETS: RegexPreset[] = [
  {
    id: "letters",
    label: "Somente letras",
    description: "Letras (com acentos) — a string inteira precisa ser só isso",
    pattern: "^[A-Za-zÀ-ÿ]+$",
    flags: "",
    kind: "validate",
  },
  {
    id: "numbers",
    label: "Somente números",
    description: "Dígitos — a string inteira precisa ser só isso",
    pattern: "^\\d+$",
    flags: "",
    kind: "validate",
  },
  {
    id: "alphanumeric",
    label: "Letras e números",
    description: "Sem espaços/símbolos — a string inteira precisa ser só isso",
    pattern: "^[A-Za-z0-9]+$",
    flags: "",
    kind: "validate",
  },
  {
    id: "email",
    label: "E-mail",
    description: "Formato básico de e-mail — valida a string inteira",
    pattern: "^[\\w.+-]+@[\\w-]+\\.[a-zA-Z]{2,}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "url",
    label: "URL",
    description: "Começa com http:// ou https:// — valida a string inteira",
    pattern: "^https?:\\/\\/[^\\s]+$",
    flags: "",
    kind: "validate",
  },
  {
    id: "phone-br",
    label: "Telefone (BR)",
    description: "Com ou sem DDD/traço — valida a string inteira",
    pattern: "^\\(?\\d{2}\\)?[\\s-]?\\d{4,5}-?\\d{4}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "cep-br",
    label: "CEP (BR)",
    description: "00000-000 ou 00000000 — valida a string inteira",
    pattern: "^\\d{5}-?\\d{3}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "cpf-br",
    label: "CPF (BR)",
    description: "000.000.000-00 ou só números — valida a string inteira",
    pattern: "^\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "date-br",
    label: "Data (dd/mm/aaaa)",
    description: "Formato brasileiro de data — valida a string inteira",
    pattern: "^\\d{2}\\/\\d{2}\\/\\d{4}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "hex-color",
    label: "Cor hexadecimal",
    description: "#fff ou #ffffff — valida a string inteira",
    pattern: "^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$",
    flags: "",
    kind: "validate",
  },
  {
    id: "ipv4",
    label: "Endereço IPv4",
    description: "Quatro grupos de números separados por ponto — valida a string inteira",
    pattern: "^(\\d{1,3}\\.){3}\\d{1,3}$",
    flags: "",
    kind: "validate",
  },
  {
    id: "whitespace",
    label: "Espaços em branco",
    description: "Encontra qualquer sequência de espaços dentro do texto",
    pattern: "\\s+",
    flags: "g",
    kind: "find",
  },
  {
    id: "trim",
    label: "Espaços no início/fim",
    description: "Útil pra detectar texto que precisa de trim()",
    pattern: "^\\s+|\\s+$",
    flags: "g",
    kind: "find",
  },
  {
    id: "find-numbers",
    label: "Extrair números",
    description: "Encontra sequências de dígitos em qualquer lugar do texto",
    pattern: "\\d+",
    flags: "g",
    kind: "find",
  },
  {
    id: "find-alphanumeric",
    label: "Extrair letras e números",
    description: "Encontra trechos de letras/números separados por outros símbolos no texto",
    pattern: "[A-Za-z0-9]+",
    flags: "g",
    kind: "find",
  },
  {
    id: "find-words",
    label: "Extrair palavras",
    description: "Encontra toda \"palavra\" (letras, números ou _) em qualquer lugar do texto",
    pattern: "\\w+",
    flags: "g",
    kind: "find",
  },
];

export interface RegexGuideEntry {
  symbol: string;
  meaning: string;
}

export const REGEX_SYNTAX_GUIDE: RegexGuideEntry[] = [
  { symbol: ".", meaning: "Qualquer caractere (exceto quebra de linha)" },
  { symbol: "*", meaning: "0 ou mais repetições do anterior" },
  { symbol: "+", meaning: "1 ou mais repetições do anterior" },
  { symbol: "?", meaning: "0 ou 1 (opcional) — ou deixa o anterior \"preguiçoso\"" },
  { symbol: "^", meaning: "Início da string (ou de cada linha, com a flag m)" },
  { symbol: "$", meaning: "Fim da string (ou de cada linha, com a flag m)" },
  { symbol: "[abc]", meaning: "Qualquer um dos caracteres: a, b ou c" },
  { symbol: "[a-z]", meaning: "Intervalo — de \"a\" até \"z\" (o \"-\" vira intervalo só dentro de [ ])" },
  { symbol: "[^abc]", meaning: "Qualquer caractere, EXCETO a, b ou c" },
  { symbol: "(abc)", meaning: "Grupo de captura — guarda o que casou pra usar depois" },
  { symbol: "(?:abc)", meaning: "Grupo sem captura — só agrupa, não guarda" },
  { symbol: "a|b", meaning: "\"a\" ou \"b\"" },
  { symbol: "{n,m}", meaning: "De n a m repetições do anterior" },
  { symbol: "\\d  \\D", meaning: "Dígito (0-9) / o contrário (não-dígito)" },
  { symbol: "\\w  \\W", meaning: "Letra, número ou _ / o contrário" },
  { symbol: "\\s  \\S", meaning: "Espaço, tab, quebra de linha / o contrário" },
  { symbol: "\\.", meaning: "Escapa um caractere especial — \\. casa um ponto literal" },
];

export const REGEX_FLAGS_GUIDE: RegexGuideEntry[] = [
  { symbol: "g", meaning: "Global — encontra todas as ocorrências, não só a primeira" },
  { symbol: "i", meaning: "Ignora maiúsculas/minúsculas" },
  { symbol: "m", meaning: "Multilinha — ^ e $ passam a valer por linha, não só na string toda" },
  { symbol: "s", meaning: "\".\" passa a também casar quebras de linha" },
];
