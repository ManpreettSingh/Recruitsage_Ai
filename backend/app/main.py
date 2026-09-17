import io
import json
import httpx
import pypdf
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from app.models.schemas import (
    CompanyAnalysisRequest,
    DossierResponse,
    ChatQueryRequest,
    DriveExtractionRequest,
    DriveExtractionResponse,
    PdfUrlExtractRequest
)
from app.orchestrator import orchestrator
from app.services.campus_service import campus_service
from app.services.ollama_service import ollama_service

app = FastAPI(
    title="RecruitSage Backend API",
    description="Agentic Placement Research Copilot for Thapar Institute of Engineering & Technology",
    version="1.0.0"
)

# Enable CORS for Chrome Extension and local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "app": "RecruitSage Intelligence Engine",
        "status": "online",
        "version": "1.0.0",
        "docs_url": "/docs"
    }

@app.get("/api/health")
async def health_check():
    ollama_health = await ollama_service.check_health()
    return {
        "status": "healthy",
        "ollama": ollama_health,
        "campus_placements_count": len(campus_service.placements_data),
        "question_bank_count": len(campus_service.questions_data)
    }

@app.post("/api/extract-drive-context", response_model=DriveExtractionResponse)
async def extract_drive_context(request: DriveExtractionRequest):
    raw_text = (request.raw_page_text or "").strip()
    if not raw_text and request.page_url and request.page_url.startswith("http"):
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                res = await client.get(request.page_url)
                if res.status_code == 200:
                    raw_text = res.text
        except Exception as e:
            print(f"[API] Error scraping page URL: {e}")

    if not raw_text:
        raise HTTPException(status_code=400, detail="raw_page_text or a valid page_url is required")
    parsed = await ollama_service.extract_drive_context(raw_text)
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
                parsed_fields = await ollama_service.extract_drive_context(full_text[:5000])
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
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "application/pdf,*/*"
        }
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
            resp = await client.get(clean_url)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to fetch PDF from URL (HTTP {resp.status_code})")
            
            content = resp.content
            if len(content) > 25 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="PDF exceeds 25 MB limit")
            
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
                    parsed_fields = await ollama_service.extract_drive_context(full_text[:5000])
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
async def analyze_company(request: CompanyAnalysisRequest):
    if not request.company_name or not request.company_name.strip():
        raise HTTPException(status_code=400, detail="company_name is required")
    try:
        dossier = await orchestrator.execute_task_graph(request)
        return dossier
    except Exception as e:
        print(f"[API] Error analyzing company: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_doubt_solver(request: ChatQueryRequest):
    if not request.company_name:
        raise HTTPException(status_code=400, detail="company_name is required")
    
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    
    async def event_generator():
        async for chunk in ollama_service.stream_chat(
            company_name=request.company_name,
            context=request.context,
            messages=messages
        ):
            # Send chunks as SSE formatted data
            yield f"data: {json.dumps({'delta': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/campus/match")
def match_campus_company(name: str, skills: Optional[str] = None):
    skill_list = [s.strip() for s in skills.split(",") if s.strip()] if skills else []
    return campus_service.match_company(name, skills=skill_list)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
