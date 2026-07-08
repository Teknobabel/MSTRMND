import { describe, expect, it } from "vitest";
import { isWebpBytes, sanitizeArtFileName, webpHasAnimation } from "./artFiles";

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

/** Minimal RIFF container: header + the given chunks (tag, payload) with size fields. */
function webpBytes(...chunks: [string, number[]][]): Uint8Array {
  const body: number[] = [];
  for (const [tag, payload] of chunks) {
    body.push(...ascii(tag));
    const size = payload.length;
    body.push(size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff);
    body.push(...payload);
    if (size % 2 === 1) {
      body.push(0);
    }
  }
  const riffSize = body.length + 4;
  return new Uint8Array([
    ...ascii("RIFF"),
    riffSize & 0xff,
    (riffSize >> 8) & 0xff,
    (riffSize >> 16) & 0xff,
    (riffSize >> 24) & 0xff,
    ...ascii("WEBP"),
    ...body,
  ]);
}

describe("sanitizeArtFileName", () => {
  it("slugs names and drops the .webp extension", () => {
    expect(sanitizeArtFileName("My Cool Minion.webp")).toBe("my-cool-minion");
    expect(sanitizeArtFileName("minion-operative-alpha")).toBe("minion-operative-alpha");
  });

  it("strips path separators and traversal characters", () => {
    expect(sanitizeArtFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeArtFileName("a\\b/c")).toBe("a-b-c");
  });

  it("returns null when nothing usable remains", () => {
    expect(sanitizeArtFileName("")).toBeNull();
    expect(sanitizeArtFileName("....")).toBeNull();
    expect(sanitizeArtFileName(".webp")).toBeNull();
  });
});

describe("isWebpBytes", () => {
  it("accepts a RIFF/WEBP header", () => {
    expect(isWebpBytes(webpBytes(["VP8 ", [1, 2, 3]]))).toBe(true);
  });

  it("rejects other formats and truncated data", () => {
    const png = new Uint8Array([0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(isWebpBytes(png)).toBe(false);
    /* RIFF but not WEBP (e.g. a .wav file). */
    expect(isWebpBytes(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")]))).toBe(
      false,
    );
    expect(isWebpBytes(new Uint8Array(ascii("RIFF")))).toBe(false);
  });
});

describe("webpHasAnimation", () => {
  it("finds an ANIM chunk after other chunks", () => {
    const animated = webpBytes(
      ["VP8X", [0x12, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      ["ANIM", [0, 0, 0, 0, 0, 0]],
    );
    expect(webpHasAnimation(animated)).toBe(true);
  });

  it("returns false for a static WebP", () => {
    expect(webpHasAnimation(webpBytes(["VP8 ", [1, 2, 3, 4, 5]]))).toBe(false);
  });

  it("is not fooled by ANIM bytes inside another chunk's payload", () => {
    const decoy = webpBytes(["VP8 ", ascii("ANIM")]);
    expect(webpHasAnimation(decoy)).toBe(false);
  });

  it("returns false for non-WebP input", () => {
    expect(webpHasAnimation(new Uint8Array(ascii("GIF89a")))).toBe(false);
  });
});
