import { describe, expect, test } from "bun:test"
import { createV2PluginDefinition } from "./plugin-definition"
import { formatInstinctsForSystem } from "./instinct-injection"

describe("createV2PluginDefinition", () => {
  describe("#given the v2 adapter definition", () => {
    test("#then it exposes the V2 plugin contract", () => {
      // given / when
      const definition = createV2PluginDefinition()

      // then
      expect(definition.id).toBe("oh-my-openagent")
      expect(typeof definition.setup).toBe("function")
    })
  })
})

describe("formatInstinctsForSystem", () => {
  describe("#given selected instincts", () => {
    test("#then the system block lists trigger and action with a confidence bar", () => {
      // given
      const top = [
        {
          instinct: {
            confidence: 0.8,
            trigger: "when writing new functions",
            content: "## Action\nUse functional patterns over classes",
          },
        },
      ]

      // when
      const block = formatInstinctsForSystem(top)

      // then
      expect(block).toContain("[Learned Patterns - 1 active]")
      expect(block).toContain("(0.80)")
      expect(block).toContain("when writing new functions")
      expect(block).toContain("Use functional patterns over classes")
    })
  })
})
