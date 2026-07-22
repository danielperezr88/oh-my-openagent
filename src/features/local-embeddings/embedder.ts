import { log } from "../../shared/logger"

const MODEL_ID = "Xenova/all-MiniLM-L6-v2"

export interface SemanticSearchResult {
  toolID: string
  score: number
}

type EmbeddingVector = number[]

interface EmbeddingPipeline {
  (texts: string[], options: { pooling: "mean"; normalize: true }): Promise<{
    data: number[]
    dims: number[]
  }>
}

/**
 * Local tool embedder using sentence-transformers (all-MiniLM-L6-v2) via @huggingface/transformers.
 *
 * Loads the model lazily on first use. Call warmup() during plugin init to pre-load in background.
 * Falls back gracefully if @huggingface/transformers is unavailable.
 */
export class LocalToolEmbedder {
  private pipeline: EmbeddingPipeline | null = null
  private warmupPromise: Promise<void> | null = null
  private ready = false
  private failed = false

  /** Cached tool description embeddings: toolID -> embedding vector */
  private descriptionEmbeddings = new Map<string, EmbeddingVector>()
  /** Cache key: hash of current descriptions to detect changes */
  private cachedDescriptionsHash = ""

  /**
   * Pre-load the model in the background. Non-blocking.
   * Call this during plugin init so the model is ready when first needed.
   */
  warmup(): void {
    if (this.warmupPromise || this.failed) return
    this.warmupPromise = this.loadModel()
    this.warmupPromise.catch(() => {
      this.failed = true
      log("[local-embeddings] Model loading failed, semantic search disabled")
    })
  }

  /**
   * Check if the embedder is ready for use.
   */
  isReady(): boolean {
    return this.ready
  }

  /**
   * Wait for the model to be ready (if warming up). Returns true if ready.
   */
  async waitForReady(timeoutMs = 5000): Promise<boolean> {
    if (this.ready) return true
    if (this.failed) return false
    if (!this.warmupPromise) return false

    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))
    await Promise.race([this.warmupPromise.then(() => true), timeout])
    return this.ready
  }

  /**
   * Perform semantic search against tool descriptions.
   *
   * @param query - The search query (e.g., user message)
   * @param toolDescriptions - Map of toolID -> description
   * @param options - Search options
   * @returns Ranked list of matching tools, best first
   */
  async search(
    query: string,
    toolDescriptions: Map<string, string>,
    options?: { threshold?: number; topK?: number },
  ): Promise<SemanticSearchResult[]> {
    const threshold = options?.threshold ?? 0.3
    const topK = options?.topK ?? 5

    if (!this.ready) {
      const becameReady = await this.waitForReady()
      if (!becameReady) return []
    }

    // Ensure description embeddings are cached and up-to-date
    await this.ensureDescriptionEmbeddings(toolDescriptions)

    // Embed the query
    const queryEmbedding = await this.embed(query)
    if (!queryEmbedding) return []

    // Compute cosine similarity against all cached embeddings
    const results: SemanticSearchResult[] = []
    for (const [toolID, embedding] of this.descriptionEmbeddings) {
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score >= threshold) {
        results.push({ toolID, score })
      }
    }

    // Sort by score descending, take topK
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  // --- Private ---

  private async loadModel(): Promise<void> {
    try {
      const { pipeline } = await import("@huggingface/transformers")
      log("[local-embeddings] Loading embedding model", { model: MODEL_ID })

      const extractor = await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
      })

      this.pipeline = extractor as unknown as EmbeddingPipeline
      this.ready = true
      log("[local-embeddings] Model loaded successfully")
    } catch (err) {
      this.failed = true
      log("[local-embeddings] Failed to load model", { error: String(err) })
      throw err
    }
  }

  private async embed(text: string): Promise<EmbeddingVector | null> {
    if (!this.pipeline) return null
    try {
      const output = await this.pipeline([text], { pooling: "mean", normalize: true })
      return Array.from(output.data)
    } catch (err) {
      log("[local-embeddings] Embedding failed", { error: String(err) })
      return null
    }
  }

  private async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (!this.pipeline || texts.length === 0) return []

    try {
      const output = await this.pipeline(texts, { pooling: "mean", normalize: true })
      const dim = output.dims[output.dims.length - 1]
      const vectors: EmbeddingVector[] = []
      for (let i = 0; i < texts.length; i++) {
        const start = i * dim
        vectors.push(Array.from(output.data.slice(start, start + dim)))
      }
      return vectors
    } catch (err) {
      log("[local-embeddings] Batch embedding failed", { error: String(err) })
      return []
    }
  }

  private async ensureDescriptionEmbeddings(descriptions: Map<string, string>): Promise<void> {
    const hash = computeMapHash(descriptions)
    if (hash === this.cachedDescriptionsHash) return

    // Re-embed all descriptions
    const entries = Array.from(descriptions.entries())
    const texts = entries.map(([, desc]) => desc)
    const embeddings = await this.embedBatch(texts)

    this.descriptionEmbeddings.clear()
    for (let i = 0; i < entries.length; i++) {
      if (embeddings[i]) {
        this.descriptionEmbeddings.set(entries[i][0], embeddings[i])
      }
    }
    this.cachedDescriptionsHash = hash
  }
}

// --- Singleton ---

let instance: LocalToolEmbedder | null = null

/** @internal Reset singleton for testing */
export function _resetEmbedderSingleton(): void {
  instance = null
}

/**
 * Get the global LocalToolEmbedder instance. Creates one if needed.
 */
export function getLocalToolEmbedder(): LocalToolEmbedder {
  if (!instance) {
    instance = new LocalToolEmbedder()
  }
  return instance
}

/**
 * Initialize and warmup the global embedder. Call during plugin init.
 */
export function initLocalEmbedder(): void {
  const embedder = getLocalToolEmbedder()
  embedder.warmup()
}

// --- Utility ---

export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function computeMapHash(map: Map<string, string>): string {
  const entries: string[] = []
  for (const [key, value] of map) {
    entries.push(`${key}::${value}`)
  }
  entries.sort()
  return entries.join("|")
}
