import { describe, it, expect } from "bun:test"
import { createDispatchRegistry } from "./dispatch-registry"
import { registerAllDispatchHooks } from "./register-dispatch-hooks"

describe("registerAllDispatchHooks", () => {
  it("registers all expected hooks for experimental.chat.messages.transform", () => {
    const registry = createDispatchRegistry()
    const noop = async () => {}
    const hooks = {
      platformErrorFilter: { "experimental.chat.messages.transform": noop },
      microCompact: { "experimental.chat.messages.transform": noop },
      contextInjectorMessagesTransform: { "experimental.chat.messages.transform": noop },
      thinkingBlockValidator: { "experimental.chat.messages.transform": noop },
      reasoningContentPreserver: { "experimental.chat.messages.transform": noop },
      toolPairValidator: { "experimental.chat.messages.transform": noop },
      todoNag: { "experimental.chat.messages.transform": noop, event: noop, "tool.execute.after": noop },
      identityReinjection: { "experimental.chat.messages.transform": noop, event: noop },
      backgroundResultInjection: { "experimental.chat.messages.transform": noop },
      pathScopedRules: { "experimental.chat.messages.transform": noop, event: noop, "tool.execute.after": noop },
      mcpDeferredLoader: { "experimental.chat.messages.transform": noop, "tool.definition": noop },
    } as any

    registerAllDispatchHooks({ hooks, registry })

    const handlers = registry.getHandlers("experimental.chat.messages.transform")
    expect(handlers).toHaveLength(11)
    expect(handlers.map(h => h.name)).toEqual([
      "platformErrorFilter", "microCompact", "contextInjectorMessagesTransform", "thinkingBlockValidator",
      "reasoningContentPreserver", "toolPairValidator", "todoNag", "identityReinjection",
      "backgroundResultInjection", "pathScopedRules", "mcpDeferredLoader",
    ])
  })

  it("registers all expected hooks for event stage", () => {
    const registry = createDispatchRegistry()
    const noop = async () => {}
    const hooks = {
      autoUpdateChecker: { event: noop },
      legacyPluginToast: { event: noop },
      claudeCodeHooks: { event: noop },
      backgroundNotificationHook: { event: noop },
      sessionNotification: noop,
      todoContinuationEnforcer: { handler: noop },
      unstableAgentBabysitter: { event: noop },
      contextWindowMonitor: { event: noop },
      preemptiveCompaction: { event: noop },
      directoryAgentsInjector: { event: noop },
      directoryReadmeInjector: { event: noop },
      rulesInjector: { event: noop },
      thinkMode: { event: noop },
      anthropicContextWindowLimitRecovery: { event: noop },
      runtimeFallback: { event: noop },
      agentUsageReminder: { event: noop },
      categorySkillReminder: { event: noop },
      interactiveBashSession: { event: noop },
      ralphLoop: { event: noop },
      stopContinuationGuard: { event: noop },
      compactionContextInjector: { event: noop },
      compactionTodoPreserver: { event: noop },
      writeExistingFileGuard: { event: noop },
      atlasHook: { handler: noop },
      autoSlashCommand: { event: noop },
      todoNag: { event: noop },
      identityReinjection: { event: noop },
      pathScopedRules: { event: noop },
      checkpointUndo: { event: noop },
    } as any

    registerAllDispatchHooks({ hooks, registry })

    const handlers = registry.getHandlers("event")
    expect(handlers).toHaveLength(29)
    expect(handlers.map(h => h.name)).toContain("autoUpdateChecker")
    expect(handlers.map(h => h.name)).toContain("checkpointUndo")
  })

  it("registers all expected hooks for tool.execute.after stage", () => {
    const registry = createDispatchRegistry()
    const noop = async () => {}
    const hooks = {
      toolOutputTruncator: { "tool.execute.after": noop },
      claudeCodeHooks: { "tool.execute.after": noop },
      preemptiveCompaction: { "tool.execute.after": noop },
      contextWindowMonitor: { "tool.execute.after": noop },
      commentChecker: { "tool.execute.after": noop },
      directoryAgentsInjector: { "tool.execute.after": noop },
      directoryReadmeInjector: { "tool.execute.after": noop },
      rulesInjector: { "tool.execute.after": noop },
      emptyTaskResponseDetector: { "tool.execute.after": noop },
      agentUsageReminder: { "tool.execute.after": noop },
      categorySkillReminder: { "tool.execute.after": noop },
      interactiveBashSession: { "tool.execute.after": noop },
      editErrorRecovery: { "tool.execute.after": noop },
      delegateTaskRetry: { "tool.execute.after": noop },
      atlasHook: { "tool.execute.after": noop },
      taskResumeInfo: { "tool.execute.after": noop },
      readImageResizer: { "tool.execute.after": noop },
      hashlineReadEnhancer: { "tool.execute.after": noop },
      webfetchRedirectGuard: { "tool.execute.after": noop },
      jsonErrorRecovery: { "tool.execute.after": noop },
      todoNag: { "tool.execute.after": noop },
      pathScopedRules: { "tool.execute.after": noop },
      checkpointUndo: { "tool.execute.after": noop },
    } as any

    registerAllDispatchHooks({ hooks, registry })

    const handlers = registry.getHandlers("tool.execute.after")
    expect(handlers).toHaveLength(23)
  })

  it("registers hooks for tool.definition stage", () => {
    const registry = createDispatchRegistry()
    const noop = async () => {}
    const hooks = {
      todoDescriptionOverride: { "tool.definition": noop },
      mcpDeferredLoader: { "tool.definition": noop },
    } as any

    registerAllDispatchHooks({ hooks, registry })

    const handlers = registry.getHandlers("tool.definition")
    expect(handlers).toHaveLength(2)
    expect(handlers.map(h => h.name)).toEqual(["todoDescriptionOverride", "mcpDeferredLoader"])
  })
})
