import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "./translate";

describe("splitIntoChunks", () => {
  it("keeps short text in one chunk", () => {
    expect(splitIntoChunks("Olá mundo.", 500)).toEqual(["Olá mundo."]);
  });

  it("never exceeds the limit and loses no words", () => {
    const text = Array.from({ length: 120 }, (_, i) => `Frase número ${i} aqui.`).join(" ");
    const chunks = splitIntoChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ")).toBe(text);
  });

  it("prefers sentence boundaries", () => {
    const chunks = splitIntoChunks("Primeira frase curta. Segunda frase curta.", 25);
    expect(chunks).toEqual(["Primeira frase curta.", "Segunda frase curta."]);
  });

  it("hard-splits a single word longer than the limit", () => {
    const url = "x".repeat(250);
    const chunks = splitIntoChunks(url, 100);
    expect(chunks).toEqual(["x".repeat(100), "x".repeat(100), "x".repeat(50)]);
  });
});
