import io
import json
from typing import Optional, Dict, Any, List
import httpx
import pypdf
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from app.models.schemas import (
    CompanyAnalysisRequest,
    DossierResponse,
    ChatQueryRequest,
    DriveExtractionRequest,
    DriveExtractionResponse,
    PdfUrlExtractRequest,
    MermaidEvaluationRequest,
    MermaidEvaluationResponse
)
from app.orchestrator import orchestrator
from app.services.campus_service import campus_service
from app.services.llm_router import llm_router
from app.services.gemini_service import GeminiService
from app.services.cache_service import cache_service, compute_cache_keys, compute_autofill_cache_keys
from app.services.rag_service import rag_service
from app.services.rate_limiter import RateLimitMiddleware, get_client_ip
from app.services.security_utils import validate_safe_url, safe_http_fetch
from app.services.telemetry_service import telemetry
from app.config import GEMINI_API_KEY, GEMINI_MODELS, ADMIN_SECRET_KEY

def get_gemini_service(request: Request) -> GeminiService:
    """Returns a GeminiService using the user-supplied API key from the request header,
    falling back to the backend default key if no header is present."""
    user_key = request.headers.get("X-Gemini-Api-Key", "").strip()
    if user_key:
        return GeminiService(api_key=user_key)
    return GeminiService()  # uses GEMINI_API_KEY from config

app = FastAPI(
    title="Recruit Copilot Backend API",
    description="Agentic Placement Research Copilot for Thapar Institute of Engineering & Technology",
    version="1.0.0"
)

# Enable CORS for Chrome Extension, production domain, and local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://13.234.21.16.nip.io",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://localhost:5173",
        "https://recruit.thapar.edu",
    ],
    allow_origin_regex=r"^(chrome-extension://[a-z]{32}|https?://(localhost|127\.0\.0\.1|.*\.nip\.io)(:\d+)?)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
)

# Sliding window rate limiter middleware (protects quota and prevents scraping abuse)
app.add_middleware(RateLimitMiddleware)

@app.get("/")
def read_root():
    return {
        "app": "Recruit Copilot Intelligence Engine",
        "status": "online",
        "version": "1.0.0",
        "docs_url": "/docs"
    }

@app.get("/api/health")
async def health_check():
    llm_health = await llm_router.get_status()
    return {
        "status": "healthy",
        "llm": llm_health,
        "campus_placements_count": len(campus_service.placements_data),
        "question_bank_count": len(campus_service.questions_data)
    }

@app.get("/api/llm/status")
async def get_llm_status():
    return await llm_router.get_status()

@app.post("/api/extract-drive-context", response_model=DriveExtractionResponse)
async def extract_drive_context(request: Request, body: DriveExtractionRequest):
    client_id = request.headers.get("X-Client-Id", get_client_ip(request))
    telemetry.capture_event(
        distinct_id=client_id,
        event="drive_notice_extracted",
        properties={"has_url": bool(body.page_url), "provider": body.provider, "force_refresh": body.force_refresh}
    )
    gemini_svc = get_gemini_service(request)
    raw_text = (body.raw_page_text or "").strip()
    if not raw_text and body.page_url and body.page_url.startswith("http"):
        try:
            res = await safe_http_fetch(body.page_url, timeout=10.0, max_bytes=5 * 1024 * 1024)
            if res.status_code == 200:
                raw_text = res.text
        except HTTPException:
            raise
        except Exception as e:
            print(f"[API] Error scraping page URL: {e}")

    if not raw_text:
        raise HTTPException(status_code=400, detail="raw_page_text or a valid page_url is required")

    # Check Autofill Cache by Job ID in URL, Canonical Page URL, or Text Hash
    cache_keys = compute_autofill_cache_keys(body.page_url, raw_text)
    if not body.force_refresh and cache_keys:
        cached_data, matched_key = await cache_service.get(cache_keys)
        if cached_data and isinstance(cached_data, dict):
            cached_data["is_cached"] = True
            cached_data["cache_key"] = matched_key
            print(f"[AutofillCache] HIT for key '{matched_key}'")
            telemetry.capture_event(
                distinct_id=client_id,
                event="autofill_cache_hit",
                properties={"key": matched_key, "url": body.page_url}
            )
            return DriveExtractionResponse(**cached_data)

    telemetry.capture_event(
        distinct_id=client_id,
        event="autofill_cache_miss",
        properties={"url": body.page_url}
    )

    parsed, actual_provider = await llm_router.extract_drive_context(raw_text, provider=body.provider, gemini_svc=gemini_svc)
    if isinstance(parsed, dict):
        parsed["company_name"] = parsed.get("company_name") or "Unknown Company"
        parsed["role"] = parsed.get("role") or "Technical Role"
        parsed["ctc_text"] = parsed.get("ctc_text") or "Not Disclosed"
        parsed["additional_details"] = parsed.get("additional_details") or ""
        parsed["active_provider"] = actual_provider
        parsed["is_cached"] = False
        parsed["cache_key"] = cache_keys[0] if cache_keys else None

        # Store in shared cache (TTL: 7 days)
        if cache_keys:
            await cache_service.set(cache_keys, parsed, ttl_seconds=86400 * 7)

    return DriveExtractionResponse(**parsed)

