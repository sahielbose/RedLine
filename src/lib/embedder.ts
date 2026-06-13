/**
 * Embedder adapters (spec §4, §7).
 *
 * One `Embedder` interface, four providers selected by env().EMBEDDER:
 *   - 'hash'   HashEmbedder   - deterministic, dependency-free; the hermetic
 *                               default used by tests/CI (no network, no keys).
 *   - 'local'  LocalEmbedder  - bge-small-en via transformers.js (guarded
 *                               dynamic import; dep not installed by default).
 *   - 'ollama' OllamaEmbedder - POST to a local Ollama server (nomic-embed-text).
 *   - 'api'    ApiEmbedder    - OpenAI-compatible embeddings HTTP endpoint.
 *
 * Every provider exposes `dim = env().EMBED_DIM` and returns row-per-input
 * vectors of exactly that length. The factory `getEmbedder()` reads env once.
 *
 * ⚠️ EMBED_DIM must match the chosen model when using a real embedder:
 *   OpenAI 3-small=1536 | nomic-embed=768 | bge-small=384 (the env default).
 * The hash embedder works at ANY dim because it projects into EMBED_DIM buckets.
 */
import type { Embedder } from "@/lib/interfaces";
import { env } from "@/lib/env";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Lowercase + split on runs of non-alphanumerics. Stable across inputs. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * FNV-1a 32-bit hash of a string - fast, deterministic, dependency-free.
 * (We only need a stable spread of tokens into buckets, not crypto strength.)
 */
function fnv1a(token: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** L2-normalize in place to a unit vector. A zero vector is returned as-is. */
function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

function assertDim(vec: number[], dim: number, provider: string): number[] {
  if (vec.length !== dim) {
    throw new Error(
      `[embedder:${provider}] expected ${dim}-d vector but got ${vec.length}. ` +
        `Set EMBED_DIM to match the model (bge-small=384, nomic-embed=768, openai-3-small=1536).`,
    );
  }
  return vec;
}

// ── HashEmbedder (hermetic default) ───────────────────────────────────────────

/**
 * Deterministic bag-of-hashed-tokens embedder. Tokenize → hash each token into
 * one of `dim` buckets → accumulate counts → L2-normalize to a unit vector.
 *
 * Properties (relied on by tests):
 *  - same input  → byte-identical output
 *  - different inputs → (almost surely) different vectors
 *  - every non-empty output is unit-norm (~1.0)
 *  - no network, no keys, no native deps - safe for CI.
 */
export class HashEmbedder implements Embedder {
  readonly dim: number;

  constructor(dim = env().EMBED_DIM) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    for (const token of tokenize(text)) {
      const bucket = fnv1a(token) % this.dim;
      // Sign bit from the high end of the hash de-correlates collisions a bit,
      // so two different tokens landing in the same bucket can still cancel/add.
      const sign = (fnv1a(token + "") & 1) === 0 ? 1 : -1;
      vec[bucket] += sign;
    }
    return l2normalize(vec);
  }
}

// ── LocalEmbedder (transformers.js, guarded) ──────────────────────────────────

/**
 * bge-small-en (384-d) via @xenova/transformers. The dep is NOT installed by
 * default (keeps the hermetic path dependency-free), so the import is a GUARDED
 * dynamic import - this file still typechecks and the hash path still runs even
 * when the package is absent. The pipeline lazily creates the extractor once.
 */
export class LocalEmbedder implements Embedder {
  readonly dim: number;
  private readonly model: string;
  // The feature-extraction pipeline, lazily initialized on first embed().
  private extractor: ((input: string, opts: unknown) => Promise<unknown>) | null = null;

  constructor(dim = env().EMBED_DIM, model = "Xenova/bge-small-en-v1.5") {
    this.dim = dim;
    this.model = model;
  }

