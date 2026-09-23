import { md5 } from "./md5";

async function sha(algo: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512", text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface HashResults {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

export async function computeHashes(text: string): Promise<HashResults> {
  const [sha1, sha256, sha512] = await Promise.all([
    sha("SHA-1", text),
    sha("SHA-256", text),
    sha("SHA-512", text),
  ]);
  return { md5: md5(text), sha1, sha256, sha512 };
}
