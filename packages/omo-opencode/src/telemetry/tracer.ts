import { type Tracer } from "@opentelemetry/api";
import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { log } from "../shared/logger";

let tracer: Tracer | null = null;
let provider: NodeTracerProvider | null = null;
let initialized = false;

function isNoTrace(): boolean {
  return process.env.DO_NOT_TRACE === "1";
}

export function initTelemetry(): void {
  if (initialized || isNoTrace()) {
    initialized = true;
    return;
  }

  try {
    const phoenixEndpoint = process.env.PHOENIX_ENDPOINT ?? "http://localhost:6006";
    const projectName = process.env.PHOENIX_PROJECT ?? "openagent";

    const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node") as {
      NodeTracerProvider: new (opts?: any) => NodeTracerProvider;
    };
    const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base") as {
      BatchSpanProcessor: new (exporter: any, opts?: any) => any;
    };
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto") as {
      OTLPTraceExporter: new (opts: any) => any;
    };
    const { resourceFromAttributes } = require("@opentelemetry/resources") as {
      resourceFromAttributes: (attrs: Record<string, string>) => any;
    };

    const exporter = new OTLPTraceExporter({
      url: `${phoenixEndpoint}/v1/traces`,
    });

    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        "openinference.project.name": projectName,
      }),
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: 500,
          maxExportBatchSize: 64,
        }),
      ],
    });

    provider.register();
    tracer = provider.getTracer("oh-my-openagent", "0.1.0");

    log("[telemetry] Initialized successfully", {
      endpoint: phoenixEndpoint,
      project: projectName,
    });

    process.on("beforeExit", () => {
      flushTracer();
    });
  } catch (e) {
    console.error(`[telemetry] init failed: ${e instanceof Error ? e.message : String(e)}`);
    log("[telemetry] Init FAILED", {
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
    tracer = null;
    provider = null;
  }
  initialized = true;
}

export async function flushTracer(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
  } catch {
    // Ignore flush errors
  }
}

export function getTracer(): Tracer | null {
  if (isNoTrace()) return null;
  if (!initialized) initTelemetry();
  return tracer;
}
