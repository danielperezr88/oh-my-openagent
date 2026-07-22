/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import {
  isPlannerAgent,
  isNonOmoAgent,
  isGptModel,
  isGeminiModel,
  getUltraworkSource,
} from "./source-detector"

// ---------------------------------------------------------------------------
// isPlannerAgent
// ---------------------------------------------------------------------------

describe("isPlannerAgent", () => {
  it("#given undefined agentName #when checked #then returns false", () => {
    expect(isPlannerAgent(undefined)).toBe(false)
  })

  it("#given empty string agentName #when checked #then returns false", () => {
    expect(isPlannerAgent("")).toBe(false)
  })

  it("#given agentName containing 'prometheus' #when checked #then returns true", () => {
    expect(isPlannerAgent("prometheus")).toBe(true)
  })

  it("#given agentName containing 'Prometheus' (mixed case) #when checked #then returns true", () => {
    expect(isPlannerAgent("Prometheus")).toBe(true)
  })

  it("#given agentName containing 'PROMETHEUS' (uppercase) #when checked #then returns true", () => {
    expect(isPlannerAgent("PROMETHEUS")).toBe(true)
  })

  it("#given agentName containing 'planner' #when checked #then returns true", () => {
    expect(isPlannerAgent("my-planner")).toBe(true)
  })

  it("#given agentName containing 'Planner' (mixed case) #when checked #then returns true", () => {
    expect(isPlannerAgent("My-Planner-Agent")).toBe(true)
  })

  it("#given agentName 'planner-agent' #when checked #then returns true", () => {
    expect(isPlannerAgent("planner-agent")).toBe(true)
  })

  it("#given agentName 'plan_agent' (normalized to 'plan agent') #when checked #then returns true (word boundary match)", () => {
    expect(isPlannerAgent("plan_agent")).toBe(true)
  })

  it("#given agentName 'plan-agent' (normalized to 'plan agent') #when checked #then returns true (word boundary match)", () => {
    expect(isPlannerAgent("plan-agent")).toBe(true)
  })

  it("#given agentName 'my-plan' (normalized with word boundary) #when checked #then returns true", () => {
    expect(isPlannerAgent("my-plan")).toBe(true)
  })

  it("#given agentName 'planning' #when checked #then returns false (no word boundary match)", () => {
    expect(isPlannerAgent("planning")).toBe(false)
  })

  it("#given agentName 'supersonic' #when checked #then returns false", () => {
    expect(isPlannerAgent("supersonic")).toBe(false)
  })

  it("#given agentName 'some_random_agent' #when checked #then returns false", () => {
    expect(isPlannerAgent("some_random_agent")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isNonOmoAgent
// ---------------------------------------------------------------------------

describe("isNonOmoAgent", () => {
  it("#given undefined agentName #when checked #then returns false", () => {
    expect(isNonOmoAgent(undefined)).toBe(false)
  })

  it("#given empty string agentName #when checked #then returns false", () => {
    expect(isNonOmoAgent("")).toBe(false)
  })

  it("#given agentName 'builder' #when checked #then returns true", () => {
    expect(isNonOmoAgent("builder")).toBe(true)
  })

  it("#given agentName 'my-builder' #when checked #then returns true (contains 'builder')", () => {
    expect(isNonOmoAgent("my-builder")).toBe(true)
  })

  it("#given agentName 'Builder' (capitalized) #when checked #then returns true (case insensitive)", () => {
    expect(isNonOmoAgent("Builder")).toBe(true)
  })

  it("#given agentName 'plan' #when checked #then returns true (exact match)", () => {
    expect(isNonOmoAgent("plan")).toBe(true)
  })

  it("#given agentName 'Plan' #when checked #then returns false (case-sensitive exact match)", () => {
    // lowerName === "plan" but lowerName === "plan" is checked against "plan"
    // Wait: the function lowercases first, then checks. "Plan".toLowerCase() === "plan"
    // So this should actually be true. Let's re-read the source:
    // const lowerName = agentName.toLowerCase()
    // return lowerName.includes("builder") || lowerName === "plan"
    // "Plan".toLowerCase() === "plan" === "plan" -> true
    expect(isNonOmoAgent("Plan")).toBe(true)
  })

  it("#given agentName 'planner' #when checked #then returns false (not exact 'plan')", () => {
    expect(isNonOmoAgent("planner")).toBe(false)
  })

  it("#given agentName 'plan-agent' #when checked #then returns false (not exact 'plan')", () => {
    expect(isNonOmoAgent("plan-agent")).toBe(false)
  })

  it("#given agentName 'thebuilder' #when checked #then returns true (includes 'builder')", () => {
    expect(isNonOmoAgent("thebuilder")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isGptModel
// ---------------------------------------------------------------------------

describe("isGptModel", () => {
  it("#given model 'gpt-4o' #when checked #then returns true", () => {
    expect(isGptModel("gpt-4o")).toBe(true)
  })

  it("#given model 'openai/gpt-5.4' #when checked #then returns true (extracts after /)", () => {
    expect(isGptModel("openai/gpt-5.4")).toBe(true)
  })

  it("#given model 'claude-sonnet-4' #when checked #then returns false", () => {
    expect(isGptModel("claude-sonnet-4")).toBe(false)
  })

  it("#given model 'GPT-4o' (uppercase) #when checked #then returns true (case insensitive)", () => {
    expect(isGptModel("GPT-4o")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// isGeminiModel
// ---------------------------------------------------------------------------

describe("isGeminiModel", () => {
  it("#given model 'google/gemini-2.5-pro' #when checked #then returns true (google/ prefix)", () => {
    expect(isGeminiModel("google/gemini-2.5-pro")).toBe(true)
  })

  it("#given model 'google-vertex/gemini-2.5-flash' #when checked #then returns true (google-vertex/ prefix)", () => {
    expect(isGeminiModel("google-vertex/gemini-2.5-flash")).toBe(true)
  })

  it("#given model 'github-copilot/gemini-2.5-pro' #when checked #then returns true (github-copilot/ + gemini prefix)", () => {
    expect(isGeminiModel("github-copilot/gemini-2.5-pro")).toBe(true)
  })

  it("#given model 'github-copilot/gpt-4o' #when checked #then returns false (github-copilot/ but not gemini)", () => {
    expect(isGeminiModel("github-copilot/gpt-4o")).toBe(false)
  })

  it("#given model 'gemini-2.5-pro' #when checked #then returns true (starts with gemini-)", () => {
    expect(isGeminiModel("gemini-2.5-pro")).toBe(true)
  })

  it("#given model 'Gemini-2.5-flash' (capitalized) #when checked #then returns true (case insensitive)", () => {
    expect(isGeminiModel("Gemini-2.5-flash")).toBe(true)
  })

  it("#given model 'claude-sonnet-4' #when checked #then returns false", () => {
    expect(isGeminiModel("claude-sonnet-4")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getUltraworkSource
// ---------------------------------------------------------------------------

describe("getUltraworkSource", () => {
  it("#given planner agentName and no modelID #when resolved #then returns 'planner'", () => {
    expect(getUltraworkSource("prometheus", undefined)).toBe("planner")
  })

  it("#given planner agentName with gpt modelID #when resolved #then returns 'planner' (planner takes priority)", () => {
    expect(getUltraworkSource("prometheus", "gpt-5.4")).toBe("planner")
  })

  it("#given planner agentName with gemini modelID #when resolved #then returns 'planner' (planner takes priority)", () => {
    expect(getUltraworkSource("prometheus", "gemini-2.5-pro")).toBe("planner")
  })

  it("#given non-planner agentName with gpt modelID #when resolved #then returns 'gpt'", () => {
    expect(getUltraworkSource("sisyphus", "gpt-5.4")).toBe("gpt")
  })

  it("#given non-planner agentName with gpt model via provider #when resolved #then returns 'gpt'", () => {
    expect(getUltraworkSource("sisyphus", "openai/gpt-5.4")).toBe("gpt")
  })

  it("#given non-planner agentName with gemini modelID #when resolved #then returns 'gemini'", () => {
    expect(getUltraworkSource("sisyphus", "gemini-2.5-pro")).toBe("gemini")
  })

  it("#given non-planner agentName with google/ gemini model #when resolved #then returns 'gemini'", () => {
    expect(getUltraworkSource("sisyphus", "google/gemini-2.5-pro")).toBe("gemini")
  })

  it("#given no agentName and no modelID #when resolved #then returns 'default'", () => {
    expect(getUltraworkSource(undefined, undefined)).toBe("default")
  })

  it("#given non-planner agentName and no modelID #when resolved #then returns 'default'", () => {
    expect(getUltraworkSource("sisyphus", undefined)).toBe("default")
  })

  it("#given non-planner agentName with non-gpt non-gemini modelID #when resolved #then returns 'default'", () => {
    expect(getUltraworkSource("sisyphus", "claude-sonnet-4")).toBe("default")
  })

  it("#given no agentName with gpt modelID #when resolved #then returns 'gpt'", () => {
    expect(getUltraworkSource(undefined, "gpt-5.4")).toBe("gpt")
  })

  it("#given no agentName with gemini modelID #when resolved #then returns 'gemini'", () => {
    expect(getUltraworkSource(undefined, "gemini-2.5-pro")).toBe("gemini")
  })

  it("#given empty agentName and empty modelID #when resolved #then returns 'default'", () => {
    expect(getUltraworkSource("", "")).toBe("default")
  })
})