  private async getExtractor(): Promise<(input: string, opts: unknown) => Promise<unknown>> {
    if (this.extractor) return this.extractor;
    let transformers: { pipeline: (task: string, model: string) => Promise<unknown> };
    try {
      // Guarded dynamic import: the package is optional. Use a variable spec so
      // the bundler/tsc does not attempt to statically resolve the module.
      const spec = "@xenova/transformers";
      transformers = (await import(/* @vite-ignore */ /* webpackIgnore: true */ spec)) as {
        pipeline: (task: string, model: string) => Promise<unknown>;
      };
    } catch {
      throw new Error(
        "[embedder:local] '@xenova/transformers' is not installed. " +
          "Install it (npm i @xenova/transformers) to use EMBEDDER=local, " +
          "or set EMBEDDER=hash for the dependency-free default.",
      );
    }
    this.extractor = (await transformers.pipeline(
      "feature-extraction",
      this.model,
    )) as (input: string, opts: unknown) => Promise<unknown>;
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.getExtractor();
    const out: number[][] = [];
    for (const text of texts) {
      // mean-pooling + L2-normalization mirror bge's recommended usage.
      const result = (await extractor(text, { pooling: "mean", normalize: true })) as {
        data: ArrayLike<number>;
      };
      const vec = Array.from(result.data, Number);
      out.push(assertDim(vec, this.dim, "local"));
    }
    return out;
  }
}

// ── OllamaEmbedder ────────────────────────────────────────────────────────────

/**
 * Local Ollama server, nomic-embed-text (768-d). One POST per text to
 * `${OLLAMA_BASE_URL}/api/embeddings`. Self-hostable, OSS-clean.
 */
export class OllamaEmbedder implements Embedder {
  readonly dim: number;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(dim = env().EMBED_DIM, baseUrl = env().OLLAMA_BASE_URL, model = "nomic-embed-text") {
    this.dim = dim;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(
          `[embedder:ollama] ${res.status} ${res.statusText} from ${this.baseUrl}/api/embeddings`,
        );
      }
      const json = (await res.json()) as { embedding?: number[] };
      if (!json.embedding) {
        throw new Error("[embedder:ollama] response missing 'embedding' field");
      }
      out.push(assertDim(json.embedding, this.dim, "ollama"));
    }
    return out;
  }
}

// ── ApiEmbedder (OpenAI-compatible) ───────────────────────────────────────────

/**
 * OpenAI-compatible embeddings endpoint (the fast cloud path). Batches all
 * inputs in one request to `${EMBED_API_URL}` with EMBED_API_MODEL and a Bearer
 * EMBED_API_KEY. Works with OpenAI, Together, OpenRouter, vLLM, etc.
 */
export class ApiEmbedder implements Embedder {
  readonly dim: number;
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;

  constructor(
    dim = env().EMBED_DIM,
    url = env().EMBED_API_URL,
    apiKey = env().EMBED_API_KEY,
    model = env().EMBED_API_MODEL,
  ) {
    if (!url) {
      throw new Error(
        "[embedder:api] EMBED_API_URL is not set. Set it to an OpenAI-compatible " +
          "embeddings endpoint, or use EMBEDDER=hash for the dependency-free default.",
      );
    }
    this.dim = dim;
    this.url = url;
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`[embedder:api] ${res.status} ${res.statusText} from ${this.url}`);
    }
    const json = (await res.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    if (!json.data || json.data.length !== texts.length) {
      throw new Error(
        `[embedder:api] expected ${texts.length} embeddings, got ${json.data?.length ?? 0}`,
      );
    }
    // Order by 'index' so the row order matches the input order regardless of
    // how the provider sequenced its response.
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    return ordered.map((row) => assertDim(row.embedding, this.dim, "api"));
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

/**
 * Resolve the configured embedder from env().EMBEDDER. Defaults to the hermetic
 * HashEmbedder so the pipeline + evals run with zero secrets and no network.
 */
export function getEmbedder(): Embedder {
  const provider = env().EMBEDDER;
  switch (provider) {
    case "hash":
      return new HashEmbedder();
    case "local":
      return new LocalEmbedder();
    case "ollama":
      return new OllamaEmbedder();
    case "api":
      return new ApiEmbedder();
    default: {
      // Exhaustiveness guard: if EMBEDDER's enum grows, this fails to compile.
      const _exhaustive: never = provider;
      throw new Error(`[embedder] unknown provider: ${String(_exhaustive)}`);
    }
  }
}
