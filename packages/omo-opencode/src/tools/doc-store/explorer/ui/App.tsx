import React, { useState, useCallback, useRef, useEffect } from "react"
import { zoom as d3Zoom, zoomIdentity } from "d3-zoom"
import { select as d3Select } from "d3-selection"
import { selection } from "d3-selection"
import { interrupt as d3Interrupt } from "d3-transition"

// d3-transition's side-effect import patches selection.prototype.interrupt,
// but Bun's bundler strips it. Patch it manually.
if (!(selection.prototype as any).interrupt) {
  ;(selection.prototype as any).interrupt = function (this: any) {
    return this.each(function (this: any) {
      d3Interrupt(this)
    })
  }
}

// ─── Types ───────────────────────────────────────────────────────────

interface ToolData {
  name: string
  description: string
  args: ArgData[]
  cliCommand: string
  executionType: "stdout" | "stdin"
}

interface ArgData {
  name: string
  type: string
  required: boolean
  description: string
}

interface PromptSection {
  builderName: string
  content: string
  usedBy: string[]
}

interface AgentData {
  name: string
  mode: "primary" | "subagent"
  awarenessLevel: string
  awarenessBuilder: string
  tools: string[]
  models: string[]
  delegationTargets: string[]
  promptFile: string
}

interface SMState {
  id: string
  label: string
  description: string
}

interface SMTransition {
  from: string
  to: string
  label: string
  trigger: string
  isRetry?: boolean
}

interface StateMachine {
  name: string
  description: string
  states: SMState[]
  transitions: SMTransition[]
}

interface PipelineStep {
  tool: string
  group: string
  flowsTo?: string[]
  label?: string
}

interface DelegationNode {
  agent: string
  mode: "primary" | "subagent"
  awarenessLevel: string
  children: DelegationNode[]
}

interface ExplorerData {
  generatedAt: string
  tools: ToolData[]
  promptSections: PromptSection[]
  agents: AgentData[]
  stateMachines: StateMachine[]
  toolPipeline: PipelineStep[]
  delegationTree: DelegationNode
}

interface ExecutionEntry {
  id: string
  tool: string
  args: Record<string, string>
  timestamp: string
  status: "success" | "error"
  result: string
  durationMs: number
  fromState?: string
  toState?: string
}

// ─── Theme ───────────────────────────────────────────────────────────

const C = {
  bg: "#0a0a0f",
  surface: "#12121a",
  surfaceHover: "#1a1a28",
  surfaceActive: "#22223a",
  border: "#2a2a3a",
  borderLight: "#3a3a4f",
  text: "#e8e8f0",
  textMuted: "#8888a0",
  textDim: "#5a5a70",
  accent: "#6366f1",
  accentLight: "#818cf8",
  green: "#22c55e",
  blue: "#3b82f6",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
  teal: "#14b8a6",
}

const GROUP_COLORS: Record<string, string> = {
  status: C.accent,
  ingestion: C.green,
  consolidation: C.orange,
  retrieval: C.blue,
  maintenance: C.purple,
}

const AWARENESS_COLORS: Record<string, string> = {
  full: C.green,
  librarian: C.orange,
  "with-actions": C.blue,
  brief: C.yellow,
  none: C.textMuted,
}

// ─── Shared helpers ──────────────────────────────────────────────────

const Pill: React.FC<{ color: string; children: React.ReactNode; style?: React.CSSProperties }> = ({ color, children, style }) => (
  <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${color}20`, color, fontFamily: "monospace", whiteSpace: "nowrap", ...style }}>{children}</span>
)

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 style={{ fontSize: 10, color: C.textDim, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{children}</h4>
)

const panelBase: React.CSSProperties = {
  position: "absolute",
  top: 52,
  width: 380,
  maxHeight: "calc(100vh - 68px)",
  overflow: "auto",
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 20,
  color: C.text,
  fontFamily: "sans-serif",
  zIndex: 110,
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "7px 10px",
  color: C.text,
  fontSize: 12,
  outline: "none",
  fontFamily: "monospace",
}

const btnPrimary: React.CSSProperties = {
  background: C.accent,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
}

const btnGhost: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: C.textMuted,
  cursor: "pointer",
  fontSize: 16,
  padding: 4,
}

async function executeToolApi(tool: string, args: Record<string, string>): Promise<ExecutionEntry> {
  const res = await fetch("/api/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  })
  return res.json()
}

async function fetchHistory(): Promise<ExecutionEntry[]> {
  const res = await fetch("/api/history")
  return res.json()
}

function getNextTransitions(sm: StateMachine, current: string): SMTransition[] {
  return sm.transitions.filter((t) => t.from === current)
}

/** Build an SVG curved path from (x1,y1) to (x2,y2) that arcs above the nodes. */
function curvedPath(x1: number, y1: number, x2: number, y2: number, arcOffset = -40): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 + arcOffset
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`
}

/** Arrowhead marker def — must appear once inside the SVG. */
const ArrowDefs = () => (
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill={C.textMuted} />
    </marker>
    <marker id="arrow-green" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill={C.green} />
    </marker>
    <marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill={C.accentLight} />
    </marker>
    <marker id="arrow-red" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
      <polygon points="0 0,8 3,0 6" fill={C.red} />
    </marker>
  </defs>
)

