import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../src/lib/crypto";
import {
  ACCESS_TOKEN_TTL_MS,
  signAccessToken,
  signEntitlementToken,
  verifyAccessToken,
  verifyEntitlementToken,
} from "../src/lib/tokens";

describe("access tokens", () => {
  const claims = { sub: "u1", sid: "s1", role: "user" as const };

  it("round-trips", async () => {
    const { token } = await signAccessToken("secret", claims);
    expect(await verifyAccessToken("secret", token)).toMatchObject(claims);
  });

  it("rejects a wrong key, tampering and expiry", async () => {
    const now = Date.now();
    const { token } = await signAccessToken("secret", claims, now);
    expect(await verifyAccessToken("other", token)).toBeNull();

    const [h, p, s] = token.split(".");
    const forged = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    forged.role = "admin";
    const forgedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await verifyAccessToken("secret", `${h}.${forgedPayload}.${s}`)).toBeNull();

    expect(await verifyAccessToken("secret", token, now + ACCESS_TOKEN_TTL_MS + 1000)).toBeNull();
  });

  it("rejects alg=none", async () => {
    const header = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    const payload = btoa(JSON.stringify({ sub: "u", sid: "s", exp: 9e9 })).replace(/=+$/, "");
    expect(await verifyAccessToken("secret", `${header}.${payload}.`)).toBeNull();
  });
});

describe("entitlement tokens", () => {
  it("are verifiable with the public key and nothing else", async () => {
    const pair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
    const priv = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)));
    const pub = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));

    const { token } = await signEntitlementToken(priv, {
      sub: "u1",
      sid: "s1",
      email: "a@b.com",
      diamond: false,
      tools: { ocr: "silver" },
    });
    const claims = await verifyEntitlementToken(pub, token);
    expect(claims?.tools).toEqual({ ocr: "silver" });

    const other = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
    const otherPub = bytesToBase64(new Uint8Array(await webcrypto.subtle.exportKey("raw", other.publicKey)));
    expect(await verifyEntitlementToken(otherPub, token)).toBeNull();
  });
});
