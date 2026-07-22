import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { getOpenCodeCacheDir } from "../../shared/data-path"

describe("auto-update-checker constants", () => {
  it("uses the OpenCode cache directory for installed package metadata", async () => {
    const { CACHE_DIR, INSTALLED_PACKAGE_JSON, PACKAGE_NAME } = await import(`./constants?test=${Date.now()}`)

    expect(CACHE_DIR).toBe(join(getOpenCodeCacheDir(), "packages"))
    expect(INSTALLED_PACKAGE_JSON).toBe(
      join(getOpenCodeCacheDir(), "packages", "node_modules", PACKAGE_NAME, "package.json")
    )
  })

  it("PACKAGE_NAME matches the published package name", async () => {
    // when the auto-update-checker constants are loaded
    const { PACKAGE_NAME } = await import(`./constants?test=${Date.now()}`)

    // then PACKAGE_NAME equals the actually published package name (oh-my-openagent)
    expect(PACKAGE_NAME).toBe("oh-my-openagent")
  })

  it("ACCEPTED_PACKAGE_NAMES contains the published, plugin, and legacy npm names (GH-3257)", async () => {
    const { ACCEPTED_PACKAGE_NAMES } = await import(`./constants?test=${Date.now()}`)

    expect(ACCEPTED_PACKAGE_NAMES).toContain("oh-my-openagent")
    expect(ACCEPTED_PACKAGE_NAMES).toContain("oh-my-openagent")
    expect(ACCEPTED_PACKAGE_NAMES).toContain("oh-my-opencode")
  })

  it("INSTALLED_PACKAGE_JSON_CANDIDATES covers every accepted package name (GH-3257)", async () => {
    const { ACCEPTED_PACKAGE_NAMES, INSTALLED_PACKAGE_JSON_CANDIDATES, CACHE_DIR } = await import(
      `./constants?test=${Date.now()}`
    )

    expect(INSTALLED_PACKAGE_JSON_CANDIDATES).toHaveLength(ACCEPTED_PACKAGE_NAMES.length)
    for (const name of ACCEPTED_PACKAGE_NAMES) {
      expect(INSTALLED_PACKAGE_JSON_CANDIDATES).toContain(
        join(CACHE_DIR, "node_modules", name, "package.json")
      )
    }
  })
})
