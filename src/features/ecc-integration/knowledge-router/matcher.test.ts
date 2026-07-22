import { describe, expect, it } from "bun:test"
import { KNOWLEDGE_FRAGMENTS } from "./fragments"
import { listTopics, matchFragments } from "./matcher"

describe("matcher", () => {
  describe("#given a topic query for auth", () => {
    it("returns JWT and RBAC fragments", () => {
      // given
      const query = { topic: "auth" }
      // when
      const result = matchFragments(query)
      // then
      const ids = result.fragments.map((f) => f.id)
      expect(ids).toContain("sec-auth-jwt")
      expect(ids).toContain("sec-auth-rbac")
    })
  })

  describe("#given a topic query for sql-injection", () => {
    it("returns the sql injection fragment", () => {
      // given
      const query = { topic: "sql-injection" }
      // when
      const result = matchFragments(query)
      // then
      expect(result.fragments.length).toBeGreaterThanOrEqual(1)
      expect(result.fragments[0].id).toBe("sec-sql-injection")
    })
  })

  describe("#given a language filter", () => {
    it("prioritizes language-specific fragments", () => {
      // given
      const query = { topic: "async", language: "typescript" }
      // when
      const result = matchFragments(query)
      // then
      const ids = result.fragments.map((f) => f.id)
      expect(ids).toContain("style-ts-async")
    })
  })

  describe("#given a framework filter for react", () => {
    it("returns react-specific fragments", () => {
      // given
      const query = { topic: "react", framework: "react" }
      // when
      const result = matchFragments(query)
      // then
      const ids = result.fragments.map((f) => f.id)
      expect(ids).toContain("style-react-components")
      expect(ids).toContain("style-react-hooks")
    })
  })

  describe("#given a vague trigger keyword", () => {
    it("matches fragments by trigger words", () => {
      // given
      const query = { topic: "password" }
      // when
      const result = matchFragments(query)
      // then
      const ids = result.fragments.map((f) => f.id)
      expect(ids).toContain("sec-secrets")
    })
  })

  describe("#given no matching topic", () => {
    it("returns empty fragments", () => {
      // given
      const query = { topic: "nonexistent-topic-xyz" }
      // when
      const result = matchFragments(query)
      // then
      expect(result.fragments).toHaveLength(0)
      expect(result.totalAvailable).toBe(0)
    })
  })

  describe("#given a maximum fragment limit", () => {
    it("does not exceed 8 fragments", () => {
      // given
      const query = { topic: "security" }
      // when
      const result = matchFragments(query)
      // then
      expect(result.fragments.length).toBeLessThanOrEqual(8)
    })
  })
})

describe("listTopics", () => {
  it("returns sorted unique topic list", () => {
    // when
    const topics = listTopics()
    // then
    expect(topics).toContain("auth-jwt")
    expect(topics).toContain("sql-injection")
    expect(topics).toContain("tdd")
    expect(topics).toEqual([...topics].sort())
  })
})

describe("KNOWLEDGE_FRAGMENTS integrity", () => {
  it("has unique fragment IDs", () => {
    // given
    const ids = KNOWLEDGE_FRAGMENTS.map((f) => f.id)
    // when + then
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("has at least one trigger per fragment", () => {
    // given + when + then
    for (const fragment of KNOWLEDGE_FRAGMENTS) {
      expect(fragment.triggers.length).toBeGreaterThan(0)
    }
  })
})
