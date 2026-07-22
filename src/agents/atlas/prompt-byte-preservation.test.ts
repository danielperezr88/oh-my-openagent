import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { createAtlasAgent, type AtlasPromptSource, type OrchestratorContext } from "./agent"

type VariantPromptCase = {
  readonly variant: AtlasPromptSource
  readonly model: string
  readonly expectedHash: string
  readonly expectedLength: number
}

const BASE_CONTEXT = {
  availableAgents: [
    {
      name: "oracle",
      description: "Read-only architecture reviewer",
      metadata: {
        category: "advisor",
        cost: "EXPENSIVE",
        triggers: [{ domain: "Architecture", trigger: "Need design review" }],
        promptAlias: "Oracle",
      },
    },
    {
      name: "explore",
      description: "Fast codebase searcher",
      metadata: {
        category: "exploration",
        cost: "CHEAP",
        triggers: [{ domain: "Code search", trigger: "Need repository context" }],
        promptAlias: "Explore",
      },
    },
  ],
  availableSkills: [
    {
      name: "programming",
      description: "Strict TypeScript implementation discipline",
      location: "user",
    },
    {
      name: "git-master",
      description: "Atomic git operations",
      location: "plugin",
    },
    {
      name: "frontend-ui-ux",
      description: "Premium UI guidance",
      location: "project",
    },
  ],
  userCategories: {
    custom: { description: "Custom deterministic category", temperature: 0.7 },
    quick: { description: "User quick override", temperature: 0.2 },
  },
} satisfies OrchestratorContext

const VARIANT_PROMPT_CASES = [
  {
    variant: "default",
    model: "anthropic/claude-sonnet-4-6",
    expectedHash: "23dd2e71568eba671c430f45568913d2729afcc40f3246d5910ef970b80f4e34",
    expectedLength: 26817,
  },
  {
    variant: "gpt",
    model: "openai/gpt-5.5",
    expectedHash: "da0b2894650d32b2c935497c3084e2459b8ced5170054a2c15e8ff50664bf8bc",
    expectedLength: 25635,
  },
  {
    variant: "gemini",
    model: "google/gemini-3.1-pro",
    expectedHash: "a78a18db91adf39c71c41f510894c31685b36590d6f21408803e8a12e546a8b2",
    expectedLength: 28572,
  },
  {
    variant: "kimi",
    model: "moonshotai/kimi-k2.6",
    expectedHash: "256164b99497aad5a6bfc448cfe759b1286f8caa7507e9a1456646dd6b4d924c",
    expectedLength: 27052,
  },
  {
    variant: "opus-4-7",
    model: "anthropic/claude-opus-4-7",
    expectedHash: "7e4732b7fa4343bc2ac8102f0a39d940c85ffcff8c04682da2ac62d44ebb18e1",
    expectedLength: 27690,
  },
] satisfies readonly VariantPromptCase[]

const RUNTIME_PLACEHOLDERS = [
  "{CATEGORY_SECTION}",
  "{AGENT_SECTION}",
  "{DECISION_MATRIX}",
  "{SKILLS_SECTION}",
  "{{CATEGORY_SKILLS_DELEGATION_GUIDE}}",
] as const

describe("Atlas prompt byte preservation", () => {
  for (const promptCase of VARIANT_PROMPT_CASES) {
    test(`#given ${promptCase.variant} model #when Atlas prompt renders #then hash matches the baseline`, () => {
      const prompt = getAtlasPromptText({ ...BASE_CONTEXT, model: promptCase.model })

      expect(createHash("sha256").update(prompt).digest("hex")).toBe(promptCase.expectedHash)
      expect(prompt.length).toBe(promptCase.expectedLength)
    })
  }
})

describe("Atlas prompt runtime section injection", () => {
  test("#given unique live context markers #when prompt renders #then placeholders are resolved", () => {
    const prompt = getAtlasPromptText({
      model: "anthropic/claude-sonnet-4-6",
      availableAgents: [
        {
          name: "unique-agent-section-marker",
          description: "UNIQUE_AGENT_SECTION_VALUE",
          metadata: {
            category: "advisor",
            cost: "EXPENSIVE",
            triggers: [{ domain: "Runtime", trigger: "Unique agent marker" }],
          },
        },
      ],
      availableSkills: [
        {
          name: "unique-guide-skill-marker",
          description: "Unique guide skill marker",
          location: "user",
        },
      ],
      userCategories: {
        "unique-category-section-marker": {
          description: "UNIQUE_CATEGORY_SECTION_VALUE",
          temperature: 0.4,
        },
      },
    })

    expect(prompt).toContain("UNIQUE_CATEGORY_SECTION_VALUE")
    expect(prompt).toContain("UNIQUE_AGENT_SECTION_VALUE")
    expect(prompt).toContain("unique-guide-skill-marker")
    for (const placeholder of RUNTIME_PLACEHOLDERS) {
      expect(prompt).not.toContain(placeholder)
    }
  })
})

function getAtlasPromptText(ctx: OrchestratorContext): string {
  const prompt = createAtlasAgent(ctx).prompt
  if (typeof prompt === "string") return prompt
  throw new TypeError("Atlas prompt must be a string")
}