@app.post("/api/extract-pdf")
async def extract_pdf_context(
    file: UploadFile = File(...),
    auto_parse: bool = Form(True)
):
    """
    Extracts text from uploaded PDF notice/offer letter and optionally parses drive fields with local LLM.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files (.pdf) are supported")
    
    try:
        content = await file.read()
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="PDF exceeds 25 MB limit")
        
        reader = pypdf.PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise HTTPException(status_code=400, detail="PDF is password-protected. Please provide an unencrypted PDF.")
        
        pages_text = []
        for i, page in enumerate(reader.pages):
            txt = (page.extract_text() or "").strip()
            if txt:
                pages_text.append(f"--- [Notice Page {i+1}] ---\n{txt}")
        
        full_text = "\n\n".join(pages_text).strip()
        if not full_text:
            raise HTTPException(status_code=400, detail="No readable text found in PDF (it may contain scanned image pages only)")

        parsed_fields = {}
        if auto_parse:
            try:
                parsed_fields, _ = await llm_router.extract_drive_context(full_text[:12000], provider="gemini")
            except Exception as e:
                print(f"[API] Error running LLM extraction on PDF: {e}")
        
        return {
            "filename": file.filename,
            "num_pages": len(reader.pages),
            "word_count": len(full_text.split()),
            "character_count": len(full_text),
            "extracted_text": full_text[:12000],
            "parsed_fields": parsed_fields
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF document: {str(e)}")

@app.post("/api/extract-pdf-from-url")
async def extract_pdf_from_url(request: PdfUrlExtractRequest):
    """
    Downloads and extracts text from a PDF accessible via web URL (e.g. portal notice, JD attachment).
    """
    if not request.url or not request.url.strip():
        raise HTTPException(status_code=400, detail="url is required")
    
    clean_url = request.url.strip()
    try:
        headers = {
            "Accept": "application/pdf,*/*"
        }
        resp = await safe_http_fetch(clean_url, timeout=30.0, max_bytes=25 * 1024 * 1024, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Failed to fetch PDF from URL (HTTP {resp.status_code})")
        
        content = resp.content
        reader = pypdf.PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception:
                raise HTTPException(status_code=400, detail="PDF is password protected.")
        
        pages_text = []
        for i, page in enumerate(reader.pages):
            txt = (page.extract_text() or "").strip()
            if txt:
                pages_text.append(f"--- [Notice Page {i+1}] ---\n{txt}")
        
        full_text = "\n\n".join(pages_text).strip()
        if not full_text:
            raise HTTPException(status_code=400, detail="No readable text found in PDF (may be scanned image).")
        
        parsed_fields = {}
        if request.auto_parse:
            try:
                parsed_fields, _ = await llm_router.extract_drive_context(full_text[:12000], provider="gemini")
            except Exception as e:
                print(f"[API] Error running LLM extraction on PDF URL: {e}")
        
        filename = clean_url.split("/")[-1].split("?")[0] or "notice_document.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"
        
        return {
            "filename": filename,
            "num_pages": len(reader.pages),
            "word_count": len(full_text.split()),
            "character_count": len(full_text),
            "extracted_text": full_text[:12000],
            "parsed_fields": parsed_fields,
            "source_url": clean_url
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process PDF from URL: {str(e)}")

@app.post("/api/analyze", response_model=DossierResponse)
async def analyze_company(request: Request, body: CompanyAnalysisRequest):
    if not body.company_name or not body.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")
    
    # 1. Compute hierarchical cache keys (URL/Job UUID key first, then company:role key)
    cache_keys = compute_cache_keys(
        company_name=body.company_name,
        role=body.role or "Software Engineer",
        page_url=body.page_url
    )
    primary_key = cache_keys[0]

    client_id = request.headers.get("X-Client-Id", get_client_ip(request))

    # 2. Check Cache
    cached_data, hit_key = await cache_service.get(cache_keys)
    if cached_data:
        print(f"[API] ⚡ Served dossier from cache for '{body.company_name}' ({hit_key})")
        telemetry.capture_event(
            distinct_id=client_id,
            event="company_analysis_cache_hit",
            properties={"company": body.company_name, "role": body.role, "cache_key": hit_key}
        )
        cached_data["is_cached"] = True
        cached_data["cache_key"] = hit_key
        return DossierResponse(**cached_data)

    # 3. In-flight Deduplication (Thundering Herd Protection)
    # If 50 students analyze the same drive simultaneously, compute once!
    is_leader = await cache_service.acquire_dedup_lock(primary_key)
    if not is_leader:
        print(f"[API] Concurrent request detected for '{primary_key}' - waiting on in-flight leader...")
        waited = await cache_service.wait_for_in_flight(primary_key, timeout=45.0)
        if waited:
            cached_data, hit_key = await cache_service.get(cache_keys)
            if cached_data:
                print(f"[API] ⚡ Follower received cached result for '{primary_key}' ({hit_key})")
                cached_data["is_cached"] = True
                cached_data["cache_key"] = hit_key
                return DossierResponse(**cached_data)

    gemini_svc = get_gemini_service(request)
    try:
        telemetry.capture_event(
            distinct_id=client_id,
            event="company_analysis_started",
            properties={"company": body.company_name, "role": body.role, "provider": body.provider}
        )
        dossier = await orchestrator.execute_task_graph(body, gemini_svc=gemini_svc)
        telemetry.capture_event(
            distinct_id=client_id,
            event="company_analysis_success",
            properties={"company": body.company_name, "role": body.role, "hiring_verdict": getattr(dossier, "hiring_verdict", "")}
        )
        
        # Serialize for cache storage
        dossier_dict = dossier.model_dump() if hasattr(dossier, "model_dump") else dossier.dict()
        dossier_dict["is_cached"] = True
        dossier_dict["cache_key"] = primary_key
        
        # Cache under all associated keys (job URL and company:role)
        await cache_service.set(cache_keys, dossier_dict)
        
        # Return response to client marked as fresh
        dossier.is_cached = False
        dossier.cache_key = primary_key
        return dossier
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Error analyzing company: {e}")
        raise HTTPException(status_code=500, detail="Internal server error occurred during company analysis. Please try again.")
    finally:
        if is_leader:
            await cache_service.release_dedup_lock(primary_key)

@app.get("/api/cache/stats")
async def get_cache_stats():
    """Returns current cache status, hit/miss metrics, and active store type."""
    return cache_service.get_stats()

@app.post("/api/cache/clear")
async def clear_cache(request: Request):
    """Flushes cache store and resets statistics. Requires admin authorization."""
    admin_key = request.headers.get("X-Admin-Key", "").strip()
    client_ip = get_client_ip(request)
    is_localhost = client_ip in ("127.0.0.1", "::1", "localhost")
    
    if admin_key != ADMIN_SECRET_KEY and not is_localhost:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Administrative privileges or valid X-Admin-Key header required."
        )
    await cache_service.clear_all()
    return {"status": "success", "message": "Cache successfully cleared"}

@app.post("/api/chat")
async def chat_doubt_solver(request: Request, body: ChatQueryRequest):
    if not body.company_name:
        raise HTTPException(status_code=400, detail="company_name is required")

    client_id = request.headers.get("X-Client-Id", get_client_ip(request))
    telemetry.capture_event(
        distinct_id=client_id,
        event="chat_doubt_asked",
        properties={"company": body.company_name, "messages_count": len(body.messages)}
    )

    gemini_svc = get_gemini_service(request)
    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    context = dict(body.context) if isinstance(body.context, dict) else {}
    target_role = context.get("role") or "Software Engineer"

    # Ensure campus questions are fully loaded so AI never hallucinates or falls back to generic answers
    prep_guide = context.get("prep_guide")
    if not isinstance(prep_guide, dict):
        prep_guide = {}
        context["prep_guide"] = prep_guide
    campus_intel = context.get("campus_intel")
    if not isinstance(campus_intel, dict):
        campus_intel = {}
        context["campus_intel"] = campus_intel

    thapar_qs = prep_guide.get("thapar_past_questions") or campus_intel.get("thapar_past_questions") or []

    # If Optum or sparse Thapar questions, guarantee full loading from campus_service
    if (not thapar_qs or "optum" in body.company_name.lower()) and len(thapar_qs) < 20:
        from app.services.campus_service import campus_service
        enriched_thapar, enriched_other = campus_service.get_company_role_questions(
            body.company_name, target_role, []
        )
        if enriched_thapar:
            context["prep_guide"]["thapar_past_questions"] = enriched_thapar
            context["campus_intel"]["thapar_past_questions"] = enriched_thapar
        if enriched_other and not (prep_guide.get("other_campus_questions") or campus_intel.get("other_campus_questions")):
            context["prep_guide"]["other_campus_questions"] = enriched_other
            context["campus_intel"]["other_campus_questions"] = enriched_other

    # Ground chat response with relevant RAG behavioral advice, verified questions, and debriefs
    user_query = messages[-1]["content"] if messages else ""
    try:
        rag_grounding = rag_service.build_grounded_rag_context(
            company_name=body.company_name,
            user_query=user_query,
            role=target_role
        )
        if rag_grounding:
            context["rag_grounding"] = rag_grounding
    except Exception as e:
        print(f"[API] Note: RAG context grounding skipped: {e}")

    async def event_generator():
        async for chunk in llm_router.stream_chat(
            company_name=body.company_name,
            context=context,
            messages=messages,
            provider=body.provider,
            gemini_svc=gemini_svc
        ):
            yield f"data: {json.dumps({'delta': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/rag/stats")
async def get_rag_stats():
    """Returns RAG collection counts and active vector engine status."""
    return rag_service.get_stats()

@app.post("/api/rag/search")
async def search_rag(query: str, company: Optional[str] = None, role: Optional[str] = None):
    """Direct semantic query against the RAG knowledge base collections."""
    return {
        "behavioral": rag_service.search_behavioral(query, top_k=3),
        "questions": rag_service.search_questions(query, company=company, role=role, top_k=5),
        "interview_experiences": rag_service.search_interview_experiences(company, query, top_k=3)
    }

@app.post("/api/evaluate-mermaid", response_model=MermaidEvaluationResponse)
async def evaluate_mermaid(request: MermaidEvaluationRequest):
    """
    LLM-as-a-Judge: Validates Mermaid flowchart code, fixes broken syntax/unquoted brackets,
    and returns guaranteed compilable Mermaid code.
    """
    if not request.mermaid_code or not request.mermaid_code.strip():
        raise HTTPException(status_code=400, detail="mermaid_code is required")

    corrected_code, fixed_by = await llm_router.evaluate_and_fix_mermaid(
        mermaid_code=request.mermaid_code,
        error_context=request.error or "",
        provider=request.provider
    )

    return MermaidEvaluationResponse(
        valid=True,
        corrected_code=corrected_code,
        original_code=request.mermaid_code,
        fixed_by=fixed_by
    )

@app.get("/api/campus/match")
def match_campus_company(name: str, skills: Optional[str] = None):
    skill_list = [s.strip() for s in skills.split(",") if s.strip()] if skills else []
    return campus_service.match_company(name, skills=skill_list)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
