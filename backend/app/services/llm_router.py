import asyncio
from typing import Dict, Any, List, AsyncGenerator, Optional, Tuple
from app.config import DEFAULT_LLM_PROVIDER
from app.services.gemini_service import gemini_service
from app.services.ollama_service import ollama_service


class LLMRouter:
    """
    LLM Router — routes requests to either Gemini or Ollama based on the user's
    explicit provider selection. No automatic fallback — if the chosen provider
    fails, a clear error is returned to the frontend.
    """

    def __init__(self):
        self.default_provider = DEFAULT_LLM_PROVIDER or "gemini"

    async def get_status(self) -> Dict[str, Any]:
        """Checks availability of both Gemini and Ollama concurrently."""
        gemini_task = gemini_service.check_health()
        ollama_task = ollama_service.check_health()

        gemini_health, ollama_health = await asyncio.gather(
            gemini_task, ollama_task, return_exceptions=True
        )

        gemini_info = gemini_health if isinstance(gemini_health, dict) else {"status": "offline", "error": str(gemini_health)}
        ollama_info = ollama_health if isinstance(ollama_health, dict) else {"status": "offline", "error": str(ollama_health)}

        return {
            "default_provider": self.default_provider,
            "gemini": gemini_info,
            "ollama": ollama_info,
            "active_available": {
                "gemini": gemini_info.get("status") == "online",
                "ollama": ollama_info.get("status") == "online"
            }
        }

    def _resolve_provider(self, requested: Optional[str]) -> str:
        prov = (requested or self.default_provider).lower().strip()
        if "ollama" in prov or "local" in prov or "qwen" in prov:
            return "ollama"
        return "gemini"

    def _get_service(self, chosen: str, gemini_svc=None):
        """Returns the service instance for the chosen provider."""
        if chosen == "ollama":
            return ollama_service
        return gemini_svc or gemini_service

    async def extract_drive_context(self, raw_page_text: str, provider: Optional[str] = None, gemini_svc=None) -> Tuple[Dict[str, Any], str]:
        """
        Extracts structured fields from raw placement notice text.
        Returns (parsed_dict, provider_used). Raises ValueError if the provider is not configured.
        """
        chosen = self._resolve_provider(provider)
        service = self._get_service(chosen, gemini_svc)

        if chosen == "gemini" and not getattr(service, "api_key", None):
            raise ValueError("Gemini API key is not set. Please add your key in Settings.")

        try:
            res = await service.extract_drive_context(raw_page_text)
            return res or {}, chosen
        except ValueError:
            raise
        except Exception as e:
            raise RuntimeError(f"{chosen.capitalize()} failed to extract drive context: {str(e)}")

    async def synthesize_dossier(self, company_name: str, role: str, ctc_text: str, jd_text: str,
                                 campus_intel: Dict[str, Any], reddit_snippets: List[Dict[str, str]],
                                 review_snippets: List[Dict[str, str]], red_flag_snippets: List[Dict[str, str]],
                                 alumni_links: List[Dict[str, str]],
                                 interview_snippets: Optional[List[Dict[str, str]]] = None,
                                 location: str = "", probation_note: str = "",
                                 eligibility_text: str = "", skills: List[str] = None,
                                 additional_context: str = "",
                                 provider: Optional[str] = None,
                                 gemini_svc=None) -> Tuple[Dict[str, Any], str]:
        """
        Runs the synthesis agent on the chosen provider only.
        Raises an error if the provider is unavailable or not configured.
        """
        chosen = self._resolve_provider(provider)
        service = self._get_service(chosen, gemini_svc)

        if chosen == "gemini" and not getattr(service, "api_key", None):
            raise ValueError("Gemini API key is not set. Please add your key in Settings.")

        print(f"[LLMRouter] Invoking '{chosen}' for dossier synthesis...")
        try:
            res = await service.synthesize_dossier(
                company_name=company_name, role=role, ctc_text=ctc_text, jd_text=jd_text,
                campus_intel=campus_intel, reddit_snippets=reddit_snippets,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets,
                alumni_links=alumni_links, interview_snippets=interview_snippets,
                location=location, probation_note=probation_note,
                eligibility_text=eligibility_text, skills=skills, additional_context=additional_context
            )
            return res or {}, chosen
        except ValueError:
            raise
        except Exception as e:
            raise RuntimeError(f"{chosen.capitalize()} failed during synthesis: {str(e)}")

    async def evaluate_dossier(self, dossier_data: Dict[str, Any], company_name: str, role: str,
                               jd_text: str, campus_intel: Dict[str, Any],
                               review_snippets: List[Dict[str, str]],
                               red_flag_snippets: List[Dict[str, str]],
                               provider: Optional[str] = None,
                               gemini_svc=None) -> Tuple[Dict[str, Any], str]:
        """
        Runs the QA audit evaluator on the chosen provider only.
        Returns empty dict (non-fatal) if evaluation fails, since it is a secondary step.
        """
        chosen = self._resolve_provider(provider)
        service = self._get_service(chosen, gemini_svc)

        if chosen == "gemini" and not getattr(service, "api_key", None):
            print(f"[LLMRouter] Skipping evaluation — Gemini key not set.")
            return {}, chosen

        try:
            res = await service.evaluate_dossier(
                dossier_data=dossier_data, company_name=company_name, role=role,
                jd_text=jd_text, campus_intel=campus_intel,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets
            )
            return res or {}, chosen
        except Exception as e:
            print(f"[LLMRouter] Evaluation step failed on '{chosen}': {e}. Skipping (non-fatal).")
            return {}, chosen

    async def stream_chat(self, company_name: str, context: Dict[str, Any],
                          messages: List[Dict[str, str]],
                          provider: Optional[str] = None,
                          gemini_svc=None) -> AsyncGenerator[str, None]:
        """
        Streams chat from the chosen provider only.
        Yields a clear error message if the provider is not configured or fails.
        """
        chosen = self._resolve_provider(provider)
        service = self._get_service(chosen, gemini_svc)

        if chosen == "gemini" and not getattr(service, "api_key", None):
            yield "Error: Gemini API key is not set. Please open Settings (gear icon) and add your Gemini API key to continue."
            return

        try:
            async for chunk in service.stream_chat(company_name, context, messages):
                yield chunk
        except Exception as e:
            yield f"Error: {chosen.capitalize()} is unavailable. {str(e)}"

    async def evaluate_and_fix_mermaid(self, mermaid_code: str, error_context: str = "", provider: Optional[str] = None, gemini_svc=None) -> Tuple[str, str]:
        """
        Routes Mermaid syntax evaluation to the chosen provider only.
        Falls back to deterministic sanitizer if LLM fails (UI-only, non-critical).
        """
        chosen = self._resolve_provider(provider)
        service = self._get_service(chosen, gemini_svc)

        if chosen == "gemini" and not getattr(service, "api_key", None):
            return gemini_service._sanitize_mermaid(mermaid_code), "deterministic_compiler"

        try:
            fixed = await service.evaluate_and_fix_mermaid(mermaid_code, error_context)
            if fixed and ("graph " in fixed or "flowchart " in fixed):
                return fixed, chosen
        except Exception as e:
            print(f"[LLMRouter] evaluate_and_fix_mermaid failed on '{chosen}': {e}")

        return gemini_service._sanitize_mermaid(mermaid_code), "deterministic_compiler"


llm_router = LLMRouter()
