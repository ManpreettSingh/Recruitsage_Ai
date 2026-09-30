import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import pdf from "pdf-parse";
import {
  ADMIN_SECRET_KEY,
} from "./config";
import {
  CompanyAnalysisRequest,
  ChatQueryRequest,
  DriveExtractionRequest,
  PdfUrlExtractRequest,
  MermaidEvaluationRequest,
} from "./models/schemas";
import { orchestrator } from "./orchestrator";
import { campusService } from "./services/campus_service";
import { llmRouter } from "./services/llm_router";
import { GeminiService } from "./services/gemini_service";
import {
  cacheService,
  computeCacheKeys,
  computeAutofillCacheKeys,
} from "./services/cache_service";
import { ragService } from "./services/rag_service";
import { rateLimitMiddleware, getClientIp } from "./services/rate_limiter";
import { safeHttpFetch } from "./services/security_utils";
import { telemetry } from "./services/telemetry_service";

function getGeminiService(req: Request): GeminiService {
  const userKey = (req.headers["x-gemini-api-key"] as string || "").trim();
  if (userKey) {
    return new GeminiService(userKey);
  }
  return new GeminiService();
}

const app = express();
const upload = multer({ limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Enable CORS for Chrome Extension, production domain, and local testing
const allowedOriginRegex = /^(chrome-extension:\/\/[a-z]{32}|https?:\/\/(localhost|127\.0\.0\.1|.*\.nip\.io)(:\d+)?)$/;
const explicitOrigins = [
  "https://13.234.21.16.nip.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:3000",
  "http://localhost:5173",
  "https://recruit.thapar.edu",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (explicitOrigins.includes(origin) || allowedOriginRegex.test(origin)) {
        return callback(null, true);
      }
      return callback(null, true); // Allow for extension and broad compatibility
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    exposedHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
  })
);

// Sliding window rate limiter middleware
app.use(rateLimitMiddleware);

// Root
app.get("/", (req: Request, res: Response) => {
  res.json({
    app: "Recruit Copilot Intelligence Engine",
    status: "online",
    version: "1.0.0",
    docs_url: "/docs",
  });
});

// Health check
app.get("/api/health", async (req: Request, res: Response) => {
  const llmHealth = await llmRouter.getStatus();
  res.json({
    status: "healthy",
    llm: llmHealth,
    campus_placements_count: campusService.placements_data.length,
    question_bank_count: campusService.questions_data.length,
  });
});

// LLM Status
app.get("/api/llm/status", async (req: Request, res: Response) => {
  const status = await llmRouter.getStatus();
  res.json(status);
});

// Drive Context Extraction
app.post("/api/extract-drive-context", async (req: Request, res: Response) => {
  const body: DriveExtractionRequest = req.body;
  const clientId = (req.headers["x-client-id"] as string) || getClientIp(req);

  telemetry.captureEvent(clientId, "drive_notice_extracted", {
    has_url: Boolean(body.page_url),
    provider: body.provider,
    force_refresh: body.force_refresh,
  });

  const geminiSvc = getGeminiService(req);
  let rawText = (body.raw_page_text || "").trim();

  if (!rawText && body.page_url && body.page_url.startsWith("http")) {
    try {
      const fetchRes = await safeHttpFetch(body.page_url, { timeout: 10.0, max_bytes: 5 * 1024 * 1024 });
      if (fetchRes.status_code === 200) {
        rawText = fetchRes.text;
      }
    } catch (e: any) {
      console.warn(`[API] Error scraping page URL: ${e.message}`);
    }
  }

  if (!rawText) {
    res.status(400).json({ detail: "raw_page_text or a valid page_url is required" });
    return;
  }

  const cacheKeys = computeAutofillCacheKeys(body.page_url, rawText);
  if (!body.force_refresh && cacheKeys.length > 0) {
    const [cachedData, matchedKey] = await cacheService.get(cacheKeys);
    if (cachedData && typeof cachedData === "object") {
      cachedData.is_cached = true;
      cachedData.cache_key = matchedKey;
      console.log(`[AutofillCache] HIT for key '${matchedKey}'`);
      telemetry.captureEvent(clientId, "autofill_cache_hit", {
        key: matchedKey,
        url: body.page_url,
      });
      res.json(cachedData);
      return;
    }
  }

  telemetry.captureEvent(clientId, "autofill_cache_miss", { url: body.page_url });

  try {
    const [parsed, actualProvider] = await llmRouter.extractDriveContext(rawText, body.provider, geminiSvc);
    if (parsed && typeof parsed === "object") {
      parsed.company_name = parsed.company_name || "Unknown Company";
      parsed.role = parsed.role || "Technical Role";
      parsed.ctc_text = parsed.ctc_text || "Not Disclosed";
      parsed.additional_details = parsed.additional_details || "";
      parsed.active_provider = actualProvider;
      parsed.is_cached = false;
      parsed.cache_key = cacheKeys[0] || null;

      if (cacheKeys.length > 0) {
        await cacheService.set(cacheKeys, parsed, 86400 * 7);
      }
    }
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ detail: err.message });
  }
});

