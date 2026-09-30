import http from "http";
import app from "../src/main";
import { campusService } from "../src/services/campus_service";
import { cacheService } from "../src/services/cache_service";
import { ragService } from "../src/services/rag_service";
import axios from "axios";

let server: http.Server;
const TEST_PORT = 8999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("==================================================");
  console.log("🚀 Starting Recruit Copilot TypeScript End-to-End Test Suite");
  console.log("==================================================");

  // Start express server on test port
  await cacheService.clearAll();
  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, "127.0.0.1", () => {
      console.log(`[Test Server] Running on ${BASE_URL}`);
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Root & Health Check Endpoints
    // -------------------------------------------------------------
    console.log("\n[Test 1] Testing Root & Health Check Endpoints...");
    const rootRes = await axios.get(`${BASE_URL}/`);
    assert(rootRes.status === 200, "Root endpoint should return 200");
    assert(rootRes.data.status === "online", "Root status should be 'online'");
    console.log("  ✓ GET / returned status 'online'");

    const healthRes = await axios.get(`${BASE_URL}/api/health`);
    assert(healthRes.status === 200, "Health check should return 200");
    assert(healthRes.data.status === "healthy", "Health status should be 'healthy'");
    assert(typeof healthRes.data.campus_placements_count === "number", "Placements count should be number");
    assert(typeof healthRes.data.question_bank_count === "number", "Question bank count should be number");
    console.log(
      `  ✓ GET /api/health returned healthy (${healthRes.data.campus_placements_count} companies, ${healthRes.data.question_bank_count} questions)`
    );

    const llmStatusRes = await axios.get(`${BASE_URL}/api/llm/status`);
    assert(llmStatusRes.status === 200, "LLM status should return 200");
    assert(llmStatusRes.data.default_provider === "gemini", "Default provider should be gemini");
    console.log(`  ✓ GET /api/llm/status: Provider '${llmStatusRes.data.default_provider}', Gemini: ${llmStatusRes.data.gemini?.status}`);

    // -------------------------------------------------------------
    // Test 2: Campus Service & Fuzzy Entity Resolution
    // -------------------------------------------------------------
    console.log("\n[Test 2] Testing Campus Service & Entity Resolution...");
    const [optumCanonical, optumConf] = campusService.resolveCanonicalCompany("optum");
    assert(optumCanonical === "Optum", "optum alias should resolve to Optum");
    assert(optumConf === 100, "Exact alias confidence should be 100");

    const [jpmcCanonical] = campusService.resolveCanonicalCompany("jpmc");
    assert(jpmcCanonical === "J.P. Morgan", "jpmc alias should resolve to J.P. Morgan");

    const [amexCanonical] = campusService.resolveCanonicalCompany("amex");
    assert(amexCanonical === "American Express", "amex alias should resolve to American Express");

    const campusMatchRes = await axios.get(`${BASE_URL}/api/campus/match?name=Optum`);
    assert(campusMatchRes.status === 200, "Campus match should return 200");
    assert(campusMatchRes.data.matched_company_name === "Optum", "Matched company should be Optum");
    assert(campusMatchRes.data.visited_previously === true, "Optum should have visited previously");
    console.log(`  ✓ Company matching verified for Optum, JPMC, Amex`);

    // Verify known company red flags (Razorpay 5% PPO warning)
    const razorpayFlags = campusService.getKnownCompanyRedFlags("Razorpay");
    assert(razorpayFlags.length > 0, "Razorpay should have known red flags");
    assert(razorpayFlags[0].category.includes("PPO Conversion Rate"), "Should flag low intern PPO conversion");
    console.log("  ✓ Verified institutional red flag: Razorpay 5-10% PPO conversion rate warning");

    // -------------------------------------------------------------
    // Test 3: Mermaid Flowchart Evaluation & Fixing
    // -------------------------------------------------------------
    console.log("\n[Test 3] Testing Mermaid Flowchart Evaluator...");
    const brokenMermaid = `graph TD\n    A[Round 1: OA (DSA & System Design)] --> B[Round 2: Technical Interview (Coding)]`;
    const mermaidRes = await axios.post(`${BASE_URL}/api/evaluate-mermaid`, {
      mermaid_code: brokenMermaid,
      error: "Parse error on character '('",
    });
    assert(mermaidRes.status === 200, "Evaluate mermaid should return 200");
    assert(mermaidRes.data.valid === true, "Corrected mermaid should be valid");
    assert(mermaidRes.data.corrected_code.includes('A["Round 1: OA (DSA & System Design)"]'), "Should wrap labels with quotes");
    console.log("  ✓ Mermaid evaluator fixed unquoted parentheses in node labels");

    // -------------------------------------------------------------
    // Test 4: RAG Vector Engine & Playbook Retrieval
    // -------------------------------------------------------------
    console.log("\n[Test 4] Testing RAG Semantic Knowledge Base...");
    const ragStatsRes = await axios.get(`${BASE_URL}/api/rag/stats`);
    assert(ragStatsRes.status === 200, "RAG stats should return 200");
    assert(ragStatsRes.data.total_indexed_documents > 0, "RAG should have indexed documents");
    console.log(`  ✓ RAG Knowledge Base online with ${ragStatsRes.data.total_indexed_documents} indexed documents`);

    const ragSearchRes = await axios.post(`${BASE_URL}/api/rag/search`, {
      query: "conflict resolution team deadline",
    });
    assert(ragSearchRes.status === 200, "RAG search should return 200");
    assert(Array.isArray(ragSearchRes.data.behavioral), "Behavioral results should be array");
    assert(ragSearchRes.data.behavioral.length > 0, "Should retrieve behavioral scenarios for conflict");
    console.log(`  ✓ RAG semantic search retrieved ${ragSearchRes.data.behavioral.length} STAR behavioral scenarios`);

    // -------------------------------------------------------------
    // Test 5: Drive Context Extraction & Autofill Caching
    // -------------------------------------------------------------
    console.log("\n[Test 5] Testing Drive Context Extraction & Autofill Cache...");
    const sampleNotice = `
      COMPANY NOTICE: Optum Global Solutions
      Role Offered: Software Engineer (TDP)
      Package: CTC INR 14.50 LPA (Base 11.50 LPA + 3.00 LPA Bonus)
      Location: Noida / Gurgaon / Hyderabad
      Eligibility: B.Tech (COE, CSE, ENC, ECE) with CGPA >= 7.00
      Selection Process: Online Assessment on HackerRank followed by 2 Technical Rounds and HR.
    `;

    const extractRes = await axios.post(`${BASE_URL}/api/extract-drive-context`, {
      raw_page_text: sampleNotice,
      page_url: "https://recruit.thapar.edu/jobs/optum-sde-2024",
      force_refresh: true,
    });
    assert(extractRes.status === 200, "Extract should return 200");
    assert(extractRes.data.company_name.toLowerCase().includes("optum"), "Should extract Optum");
    console.log(`  ✓ Extracted drive notice: ${extractRes.data.company_name} - ${extractRes.data.role} (${extractRes.data.ctc_text})`);

    // Test autofill cache hit
    const extractCacheRes = await axios.post(`${BASE_URL}/api/extract-drive-context`, {
      raw_page_text: sampleNotice,
      page_url: "https://recruit.thapar.edu/jobs/optum-sde-2024",
      force_refresh: false,
    });
    assert(extractCacheRes.data.is_cached === true, "Second extraction call should hit autofill cache");
    console.log(`  ✓ Autofill cache hit verified (${extractCacheRes.data.cache_key})`);

    // -------------------------------------------------------------
    // Test 6: Company Analysis Orchestration (/api/analyze)
    // -------------------------------------------------------------
    console.log("\n[Test 6] Testing Full Company Analysis (/api/analyze)...");
    
    // 6A: Optum Analysis (Visiting company with rich DB questions)
    console.log("  -> Analyzing 'Optum'...");
    const optumAnalyzeRes = await axios.post(`${BASE_URL}/api/analyze`, {
      company_name: "Optum",
      role: "Software Engineer",
      ctc_text: "14.5 LPA",
      page_url: "https://recruit.thapar.edu/jobs/optum-tdp-test-uuid",
    });
    assert(optumAnalyzeRes.status === 200, "Optum analysis should return 200");
    const optumDossier = optumAnalyzeRes.data;
    assert(optumDossier.company_name === "Optum", "Company name should be Optum");
    assert(optumDossier.campus_intel.actual_database_questions.length > 20, "Optum should have >20 Thapar questions");
    assert(optumDossier.campus_intel.actual_database_questions.every((q: any) => !["dtu", "nsut", "nit", "bits"].some((col) => (q.source_drive || "").toLowerCase().includes(col))), "actual_database_questions must strictly exclude other colleges");
    assert(Array.isArray(optumDossier.red_flags), "Red flags should be array");
    assert(optumDossier.culture.review_sources.length >= 3, "Should include AmbitionBox, Glassdoor, Reddit sources");
    assert(optumDossier.evaluation?.overall_score >= 80, "Evaluation score should be >= 80");
    console.log(
      `  ✓ Optum Dossier created: ${optumDossier.campus_intel.actual_database_questions.length} Thapar DB questions, Fit: ${optumDossier.fit_score}`
    );

    // 6B: Test Cache for Optum
    console.log("  -> Testing Analysis Cache for 'Optum'...");
    const optumCacheRes = await axios.post(`${BASE_URL}/api/analyze`, {
      company_name: "Optum",
      role: "Software Engineer",
      page_url: "https://recruit.thapar.edu/jobs/optum-tdp-test-uuid",
    });
    assert(optumCacheRes.data.is_cached === true, "Analysis cache should be HIT on repeat request");
    console.log(`  ✓ Analysis Cache HIT verified (${optumCacheRes.data.cache_key})`);

    // 6C: Razorpay Analysis (Testing Thapar-only segregation: 0 DB questions & 5% PPO Red Flag)
    console.log("  -> Analyzing 'Razorpay' (Verifying Thapar-only segregation & 5% PPO warning)...");
    const razorpayAnalyzeRes = await axios.post(`${BASE_URL}/api/analyze`, {
      company_name: "Razorpay",
      role: "Software Engineer",
      ctc_text: "24 LPA",
    });
    assert(razorpayAnalyzeRes.status === 200, "Razorpay analysis should return 200");
    const razorpayDossier = razorpayAnalyzeRes.data;
    assert(razorpayDossier.campus_intel.actual_database_questions.length === 0, "Razorpay must have 0 Thapar database questions");
    const hasPpoWarning = razorpayDossier.red_flags.some((rf: any) => rf.category.includes("PPO Conversion Rate") || rf.finding.includes("PPO"));
    assert(hasPpoWarning, "Razorpay must have the 5-10% intern PPO conversion warning");
    console.log(`  ✓ Razorpay verified: 0 Thapar DB questions, 5% PPO red flag present.`);

    // -------------------------------------------------------------
    // Test 7: Chat Doubt Solver (/api/chat) with SSE Streaming
    // -------------------------------------------------------------
    console.log("\n[Test 7] Testing Chat Doubt Solver with SSE Streaming...");
    const chatReqPayload = {
      company_name: "Optum",
      context: {
        role: "Software Engineer",
        compensation: optumDossier.compensation,
        prep_guide: optumDossier.prep_guide,
        campus_intel: optumDossier.campus_intel,
        culture: optumDossier.culture,
        red_flags: optumDossier.red_flags,
      },
      messages: [
        {
          role: "user",
          content: "What questions were asked by Optum in past year in Thapar for this role?",
        },
      ],
      provider: "gemini",
    };

    const chatStreamRes = await axios.post(`${BASE_URL}/api/chat`, chatReqPayload, {
      responseType: "stream",
      headers: { "Content-Type": "application/json" },
      timeout: 45000,
    });

    assert(chatStreamRes.status === 200, "Chat stream should return 200");
    assert(chatStreamRes.headers["content-type"].includes("text/event-stream"), "Should have text/event-stream content type");

    let streamOutput = "";
    let receivedDone = false;

    await new Promise<void>((resolve, reject) => {
      chatStreamRes.data.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        const lines = text.split("\n\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (dataStr === "[DONE]") {
              receivedDone = true;
            } else {
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.delta) streamOutput += parsed.delta;
              } catch {}
            }
          }
        }
      });
      chatStreamRes.data.on("end", () => {
        resolve();
      });
      chatStreamRes.data.on("error", (err: any) => {
        reject(err);
      });
    });

    assert(receivedDone, "Stream must emit [DONE] marker at termination");
    assert(streamOutput.length > 50, "Stream output should contain response content");
    console.log(`  ✓ Chat SSE streaming successful (${streamOutput.length} characters received, stream terminated cleanly with [DONE])`);

    // -------------------------------------------------------------
    // Test 8: Cache Stats & Clear Endpoints
    // -------------------------------------------------------------
    console.log("\n[Test 8] Testing Cache Stats & Admin Clear...");
    const statsRes = await axios.get(`${BASE_URL}/api/cache/stats`);
    assert(statsRes.status === 200, "Cache stats should return 200");
    assert(statsRes.data.hits >= 2, "Cache should have recorded at least 2 hits");
    console.log(`  ✓ Cache stats verified: ${statsRes.data.hits} hits, ${statsRes.data.writes} writes`);

    const clearRes = await axios.post(
      `${BASE_URL}/api/cache/clear`,
      {},
      { headers: { "X-Admin-Key": "recruitsage-dev-admin-secret" } }
    );
    assert(clearRes.status === 200, "Cache clear should return 200");
    console.log("  ✓ Cache successfully flushed via admin key");

    console.log("\n==================================================");
    console.log("🎉 ALL TESTS PASSED! ZERO ERRORS ENCOUNTERED.");
    console.log("==================================================");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err);
  if (server) server.close();
  process.exit(1);
});