// ─── Execution Panel ─────────────────────────────────────────────────

const ExecutionPanel: React.FC<{
  tools: ToolData[]
  prefillTool: string | null
  prefillArgs: Record<string, string>
  currentPipelineState: string
  onResult: (entry: ExecutionEntry) => void
  onClose: () => void
}> = ({ tools, prefillTool, prefillArgs, currentPipelineState, onResult, onClose }) => {
  const [tool, setTool] = useState(prefillTool || "")
  const [args, setArgs] = useState<Record<string, string>>(prefillArgs)
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<ExecutionEntry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedToolDef = tools.find((t) => t.name === tool)

  const handleToolChange = (name: string) => {
    setTool(name)
    setArgs({})
    setError(null)
    setLastResult(null)
  }

  const handleExec = async () => {
    if (!tool) return
    setLoading(true)
    setError(null)
    try {
      const entry = await executeToolApi(tool, args)
      setLastResult(entry)
      onResult(entry)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const prettyResult = React.useMemo(() => {
    if (!lastResult?.result) return null
    try { return JSON.stringify(JSON.parse(lastResult.result), null, 2) }
    catch { return lastResult.result }
  }, [lastResult])

  return (
    <div style={{ ...panelBase, right: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: C.accentLight }}>Execute Tool</span>
        <button onClick={onClose} style={btnGhost}>x</button>
      </div>
      {currentPipelineState && (
        <div style={{ marginBottom: 10 }}>
          <Pill color={C.teal}>pipeline state: {currentPipelineState}</Pill>
        </div>
      )}
      <div style={{ marginBottom: 10 }}>
        <SectionLabel>Tool</SectionLabel>
        <select value={tool} onChange={(e) => handleToolChange(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="">-- select tool --</option>
          {tools.map((t) => (
            <option key={t.name} value={t.name}>{t.name.replace("doc_store_", "")}</option>
          ))}
        </select>
      </div>
      {selectedToolDef && (
        <p style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4, margin: "0 0 10px 0" }}>
          {selectedToolDef.description.slice(0, 140)}...
        </p>
      )}
      {selectedToolDef && (
        <div style={{ marginBottom: 12 }}>
          <SectionLabel>Arguments</SectionLabel>
          {selectedToolDef.args.map((a) => (
            <div key={a.name} style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 10, color: C.textMuted, display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <code style={{ color: C.accentLight }}>{a.name}</code>
                <span style={{ color: C.textDim }}>{a.type}</span>
                {a.required && <span style={{ color: C.red, fontSize: 8 }}>req</span>}
              </label>
              {a.name === "result_json" ? (
                <textarea value={args[a.name] || ""} onChange={(e) => setArgs((p) => ({ ...p, [a.name]: e.target.value }))} placeholder={a.description} style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} />
              ) : (
                <input value={args[a.name] || ""} onChange={(e) => setArgs((p) => ({ ...p, [a.name]: e.target.value }))} placeholder={a.description} style={inputStyle} />
              )}
            </div>
          ))}
        </div>
      )}
      <button onClick={handleExec} disabled={!tool || loading} style={{ ...btnPrimary, opacity: !tool || loading ? 0.5 : 1 }}>
        {loading ? "Executing..." : "Execute"}
      </button>
      {error && <div style={{ marginTop: 10, padding: 8, background: `${C.red}15`, borderRadius: 6, fontSize: 10, color: C.red }}>{error}</div>}
      {lastResult && (
        <div style={{ marginTop: 12 }}>
          <SectionLabel>
            Result ({lastResult.durationMs}ms) <Pill color={lastResult.status === "success" ? C.green : C.red}>{lastResult.status}</Pill>
          </SectionLabel>
          {lastResult.toState && (
            <div style={{ marginBottom: 6 }}><Pill color={C.teal}>{lastResult.fromState} → {lastResult.toState}</Pill></div>
          )}
          <pre style={{ fontSize: 9, lineHeight: 1.35, background: C.bg, padding: 10, borderRadius: 6, maxHeight: 180, overflow: "auto", color: C.textMuted, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{prettyResult}</pre>
        </div>
      )}
    </div>
  )
}

// ─── History Panel ───────────────────────────────────────────────────

const HistoryPanel: React.FC<{
  history: ExecutionEntry[]
  onSelect: (entry: ExecutionEntry) => void
  onClear: () => void
  onClose: () => void
}> = ({ history, onSelect, onClear, onClose }) => (
  <div style={{ ...panelBase, right: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: C.accentLight }}>History ({history.length})</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onClear} style={{ ...btnGhost, fontSize: 10 }}>clear</button>
        <button onClick={onClose} style={btnGhost}>x</button>
      </div>
    </div>
    {history.length === 0 && (
      <p style={{ fontSize: 11, color: C.textDim, textAlign: "center", padding: 20 }}>No executions yet.</p>
    )}
    {history.map((entry) => {
      const pretty = (() => { try { return JSON.stringify(JSON.parse(entry.result), null, 2) } catch { return entry.result } })()
      return (
        <div key={entry.id} style={{ padding: "8px 10px", marginBottom: 6, background: C.bg, borderRadius: 6, cursor: "pointer" }} onClick={() => onSelect(entry)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: entry.status === "success" ? C.green : C.red }}>{entry.tool.replace("doc_store_", "")}</span>
            <span style={{ fontSize: 8, color: C.textDim }}>{entry.durationMs}ms</span>
          </div>
          {entry.toState && <div style={{ marginTop: 3 }}><Pill color={C.teal} style={{ fontSize: 8 }}>{entry.fromState} → {entry.toState}</Pill></div>}
          <pre style={{ fontSize: 8, color: C.textDim, marginTop: 4, maxHeight: 40, overflow: "hidden", whiteSpace: "pre-wrap" }}>{pretty.slice(0, 120)}</pre>
        </div>
      )
    })}
  </div>
)

// ─── SVG: Tool Node ──────────────────────────────────────────────────

const NODE_W = 200
const NODE_H = 56

const ToolNode: React.FC<{
  name: string; label: string; x: number; y: number
  color: string; selected: boolean; special?: boolean
  hasResult?: boolean
  onClick: () => void
}> = ({ name, label, x, y, color, selected, special, hasResult, onClick }) => (
  <g transform={`translate(${x - NODE_W / 2},${y - NODE_H / 2})`} onClick={onClick} style={{ cursor: "pointer" }}>
    <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
      fill={selected ? color : C.surface}
      stroke={hasResult ? C.green : color}
      strokeWidth={selected ? 2.5 : hasResult ? 2 : 1.5}
      opacity={special ? 0.6 : 1}
      strokeDasharray={special ? "6 3" : undefined} />
    <text x={NODE_W / 2} y={NODE_H / 2 - 6} textAnchor="middle"
      fill={selected ? "#fff" : C.text} fontSize={12} fontFamily="monospace" fontWeight={600}>
      {name.replace("doc_store_", "").replace(/_/g, " ").toUpperCase()}
    </text>
    <text x={NODE_W / 2} y={NODE_H / 2 + 10} textAnchor="middle"
      fill={C.textMuted} fontSize={9} fontFamily="sans-serif">
      {label !== name ? label : ""}
    </text>
    {hasResult && <circle cx={NODE_W - 14} cy={12} r={5} fill={C.green} />}
  </g>
)

// ─── SVG: Section Header ─────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; subtitle: string; x: number; y: number }> = ({ title, subtitle, x, y }) => (
  <g transform={`translate(${x},${y})`}>
    <text fill={C.text} fontSize={18} fontFamily="sans-serif" fontWeight={700}>{title}</text>
    <text y={20} fill={C.textMuted} fontSize={11} fontFamily="sans-serif">{subtitle}</text>
    <line x1={0} y1={28} x2={500} y2={28} stroke={C.border} strokeWidth={0.5} />
  </g>
)

