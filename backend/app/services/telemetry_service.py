import os
import time
from typing import Optional, Dict, Any
from app.config import (
    LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASE_URL,
    LANGFUSE_ENABLED,
    POSTHOG_API_KEY,
    POSTHOG_HOST,
    POSTHOG_ENABLED
)

class TelemetryService:
    def __init__(self):
        self.langfuse = None
        self.posthog = None

        # 1. Initialize Langfuse (v4 OpenTelemetry-compatible engine)
        if LANGFUSE_ENABLED:
            try:
                os.environ["LANGFUSE_SECRET_KEY"] = LANGFUSE_SECRET_KEY
                os.environ["LANGFUSE_PUBLIC_KEY"] = LANGFUSE_PUBLIC_KEY
                os.environ["LANGFUSE_BASE_URL"] = LANGFUSE_BASE_URL
                from langfuse import Langfuse
                self.langfuse = Langfuse()
                print("[Telemetry] 🧠 Langfuse LLM Observability connected.")
            except Exception as e:
                print(f"[Telemetry] Warning: Failed to connect Langfuse: {e}")

        # 2. Initialize PostHog
        if POSTHOG_ENABLED:
            try:
                from posthog import Posthog
                self.posthog = Posthog(
                    project_api_key=POSTHOG_API_KEY,
                    host=POSTHOG_HOST
                )
                print("[Telemetry] 📊 PostHog Product & User Analytics connected.")
            except Exception as e:
                print(f"[Telemetry] Warning: Failed to connect PostHog: {e}")

    # --- PostHog Event Tracking ---
    def capture_event(self, distinct_id: str, event: str, properties: Optional[Dict[str, Any]] = None):
        """Captures user, feature, and API events in PostHog."""
        if not self.posthog:
            return
        try:
            props = properties or {}
            props["$lib"] = "recruitsage_backend"
            self.posthog.capture(
                distinct_id=distinct_id or "anonymous_student",
                event=event,
                properties=props
            )
        except Exception as e:
            print(f"[Telemetry] Error capturing PostHog event '{event}': {e}")

    # --- Langfuse LLM Tracing ---
    def start_span(
        self,
        name: str,
        input_data: Optional[Any] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Starts a workflow span in Langfuse."""
        if not self.langfuse:
            return None
        try:
            return self.langfuse.start_observation(
                name=name,
                as_type="span",
                input=input_data,
                metadata=metadata or {}
            )
        except Exception as e:
            print(f"[Telemetry] Error starting Langfuse span '{name}': {e}")
            return None

    def log_generation(
        self,
        name: str,
        model: str,
        input_data: Any,
        output_data: Any,
        usage: Optional[Dict[str, int]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Records an LLM generation observation in Langfuse."""
        if not self.langfuse:
            return
        try:
            usage_details = {}
            if usage:
                usage_details["input"] = usage.get("prompt_tokens") or usage.get("input") or 0
                usage_details["output"] = usage.get("completion_tokens") or usage.get("output") or 0
                usage_details["total"] = usage.get("total_tokens") or usage.get("total") or (usage_details["input"] + usage_details["output"])

            obs = self.langfuse.start_observation(
                name=name,
                as_type="generation",
                model=model,
                input=input_data,
                output=output_data,
                usage_details=usage_details if usage_details else None,
                metadata=metadata or {}
            )
            if obs:
                obs.end()
        except Exception as e:
            print(f"[Telemetry] Error logging Langfuse generation '{name}': {e}")

    def flush(self):
        """Flushes buffered telemetry events."""
        if self.langfuse:
            try:
                self.langfuse.flush()
            except Exception:
                pass
        if self.posthog:
            try:
                self.posthog.flush()
            except Exception:
                pass

# Global singleton
telemetry = TelemetryService()
