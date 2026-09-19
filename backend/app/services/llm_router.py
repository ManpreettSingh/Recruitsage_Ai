import asyncio
from typing import Dict, Any, List, AsyncGenerator, Optional, Tuple
from app.config import DEFAULT_LLM_PROVIDER
from app.services.gemini_service import gemini_service
from app.services.ollama_service import ollama_service

class LLMRouter:
    """
    Intelligent Hybrid LLM Router.
    Routes inference requests dynamically between Google Gemini API and local Ollama (Qwen 2.5 7B),
    with seamless automatic mutual fallback if the requested provider is unreachable or rate-limited.
    """

    def __init__(self):
        self.default_provider = DEFAULT_LLM_PROVIDER or "gemini"

    async def get_status(self) -> Dict[str, Any]:
        """
        Queries status and availability of both Gemini and Ollama concurrently.
        """
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

    async def extract_drive_context(self, raw_page_text: str, provider: Optional[str] = None) -> Tuple[Dict[str, Any], str]:
        """
        Extracts structured fields from raw placement notice text.
        Returns (parsed_dict, actual_provider_used).
        """
        chosen = self._resolve_provider(provider)
        primary = gemini_service if chosen == "gemini" else ollama_service
        secondary = ollama_service if chosen == "gemini" else gemini_service
        primary_name = chosen
        secondary_name = "ollama" if chosen == "gemini" else "gemini"

        try:
            res = await primary.extract_drive_context(raw_page_text)
            if res and res.get("company_name"):
                return res, primary_name
        except Exception as e:
            print(f"[LLMRouter] Primary {primary_name} failed extract_drive_context: {e}. Trying fallback {secondary_name}...")

        # Fallback
        try:
            res = await secondary.extract_drive_context(raw_page_text)
            if res and res.get("company_name"):
                return res, secondary_name
            elif res:
                return res, secondary_name
        except Exception as e:
            print(f"[LLMRouter] Secondary {secondary_name} failed extract_drive_context: {e}")

        # Return whatever primary returned if fallback also failed
        return res or {}, primary_name

    async def synthesize_dossier(self, company_name: str, role: str, ctc_text: str, jd_text: str,
                                 campus_intel: Dict[str, Any], reddit_snippets: List[Dict[str, str]],
                                 review_snippets: List[Dict[str, str]], red_flag_snippets: List[Dict[str, str]],
                                 alumni_links: List[Dict[str, str]],
                                 interview_snippets: Optional[List[Dict[str, str]]] = None,
                                 location: str = "", probation_note: str = "",
                                 eligibility_text: str = "", skills: List[str] = None,
                                 additional_context: str = "",
                                 provider: Optional[str] = None) -> Tuple[Dict[str, Any], str]:
        """
        Executes synthesis agent with automatic failover between Gemini and Ollama.
        Returns (dossier_dict, actual_provider_used).
        """
        chosen = self._resolve_provider(provider)
        primary = gemini_service if chosen == "gemini" else ollama_service
        secondary = ollama_service if chosen == "gemini" else gemini_service
        primary_name = chosen
        secondary_name = "ollama" if chosen == "gemini" else "gemini"

        try:
            print(f"[LLMRouter] Invoking primary provider '{primary_name}' for dossier synthesis...")
            res = await primary.synthesize_dossier(
                company_name=company_name, role=role, ctc_text=ctc_text, jd_text=jd_text,
                campus_intel=campus_intel, reddit_snippets=reddit_snippets,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets,
                alumni_links=alumni_links, interview_snippets=interview_snippets,
                location=location, probation_note=probation_note,
                eligibility_text=eligibility_text, skills=skills, additional_context=additional_context
            )
            if res and isinstance(res, dict) and "compensation" in res:
                return res, primary_name
            else:
                print(f"[LLMRouter] Primary '{primary_name}' returned incomplete dossier. Failing over to '{secondary_name}'...")
        except Exception as e:
            print(f"[LLMRouter] Error on primary '{primary_name}': {e}. Failing over to '{secondary_name}'...")

        # Fallback to secondary
        try:
            print(f"[LLMRouter] Invoking fallback provider '{secondary_name}' for dossier synthesis...")
            res_sec = await secondary.synthesize_dossier(
                company_name=company_name, role=role, ctc_text=ctc_text, jd_text=jd_text,
                campus_intel=campus_intel, reddit_snippets=reddit_snippets,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets,
                alumni_links=alumni_links, interview_snippets=interview_snippets,
                location=location, probation_note=probation_note,
                eligibility_text=eligibility_text, skills=skills, additional_context=additional_context
            )
            if res_sec and isinstance(res_sec, dict):
                return res_sec, secondary_name
        except Exception as e:
            print(f"[LLMRouter] Secondary '{secondary_name}' also failed: {e}")

        return res or {}, primary_name

    async def evaluate_dossier(self, dossier_data: Dict[str, Any], company_name: str, role: str,
                               jd_text: str, campus_intel: Dict[str, Any],
                               review_snippets: List[Dict[str, str]],
                               red_flag_snippets: List[Dict[str, str]],
                               provider: Optional[str] = None) -> Tuple[Dict[str, Any], str]:
        """
        Executes QA audit evaluator with automatic failover between Gemini and Ollama.
        """
        chosen = self._resolve_provider(provider)
        primary = gemini_service if chosen == "gemini" else ollama_service
        secondary = ollama_service if chosen == "gemini" else gemini_service
        primary_name = chosen
        secondary_name = "ollama" if chosen == "gemini" else "gemini"

        try:
            res = await primary.evaluate_dossier(
                dossier_data=dossier_data, company_name=company_name, role=role,
                jd_text=jd_text, campus_intel=campus_intel,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets
            )
            if res and isinstance(res, dict) and "overall_score" in res:
                return res, primary_name
        except Exception as e:
            print(f"[LLMRouter] Primary '{primary_name}' evaluate_dossier failed: {e}. Trying fallback...")

        try:
            res = await secondary.evaluate_dossier(
                dossier_data=dossier_data, company_name=company_name, role=role,
                jd_text=jd_text, campus_intel=campus_intel,
                review_snippets=review_snippets, red_flag_snippets=red_flag_snippets
            )
            if res and isinstance(res, dict):
                return res, secondary_name
        except Exception as e:
            print(f"[LLMRouter] Secondary '{secondary_name}' evaluate_dossier failed: {e}")

        return {}, primary_name

    async def stream_chat(self, company_name: str, context: Dict[str, Any],
                          messages: List[Dict[str, str]],
                          provider: Optional[str] = None) -> AsyncGenerator[str, None]:
        """
        Streams chat responses from the chosen provider, falling back seamlessly if initial token fails.
        """
        chosen = self._resolve_provider(provider)
        primary = gemini_service if chosen == "gemini" else ollama_service
        secondary = ollama_service if chosen == "gemini" else gemini_service
        primary_name = chosen
        secondary_name = "ollama" if chosen == "gemini" else "gemini"

        received_token = False
        try:
            async for chunk in primary.stream_chat(company_name, context, messages):
                # Check for explicit service unavailable messages from primary
                if "temporarily unavailable" in chunk and not received_token:
                    print(f"[LLMRouter] Primary {primary_name} reported unavailable. Switching to {secondary_name}...")
                    break
                received_token = True
                yield chunk
        except Exception as e:
            print(f"[LLMRouter] Primary {primary_name} stream_chat raised: {e}")

        # If primary failed to yield any valid content, stream from secondary
        if not received_token:
            print(f"[LLMRouter] Attempting chat stream with fallback provider '{secondary_name}'...")
            try:
                async for chunk in secondary.stream_chat(company_name, context, messages):
                    yield chunk
            except Exception as e:
                yield f"\n[RecruitSage Chat Error: Both {primary_name} and {secondary_name} providers are currently unavailable. {str(e)}]"

    async def evaluate_and_fix_mermaid(self, mermaid_code: str, error_context: str = "", provider: Optional[str] = None) -> Tuple[str, str]:
        """
        Routes Mermaid syntax evaluation to LLM judge (Gemini or Ollama) with fallback.
        Returns (corrected_code, used_provider).
        """
        chosen = self._resolve_provider(provider)
        primary = gemini_service if chosen == "gemini" else ollama_service
        secondary = ollama_service if chosen == "gemini" else gemini_service
        primary_name = chosen
        secondary_name = "ollama" if chosen == "gemini" else "gemini"

        try:
            fixed = await primary.evaluate_and_fix_mermaid(mermaid_code, error_context)
            if fixed and ("graph " in fixed or "flowchart " in fixed):
                return fixed, primary_name
        except Exception as e:
            print(f"[LLMRouter] Primary {primary_name} evaluate_and_fix_mermaid error: {e}")

        try:
            fixed = await secondary.evaluate_and_fix_mermaid(mermaid_code, error_context)
            if fixed and ("graph " in fixed or "flowchart " in fixed):
                return fixed, secondary_name
        except Exception as e:
            print(f"[LLMRouter] Secondary {secondary_name} evaluate_and_fix_mermaid error: {e}")

        return gemini_service._sanitize_mermaid(mermaid_code), "deterministic_compiler"

llm_router = LLMRouter()
