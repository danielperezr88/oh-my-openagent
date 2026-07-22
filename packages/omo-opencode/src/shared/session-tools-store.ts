import { trackToolResolution } from "../telemetry/tool-resolution-tracker"
import { log } from "./logger"

const store = new Map<string, Record<string, boolean>>();

export function setSessionTools(sessionID: string, tools: Record<string, boolean>, agent?: string): void {
  store.set(sessionID, { ...tools });
  if (agent) {
    trackToolResolution(sessionID, agent, tools);
    const docStoreCount = Object.keys(tools).filter(k => k.startsWith("doc_store_") && tools[k] !== false).length;
    log("[session-tools-store] Resolved tools for session", {
      sessionID,
      agent,
      deniedTools: Object.entries(tools).filter(([, v]) => v === false).map(([k]) => k),
      docStoreToolsAvailable: docStoreCount === 7,
    });
  }
}

export function getSessionTools(sessionID: string): Record<string, boolean> | undefined {
  const tools = store.get(sessionID);
  return tools ? { ...tools } : undefined;
}

export function deleteSessionTools(sessionID: string): void {
  store.delete(sessionID);
}

export function clearSessionTools(): void {
  store.clear();
}
