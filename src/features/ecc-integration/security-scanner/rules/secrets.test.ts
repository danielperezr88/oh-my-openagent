import { describe, expect, it } from "bun:test"
import { scanFileForSecrets, SECRET_PATTERNS, shouldScanFile } from "./secrets"

describe("secrets rules", () => {
  describe("#given AWS access key in content", () => {
    it("detects the key", () => {
      // given
      const content = 'const key = "AKIAIOSFODNN7EXAMPLE"'
      // when
      const findings = scanFileForSecrets(content, "config.ts")
      // then
      expect(findings.some((f) => f.id === "aws-access-key")).toBe(true)
    })
  })

  describe("#given GitHub token in content", () => {
    it("detects the token", () => {
      // given
      const content = 'const token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"'
      // when
      const findings = scanFileForSecrets(content, "config.ts")
      // then
      expect(findings.some((f) => f.id === "github-token")).toBe(true)
    })
  })

  describe("#given OpenAI API key in content", () => {
    it("detects the key", () => {
      // given
      const content = 'const key = "sk-1234567890abcdefghijklmnopqrstuvwxyz"'
      // when
      const findings = scanFileForSecrets(content, "config.ts")
      // then
      expect(findings.some((f) => f.id === "openai-api-key")).toBe(true)
    })
  })

  describe("#given private key block in content", () => {
    it("detects the block", () => {
      // given
      const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA..."
      // when
      const findings = scanFileForSecrets(content, "id_rsa")
      // then
      expect(findings.some((f) => f.id === "private-key-block")).toBe(true)
    })
  })

  describe("#given database URL with credentials", () => {
    it("detects the credentials", () => {
      // given
      const content = 'const url = "postgres://user:password@localhost:5432/db"'
      // when
      const findings = scanFileForSecrets(content, "config.ts")
      // then
      expect(findings.some((f) => f.id === "database-url-with-creds")).toBe(true)
    })
  })

  describe("#given clean content", () => {
    it("returns no findings", () => {
      // given
      const content = 'const greeting = "hello world"'
      // when
      const findings = scanFileForSecrets(content, "clean.ts")
      // then
      expect(findings).toHaveLength(0)
    })
  })

  describe("#given a line number", () => {
    it("reports correct line number", () => {
      // given
      const content = 'const a = 1\nconst b = 2\nconst key = "AKIAIOSFODNN7EXAMPLE"'
      // when
      const findings = scanFileForSecrets(content, "config.ts")
      // then
      expect(findings[0].line).toBe(3)
    })
  })
})

describe("shouldScanFile", () => {
  it("skips lock files", () => {
    expect(shouldScanFile("package-lock.json")).toBe(false)
    expect(shouldScanFile("bun.lock")).toBe(false)
    expect(shouldScanFile("yarn.lock")).toBe(false)
  })

  it("skips minified files", () => {
    expect(shouldScanFile("bundle.min.js")).toBe(false)
  })

  it("scans normal source files", () => {
    expect(shouldScanFile("config.ts")).toBe(true)
    expect(shouldScanFile("index.js")).toBe(true)
  })
})

describe("SECRET_PATTERNS integrity", () => {
  it("has at least 10 patterns", () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(10)
  })

  it("has unique IDs", () => {
    const ids = SECRET_PATTERNS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