// ─── Diagram 1: Tool Pipeline Flow ───────────────────────────────────

const ToolPipeline: React.FC<{
  pipeline: PipelineStep[]
  selectedTool: string | null
  executedTools: Set<string>
  onSelectTool: (name: string) => void
}> = ({ pipeline, selectedTool, executedTools, onSelectTool }) => {
  // Layout: each group gets its own column, wide spacing
  const colW = 280
  const rowH = 120
  const groups = ["ingestion", "consolidation", "retrieval", "maintenance", "status"]
  const grouped = groups.map((g) => pipeline.filter((p) => p.group === g))

  // Build position lookup for all nodes
  const positions = new Map<string, { x: number; y: number; colIdx: number }>()
  let colX = 0
  grouped.forEach((group, gi) => {
    group.forEach((step, si) => {
      positions.set(step.tool, { x: colX + colW / 2, y: 100 + si * rowH, colIdx: gi })
    })
    colX += colW
  })

  return (
    <g transform="translate(40,60)">
      <SectionHeader title="Tool Pipeline Flow" subtitle="Data flow through the 9 doc-store tools — click any tool to execute" x={0} y={0} />

      {/* Arrows drawn BEFORE nodes so nodes render on top */}
      {pipeline.flatMap((step) => {
        const from = positions.get(step.tool)
        if (!from || !step.flowsTo) return []
        return step.flowsTo.map((target) => {
          const to = positions.get(target)
          if (!to) return null
          // Route from right edge of source to left edge of target
          const x1 = from.x + NODE_W / 2 + 4
          const y1 = from.y
          const x2 = to.x - NODE_W / 2 - 4
          const y2 = to.y
          // Curve that arcs above if same row, or bends smoothly
          const dx = x2 - x1
          const dy = y2 - y1
          const cx1 = x1 + dx * 0.4
          const cy1 = y1 + dy * 0.1
          const cx2 = x2 - dx * 0.4
          const cy2 = y2 - dy * 0.1
          const path = `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`
          return (
            <g key={`arrow-${step.tool}-${target}`}>
              <path d={path} fill="none" stroke={GROUP_COLORS[step.group] || C.border} strokeWidth={1.5} markerEnd="url(#arrow)" />
              {step.tool === "doc_store_consolidate_prepare" && (
                <text x={(x1 + x2) / 2} y={Math.min(y1, y2) - 12} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="sans-serif">
                  schema + text
                </text>
              )}
            </g>
          )
        })
      })}

      {/* Nodes */}
      {pipeline.map((step) => {
        const pos = positions.get(step.tool)
        if (!pos) return null
        return (
          <ToolNode key={step.tool} name={step.tool} label={step.label || step.tool}
            x={pos.x} y={pos.y}
            color={GROUP_COLORS[step.group] || C.accent}
            selected={selectedTool === step.tool}
            special={step.tool.startsWith("(")}
            hasResult={executedTools.has(step.tool)}
            onClick={() => onSelectTool(step.tool)} />
        )
      })}
    </g>
  )
}