// Extract PDF from file upload
app.post("/api/extract-pdf", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ detail: "PDF file is required" });
    return;
  }

  if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
    res.status(400).json({ detail: "Only PDF files (.pdf) are supported" });
    return;
  }

  try {
    const data = await pdf(req.file.buffer);
    const fullText = (data.text || "").trim();

    if (!fullText) {
      res.status(400).json({ detail: "No readable text found in PDF (it may contain scanned image pages only)" });
      return;
    }

    let parsedFields: Record<string, any> = {};
    const autoParse = req.body.auto_parse === "true" || req.body.auto_parse === true;

    if (autoParse) {
      try {
        const [parsed] = await llmRouter.extractDriveContext(fullText.slice(0, 12000), "gemini");
        parsedFields = parsed;
      } catch (e: any) {
        console.warn(`[API] Error running LLM extraction on PDF: ${e.message}`);
      }
    }

    res.json({
      filename: req.file.originalname,
      num_pages: data.numpages,
      word_count: fullText.split(/\s+/).length,
      character_count: fullText.length,
      extracted_text: fullText.slice(0, 12000),
      parsed_fields: parsedFields,
    });
  } catch (err: any) {
    res.status(500).json({ detail: `Failed to parse PDF document: ${err.message}` });
  }
});

// Extract PDF from URL
app.post("/api/extract-pdf-from-url", async (req: Request, res: Response) => {
  const body: PdfUrlExtractRequest = req.body;
  if (!body.url || !body.url.trim()) {
    res.status(400).json({ detail: "url is required" });
    return;
  }

  const cleanUrl = body.url.trim();
  try {
    const fetchRes = await safeHttpFetch(cleanUrl, {
      timeout: 30.0,
      max_bytes: 25 * 1024 * 1024,
      headers: { Accept: "application/pdf,*/*" },
    });

    if (fetchRes.status_code !== 200) {
      res.status(400).json({ detail: `Failed to fetch PDF from URL (HTTP ${fetchRes.status_code})` });
      return;
    }

    const data = await pdf(fetchRes.content);
    const fullText = (data.text || "").trim();

    if (!fullText) {
      res.status(400).json({ detail: "No readable text found in PDF (may be scanned image)." });
      return;
    }

    let parsedFields: Record<string, any> = {};
    if (body.auto_parse !== false) {
      try {
        const [parsed] = await llmRouter.extractDriveContext(fullText.slice(0, 12000), "gemini");
        parsedFields = parsed;
      } catch (e: any) {
        console.warn(`[API] Error running LLM extraction on PDF URL: ${e.message}`);
      }
    }

    let filename = cleanUrl.split("/").pop()?.split("?")[0] || "notice_document.pdf";
    if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";

    res.json({
      filename,
      num_pages: data.numpages,
      word_count: fullText.split(/\s+/).length,
      character_count: fullText.length,
      extracted_text: fullText.slice(0, 12000),
      parsed_fields: parsedFields,
      source_url: cleanUrl,
    });
  } catch (err: any) {
    res.status(500).json({ detail: `Failed to process PDF from URL: ${err.message}` });
  }
});

