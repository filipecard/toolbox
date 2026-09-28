import { describe, expect, it } from "vitest";
import { md5 } from "./md5";

// RFC 1321 test suite.
describe("md5", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("md5(%j)", (input, expected) => {
    expect(md5(input)).toBe(expected);
  });

  // Expected value from Node's crypto.createHash("md5") over UTF-8 bytes.
  it("hashes UTF-8, not UTF-16", () => {
    expect(md5("ção")).toBe("28452896dc8896b5ec91899a8f0c4143");
  });
});