// ─── Diagram 2: State Machine ────────────────────────────────────────

const SM_R = 180 // circle radius for layout
const STATE_R = 40 // node circle radius

const StateMachineDiagram: React.FC<{
  sm: StateMachine
  x: number; y: number
  currentState: string
  executedTransitions: Set<string>
  onSelectState: (id: string) => void
  onFireTransition: (t: SMTransition) => void
}> = ({ sm, x, y, currentState, executedTransitions, onSelectState, onFireTransition }) => {
  const cx = 350, cy = 260
  const nextTrans = getNextTransitions(sm, currentState)

  const positions = sm.states.map((s, i) => {
    const angle = (2 * Math.PI * i) / sm.states.length - Math.PI / 2
    return { ...s, x: cx + SM_R * Math.cos(angle), y: cy + SM_R * Math.sin(angle) }
  })
  const pos = (id: string) => positions.find((s) => s.id === id)!

  return (
    <g transform={`translate(${x},${y})`}>
      <SectionHeader title={sm.name} subtitle={sm.description} x={0} y={0} />

      {/* Transitions — draw before states */}
      {sm.transitions.map((t, i) => {
        const from = pos(t.from), to = pos(t.to)
        const dx = to.x - from.x, dy = to.y - from.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist === 0) return null
        const nx = dx / dist, ny = dy / dist

        // Start/end outside the circles
        const x1 = from.x + nx * (STATE_R + 6)
        const y1 = from.y + ny * (STATE_R + 6)
        const x2 = to.x - nx * (STATE_R + 10)
        const y2 = to.y - ny * (STATE_R + 10)

        const isNext = nextTrans.some((nt) => nt.to === t.to && nt.label === t.label)
        const isExec = executedTransitions.has(`${t.from}->${t.to}`)

        // Curve offset: perpendicular to the line, further for retries
        const perpX = -ny, perpY = nx
        const curveMag = t.isRetry ? 30 : 16
        const mx = (x1 + x2) / 2 + perpX * curveMag
        const my = (y1 + y2) / 2 + perpY * curveMag
        const path = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`

        const markerId = isNext ? "arrow-accent" : isExec ? "arrow-green" : t.isRetry ? "arrow-red" : "arrow"
        const strokeColor = isNext ? C.accentLight : isExec ? C.green : t.isRetry ? C.red : C.border

        return (
          <g key={`t-${i}`}
            onClick={isNext ? () => onFireTransition(t) : undefined}
            style={{ cursor: isNext ? "pointer" : "default" }}>
            <path d={path} fill="none"
              stroke={strokeColor}
              strokeWidth={isNext ? 2.5 : 1.5}
              strokeDasharray={t.isRetry ? "4 3" : undefined}
              markerEnd={`url(#${markerId})`} />
            <text
              x={mx + perpX * 10}
              y={my + perpY * 10}
              textAnchor="middle"
              fill={strokeColor}
              fontSize={8} fontFamily="monospace" fontWeight={isNext ? 700 : 500}>
              {t.label}
            </text>
          </g>
        )
      })}

      {/* States */}
      {positions.map((s) => {
        const isCurrent = currentState === s.id
        const isNextTarget = nextTrans.some((nt) => nt.to === s.id)
        const strokeColor = isCurrent ? C.accentLight
          : s.id === "consolidated" ? C.green
          : s.id === "validation_error" ? C.red
          : isNextTarget ? C.accent
          : C.accent

        return (
          <g key={s.id} onClick={() => onSelectState(s.id)} style={{ cursor: "pointer" }}>
            {isCurrent && <circle cx={s.x} cy={s.y} r={STATE_R + 8} fill="none" stroke={C.accentLight} strokeWidth={1} opacity={0.4} />}
            <circle cx={s.x} cy={s.y} r={STATE_R}
              fill={isCurrent ? C.accent : C.surface}
              stroke={strokeColor}
              strokeWidth={isCurrent ? 3 : isNextTarget ? 2 : 1.5} />
            <text x={s.x} y={s.y - 3} textAnchor="middle"
              fill={isCurrent ? "#fff" : C.text} fontSize={8}
              fontFamily="monospace" fontWeight={700}>{s.label}</text>
            {isCurrent && <text x={s.x} y={s.y + 10} textAnchor="middle" fill="#fff" fontSize={6} fontFamily="sans-serif" opacity={0.8}>current</text>}
          </g>
        )
      })}

      {/* Next-step hint */}
      {nextTrans.length > 0 && (
        <g transform={`translate(${cx - 160},${cy + SM_R + 60})`}>
          <rect x={0} y={0} width={320} height={50} rx={8} fill={`${C.accent}15`} stroke={C.accent} strokeWidth={1} />
          <text x={160} y={18} textAnchor="middle" fill={C.accentLight} fontSize={10} fontFamily="sans-serif" fontWeight={600}>Available next steps:</text>
          <text x={160} y={36} textAnchor="middle" fill={C.textMuted} fontSize={9} fontFamily="monospace">
            {nextTrans.map((t) => `${t.trigger.replace("doc_store_", "")} → ${t.to}`).join("  |  ")}
          </text>
        </g>
      )}
    </g>
  )
}

