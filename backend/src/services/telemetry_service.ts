import { POSTHOG_API_KEY, POSTHOG_HOST, POSTHOG_ENABLED } from "../config";
import { PostHog } from "posthog-node";

export class TelemetryService {
  private posthog: PostHog | null = null;

  constructor() {
    if (POSTHOG_ENABLED) {
      try {
        this.posthog = new PostHog(POSTHOG_API_KEY, {
          host: POSTHOG_HOST,
        });
        console.log("[Telemetry] 📊 PostHog Product & User Analytics connected.");
      } catch (e: any) {
        console.warn(`[Telemetry] Warning: Failed to connect PostHog: ${e.message}`);
      }
    }
  }

  captureEvent(distinctId: string, event: string, properties: Record<string, any> = {}): void {
    if (!this.posthog) return;
    try {
      const props = {
        ...properties,
        $lib: "recruitsage_backend_ts",
      };
      this.posthog.capture({
        distinctId: distinctId || "anonymous_student",
        event,
        properties: props,
      });
    } catch (e: any) {
      console.error(`[Telemetry] Error capturing PostHog event '${event}': ${e.message}`);
    }
  }

  logGeneration(
    name: string,
    model: string,
    inputData: any,
    outputData: any,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
    metadata?: Record<string, any>
  ): void {
    // Optionally logged to telemetry or console
    if (process.env.DEBUG_TELEMETRY === "true") {
      console.log(`[Telemetry Gen] ${name} (${model}):`, { usage, metadata });
    }
  }

  async flush(): Promise<void> {
    if (this.posthog) {
      try {
        await this.posthog.shutdown();
      } catch {}
    }
  }
}

export const telemetry = new TelemetryService();
