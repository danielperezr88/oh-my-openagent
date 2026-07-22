import { describe, expect, test } from "bun:test"
import {
	formatAnalyzeResult,
	formatReplaceResult,
	formatSearchResult,
	formatTransformResult,
} from "./result-formatter"
import type { AnalyzeResult, CliMatch, SgResult } from "./types"

function makeCliMatch(overrides: Partial<CliMatch> = {}): CliMatch {
	return {
		text: "console.log($MSG)",
		range: {
			byteOffset: { start: 0, end: 20 },
			start: { line: 3, column: 7 },
			end: { line: 3, column: 27 },
		},
		file: "src/app.ts",
		lines: "    console.log('hello')\n",
		charCount: { leading: 4, trailing: 1 },
		language: "typescript",
		...overrides,
	}
}

function makeSgResult(overrides: Partial<SgResult> = {}): SgResult {
	return {
		matches: [],
		totalMatches: 0,
		truncated: false,
		...overrides,
	}
}

function makeAnalyzeResult(overrides: Partial<AnalyzeResult> = {}): AnalyzeResult {
	return {
		text: "someNode",
		range: {
			start: { line: 2, column: 0 },
			end: { line: 2, column: 8 },
		},
		kind: "identifier",
		metaVariables: [],
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// formatSearchResult
// ---------------------------------------------------------------------------
describe("formatSearchResult", () => {
	test("returns error message when result has an error", () => {
		const result = makeSgResult({ error: "something went wrong" })
		const output = formatSearchResult(result)
		expect(output).toBe("Error: something went wrong")
	})

	test('returns "No matches found" for empty matches', () => {
		const result = makeSgResult()
		const output = formatSearchResult(result)
		expect(output).toBe("No matches found")
	})

	test("shows [TRUNCATED] with max_matches reason", () => {
		const matches = [makeCliMatch()]
		const result = makeSgResult({
			matches,
			totalMatches: 600,
			truncated: true,
			truncatedReason: "max_matches",
		})
		const output = formatSearchResult(result)
		expect(output).toContain("[TRUNCATED]")
		expect(output).toContain("showing first 1 of 600")
	})

	test("shows [TRUNCATED] with timeout reason", () => {
		const matches = [makeCliMatch()]
		const result = makeSgResult({
			matches,
			totalMatches: 1,
			truncated: true,
			truncatedReason: "timeout",
		})
		const output = formatSearchResult(result)
		expect(output).toContain("[TRUNCATED]")
		expect(output).toContain("search timed out")
	})

	test("shows [TRUNCATED] with max_output_bytes reason", () => {
		const matches = [makeCliMatch()]
		const result = makeSgResult({
			matches,
			totalMatches: 1,
			truncated: true,
			truncatedReason: "max_output_bytes",
		})
		const output = formatSearchResult(result)
		expect(output).toContain("[TRUNCATED]")
		expect(output).toContain("output exceeded 1MB limit")
	})

	test("formats normal result with file:line:col and match lines", () => {
		const match = makeCliMatch({
			file: "src/utils.ts",
			range: {
				byteOffset: { start: 0, end: 10 },
				start: { line: 9, column: 4 },
				end: { line: 9, column: 14 },
			},
			lines: "  foo()\n",
		})
		const result = makeSgResult({ matches: [match], totalMatches: 1 })
		const output = formatSearchResult(result)

		// line+1=10, column+1=5
		expect(output).toContain("src/utils.ts:10:5")
		expect(output).toContain("foo()")
		expect(output).toContain("Found 1 match(es)")
	})

	test("formats multiple matches correctly", () => {
		const match1 = makeCliMatch({ file: "a.ts", lines: "aaa\n" })
		const match2 = makeCliMatch({ file: "b.ts", lines: "bbb\n" })
		const result = makeSgResult({ matches: [match1, match2], totalMatches: 2 })
		const output = formatSearchResult(result)

		expect(output).toContain("Found 2 match(es)")
		expect(output).toContain("a.ts:")
		expect(output).toContain("aaa")
		expect(output).toContain("b.ts:")
		expect(output).toContain("bbb")
	})
})

// ---------------------------------------------------------------------------
// formatReplaceResult
// ---------------------------------------------------------------------------
describe("formatReplaceResult", () => {
	test("returns error message when result has an error", () => {
		const result = makeSgResult({ error: "replace failed" })
		const output = formatReplaceResult(result, false)
		expect(output).toBe("Error: replace failed")
	})

	test('returns "No matches found to replace" for empty matches', () => {
		const result = makeSgResult()
		const output = formatReplaceResult(result, false)
		expect(output).toBe("No matches found to replace")
	})

	test("includes [DRY RUN] prefix and hint when isDryRun is true", () => {
		const match = makeCliMatch({ file: "a.ts", text: "newText" })
		const result = makeSgResult({ matches: [match], totalMatches: 1 })
		const output = formatReplaceResult(result, true)

		expect(output).toContain("[DRY RUN]")
		expect(output).toContain("Use dryRun=false to apply changes")
		expect(output).toContain("1 replacement(s)")
	})

	test("does not include [DRY RUN] when isDryRun is false", () => {
		const match = makeCliMatch({ file: "a.ts", text: "newText" })
		const result = makeSgResult({ matches: [match], totalMatches: 1 })
		const output = formatReplaceResult(result, false)

		expect(output).not.toContain("[DRY RUN]")
		expect(output).not.toContain("dryRun=false")
		expect(output).toContain("1 replacement(s)")
	})

	test("shows replacement text using match.text field", () => {
		const match = makeCliMatch({ file: "src/app.ts", text: "replacedCode()" })
		const result = makeSgResult({ matches: [match], totalMatches: 1 })
		const output = formatReplaceResult(result, false)

		expect(output).toContain("replacedCode()")
	})

	test("shows file location for each replacement", () => {
		const match = makeCliMatch({
			file: "src/main.ts",
			range: {
				byteOffset: { start: 0, end: 10 },
				start: { line: 14, column: 2 },
				end: { line: 14, column: 12 },
			},
		})
		const result = makeSgResult({ matches: [match], totalMatches: 1 })
		const output = formatReplaceResult(result, false)

		// line+1=15, column+1=3
		expect(output).toContain("src/main.ts:15:3")
	})
})

// ---------------------------------------------------------------------------
// formatAnalyzeResult
// ---------------------------------------------------------------------------
describe("formatAnalyzeResult", () => {
	test('returns "No matches found" for empty results', () => {
		const output = formatAnalyzeResult([], false)
		expect(output).toBe("No matches found")
	})

	test("shows kind and text without metavariables when extractedMetaVars is false", () => {
		const result = makeAnalyzeResult({
			text: "myFunc",
			kind: "function_declaration",
			metaVariables: [{ name: "NAME", text: "myFunc", kind: "identifier" }],
		})
		const output = formatAnalyzeResult([result], false)

		expect(output).toContain("Found 1 match(es)")
		expect(output).toContain("(function_declaration)")
		expect(output).toContain("myFunc")
		// Should NOT show meta-variables
		expect(output).not.toContain("Meta-variables")
		expect(output).not.toContain("$NAME")
	})

	test("shows metavariables when extractedMetaVars is true", () => {
		const result = makeAnalyzeResult({
			text: "myFunc",
			kind: "function_declaration",
			metaVariables: [
				{ name: "NAME", text: "myFunc", kind: "identifier" },
			],
			range: {
				start: { line: 0, column: 0 },
				end: { line: 0, column: 6 },
			},
		})
		const output = formatAnalyzeResult([result], true)

		expect(output).toContain("Meta-variables")
		expect(output).toContain('$NAME = "myFunc" (identifier)')
	})

	test("does not show metavariable section when extractedMetaVars is true but no metavars", () => {
		const result = makeAnalyzeResult({
			text: "x",
			kind: "identifier",
			metaVariables: [],
		})
		const output = formatAnalyzeResult([result], true)

		expect(output).not.toContain("Meta-variables")
	})

	test("formats location as L{line+1}:{col+1}", () => {
		const result = makeAnalyzeResult({
			range: {
				start: { line: 4, column: 9 },
				end: { line: 4, column: 15 },
			},
		})
		const output = formatAnalyzeResult([result], false)
		// line+1=5, column+1=10
		expect(output).toContain("[L5:10]")
	})

	test("formats multiple analyze results", () => {
		const r1 = makeAnalyzeResult({ text: "alpha", kind: "identifier" })
		const r2 = makeAnalyzeResult({ text: "beta", kind: "string" })
		const output = formatAnalyzeResult([r1, r2], false)

		expect(output).toContain("Found 2 match(es)")
		expect(output).toContain("alpha")
		expect(output).toContain("beta")
	})
})

// ---------------------------------------------------------------------------
// formatTransformResult
// ---------------------------------------------------------------------------
describe("formatTransformResult", () => {
	test('returns "No matches found to transform" when editCount is 0', () => {
		const output = formatTransformResult("original", "original", 0)
		expect(output).toBe("No matches found to transform")
	})

	test("returns transformed code with edit count in code block", () => {
		const output = formatTransformResult("let x = 1", "const x = 1", 1)
		expect(output).toContain("Transformed (1 edit(s))")
		expect(output).toContain("```")
		expect(output).toContain("const x = 1")
	})

	test("includes the transformed string inside the code block", () => {
		const transformed = "function hello() { return 42; }"
		const output = formatTransformResult("old code", transformed, 3)
		expect(output).toContain("3 edit(s)")
		expect(output).toContain(transformed)
	})

	test("does not include original code in output", () => {
		const original = "let x = 1"
		const transformed = "const x = 1"
		const output = formatTransformResult(original, transformed, 1)
		// Original should not appear in the formatted output
		expect(output).not.toMatch(/\blet x = 1\b/)
		expect(output).toContain(transformed)
	})
})
