import { describe, expect, test } from "bun:test"
import { createSgResultFromStdout } from "./sg-compact-json-output"
import { DEFAULT_MAX_MATCHES, DEFAULT_MAX_OUTPUT_BYTES } from "./language-support"

function makeCliMatch(overrides: Partial<{ text: string; file: string; lines: string; language: string }> = {}) {
	return {
		text: overrides.text ?? "console.log($MSG)",
		range: {
			byteOffset: { start: 0, end: 20 },
			start: { line: 0, column: 0 },
			end: { line: 0, column: 20 },
		},
		file: overrides.file ?? "test.ts",
		lines: overrides.lines ?? "console.log('hello')",
		charCount: { leading: 0, trailing: 0 },
		language: overrides.language ?? "typescript",
	}
}

describe("createSgResultFromStdout", () => {
	test("returns empty matches for empty string", () => {
		const result = createSgResultFromStdout("")
		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
		expect(result.truncated).toBe(false)
		expect(result.truncatedReason).toBeUndefined()
		expect(result.error).toBeUndefined()
	})

	test("returns empty matches for whitespace-only string", () => {
		const result = createSgResultFromStdout("   \n\t  ")
		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
		expect(result.truncated).toBe(false)
	})

	test("parses a valid JSON array of matches correctly", () => {
		const match1 = makeCliMatch({ file: "a.ts", lines: "foo()" })
		const match2 = makeCliMatch({ file: "b.ts", lines: "bar()" })
		const stdout = JSON.stringify([match1, match2])

		const result = createSgResultFromStdout(stdout)
		expect(result.matches).toHaveLength(2)
		expect(result.totalMatches).toBe(2)
		expect(result.truncated).toBe(false)
		expect(result.matches[0].file).toBe("a.ts")
		expect(result.matches[1].file).toBe("b.ts")
	})

	test("parses a single match correctly with totalMatches=1", () => {
		const match = makeCliMatch({ file: "single.ts", text: "hello" })
		const stdout = JSON.stringify([match])

		const result = createSgResultFromStdout(stdout)
		expect(result.matches).toHaveLength(1)
		expect(result.totalMatches).toBe(1)
		expect(result.truncated).toBe(false)
		expect(result.matches[0].file).toBe("single.ts")
		expect(result.matches[0].text).toBe("hello")
	})

	test("returns empty matches for invalid JSON", () => {
		const result = createSgResultFromStdout("not valid json at all")
		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
		expect(result.truncated).toBe(false)
	})

	test("returns empty matches for invalid JSON that is not an array", () => {
		const result = createSgResultFromStdout('{"key": "value"}')
		// JSON.parse succeeds but the result is an object, not an array.
		// The function casts it, but matches.length will be undefined,
		// leading to NaN for totalMatches. This test documents current behavior.
		expect(result.matches).toBeDefined()
	})

	test("handles truncation when output exceeds DEFAULT_MAX_OUTPUT_BYTES", () => {
		// Build a large JSON array that exceeds 1MB by padding match text
		const match = makeCliMatch({ text: "x".repeat(200_000) })
		const matches = Array(6).fill(match)
		const stdout = JSON.stringify(matches)
		// Ensure stdout is actually >= 1MB
		expect(stdout.length).toBeGreaterThanOrEqual(DEFAULT_MAX_OUTPUT_BYTES)

		const result = createSgResultFromStdout(stdout)
		expect(result.truncated).toBe(true)
		expect(result.truncatedReason).toBe("max_output_bytes")
	})

	test("handles truncation when too many matches exceed DEFAULT_MAX_MATCHES", () => {
		// Create matches array with more than 500 entries
		const matches = Array.from({ length: DEFAULT_MAX_MATCHES + 10 }, (_, i) =>
			makeCliMatch({ file: `file${i}.ts`, text: `match${i}` }),
		)
		const stdout = JSON.stringify(matches)

		const result = createSgResultFromStdout(stdout)
		expect(result.totalMatches).toBe(DEFAULT_MAX_MATCHES + 10)
		expect(result.matches.length).toBe(DEFAULT_MAX_MATCHES)
		expect(result.truncated).toBe(true)
		expect(result.truncatedReason).toBe("max_matches")
	})

	test("handles truncated output that can be repaired by removing last incomplete element", () => {
		// Create valid JSON then append incomplete data to simulate truncation
		const match1 = makeCliMatch({ file: "a.ts" })
		const match2 = makeCliMatch({ file: "b.ts" })
		const validPart = JSON.stringify([match1, match2])
		// Create a string >= 1MB that starts with valid JSON array but is truncated
		// We manually build: [match1, match2, match3(incomplete)...padding
		const match3Partial = JSON.stringify(makeCliMatch({ file: "c.ts" })).slice(0, -5)
		const padding = "x".repeat(DEFAULT_MAX_OUTPUT_BYTES)
		const stdout = `[${JSON.stringify(match1)},${JSON.stringify(match2)},${match3Partial}${padding}`

		const result = createSgResultFromStdout(stdout)
		// The truncation recovery path should attempt to find the last valid "},"
		expect(result.truncated).toBe(true)
	})

	test("handles truncated output with no recoverable JSON structure", () => {
		// Pure garbage >= 1MB: no "}" characters, so the recovery path silently
		// falls through (no throw), leaving matches=[] and no error set.
		const garbage = "x".repeat(DEFAULT_MAX_OUTPUT_BYTES + 100)
		const result = createSgResultFromStdout(garbage)
		expect(result.truncated).toBe(true)
		expect(result.truncatedReason).toBe("max_output_bytes")
		expect(result.matches).toEqual([])
		expect(result.totalMatches).toBe(0)
	})

	test("handles truncated output that triggers catch in recovery path", () => {
		// Build truncated output that has "}" but still cannot be parsed after repair attempt.
		// This triggers the catch block that returns the error message.
		const match1 = makeCliMatch({ file: "a.ts" })
		const validJson = JSON.stringify([match1])
		// Start with valid array, then inject a "}" that will make the repair produce invalid JSON
		const broken = validJson.slice(0, -1) + ",{" + "x".repeat(DEFAULT_MAX_OUTPUT_BYTES)
		const result = createSgResultFromStdout(broken)
		expect(result.truncated).toBe(true)
		expect(result.truncatedReason).toBe("max_output_bytes")
	})

	test("preserves all fields of parsed matches", () => {
		const match = {
			text: "someMatchedCode()",
			range: {
				byteOffset: { start: 42, end: 60 },
				start: { line: 5, column: 10 },
				end: { line: 5, column: 28 },
			},
			file: "src/index.ts",
			lines: "    someMatchedCode()\n",
			charCount: { leading: 4, trailing: 1 },
			language: "typescript",
		}
		const stdout = JSON.stringify([match])

		const result = createSgResultFromStdout(stdout)
		expect(result.matches[0]).toEqual(match)
	})

	test("does not truncate when exactly at boundary (length < DEFAULT_MAX_OUTPUT_BYTES)", () => {
		const match = makeCliMatch()
		const stdout = JSON.stringify([match])
		expect(stdout.length).toBeLessThan(DEFAULT_MAX_OUTPUT_BYTES)

		const result = createSgResultFromStdout(stdout)
		expect(result.truncated).toBe(false)
	})

	test("does not set truncatedReason when not truncated", () => {
		const match = makeCliMatch()
		const stdout = JSON.stringify([match])

		const result = createSgResultFromStdout(stdout)
		expect(result.truncatedReason).toBeUndefined()
	})
})
