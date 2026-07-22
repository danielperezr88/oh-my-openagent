import type { Span } from "@opentelemetry/api";
import { getTracer } from "./tracer";
import { getSessionRootID } from "./interaction-tracker";

interface PendingLLM {
  sessionID: string;
  reasoning: string[];
  text: string[];
  modelID: string;
  providerID: string;
  startTime: number;
}

const pending = new Map<string, PendingLLM>();

// Track the last user message per session so we can record it as input
const lastUserMessage = new Map<string, { id: string; text: string; agent: string; model: string }>();

const TRUNCATE_LIMIT = 10240;

function truncate(value: string): string {
  return value.length > TRUNCATE_LIMIT ? value.slice(0, TRUNCATE_LIMIT) + "..." : value;
}

/**
 * Called from the event handler for `message.updated` events.
 */
export function trackMessageEvent(info: Record<string, unknown>): void {
  const tracer = getTracer();
  if (!tracer) return;

  const role = info.role as string | undefined;
  const sessionID = info.sessionID as string | undefined;
  const messageID = info.id as string | undefined;

  if (!sessionID || !messageID) return;

  if (role === "user") {
    // Capture user message text for input correlation
    const userText = typeof info.text === "string" ? info.text : "";
    lastUserMessage.set(sessionID, {
      id: messageID,
      text: userText,
      agent: (info.agent as string) ?? "unknown",
      model: typeof info.model === "object" && info.model !== null
        ? `${(info.model as Record<string, unknown>).providerID}/${(info.model as Record<string, unknown>).modelID}`
        : "unknown",
    });
    return;
  }

  if (role === "assistant") {
    // Finalize the LLM span
    const pendingData = pending.get(messageID);
    const tokens = info.tokens as {
      input: number;
      output: number;
      reasoning: number;
      cache: { read: number; write: number };
    } | undefined;

    const span: Span = tracer.startSpan(`llm.chat_turn`);

    span.setAttribute("openinference.span.kind", "LLM");
    span.setAttribute("session.id", sessionID);

    const rootID = getSessionRootID(sessionID);
    if (rootID) {
      span.setAttribute("session.root_id", rootID);
    }

    if (pendingData) {
      span.setAttribute("llm.model_name", pendingData.modelID);
      span.setAttribute("llm.provider", pendingData.providerID);

      // Record collected content
      if (pendingData.reasoning.length > 0) {
        span.setAttribute("llm.thinking", truncate(pendingData.reasoning.join("\n")));
      }
      if (pendingData.text.length > 0) {
        span.setAttribute("output.value", truncate(pendingData.text.join("\n")));
      }

      // Set span timing from when we first saw parts
      // (OTel will use the start time from startSpan, which is now)
      pending.delete(messageID);
    }

    // Model info from the assistant message itself (more reliable)
    const modelID = info.modelID as string | undefined;
    const providerID = info.providerID as string | undefined;
    if (modelID) span.setAttribute("llm.model_name", modelID);
    if (providerID) span.setAttribute("llm.provider", providerID);

    // Token counts
    if (tokens) {
      span.setAttribute("llm.token_count.prompt", tokens.input);
      span.setAttribute("llm.token_count.completion", tokens.output);
      span.setAttribute("llm.token_count.reasoning", tokens.reasoning);
      if (tokens.cache) {
        span.setAttribute("llm.token_count.cache_read", tokens.cache.read);
        span.setAttribute("llm.token_count.cache_write", tokens.cache.write);
      }
    }

    // Cost
    const cost = info.cost as number | undefined;
    if (typeof cost === "number") {
      span.setAttribute("llm.cost", cost);
    }

    // Finish reason
    const finish = info.finish as string | undefined;
    if (finish) span.setAttribute("llm.finish_reason", finish);

    // Input value from last user message in this session
    const userInput = lastUserMessage.get(sessionID);
    if (userInput) {
      if (userInput.text) {
        span.setAttribute("input.value", truncate(userInput.text));
      }
      span.setAttribute("input.role", "user");
    }

    // Error handling
    const error = info.error as Record<string, unknown> | undefined;
    if (error) {
      const errorMsg = (error.data as Record<string, unknown>)?.message ?? error.name ?? "unknown error";
      span.setStatus({ code: 2, message: String(errorMsg) });
    } else {
      span.setStatus({ code: 1 }); // OK
    }

    span.end();
    return;
  }
}

/**
 * Called from the event handler for `message.part.updated` events.
 */
export function trackPartEvent(part: Record<string, unknown>): void {
  const tracer = getTracer();
  if (!tracer) return;

  const type = part.type as string | undefined;
  const messageID = part.messageID as string | undefined;
  const sessionID = part.sessionID as string | undefined;

  if (!messageID || !sessionID) return;

  if (type === "reasoning") {
    const text = part.text as string | undefined;
    if (!text) return;

    let data = pending.get(messageID);
    if (!data) {
      data = { sessionID, reasoning: [], text: [], modelID: "", providerID: "", startTime: Date.now() };
      pending.set(messageID, data);
    }
    data.reasoning.push(text);
    return;
  }

  if (type === "text") {
    const text = part.text as string | undefined;
    if (!text) return;

    let data = pending.get(messageID);
    if (!data) {
      data = { sessionID, reasoning: [], text: [], modelID: "", providerID: "", startTime: Date.now() };
      pending.set(messageID, data);
    }
    data.text.push(text);
    return;
  }

  // For step-finish, extract per-step model info if available
  if (type === "step-finish") {
    const cost = part.cost as number | undefined;
    const tokens = part.tokens as {
      input: number;
      output: number;
      reasoning: number;
    } | undefined;

    // We don't create a separate span for step-finish; the per-step data
    // is already captured in the overall message.updated event.
    // But we can store model info if we see it.
    if (pending.has(messageID)) {
      // Already tracking this message
    }
    return;
  }
}
