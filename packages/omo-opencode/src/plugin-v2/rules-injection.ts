import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { parseFrontmatter, type RuleFrontmatterData } from "@oh-my-opencode/utils"
import type { Plugin } from "@opencode/plugin"

interface RuleFile {
  readonly path: string
  readonly mtimeMs: number
  readonly alwaysApply: boolean
  readonly globs: readonly string[]
  readonly body: string
}

const RULE_DIRS = [join(".omo", "rules"), join(".claude", "rules"), join(".cursor", "rules")]
const SINGLE_RULE_FILES = [join(".github", "copilot-instructions.md")]
const MAX_BLOCK_CHARS = 12_000
const SCOPED_BODY_CHARS = 400

function toGlobList(globs: string | readonly string[] | undefined): readonly string[] {
  if (typeof globs === "string") return [globs]
  if (Array.isArray(globs)) return globs.filter((glob): glob is string => typeof glob === "string")
  return []
}

function readRuleFile(path: string): RuleFile | null {
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = parseFrontmatter<RuleFrontmatterData>(content, { mode: "rule" })
    const globs = toGlobList(parsed.data.globs)
    return {
      path,
      mtimeMs: statSync(path).mtimeMs,
      alwaysApply: parsed.data.alwaysApply === true || (!parsed.hadFrontmatter && globs.length === 0),
      globs,
      body: parsed.body.trim(),
    }
  } catch {
    return null
  }
}

export function scanRuleFiles(directory: string): RuleFile[] {
  const files: RuleFile[] = []
  for (const relativeDir of RULE_DIRS) {
    const absDir = join(directory, relativeDir)
    if (!existsSync(absDir)) continue
    for (const entry of readdirSync(absDir)) {
      if (!entry.endsWith(".md") && !entry.endsWith(".mdc")) continue
      const rule = readRuleFile(join(absDir, entry))
      if (rule) files.push(rule)
    }
  }
  for (const relativeFile of SINGLE_RULE_FILES) {
    const absFile = join(directory, relativeFile)
    if (!existsSync(absFile)) continue
    const rule = readRuleFile(absFile)
    if (rule) files.push(rule)
  }
  return files
}

function formatScopedRule(rule: RuleFile): string {
  const label = rule.globs.length > 0 ? rule.globs.join(", ") : "*"
  const body = rule.body.length > SCOPED_BODY_CHARS ? `${rule.body.slice(0, SCOPED_BODY_CHARS)}...[truncated]` : rule.body
  return `- When touching \`${label}\`:\n${body}`
}

export function buildRulesSystemBlock(directory: string): string | null {
  const files = scanRuleFiles(directory)
  if (files.length === 0) return null

  const always = files.filter((f) => f.alwaysApply)
  const scoped = files.filter((f) => !f.alwaysApply && f.globs.length > 0)
  if (always.length === 0 && scoped.length === 0) return null

  const sections: string[] = ["<omo-project-rules>", "Project rules discovered from .omo/rules, .claude/rules, .cursor/rules."]
  if (always.length > 0) {
    sections.push("## Always apply")
    for (const rule of always) sections.push(rule.body)
  }
  if (scoped.length > 0) {
    sections.push("## Scoped rules (apply when touching matching files)")
    for (const rule of scoped) sections.push(formatScopedRule(rule))
  }
  sections.push("</omo-project-rules>")

  const block = sections.join("\n\n")
  if (block.length <= MAX_BLOCK_CHARS) return block
  return `${block.slice(0, MAX_BLOCK_CHARS)}\n...[rules truncated at ${MAX_BLOCK_CHARS} chars]`
}

export function registerRulesInjection(ctx: Plugin.Context): void {
  const directory = ctx.location.directory
  void ctx.session.hook("context", (event) => {
    const block = buildRulesSystemBlock(directory)
    if (block) event.system.push({ type: "text", text: block })
  })
}
