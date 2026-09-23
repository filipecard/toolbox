const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>/?";
const AMBIGUOUS = /[il1Lo0O]/g;

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

/** Uniform random index in [0, max) via rejection sampling — avoids the
 * small modulo bias a plain `random() % max` would introduce, since this
 * generates actual passwords (not just cosmetic randomness). */
function randomIndex(max: number): number {
  const range = Math.floor(0xffffffff / max) * max;
  let x: number;
  do {
    x = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (x >= range);
  return x % max;
}

export function buildCharset(options: PasswordOptions): string {
  let charset = "";
  if (options.lower) charset += LOWER;
  if (options.upper) charset += UPPER;
  if (options.numbers) charset += NUMBERS;
  if (options.symbols) charset += SYMBOLS;
  if (options.excludeAmbiguous) charset = charset.replace(AMBIGUOUS, "");
  return charset;
}

export function generatePassword(options: PasswordOptions): string {
  const charset = buildCharset(options);
  if (!charset) return "";
  let result = "";
  for (let i = 0; i < options.length; i++) {
    result += charset[randomIndex(charset.length)];
  }
  return result;
}

export type PasswordStrength = "Fraca" | "Razoável" | "Forte" | "Muito forte";

/** Rough entropy-based estimate (length * log2(charset size)) — good enough
 * for a UI hint, not a rigorous security metric. */
export function estimateStrength(password: string, charsetSize: number): PasswordStrength {
  if (!password || charsetSize <= 1) return "Fraca";
  const bits = password.length * Math.log2(charsetSize);
  if (bits < 40) return "Fraca";
  if (bits < 60) return "Razoável";
  if (bits < 80) return "Forte";
  return "Muito forte";
}