// ─── Diagram 3: Agent Awareness Matrix ───────────────────────────────

const AgentAwarenessMatrix: React.FC<{
  agents: AgentData[]
  tools: ToolData[]
  selectedAgent: string | null
  onSelectAgent: (name: string) => void
}> = ({ agents, tools, selectedAgent, onSelectAgent }) => {
  const cellW = 22, cellH = 28, labelW = 140, headerH = 60
  const sortedTools = [
    "doc_store_status", "doc_store_search", "doc_store_query",
    "doc_store_ingest", "doc_store_consolidate_list",
    "doc_store_consolidate_prepare", "doc_store_consolidate_store",
    "doc_store_lint", "doc_store_maintain",
  ]
  const getColor = (agent: AgentData, tn: string): string => {
    if (!agent.tools.includes(tn)) return "#1a1a28"
    const a = agent.awarenessLevel
    if (a === "librarian") return C.orange
    if (a === "full") return C.green
    if (a === "with-actions") return C.blue
    return C.yellow
  }

  return (
    <g transform="translate(40,60)">
      <SectionHeader title="Agent Awareness Map" subtitle="Which agents access which tools" x={0} y={0} />
      {sortedTools.map((tn, ti) => (
        <g key={`th-${ti}`} transform={`translate(${labelW + ti * cellW},${headerH - 10})`}>
          <text transform="rotate(-50)" x={0} y={0} textAnchor="start" fill={C.textMuted} fontSize={7} fontFamily="monospace">
            {tn.replace("doc_store_", "").replace("consolidate_", "c_")}
          </text>
        </g>
      ))}
      {agents.map((agent, ai) => {
        const sel = selectedAgent === agent.name
        return (
          <g key={agent.name} transform={`translate(0,${headerH + ai * cellH})`} onClick={() => onSelectAgent(agent.name)} style={{ cursor: "pointer" }}>
            <rect x={0} y={0} width={labelW} height={cellH - 2} rx={4} fill={sel ? C.surfaceHover : "transparent"} />
            <circle cx={14} cy={cellH / 2} r={5} fill={AWARENESS_COLORS[agent.awarenessLevel]} />
            <text x={26} y={cellH / 2 + 4} fill={sel ? C.text : C.textMuted} fontSize={10} fontFamily="sans-serif" fontWeight={sel ? 600 : 400}>{agent.name}</text>
            {sortedTools.map((tn, ti) => (
              <rect key={`${agent.name}-${tn}`} x={labelW + ti * cellW + 1} y={2} width={cellW - 2} height={cellH - 4} rx={3} fill={getColor(agent, tn)} opacity={agent.tools.includes(tn) ? 0.8 : 0.3} />
            ))}
          </g>
        )
      })}
    </g>
  )
}

// ─── Diagram 4: Delegation Hierarchy ─────────────────────────────────

const TREE_NW = 160, TREE_NH = 48, TREE_HGAP = 200, TREE_VGAP = 90
const TREE_HEADER_OFFSET = 70 // push nodes below the section header

