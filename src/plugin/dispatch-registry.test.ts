import { describe, it, expect } from "bun:test"
import { createDispatchRegistry } from "./dispatch-registry"

describe("DispatchRegistry", () => {
  it("register + getHandlers round-trip returns registered handlers", () => {
    const registry = createDispatchRegistry()
    const handler = async () => {}
    registry.register("tool.definition", "testHook", handler)

    const handlers = registry.getHandlers("tool.definition")
    expect(handlers).toHaveLength(1)
    expect(handlers[0].name).toBe("testHook")
    expect(handlers[0].handler).toBe(handler)
  })

  it("returns empty array for unregistered stages", () => {
    const registry = createDispatchRegistry()
    const handlers = registry.getHandlers("event")
    expect(handlers).toHaveLength(0)
  })

  it("preserves registration order", () => {
    const registry = createDispatchRegistry()
    const order: string[] = []

    registry.register("event", "first", async () => { order.push("first") })
    registry.register("event", "second", async () => { order.push("second") })
    registry.register("event", "third", async () => { order.push("third") })

    const handlers = registry.getHandlers("event")
    expect(handlers.map(h => h.name)).toEqual(["first", "second", "third"])
  })

  it("includes null handlers in the list", () => {
    const registry = createDispatchRegistry()
    const handler = async () => {}

    registry.register("tool.execute.after", "present", handler)
    registry.register("tool.execute.after", "absent", null)
    registry.register("tool.execute.after", "alsoPresent", handler)

    const handlers = registry.getHandlers("tool.execute.after")
    expect(handlers).toHaveLength(3)
    expect(handlers[0].handler).toBe(handler)
    expect(handlers[1].handler).toBeNull()
    expect(handlers[2].handler).toBe(handler)
  })

  it("isolates different pipeline stages", () => {
    const registry = createDispatchRegistry()
    const eventHandler = async () => {}
    const toolHandler = async () => {}

    registry.register("event", "myHook", eventHandler)
    registry.register("tool.execute.after", "myHook", toolHandler)

    const events = registry.getHandlers("event")
    const tools = registry.getHandlers("tool.execute.after")

    expect(events).toHaveLength(1)
    expect(events[0].handler).toBe(eventHandler)
    expect(tools).toHaveLength(1)
    expect(tools[0].handler).toBe(toolHandler)
  })
})
