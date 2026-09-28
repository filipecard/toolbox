import { describe, expect, it } from "vitest";
import {
  constantTimeEqualStrings,
  generateUserCode,
  hashPassword,
  hmacSign,
  hmacVerify,
  normalizeUserCode,
  randomToken,
  verifyPassword,
} from "../src/lib/crypto";

describe("passwords", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correta-123");
    expect(stored.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("correta-123", stored)).toBe(true);
    expect(await verifyPassword("errada-123", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("mesma")).not.toBe(await hashPassword("mesma"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("tokens and codes", () => {
  it("random tokens are url-safe and unique", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(randomToken());
  });

  it("user codes are readable and normalize what people type", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateUserCode();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(code).not.toMatch(/[01OILSZ25]/);
      expect(normalizeUserCode(code.toLowerCase().replace("-", " "))).toBe(code);
    }
    expect(normalizeUserCode("abc")).toBeNull();
    expect(normalizeUserCode("OOOO-OOOO")).toBeNull();
  });

  it("hmac signatures verify only for the same message and key", async () => {
    const sig = await hmacSign("k1", "msg");
    expect(await hmacVerify("k1", "msg", sig)).toBe(true);
    expect(await hmacVerify("k2", "msg", sig)).toBe(false);
    expect(await hmacVerify("k1", "msg2", sig)).toBe(false);
    expect(await hmacVerify("k1", "msg", "@@not-base64@@")).toBe(false);
  });

  it("constant-time compare", () => {
    expect(constantTimeEqualStrings("abc", "abc")).toBe(true);
    expect(constantTimeEqualStrings("abc", "abd")).toBe(false);
    expect(constantTimeEqualStrings("abc", "abcd")).toBe(false);
  });
});