const DelegationTree: React.FC<{
  tree: DelegationNode; x: number; y: number
  selectedAgent: string | null; onSelectAgent: (name: string) => void
}> = ({ tree, x, y, selectedAgent, onSelectAgent }) => {
  // Draggable offsets keyed by node id (agent-depth)
  const [dragOffsets, setDragOffsets] = useState<Record<string, number>>({})
  const dragging = useRef<{ key: string; startX: number; startOffset: number } | null>(null)

  const seen = new Set<string>()
  const allNodes: Array<{ node: DelegationNode; x: number; y: number; key: string; parentKey?: string }> = []

  const collect = (n: DelegationNode, d: number, off: number, parentKey?: string) => {
    const tw = n.children.length > 0 ? (n.children.length - 1) * TREE_HGAP : 0
    const cx = off + tw / 2
    const cy = d * TREE_VGAP + TREE_HEADER_OFFSET
    const key = `${n.agent}__${d}`
    if (!seen.has(key)) { seen.add(key); allNodes.push({ node: n, x: cx, y: cy, key, parentKey }) }
    n.children.forEach((c, ci) => {
      const co = off + ci * TREE_HGAP
      collect(c, d + 1, co, key)
    })
  }
  collect(tree, 0, 0)

  // Apply drag offsets to x positions, build lookup by key
  const posByKey = new Map(allNodes.map((n) => [n.key, {
    ...n,
    x: n.x + (dragOffsets[n.key] || 0),
  }]))

  // X-drag handlers
  const onDragStart = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    dragging.current = { key, startX: e.clientX, startOffset: dragOffsets[key] || 0 }
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const dx = ev.clientX - dragging.current.startX
      setDragOffsets((prev) => ({ ...prev, [dragging.current!.key]: dragging.current!.startOffset + dx }))
    }
    const onUp = () => {
      dragging.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <g transform={`translate(${x},${y})`}>
      <SectionHeader title="Delegation Hierarchy" subtitle="Drag nodes horizontally to adjust layout | Click for details" x={0} y={0} />

      {/* Edges — curved, before nodes */}
      {allNodes.filter((n) => n.parentKey).map((n, i) => {
        const child = posByKey.get(n.key)!
        const parent = posByKey.get(n.parentKey!)
        const x1 = parent.x
        const y1 = parent.y + TREE_NH / 2
        const x2 = child.x
        const y2 = child.y - TREE_NH / 2
        const my = (y1 + y2) / 2
        const path = `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`
        return <path key={`e-${i}`} d={path} fill="none" stroke={C.border} strokeWidth={1} markerEnd="url(#arrow)" />
      })}

      {/* Nodes */}
      {allNodes.map((n, i) => {
        const pos = posByKey.get(n.key)!
        const sel = selectedAgent === n.node.agent
        const col = AWARENESS_COLORS[n.node.awarenessLevel] || C.textMuted
        return (
          <g key={`n-${i}`} transform={`translate(${pos.x - TREE_NW / 2},${n.y - TREE_NH / 2})`}
            onClick={() => onSelectAgent(n.node.agent)} style={{ cursor: "ew-resize" }}
            onMouseDown={(e) => onDragStart(n.key, e)}>
            <rect x={0} y={0} width={TREE_NW} height={TREE_NH} rx={8}
              fill={sel ? C.surfaceHover : C.surface} stroke={col} strokeWidth={sel ? 2 : 1} />
            <circle cx={12} cy={14} r={4} fill={col} />
            <text x={22} y={18} fill={C.text} fontSize={11} fontFamily="sans-serif" fontWeight={600}>{n.node.agent}</text>
            <text x={12} y={34} fill={C.textMuted} fontSize={8} fontFamily="monospace">{n.node.mode} | {n.node.awarenessLevel}</text>
          </g>
        )
      })}
    </g>
  )
}

// ─── Detail Panel ────────────────────────────────────────────────────

const DetailPanel: React.FC<{
  type: "tool" | "agent" | "state" | null
  data: ToolData | AgentData | SMState | null
  promptSections: PromptSection[]
  onExecute: (toolName: string) => void
  onClose: () => void
}> = ({ type, data, promptSections, onExecute, onClose }) => {
  if (!type || !data) return null

  if (type === "tool") {
    const tool = data as ToolData
    return (
      <div style={{ ...panelBase, right: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, color: C.accentLight, fontFamily: "monospace", fontSize: 13 }}>{tool.name}</h3>
          <button onClick={onClose} style={btnGhost}>x</button>
        </div>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: C.textMuted, marginTop: 6 }}>{tool.description}</p>
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Arguments</SectionLabel>
          {tool.args.map((a) => (
            <div key={a.name} style={{ marginBottom: 6, padding: "5px 8px", background: C.bg, borderRadius: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <code style={{ color: C.accentLight, fontSize: 11 }}>{a.name}</code>
                <span style={{ color: C.textDim, fontSize: 9 }}>{a.type}</span>
                {a.required && <span style={{ color: C.red, fontSize: 8, padding: "0 3px", background: `${C.red}15`, borderRadius: 2 }}>req</span>}
              </div>
              <div style={{ color: C.textDim, fontSize: 9, marginTop: 1 }}>{a.description}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <SectionLabel>CLI</SectionLabel>
          <code style={{ fontSize: 10, background: C.bg, padding: "5px 8px", borderRadius: 5, display: "block", color: C.teal }}>bun run ~/doc-store/... --json {tool.cliCommand}</code>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button onClick={() => onExecute(tool.name)} style={btnPrimary}>Execute this tool</button>
        </div>
      </div>
    )
  }

  if (type === "agent") {
    const agent = data as AgentData
    const ps = promptSections.find((p) => p.builderName === agent.awarenessBuilder)
    return (
      <div style={{ ...panelBase, right: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, color: AWARENESS_COLORS[agent.awarenessLevel] || C.accentLight }}>{agent.name}</h3>
          <button onClick={onClose} style={btnGhost}>x</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <Pill color={C.accent}>{agent.mode}</Pill>
          <Pill color={AWARENESS_COLORS[agent.awarenessLevel]}>{agent.awarenessLevel}</Pill>
        </div>
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Models</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{agent.models.map((m) => <Pill key={m} color={C.teal}>{m}</Pill>)}</div>
        </div>
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Tools ({agent.tools.length})</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{agent.tools.map((t) => <Pill key={t} color={C.green}>{t.replace("doc_store_", "")}</Pill>)}</div>
        </div>
        {agent.delegationTargets.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <SectionLabel>Delegates To</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{agent.delegationTargets.map((t) => <Pill key={t} color={C.blue}>{t}</Pill>)}</div>
          </div>
        )}
        {ps && (
          <div style={{ marginTop: 14 }}>
            <SectionLabel>Prompt ({ps.builderName})</SectionLabel>
            <pre style={{ fontSize: 8, lineHeight: 1.35, background: C.bg, padding: 8, borderRadius: 5, maxHeight: 160, overflow: "auto", color: C.textDim, whiteSpace: "pre-wrap" }}>{ps.content}</pre>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <SectionLabel>Source</SectionLabel>
          <code style={{ fontSize: 9, color: C.purple, fontFamily: "monospace" }}>{agent.promptFile}</code>
        </div>
      </div>
    )
  }

  if (type === "state") {
    const state = data as SMState
    return (
      <div style={{ ...panelBase, right: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, color: C.accentLight, fontFamily: "monospace" }}>{state.label}</h3>
          <button onClick={onClose} style={btnGhost}>x</button>
        </div>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: C.textMuted, marginTop: 6 }}>{state.description}</p>
        <Pill color={C.accent}>id: {state.id}</Pill>
      </div>
    )
  }
  return null
}

// ─── Chrome ──────────────────────────────────────────────────────────

const SearchBar: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 120 }}>
    <input type="text" placeholder="Search tools, agents, states..." value={value} onChange={(e) => onChange(e.target.value)}
      style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", color: C.text, fontSize: 12, width: 300, outline: "none", fontFamily: "sans-serif" }} />
  </div>
)

