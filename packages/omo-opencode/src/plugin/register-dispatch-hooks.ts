import type { DispatchRegistry } from "./dispatch-registry"
import type { CreatedHooks } from "../create-hooks"

/**
 * Registers all hooks into the dispatch registry, extracting the correct
 * handler for each pipeline stage.
 *
 * This is the ONE file you edit when adding a new hook — register it here
 * under the appropriate pipeline stage with the correct handler accessor.
 */
export function registerAllDispatchHooks(args: {
  hooks: CreatedHooks
  registry: DispatchRegistry
}): void {
  const { hooks, registry } = args

  registry.register("experimental.chat.messages.transform", "platformErrorFilter", hooks.platformErrorFilter?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "microCompact", hooks.microCompact?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "contextInjectorMessagesTransform", hooks.contextInjectorMessagesTransform?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "reasoningContentPreserver", hooks.reasoningContentPreserver?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "toolPairValidator", hooks.toolPairValidator?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "todoNag", hooks.todoNag?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "identityReinjection", hooks.identityReinjection?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "backgroundResultInjection", hooks.backgroundResultInjection?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "pathScopedRules", hooks.pathScopedRules?.["experimental.chat.messages.transform"])
  registry.register("experimental.chat.messages.transform", "mcpDeferredLoader", hooks.mcpDeferredLoader?.["experimental.chat.messages.transform"])

  registry.register("event", "autoUpdateChecker", hooks.autoUpdateChecker?.event)
  registry.register("event", "legacyPluginToast", hooks.legacyPluginToast?.event)
  registry.register("event", "claudeCodeHooks", hooks.claudeCodeHooks?.event)
  registry.register("event", "backgroundNotificationHook", hooks.backgroundNotificationHook?.event)
  registry.register("event", "sessionNotification", hooks.sessionNotification)
  registry.register("event", "todoContinuationEnforcer", hooks.todoContinuationEnforcer?.handler)
  registry.register("event", "unstableAgentBabysitter", hooks.unstableAgentBabysitter?.event)
  registry.register("event", "preemptiveCompaction", hooks.preemptiveCompaction?.event)
  registry.register("event", "directoryAgentsInjector", hooks.directoryAgentsInjector?.event)
  registry.register("event", "directoryReadmeInjector", hooks.directoryReadmeInjector?.event)
  registry.register("event", "rulesInjector", hooks.rulesInjector?.event)
  registry.register("event", "thinkMode", hooks.thinkMode?.event)
  registry.register("event", "anthropicContextWindowLimitRecovery", hooks.anthropicContextWindowLimitRecovery?.event)
  registry.register("event", "runtimeFallback", hooks.runtimeFallback?.event)
  registry.register("event", "agentUsageReminder", hooks.agentUsageReminder?.event)
  registry.register("event", "categorySkillReminder", hooks.categorySkillReminder?.event)
  registry.register("event", "interactiveBashSession", hooks.interactiveBashSession?.event)
  registry.register("event", "goal", hooks.goal?.event)
  registry.register("event", "stopContinuationGuard", hooks.stopContinuationGuard?.event)
  registry.register("event", "compactionContextInjector", hooks.compactionContextInjector?.event)
  registry.register("event", "compactionTodoPreserver", hooks.compactionTodoPreserver?.event)
  registry.register("event", "writeExistingFileGuard", hooks.writeExistingFileGuard?.event)
  registry.register("event", "atlasHook", hooks.atlasHook?.handler)
  registry.register("event", "autoSlashCommand", hooks.autoSlashCommand?.event)
  registry.register("event", "todoNag", hooks.todoNag?.event)
  registry.register("event", "identityReinjection", hooks.identityReinjection?.event)
  registry.register("event", "pathScopedRules", hooks.pathScopedRules?.event)
  registry.register("event", "checkpointUndo", hooks.checkpointUndo?.event)

  registry.register("tool.execute.after", "toolOutputTruncator", hooks.toolOutputTruncator?.["tool.execute.after"])
  registry.register("tool.execute.after", "claudeCodeHooks", hooks.claudeCodeHooks?.["tool.execute.after"])
  registry.register("tool.execute.after", "preemptiveCompaction", hooks.preemptiveCompaction?.["tool.execute.after"])
  registry.register("tool.execute.after", "commentChecker", hooks.commentChecker?.["tool.execute.after"])
  registry.register("tool.execute.after", "directoryAgentsInjector", hooks.directoryAgentsInjector?.["tool.execute.after"])
  registry.register("tool.execute.after", "directoryReadmeInjector", hooks.directoryReadmeInjector?.["tool.execute.after"])
  registry.register("tool.execute.after", "rulesInjector", hooks.rulesInjector?.["tool.execute.after"])
  registry.register("tool.execute.after", "emptyTaskResponseDetector", hooks.emptyTaskResponseDetector?.["tool.execute.after"])
  registry.register("tool.execute.after", "agentUsageReminder", hooks.agentUsageReminder?.["tool.execute.after"])
  registry.register("tool.execute.after", "categorySkillReminder", hooks.categorySkillReminder?.["tool.execute.after"])
  registry.register("tool.execute.after", "interactiveBashSession", hooks.interactiveBashSession?.["tool.execute.after"])
  registry.register("tool.execute.after", "editErrorRecovery", hooks.editErrorRecovery?.["tool.execute.after"])
  registry.register("tool.execute.after", "delegateTaskRetry", hooks.delegateTaskRetry?.["tool.execute.after"])
  registry.register("tool.execute.after", "atlasHook", hooks.atlasHook?.["tool.execute.after"])
  registry.register("tool.execute.after", "taskResumeInfo", hooks.taskResumeInfo?.["tool.execute.after"])
  registry.register("tool.execute.after", "readImageResizer", hooks.readImageResizer?.["tool.execute.after"])
  registry.register("tool.execute.after", "hashlineReadEnhancer", hooks.hashlineReadEnhancer?.["tool.execute.after"])
  registry.register("tool.execute.after", "webfetchRedirectGuard", hooks.webfetchRedirectGuard?.["tool.execute.after"])
  registry.register("tool.execute.after", "jsonErrorRecovery", hooks.jsonErrorRecovery?.["tool.execute.after"])
  registry.register("tool.execute.after", "todoNag", hooks.todoNag?.["tool.execute.after"])
  registry.register("tool.execute.after", "pathScopedRules", hooks.pathScopedRules?.["tool.execute.after"])
  registry.register("tool.execute.after", "checkpointUndo", hooks.checkpointUndo?.["tool.execute.after"])

  registry.register("tool.definition", "todoDescriptionOverride", hooks.todoDescriptionOverride?.["tool.definition"])
  registry.register("tool.definition", "mcpDeferredLoader", hooks.mcpDeferredLoader?.["tool.definition"])
}
