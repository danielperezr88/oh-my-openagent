import { describe, it, expect, beforeEach } from "bun:test"
import { LocalToolEmbedder, cosineSimilarity, computeMapHash } from "./embedder"

describe("LocalToolEmbedder", () => {
  describe("lifecycle", () => {
    it("starts not ready", () => {
      const embedder = new LocalToolEmbedder()
      expect(embedder.isReady()).toBe(false)
    })

    it("waitForReady returns false when not warming up", async () => {
      const embedder = new LocalToolEmbedder()
      const ready = await embedder.waitForReady(100)
      expect(ready).toBe(false)
    })

    it("search returns empty when not ready", async () => {
      const embedder = new LocalToolEmbedder()
      const results = await embedder.search("test", new Map([["tool1", "A test tool"]]))
      expect(results).toEqual([])
    })
  })

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const vec = [1, 0, 0]
      expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5)
    })

    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5)
    })

    it("returns -1 for opposite vectors", () => {
      expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 5)
    })

    it("returns 0 for different-length vectors", () => {
      expect(cosineSimilarity([1, 2], [1])).toBe(0)
    })

    it("returns 0 for zero vectors", () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    })

    it("computes similarity for general vectors", () => {
      // cos([1,2,3], [4,5,6]) = (4+10+18)/(sqrt(14)*sqrt(77)) = 32/sqrt(1078) ≈ 0.9746
      const result = cosineSimilarity([1, 2, 3], [4, 5, 6])
      expect(result).toBeCloseTo(0.9746, 3)
    })
  })

  describe("computeMapHash", () => {
    it("produces same hash for identical maps", () => {
      const m1 = new Map([["a", "hello"], ["b", "world"]])
      const m2 = new Map([["b", "world"], ["a", "hello"]])
      expect(computeMapHash(m1)).toBe(computeMapHash(m2))
    })

    it("produces different hash for different maps", () => {
      const m1 = new Map([["a", "hello"]])
      const m2 = new Map([["a", "world"]])
      expect(computeMapHash(m1)).not.toBe(computeMapHash(m2))
    })

    it("produces different hash when keys differ", () => {
      const m1 = new Map([["a", "hello"]])
      const m2 = new Map([["b", "hello"]])
      expect(computeMapHash(m1)).not.toBe(computeMapHash(m2))
    })
  })

  describe("search with mock pipeline", () => {
    // We test the search logic by directly injecting a mock pipeline
    // This avoids needing the real @huggingface/transformers model
    it("returns ranked results by cosine similarity", async () => {
      const embedder = new LocalToolEmbedder()

      // Inject a mock pipeline that returns pre-defined embeddings
      // We simulate 3-dimensional embeddings:
      // - "search the web" -> [0.9, 0.1, 0.0] (web-search-like)
      // - "read files" -> [0.0, 0.1, 0.9] (file-read-like)
      // - "run terminal commands" -> [0.1, 0.9, 0.1] (terminal-like)
      const toolEmbeddings: Record<string, number[]> = {
        "mcp__websearch__search": [0.9, 0.1, 0.0],
        "mcp__filesystem__read": [0.0, 0.1, 0.9],
        "mcp__terminal__exec": [0.1, 0.9, 0.1],
      }

      // Use reflection to inject mock
      const embedderAny = embedder as unknown as {
        pipeline: (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>
        ready: boolean
      }

      embedderAny.ready = true
      embedderAny.pipeline = async (texts: string[], _opts: { pooling: string; normalize: boolean }) => {
        const dim = 3
        const data = new Float32Array(texts.length * dim)

        // Simple hash-based mock embedding
        for (let i = 0; i < texts.length; i++) {
          const text = texts[i]!.toLowerCase()
          let emb: number[]
          if (text.includes("search") || text.includes("web") || text.includes("find")) {
            emb = [0.9, 0.1, 0.0]
          } else if (text.includes("read") || text.includes("file") || text.includes("document")) {
            emb = [0.0, 0.1, 0.9]
          } else if (text.includes("terminal") || text.includes("command") || text.includes("bash")) {
            emb = [0.1, 0.9, 0.1]
          } else {
            // Default: equal components
            emb = [0.33, 0.33, 0.33]
          }
          for (let j = 0; j < dim; j++) {
            data[i * dim + j] = emb[j]!
          }
        }

        return { data, dims: [texts.length, dim] }
      }

      const descriptions = new Map(Object.entries({
        "mcp__websearch__search": "Search the web for information",
        "mcp__filesystem__read": "Read file contents from disk",
        "mcp__terminal__exec": "Run terminal commands",
      }))

      // Search for "find web pages"
      const results = await embedder.search("find web pages", descriptions, { threshold: 0.5, topK: 3 })

      // Should find websearch as top result
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0]!.toolID).toBe("mcp__websearch__search")
      expect(results[0]!.score).toBeGreaterThan(0.5)
    })

    it("respects threshold filter", async () => {
      const embedder = new LocalToolEmbedder()
      const embedderAny = embedder as unknown as {
        pipeline: (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>
        ready: boolean
      }

      let callIndex = 0
      embedderAny.ready = true
      embedderAny.pipeline = async (texts: string[], _opts: { pooling: string; normalize: boolean }) => {
        const dim = 3
        const data = new Float32Array(texts.length * dim)
        // First call (descriptions): embed descriptions as [1, 0, 0]
        // Second call (query): embed query as [0, 1, 0] (orthogonal)
        const isDescriptionCall = callIndex === 0
        callIndex++
        for (let i = 0; i < texts.length; i++) {
          if (isDescriptionCall) {
            data[i * dim] = 1
            data[i * dim + 1] = 0
            data[i * dim + 2] = 0
          } else {
            data[i * dim] = 0
            data[i * dim + 1] = 1
            data[i * dim + 2] = 0
          }
        }
        return { data, dims: [texts.length, dim] }
      }

      const descriptions = new Map([["tool1", "Some description"]])

      // Orthogonal vectors have cosine similarity = 0, so threshold 0.99 filters them
      const results = await embedder.search("unrelated query", descriptions, { threshold: 0.99 })
      expect(results).toEqual([])
    })

    it("respects topK limit", async () => {
      const embedder = new LocalToolEmbedder()
      const embedderAny = embedder as unknown as {
        pipeline: (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>
        ready: boolean
      }

      embedderAny.ready = true
      embedderAny.pipeline = async (texts: string[], _opts: { pooling: string; normalize: boolean }) => {
        const dim = 2
        const data = new Float32Array(texts.length * dim)
        // All texts get the same embedding -> same similarity
        for (let i = 0; i < texts.length; i++) {
          data[i * dim] = 1
          data[i * dim + 1] = 0
        }
        return { data, dims: [texts.length, dim] }
      }

      const descriptions = new Map([
        ["tool1", "desc1"],
        ["tool2", "desc2"],
        ["tool3", "desc3"],
        ["tool4", "desc4"],
        ["tool5", "desc5"],
      ])

      const results = await embedder.search("query", descriptions, { threshold: 0.0, topK: 2 })
      expect(results.length).toBe(2)
    })

    it("caches description embeddings across calls", async () => {
      const embedder = new LocalToolEmbedder()
      const embedderAny = embedder as unknown as {
        pipeline: (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>
        ready: boolean
      }

      let callCount = 0
      embedderAny.ready = true
      embedderAny.pipeline = async (texts: string[], _opts: { pooling: string; normalize: boolean }) => {
        const dim = 2
        const data = new Float32Array(texts.length * dim)
        callCount += texts.length
        for (let i = 0; i < texts.length; i++) {
          data[i * dim] = 1
          data[i * dim + 1] = 0
        }
        return { data, dims: [texts.length, dim] }
      }

      const descriptions = new Map([["tool1", "description one"]])

      await embedder.search("query 1", descriptions)
      const countAfterFirst = callCount

      await embedder.search("query 2", descriptions)
      const countAfterSecond = callCount

      // Second call should only embed the query, not the descriptions again
      // countAfterSecond - countAfterFirst should be 1 (just the query)
      expect(countAfterSecond - countAfterFirst).toBe(1)
    })
  })
})