const NavBar: React.FC<{ current: number; onChange: (v: number) => void }> = ({ current, onChange }) => {
  const views = ["Pipeline", "State Machines", "Agent Matrix", "Delegation"]
  return (
    <div style={{ position: "absolute", top: 12, left: 16, display: "flex", gap: 4, zIndex: 120 }}>
      {views.map((v, i) => (
        <button key={v} onClick={() => onChange(i)} style={{
          background: current === i ? C.accent : C.surface, border: `1px solid ${current === i ? C.accent : C.border}`,
          borderRadius: 6, padding: "5px 10px", color: current === i ? "#fff" : C.textMuted, cursor: "pointer", fontSize: 10, fontFamily: "sans-serif"
        }}>{i + 1}. {v}</button>
      ))}
    </div>
  )
}

const Toolbar: React.FC<{ onOpenExec: () => void; onOpenHistory: () => void; showExec: boolean; showHistory: boolean }> = ({ onOpenExec, onOpenHistory, showExec, showHistory }) => (
  <div style={{ position: "absolute", top: 12, right: 16, display: "flex", gap: 6, zIndex: 120 }}>
    <button onClick={onOpenExec} style={{
      background: showExec ? C.accent : C.surface, border: `1px solid ${showExec ? C.accent : C.border}`,
      borderRadius: 6, padding: "5px 10px", color: showExec ? "#fff" : C.textMuted, cursor: "pointer", fontSize: 10, fontFamily: "sans-serif", fontWeight: 600
    }}>Run</button>
    <button onClick={onOpenHistory} style={{
      background: showHistory ? C.accent : C.surface, border: `1px solid ${showHistory ? C.accent : C.border}`,
      borderRadius: 6, padding: "5px 10px", color: showHistory ? "#fff" : C.textMuted, cursor: "pointer", fontSize: 10, fontFamily: "sans-serif"
    }}>History</button>
  </div>
)

