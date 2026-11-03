/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { checkNetwork, type NetworkCheckDeps } from "./network"

const LOCAL_CONFIG = JSON.stringify({
  plugins: [{ package: "file:///opt/oh-my-openagent/dist", options: {} }],
})
const REGISTRY_CONFIG = JSON.stringify({ plugin: ["oh-my-openagent"] })
const NO_OMO_CONFIG = JSON.stringify({ model: "some-model" })

function okFetch(): typeof fetch {
  return (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch
}

function brokenFetch(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input))
    throw new Error("connect ECONNREFUSED")
  }) as unknown as typeof fetch
}

function recordingFetch(calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input))
    return new Response("{}", { status: 200 })
  }) as unknown as typeof fetch
}

describe("checkNetwork", () => {
  it("skips when no omo plugin entry is registered", async () => {
    const deps: NetworkCheckDeps = { configContent: NO_OMO_CONFIG, env: {}, fetchImpl: okFetch() }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("skip")
    expect(result.issues).toEqual([])
  })

  it("passes for a local file:// plugin when all endpoints are reachable", async () => {
    const calls: string[] = []
    const deps: NetworkCheckDeps = { configContent: LOCAL_CONFIG, env: {}, fetchImpl: recordingFetch(calls) }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("pass")
    expect(result.details.join("\n")).toContain("registry probe skipped")
    expect(calls).toHaveLength(1) // only models.dev is probed; the registry is not needed
    expect(calls[0]).toContain("models.dev")
  })

  it("fails when a registry-resolved plugin cannot reach the registry", async () => {
    const calls: string[] = []
    const deps: NetworkCheckDeps = { configContent: REGISTRY_CONFIG, env: {}, fetchImpl: brokenFetch(calls) }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("fail")
    const registryIssue = result.issues.find((issue) => issue.title.includes("registry is unreachable"))
    expect(registryIssue).toBeDefined()
    expect(registryIssue?.fix).toContain("file://")
    expect(calls.some((url) => url.includes("registry.npmjs.org"))).toBe(true)
  })

  it("passes for a registry-resolved plugin when the registry is reachable", async () => {
    const deps: NetworkCheckDeps = { configContent: REGISTRY_CONFIG, env: {}, fetchImpl: okFetch() }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("pass")
    expect(result.message).toContain("registry ok")
  })

  it("warns when models.dev is unreachable", async () => {
    const modelsDevOnly: typeof fetch = (async (input: string | URL | Request) => {
      if (String(input).includes("models.dev")) throw new Error("blocked")
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    const deps: NetworkCheckDeps = { configContent: LOCAL_CONFIG, env: {}, fetchImpl: modelsDevOnly }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("warn")
    const issue = result.issues.find((candidate) => candidate.title.includes("models.dev is unreachable"))
    expect(issue?.severity).toBe("warning")
  })

  it("warns on an empty-string proxy variable", async () => {
    const deps: NetworkCheckDeps = {
      configContent: LOCAL_CONFIG,
      env: { HTTP_PROXY: "" },
      fetchImpl: okFetch(),
    }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("warn")
    const issue = result.issues.find((candidate) => candidate.title.includes("HTTP_PROXY"))
    expect(issue?.title).toContain("set but empty")
  })

  it("warns on a proxy variable missing its URL scheme", async () => {
    const deps: NetworkCheckDeps = {
      configContent: LOCAL_CONFIG,
      env: { HTTPS_PROXY: "proxy.corp.example:8080" },
      fetchImpl: okFetch(),
    }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("warn")
    const issue = result.issues.find((candidate) => candidate.title.includes("HTTPS_PROXY"))
    expect(issue?.title).toContain("missing URL scheme")
    expect(issue?.fix).toContain("http://proxy.corp.example:8080")
  })

  it("passes with well-formed proxy variables and no issues", async () => {
    const deps: NetworkCheckDeps = {
      configContent: LOCAL_CONFIG,
      env: { HTTP_PROXY: "http://proxy.corp.example:8080", NO_PROXY: "localhost,127.0.0.1" },
      fetchImpl: okFetch(),
    }
    const result = await checkNetwork(deps)
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
    expect(result.details.join("\n")).toContain("NO_PROXY=localhost,127.0.0.1")
  })
})
