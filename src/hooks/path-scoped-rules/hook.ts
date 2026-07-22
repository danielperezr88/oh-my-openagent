import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { log } from "../../shared/logger"

/**
 * Simple glob pattern matcher supporting *, **, and ? wildcards.
 */
export function globMatch(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  const regex = new RegExp(`^${regexStr}$`)
  return regex.test(str.replace(/\\/g, "/"))
}

export interface PathScopedRule {
  paths: string[]
  content: string
  name?: string
}

export interface PathScopedRulesOptions {
  /** Project root directory for loading rules */
  directory?: string
  /** Directory name for rules (default: .omo-rules) */
  rulesDir?: string
}

interface MatchedRule {
  name: string
  content: string
  matchedPath: string
}

type TransformPart = { type: string; text?: string; [key: string]: unknown }

interface MessageWithParts {
  info: { role: string; sessionID?: string; [key: string]: unknown }
  parts: TransformPart[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

/**
 * Path-scoped context rules hook.
 *
 * Inspired by Claude Code's .claude/rules/*.md with paths: frontmatter.
 * Loads rule files from .omo-rules/ directory. Rules with YAML-like
 * frontmatter specifying glob patterns are injected when matching files
 * are accessed via Read, grep, Glob tools.
 */
export function createPathScopedRulesHook(options?: PathScopedRulesOptions): MessagesTransformHook & {
  "tool.execute.after": (input: { tool: string; sessionID: string; callID: string }, output: { title: string; output: string; metadata: unknown }) => Promise<void>
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
} {
  const directory = options?.directory ?? ""
  const rulesDirName = options?.rulesDir ?? ".omo-rules"
  const loadedRules: PathScopedRule[] = []
  const recentlyAccessedPaths = new Map<string, Set<string>>()
  let rulesLoaded = false

  const loadRules = async (): Promise<void> => {
    if (rulesLoaded || !directory) return
    rulesLoaded = true

    const rulesPath = join(directory, rulesDirName)
    try {
      const files = await readdir(rulesPath)
      for (const file of files.filter((f) => f.endsWith(".md"))) {
        const content = await readFile(join(rulesPath, file), "utf-8")
        const rule = parseRuleFile(content, file)
        if (rule) loadedRules.push(rule)
      }
    } catch {
      // Rules dir doesn't exist — fine
    }

    if (loadedRules.length > 0) {
      log("[path-scoped-rules] Loaded rules", { directory, count: loadedRules.length })
    }
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    const pathTools = new Set(["Read", "read", "grep", "Grep", "Glob", "glob", "safe_grep", "safe_glob"])
    if (!pathTools.has(input.tool)) return

    const outputText = output.output ?? ""
    const pathPattern = /(?:^|\n)([^\s:]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|md|json|yaml|yml|toml))/gm
    const paths = recentlyAccessedPaths.get(input.sessionID) ?? new Set<string>()

    let match: RegExpExecArray | null
    while ((match = pathPattern.exec(outputText)) !== null) {
      paths.add(match[1])
    }

    recentlyAccessedPaths.set(input.sessionID, paths)
  }

  const messagesTransform = async (
    _input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => {
    if (output.messages.length === 0) return

    await loadRules()
    if (loadedRules.length === 0) return

    const lastMsg = output.messages[output.messages.length - 1]
    const sessionID = (lastMsg.info as Record<string, unknown>).sessionID as string | undefined
    if (!sessionID) return

    const accessedPaths = recentlyAccessedPaths.get(sessionID)
    if (!accessedPaths || accessedPaths.size === 0) return

    const matched: MatchedRule[] = []
    for (const rule of loadedRules) {
      for (const pattern of rule.paths) {
        for (const filePath of accessedPaths) {
          if (globMatch(filePath, pattern) || (directory && globMatch(relative(directory, filePath), pattern))) {
            matched.push({
              name: rule.name ?? "unnamed",
              content: rule.content,
              matchedPath: filePath,
            })
            break
          }
        }
        if (matched.length > 0 && matched[matched.length - 1].name === (rule.name ?? "unnamed")) break
      }
    }

    if (matched.length === 0) return

    // Inject matched rules into last user message
    for (let i = output.messages.length - 1; i >= 0; i--) {
      if (output.messages[i].info.role === "user") {
        const ruleText = matched.map((m) =>
          `<path-rule name="${m.name}" path="${m.matchedPath}">\n${m.content}\n</path-rule>`
        ).join("\n")

        output.messages[i].parts.unshift({
          type: "text",
          text: ruleText,
        })

        log("[path-scoped-rules] Injected matched rules", {
          sessionID,
          ruleCount: matched.length,
          rules: matched.map((m) => m.name),
        })
        break
      }
    }

    recentlyAccessedPaths.delete(sessionID)
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type === "session.deleted") {
      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionId = props?.info?.id
      if (sessionId) {
        recentlyAccessedPaths.delete(sessionId)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "experimental.chat.messages.transform": messagesTransform,
    event: eventHandler,
  }
}

const PATHS_PATTERN = /^---\s*\npaths:\s*\n((?:\s+-\s+.+\n)*)---\s*\n([\s\S]*)$/

export function parseRuleFile(content: string, filename: string): PathScopedRule | null {
  const match = content.match(PATHS_PATTERN)
  if (!match) {
    if (content.trim().length === 0) return null
    return {
      paths: ["**/*"],
      content: content.trim(),
      name: filename.replace(/\.md$/, ""),
    }
  }

  const pathsList = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s+-\s+/, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)

  if (pathsList.length === 0) return null

  return {
    paths: pathsList,
    content: match[2].trim(),
    name: filename.replace(/\.md$/, ""),
  }
}