// Analyze Company
app.post("/api/analyze", async (req: Request, res: Response) => {
  const body: CompanyAnalysisRequest = req.body;
  if (!body.company_name || !body.company_name.trim()) {
    res.status(400).json({ detail: "company_name is required" });
    return;
  }

  const cacheKeys = computeCacheKeys(body.company_name, body.role || "Software Engineer", body.page_url);
  const primaryKey = cacheKeys[0];
  const clientId = (req.headers["x-client-id"] as string) || getClientIp(req);

  // 1. Check Cache
  const [cachedData, hitKey] = await cacheService.get(cacheKeys);
  if (cachedData) {
    if (cachedData.campus_intel?.actual_database_questions) {
      const otherCollegesKw = ["dtu", "nsut", "nit", "iit", "bits", "coep", "iiit", "vit", "srm", "manipal", "pes"];
      cachedData.campus_intel.actual_database_questions = cachedData.campus_intel.actual_database_questions.filter((q: any) => {
        const combined = `${q.source_drive || ""} ${q.source || ""} ${q.source_name || ""}`.toLowerCase();
        return !otherCollegesKw.some((col) => combined.includes(col));
      });
      if (cachedData.prep_guide?.actual_database_questions) {
        cachedData.prep_guide.actual_database_questions = cachedData.campus_intel.actual_database_questions;
      }
      if (cachedData.prep_guide?.thapar_past_questions) {
        cachedData.prep_guide.thapar_past_questions = cachedData.campus_intel.actual_database_questions;
      }
    }
    console.log(`[API] ⚡ Served dossier from cache for '${body.company_name}' (${hitKey})`);
    telemetry.captureEvent(clientId, "company_analysis_cache_hit", {
      company: body.company_name,
      role: body.role,
      cache_key: hitKey,
    });
    cachedData.is_cached = true;
    cachedData.cache_key = hitKey;
    res.json(cachedData);
    return;
  }

  // 2. In-flight Deduplication
  const isLeader = await cacheService.acquireDedupLock(primaryKey);
  if (!isLeader) {
    console.log(`[API] Concurrent request detected for '${primaryKey}' - waiting on in-flight leader...`);
    const waited = await cacheService.waitForInFlight(primaryKey, 45000);
    if (waited) {
      const [followData, followKey] = await cacheService.get(cacheKeys);
      if (followData) {
        console.log(`[API] ⚡ Follower received cached result for '${primaryKey}' (${followKey})`);
        followData.is_cached = true;
        followData.cache_key = followKey;
        res.json(followData);
        return;
      }
    }
  }

  const geminiSvc = getGeminiService(req);
  try {
    telemetry.captureEvent(clientId, "company_analysis_started", {
      company: body.company_name,
      role: body.role,
      provider: body.provider,
    });

    const dossier = await orchestrator.executeTaskGraph(body, geminiSvc);
    telemetry.captureEvent(clientId, "company_analysis_success", {
      company: body.company_name,
      role: body.role,
      fit_score: dossier.fit_score,
    });

    // Store in cache
    const dossierDict = JSON.parse(JSON.stringify(dossier));
    dossierDict.is_cached = true;
    dossierDict.cache_key = primaryKey;
    await cacheService.set(cacheKeys, dossierDict);

    // Return fresh to caller
    dossier.is_cached = false;
    dossier.cache_key = primaryKey;
    res.json(dossier);
  } catch (err: any) {
    console.error(`[API] Error analyzing company: ${err.message}`);
    res.status(500).json({ detail: "Internal server error occurred during company analysis. Please try again." });
  } finally {
    if (isLeader) {
      await cacheService.releaseDedupLock(primaryKey);
    }
  }
});

// Cache Stats & Clear
app.get("/api/cache/stats", (req: Request, res: Response) => {
  res.json(cacheService.getStats());
});

app.post("/api/cache/clear", async (req: Request, res: Response) => {
  const adminKey = (req.headers["x-admin-key"] as string || "").trim();
  const clientIp = getClientIp(req);
  const isLocalhost = ["127.0.0.1", "::1", "localhost"].includes(clientIp);

  if (adminKey !== ADMIN_SECRET_KEY && !isLocalhost) {
    res.status(403).json({
      detail: "Forbidden: Administrative privileges or valid X-Admin-Key header required.",
    });
    return;
  }

  await cacheService.clearAll();
  res.json({ status: "success", message: "Cache successfully cleared" });
});