const Legend = () => (
  <div style={{ position: "absolute", bottom: 16, left: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", zIndex: 100, fontSize: 9, color: C.textMuted }}>
    <div style={{ marginBottom: 3, fontWeight: 600, color: C.text, fontSize: 10 }}>Awareness</div>
    {Object.entries(AWARENESS_COLORS).map(([l, c]) => (
      <div key={l} style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} /><span>{l}</span>
      </div>
    ))}
    <div style={{ marginTop: 6, fontWeight: 600, color: C.text, fontSize: 10 }}>Pan & Zoom</div>
    <div style={{ marginTop: 2 }}>Scroll to zoom | Drag to pan</div>
  </div>
)

// ─── Main Composition ────────────────────────────────────────────────

export const DocStoreExplorer: React.FC<{ data: ExplorerData }> = ({ data }) => {
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [viewIndex, setViewIndex] = useState(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)

  // Execution state
  const [showExec, setShowExec] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [prefillTool, setPrefillTool] = useState<string | null>(null)
  const [prefillArgs, setPrefillArgs] = useState<Record<string, string>>({})
  const [history, setHistory] = useState<ExecutionEntry[]>([])
  const [executedTools, setExecutedTools] = useState<Set<string>>(new Set())
  const [executedTransitions, setExecutedTransitions] = useState<Set<string>>(new Set())
  const [pipelineState, setPipelineState] = useState("pending")

  const filteredAgents = searchQuery
    ? data.agents.filter((a) => a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.awarenessLevel.toLowerCase().includes(searchQuery.toLowerCase()))
    : data.agents

  // Load history on mount
  useEffect(() => { fetchHistory().then(setHistory) }, [])

  // D3 zoom — applied once to the SVG
  useEffect(() => {
    const svg = svgRef.current
    const g = gRef.current
    if (!svg || !g) return

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        d3Select(g).attr("transform", event.transform.toString())
      })

    d3Select(svg).call(zoomBehavior)
    // Set initial transform
    d3Select(svg).call(zoomBehavior.transform, zoomIdentity.translate(0, 0).scale(1))

    return () => {
      d3Select(svg).on(".zoom", null)
    }
  }, [viewIndex]) // re-apply when view changes

  const getDetailType = (): "tool" | "agent" | "state" | null => {
    if (selectedTool) return "tool"
    if (selectedAgent) return "agent"
    if (selectedState) return "state"
    return null
  }
  const getDetailData = (): ToolData | AgentData | SMState | null => {
    if (selectedTool) return data.tools.find((t) => t.name === selectedTool) || null
    if (selectedAgent) return data.agents.find((a) => a.name === selectedAgent) || null
    if (selectedState) { for (const sm of data.stateMachines) { const s = sm.states.find((st) => st.id === selectedState); if (s) return s } }
    return null
  }

  const openExecForTool = (toolName: string, args?: Record<string, string>) => {
    setSelectedTool(null); setSelectedAgent(null); setSelectedState(null)
    setPrefillTool(toolName); setPrefillArgs(args || {})
    setShowExec(true); setShowHistory(false)
  }

  const handleResult = (entry: ExecutionEntry) => {
    setHistory((h) => [entry, ...h])
    if (entry.tool) setExecutedTools((s) => new Set(s).add(entry.tool))
    if (entry.fromState && entry.toState) {
      setExecutedTransitions((s) => new Set(s).add(`${entry.fromState}->${entry.toState}`))
      const consolidationSM = data.stateMachines[0]
      if (consolidationSM) {
        const isValidTransition = consolidationSM.transitions.some((t) => t.from === entry.fromState && t.to === entry.toState)
        if (isValidTransition) setPipelineState(entry.toState)
      }
    }
  }

  const handleFireTransition = (t: SMTransition) => {
    if (t.trigger.startsWith("doc_store_")) openExecForTool(t.trigger)
  }

  const clearHistory = async () => {
    await fetch("/api/history/clear", { method: "POST" })
    setHistory([]); setExecutedTools(new Set()); setExecutedTransitions(new Set()); setPipelineState("pending")
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: C.bg, overflow: "hidden", position: "relative", fontFamily: "sans-serif" }}>
      <NavBar current={viewIndex} onChange={setViewIndex} />
      <SearchBar value={searchQuery} onChange={setSearchQuery} />
      <Toolbar
        onOpenExec={() => { setShowExec(!showExec); setShowHistory(false) }}
        onOpenHistory={() => { setShowHistory(!showHistory); setShowExec(false) }}
        showExec={showExec} showHistory={showHistory}
      />

      <svg ref={svgRef} width="100%" height="100%" style={{ cursor: "grab" }}>
        <ArrowDefs />
        <g ref={gRef}>
          {viewIndex === 0 && (
            <ToolPipeline pipeline={data.toolPipeline} selectedTool={selectedTool}
              executedTools={executedTools}
              onSelectTool={(name) => { setSelectedTool(name); setSelectedAgent(null); setSelectedState(null) }} />
          )}
          {viewIndex === 1 && (
            <>
              {data.stateMachines.map((sm, i) => (
                <StateMachineDiagram key={sm.name} sm={sm} x={40 + i * 700} y={60}
                  currentState={i === 0 ? pipelineState : sm.states[0]?.id || "start"}
                  executedTransitions={executedTransitions}
                  onSelectState={(id) => { setSelectedState(id); setSelectedTool(null); setSelectedAgent(null) }}
                  onFireTransition={handleFireTransition} />
              ))}
            </>
          )}
          {viewIndex === 2 && (
            <AgentAwarenessMatrix agents={filteredAgents} tools={data.tools}
              selectedAgent={selectedAgent}
              onSelectAgent={(name) => { setSelectedAgent(name); setSelectedTool(null); setSelectedState(null) }} />
          )}
          {viewIndex === 3 && (
            <DelegationTree tree={data.delegationTree} x={100} y={60}
              selectedAgent={selectedAgent}
              onSelectAgent={(name) => { setSelectedAgent(name); setSelectedTool(null); setSelectedState(null) }} />
          )}
        </g>
      </svg>

      {/* Detail panel */}
      {!showExec && !showHistory && (
        <DetailPanel type={getDetailType()} data={getDetailData()} promptSections={data.promptSections}
          onExecute={(toolName) => openExecForTool(toolName)}
          onClose={() => { setSelectedTool(null); setSelectedAgent(null); setSelectedState(null) }} />
      )}

      {/* Execution panel */}
      {showExec && (
        <ExecutionPanel tools={data.tools} prefillTool={prefillTool} prefillArgs={prefillArgs}
          currentPipelineState={pipelineState} onResult={handleResult}
          onClose={() => { setShowExec(false); setPrefillTool(null); setPrefillArgs({}) }} />
      )}

      {/* History panel */}
      {showHistory && (
        <HistoryPanel history={history}
          onSelect={(entry) => { setPrefillTool(entry.tool); setPrefillArgs(entry.args); setShowHistory(false); setShowExec(true) }}
          onClear={clearHistory} onClose={() => setShowHistory(false)} />
      )}

      <Legend />
    </div>
  )
}

export default DocStoreExplorer
