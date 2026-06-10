/**
 * HashEmbedder tests — hermetic (no network, no keys, no native deps).
 * Asserts the four properties the pipeline relies on: determinism, correct
 * dimension (env default 384), unit-norm, and that different texts differ.
 */
import { describe, it, expect } from "vitest";
import { HashEmbedder, getEmbedder } from "@/lib/embedder";
import { env } from "@/lib/env";

const DIM = env().EMBED_DIM; // 384 by default

function l2(vec: number[]): number {
  return Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
}

describe("HashEmbedder", () => {
  it("is deterministic: same text → identical vector", async () => {
    const e = new HashEmbedder();
    const [a] = await e.embed(["The FTC negative-option rule affects auto-renewing subscriptions."]);
    const [b] = await e.embed(["The FTC negative-option rule affects auto-renewing subscriptions."]);
    expect(a).toEqual(b);
  });

  it("produces vectors of the configured dimension (env default 384)", async () => {
    const e = new HashEmbedder();
    expect(e.dim).toBe(DIM);
    expect(DIM).toBe(384);
    const [vec] = await e.embed(["import de minimis suspended for all countries"]);
    expect(vec).toHaveLength(DIM);
  });

  it("returns unit-norm vectors (~1.0) for non-empty text", async () => {
    const e = new HashEmbedder();
    const [vec] = await e.embed(["FSMA 204 food traceability compliance date extended"]);
    expect(l2(vec)).toBeCloseTo(1.0, 6);
  });

  it("returns one vector per input, all unit-norm", async () => {
    const e = new HashEmbedder();
    const out = await e.embed(["overtime threshold change", "data breach notification rule"]);
    expect(out).toHaveLength(2);
    for (const vec of out) {
      expect(vec).toHaveLength(DIM);
      expect(l2(vec)).toBeCloseTo(1.0, 6);
    }
  });

  it("different texts produce different vectors", async () => {
    const e = new HashEmbedder();
    const [a] = await e.embed(["worker classification 1099 contractor rule"]);
    const [b] = await e.embed(["FCC equipment authorization covered list"]);
    expect(a).not.toEqual(b);
  });

  it("handles empty / all-punctuation text without throwing (zero vector)", async () => {
    const e = new HashEmbedder();
    const [empty] = await e.embed([""]);
    const [punct] = await e.embed(["...!!! --- ???"]);
    expect(empty).toHaveLength(DIM);
    expect(punct).toHaveLength(DIM);
    // No tokens → zero vector (norm 0), which is intentionally left un-normalized.
    expect(l2(empty)).toBe(0);
  });

  it("is case- and punctuation-insensitive (same tokens → same vector)", async () => {
    const e = new HashEmbedder();
    const [a] = await e.embed(["Wages & Hours: Overtime!"]);
    const [b] = await e.embed(["wages hours overtime"]);
    expect(a).toEqual(b);
  });
});

describe("getEmbedder", () => {
  it("returns the hermetic HashEmbedder by default (EMBEDDER=hash)", () => {
    // env default EMBEDDER is 'hash'; the factory must not require network/keys.
    const e = getEmbedder();
    expect(e).toBeInstanceOf(HashEmbedder);
    expect(e.dim).toBe(DIM);
  });
});