// Chat Doubt Solver with SSE Streaming
app.post("/api/chat", async (req: Request, res: Response) => {
  const body: ChatQueryRequest = req.body;
  if (!body.company_name) {
    res.status(400).json({ detail: "company_name is required" });
    return;
  }

  const clientId = (req.headers["x-client-id"] as string) || getClientIp(req);
  telemetry.captureEvent(clientId, "chat_doubt_asked", {
    company: body.company_name,
    messages_count: body.messages ? body.messages.length : 0,
  });

  const geminiSvc = getGeminiService(req);
  const messages = (body.messages || []).map((m) => ({ role: m.role, content: m.content }));
  const context = { ...(body.context || {}) };
  const targetRole = context.role || "Software Engineer";

  if (!context.prep_guide) context.prep_guide = {};
  if (!context.campus_intel) context.campus_intel = {};

  const thaparQs = context.prep_guide.thapar_past_questions || context.campus_intel.thapar_past_questions || [];

  // Guarantee Optum questions loading
  if ((!thaparQs.length || body.company_name.toLowerCase().includes("optum")) && thaparQs.length < 20) {
    const [enrichedThapar, enrichedOther] = campusService.getCompanyRoleQuestions(
      body.company_name,
      targetRole,
      []
    );
    if (enrichedThapar.length > 0) {
      context.prep_guide.thapar_past_questions = enrichedThapar;
      context.campus_intel.thapar_past_questions = enrichedThapar;
    }
    if (enrichedOther.length > 0 && !context.prep_guide.other_campus_questions) {
      context.prep_guide.other_campus_questions = enrichedOther;
      context.campus_intel.other_campus_questions = enrichedOther;
    }
  }

  // Ground chat with RAG
  const userQuery = messages.length > 0 ? messages[messages.length - 1].content : "";
  try {
    const ragGrounding = ragService.buildGroundedRagContext(body.company_name, userQuery, targetRole);
    if (ragGrounding) {
      context.rag_grounding = ragGrounding;
    }
  } catch (e: any) {
    console.warn(`[API] Note: RAG context grounding skipped: ${e.message}`);
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable Nginx proxy buffering for instant SSE delivery

  try {
    for await (const chunk of llmRouter.streamChat(
      body.company_name,
      context,
      messages,
      body.provider,
      geminiSvc
    )) {
      res.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ delta: `\n[Error: ${err.message}]` })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// RAG Stats & Search
app.get("/api/rag/stats", (req: Request, res: Response) => {
  res.json(ragService.getStats());
});

app.post("/api/rag/search", (req: Request, res: Response) => {
  const query = (req.query.query as string) || (req.body?.query as string) || "";
  const company = (req.query.company as string) || (req.body?.company as string);
  const role = (req.query.role as string) || (req.body?.role as string);

  res.json({
    behavioral: ragService.searchBehavioral(query, 3),
    questions: ragService.searchQuestions(query, company, role, 5),
    interview_experiences: ragService.searchInterviewExperiences(company || "", query, 3),
  });
});

// Mermaid Flowchart Evaluation & Fixing
app.post("/api/evaluate-mermaid", async (req: Request, res: Response) => {
  const body: MermaidEvaluationRequest = req.body;
  if (!body.mermaid_code || !body.mermaid_code.trim()) {
    res.status(400).json({ detail: "mermaid_code is required" });
    return;
  }

  const [correctedCode, fixedBy] = await llmRouter.evaluateAndFixMermaid(
    body.mermaid_code,
    body.error || "",
    body.provider
  );

  res.json({
    valid: true,
    corrected_code: correctedCode,
    original_code: body.mermaid_code,
    fixed_by: fixedBy,
  });
});

// Campus Company Matching
app.get("/api/campus/match", (req: Request, res: Response) => {
  const name = (req.query.name as string) || "";
  const skillsStr = (req.query.skills as string) || "";
  const skills = skillsStr ? skillsStr.split(",").map((s) => s.trim()).filter(Boolean) : [];
  res.json(campusService.matchCompany(name, "", skills));
});

const PORT = parseInt(process.env.PORT || "8000", 10);
if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`==================================================`);
    console.log(`Recruit Copilot TypeScript Engine running on port ${PORT}`);
    console.log(`Endpoint: http://localhost:${PORT}`);
    console.log(`==================================================`);
  });
}

export default app;
