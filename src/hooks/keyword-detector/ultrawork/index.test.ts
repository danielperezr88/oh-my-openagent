/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { getUltraworkMessage } from "./index"

// ---------------------------------------------------------------------------
// getUltraworkMessage — routing based on source-detector results
// ---------------------------------------------------------------------------

describe("getUltraworkMessage", () => {
  it("#given planner agentName #when fetched #then returns planner ultrawork message", () => {
    const msg = getUltraworkMessage("prometheus", undefined)
    expect(msg).toContain("PLANNER")
    expect(msg).toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })

  it("#given planner agentName with gpt model #when fetched #then still returns planner message (planner priority)", () => {
    const msg = getUltraworkMessage("prometheus", "gpt-5.4")
    expect(msg).toContain("PLANNER")
    expect(msg).not.toContain("output_verbosity_spec")
  })

  it("#given non-planner agentName with gpt modelID #when fetched #then returns gpt ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", "gpt-5.4")
    expect(msg).toContain("output_verbosity_spec")
  })

  it("#given non-planner agentName with provider-prefixed gpt modelID #when fetched #then returns gpt ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", "openai/gpt-5.4")
    expect(msg).toContain("output_verbosity_spec")
  })

  it("#given non-planner agentName with gemini modelID #when fetched #then returns gemini ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", "gemini-2.5-pro")
    expect(msg).toContain("GEMINI_INTENT_GATE")
  })

  it("#given non-planner agentName with google/ gemini modelID #when fetched #then returns gemini ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", "google/gemini-2.5-flash")
    expect(msg).toContain("GEMINI_INTENT_GATE")
  })

  it("#given no agentName with gemini modelID #when fetched #then returns gemini ultrawork message", () => {
    const msg = getUltraworkMessage(undefined, "gemini-2.5-pro")
    expect(msg).toContain("GEMINI_INTENT_GATE")
  })

  it("#given no agentName and no modelID #when fetched #then returns default ultrawork message", () => {
    const msg = getUltraworkMessage(undefined, undefined)
    expect(msg).toContain("ABSOLUTE CERTAINTY")
  })

  it("#given non-planner agentName with non-gpt non-gemini modelID #when fetched #then returns default ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", "claude-sonnet-4")
    expect(msg).toContain("ABSOLUTE CERTAINTY")
  })

  it("#given non-planner agentName with no modelID #when fetched #then returns default ultrawork message", () => {
    const msg = getUltraworkMessage("sisyphus", undefined)
    expect(msg).toContain("ABSOLUTE CERTAINTY")
  })

  it("#given default message #when fetched #then contains plan agent invocation mandate", () => {
    const msg = getUltraworkMessage("sisyphus", "claude-sonnet-4")
    expect(msg).toContain("PLAN AGENT INVOCATION")
  })

  it("#given gemini message #when fetched #then contains anti-optimism checkpoint", () => {
    const msg = getUltraworkMessage("sisyphus", "gemini-2.5-pro")
    expect(msg).toContain("ANTI_OPTIMISM_CHECKPOINT")
  })

  it("#given any message #when fetched #then always contains ultrawork-mode tag", () => {
    const planner = getUltraworkMessage("prometheus", undefined)
    const gpt = getUltraworkMessage("sisyphus", "gpt-5.4")
    const gemini = getUltraworkMessage("sisyphus", "gemini-2.5-pro")
    const default_ = getUltraworkMessage("sisyphus", "claude-sonnet-4")

    for (const msg of [planner, gpt, gemini, default_]) {
      expect(msg).toContain("<ultrawork-mode>")
      expect(msg).toContain("</ultrawork-mode>")
      expect(msg).toContain("ULTRAWORK MODE ENABLED")
    }
  })
})
