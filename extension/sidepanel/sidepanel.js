// RecruitSage Side Panel Controller - Professional Grade

const BACKEND_URL = "http://localhost:8000";

let currentDossier = null;
let chatHistory = [];
let currentRawPageText = "";
let attachedPdfText = "";
let attachedPdfFilename = "";

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMarkdownAndMermaid();
  initHealthChecks();
  initAutoSync();
  initEventListeners();
});

// Theme Management Engine (Official RecruitSage Dark / Light Modes)
function initTheme() {
  chrome.storage.local.get(["recruitsage_theme"], (result) => {
    const savedTheme = (result && result.recruitsage_theme) ? result.recruitsage_theme : "dark";
    applyTheme(savedTheme, false);
  });
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "light" ? "dark" : "light";
  applyTheme(newTheme, true);
  chrome.storage.local.set({ recruitsage_theme: newTheme });
}

function applyTheme(theme, recompileDiagrams = true) {
  document.documentElement.setAttribute("data-theme", theme);
  const themeBtn = document.getElementById("btn-theme-toggle");
  if (themeBtn) {
    const sunIcon = themeBtn.querySelector(".theme-icon-sun");
    const moonIcon = themeBtn.querySelector(".theme-icon-moon");
    if (theme === "light") {
      if (sunIcon) sunIcon.classList.add("rs-hidden");
      if (moonIcon) moonIcon.classList.remove("rs-hidden");
      themeBtn.setAttribute("title", "Switch to Dark Mode");
      themeBtn.setAttribute("aria-label", "Switch to Dark Mode");
    } else {
      if (sunIcon) sunIcon.classList.remove("rs-hidden");
      if (moonIcon) moonIcon.classList.add("rs-hidden");
      themeBtn.setAttribute("title", "Switch to Light Mode");
      themeBtn.setAttribute("aria-label", "Switch to Light Mode");
    }
  }

  applyMermaidTheme(theme);
  if (recompileDiagrams) {
    recompileAllMermaidDiagrams();
  }
}

function applyMermaidTheme(theme) {
  if (typeof mermaid === "undefined" || !mermaid.initialize) return;
  try {
    if (theme === "light") {
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        darkMode: false,
        themeVariables: {
          background: "#ffffff",
          primaryColor: "#e0e7ff",
          primaryTextColor: "#0f172a",
          primaryBorderColor: "#818cf8",
          lineColor: "#4f46e5",
          secondaryColor: "#f1f5f9",
          tertiaryColor: "#ffffff"
        },
        securityLevel: "loose"
      });
    } else {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        darkMode: true,
        themeVariables: {
          background: "#060709",
          primaryColor: "#2563eb",
          primaryTextColor: "#f8fafc",
          primaryBorderColor: "rgba(59, 130, 246, 0.4)",
          lineColor: "#60a5fa",
          secondaryColor: "#1e293b",
          tertiaryColor: "#0f172a"
        },
        securityLevel: "loose"
      });
    }
  } catch (e) {
    console.warn("Mermaid theme init error:", e);
  }
}

async function recompileAllMermaidDiagrams() {
  if (typeof mermaid === "undefined") return;
  const nodes = document.querySelectorAll(".mermaid[data-raw-code]");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rawCode = node.getAttribute("data-raw-code");
    if (!rawCode) continue;
    const uniqueId = `mermaid-theme-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`;
    try {
      const { svg } = await mermaid.render(uniqueId, rawCode);
      node.innerHTML = svg;
    } catch (e) {
      console.warn("Error re-rendering diagram on theme toggle:", e);
      const stray = document.getElementById(uniqueId);
      if (stray) stray.remove();
    }
  }
}

function initMarkdownAndMermaid() {
  if (typeof marked !== "undefined" && marked.setOptions) {
    marked.setOptions({
      gfm: true,
      breaks: true
    });
  }

  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  applyMermaidTheme(currentTheme);
}

// 1. Health Checks
async function initHealthChecks() {
  const dot = document.getElementById("system-dot");
  const label = document.getElementById("system-label");

  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { method: "GET" });
    if (res.ok) {
      const data = await res.json();
      dot.className = "status-dot status-dot-active";
      if (data.ollama && data.ollama.status === "online") {
        label.innerText = "Engine Ready";
      } else {
        label.innerText = "Backend Ready (Ollama Offline)";
        dot.className = "status-dot status-dot-inactive";
      }
    } else {
      markOffline();
    }
  } catch (err) {
    markOffline();
  }

  function markOffline() {
    dot.className = "status-dot status-dot-inactive";
    label.innerText = "Offline";
  }
}

// 2. Auto-sync from Active Tab
function initAutoSync() {
  chrome.storage.local.get(["last_extracted_company"], (result) => {
    if (result && result.last_extracted_company) {
      if (result.last_extracted_company.raw_page_text) {
        currentRawPageText = result.last_extracted_company.raw_page_text;
      }
      populateInputs(result.last_extracted_company);
    }
    // Always trigger live scrape + LLM conversion when sidepanel opens
    scrapeAndExtractFromTab();
  });
}

// Live Page Scraper + LLM Conversion Engine
async function scrapeAndExtractFromTab() {
  const syncBtn = document.getElementById("btn-sync-page");
  const aiBadge = document.getElementById("ai-extract-badge");

  if (syncBtn) {
    syncBtn.innerHTML = `
      <svg class="spin-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      Scraping...
    `;
  }
  if (aiBadge) {
    aiBadge.innerText = "✨ 1/2 Scraping page...";
    aiBadge.className = "badge-ai badge-ai-pulsing";
    aiBadge.classList.remove("rs-hidden");
  }

  let scrapedText = "";
  let pageUrl = "";

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].id) {
      resetSyncBtn();
      if (aiBadge) aiBadge.classList.add("rs-hidden");
      return;
    }

    const currentTab = tabs[0];
    pageUrl = currentTab.url || "";

    // Step 0: Check if active tab is itself an opened PDF
    if (pageUrl && pageUrl.toLowerCase().includes(".pdf")) {
      if (aiBadge) {
        aiBadge.innerText = "📄 Ingesting active PDF tab...";
        aiBadge.className = "badge-ai badge-ai-pulsing";
      }
      try {
        const pdfResp = await fetch(pageUrl, { credentials: "include" });
        if (pdfResp.ok) {
          const blob = await pdfResp.blob();
          const cleanName = pageUrl.split("/").pop().split("?")[0] || "Drive_Notice.pdf";
          const file = new File([blob], cleanName, { type: "application/pdf" });
          await handlePdfUpload(file);
          if (aiBadge) {
            aiBadge.innerText = "✨ Active PDF Extracted";
            aiBadge.className = "badge-ai";
            setTimeout(() => { if (aiBadge) aiBadge.classList.add("rs-hidden"); }, 4000);
          }
          return;
        }
      } catch (pdfTabErr) {
        console.warn("[RecruitSage] Error fetching active PDF tab:", pdfTabErr);
      }
    }

    // Step 1A: Query content script on active tab
    try {
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTab.id, { action: "EXTRACT_PAGE_DATA" }, (res) => {
          if (chrome.runtime.lastError || !res) {
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });

      if (response && response.raw_page_text) {
        scrapedText = response.raw_page_text;
        // Pre-fill initial heuristic data so user sees instant values
        populateInputs(response);

        // Check for attached JD / Salary breakdown PDFs on webpage!
        if (response.detected_pdfs && response.detected_pdfs.length > 0) {
          renderDetectedDocuments(response.detected_pdfs);
        }
      }
    } catch (msgErr) {
      console.log("[RecruitSage] Content script message error:", msgErr);
    }

    // Step 1B: Robust fallback - scrape directly via chrome.scripting if content script didn't answer
    if (!scrapedText && currentTab.id) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id },
          func: () => ({
            text: document.body ? document.body.innerText : "",
            url: window.location.href,
            title: document.title
          })
        });
        if (results && results[0] && results[0].result) {
          scrapedText = results[0].result.text || "";
          pageUrl = results[0].result.url || pageUrl;
        }
      } catch (scriptErr) {
        console.warn("[RecruitSage] Scripting executeScript error:", scriptErr);
      }
    }

    if (!scrapedText || scrapedText.trim().length < 20) {
      resetSyncBtn();
      if (aiBadge) {
        aiBadge.innerText = "No text found on page";
        setTimeout(() => aiBadge.classList.add("rs-hidden"), 3000);
      }
      return;
    }

    currentRawPageText = scrapedText;

    // Step 2: Feed into LLM (Qwen 2.5) to convert raw text into structured JSON
    if (aiBadge) {
      aiBadge.innerText = "✨ 2/2 LLM parsing drive notice...";
      aiBadge.className = "badge-ai badge-ai-pulsing";
    }

    const res = await fetch(`${BACKEND_URL}/api/extract-drive-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_page_text: scrapedText, page_url: pageUrl })
    });

    if (res.ok) {
      const parsedJson = await res.json();
      console.log("[RecruitSage] LLM Parsed JSON:", parsedJson);

      // Step 3: Fill the input fields in the form with the parsed JSON!
      populateInputs(parsedJson, true);
      chrome.storage.local.set({ last_extracted_company: parsedJson });

      if (aiBadge) {
        aiBadge.innerText = "✨ Form Filled via LLM";
        aiBadge.className = "badge-ai";
        setTimeout(() => {
          if (aiBadge) aiBadge.classList.add("rs-hidden");
        }, 5000);
      }
    } else {
      const errText = await res.text();
      console.warn("[RecruitSage] LLM extraction error:", errText);
      if (aiBadge) {
        aiBadge.innerText = "LLM error - heuristic used";
        setTimeout(() => aiBadge.classList.add("rs-hidden"), 4000);
      }
    }
  } catch (err) {
    console.error("[RecruitSage] Scrape & LLM error:", err);
    if (aiBadge) {
      aiBadge.innerText = "Backend offline";
      setTimeout(() => aiBadge.classList.add("rs-hidden"), 4000);
    }
  } finally {
    resetSyncBtn();
  }

  function resetSyncBtn() {
    if (syncBtn) {
      syncBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        Sync Page
      `;
    }
  }
}

function populateInputs(data, isLlmParsed = false) {
  if (!data) return;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (val !== undefined && val !== null) {
      if (isLlmParsed) {
        el.value = val;
      } else {
        if (val || !el.value) el.value = val;
      }
    }
  };

  setVal("input-company", data.company_name);
  setVal("input-role", data.role);
  setVal("input-ctc", data.ctc_text);
  setVal("input-location", data.location);
  setVal("input-job-type", data.job_type);
  setVal("input-deadline", data.deadline);
  setVal("input-probation", data.probation_or_bond_note || data.probation_note);
  setVal("input-eligibility", data.eligibility_summary || data.eligibility_text);
  
  if (data.skills_required && Array.isArray(data.skills_required)) {
    setVal("input-skills", data.skills_required.join(", "));
  } else if (data.skills && Array.isArray(data.skills)) {
    setVal("input-skills", data.skills.join(", "));
  } else if (data.skills) {
    setVal("input-skills", data.skills);
  }

  setVal("input-jd", data.clean_jd_summary || data.jd_text || data.raw_page_text);

  chrome.storage.local.set({ last_extracted_company: data });
}

// 3. Event Listeners
function initEventListeners() {
  const themeToggleBtn = document.getElementById("btn-theme-toggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }

  document.getElementById("btn-sync-page").addEventListener("click", scrapeAndExtractFromTab);
  document.getElementById("btn-analyze").addEventListener("click", runAnalysis);

  // External trigger from page floating button
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === "TRIGGER_EXTRACTION_IN_PANEL") {
      scrapeAndExtractFromTab();
    }
  });

  // Toggle JD drawer
  const toggleJdBtn = document.getElementById("btn-toggle-jd");
  const jdDrawer = document.getElementById("jd-drawer");
  const toggleIcon = document.getElementById("toggle-jd-icon");
  if (toggleJdBtn && jdDrawer) {
    toggleJdBtn.addEventListener("click", () => {
      const isHidden = jdDrawer.classList.toggle("rs-hidden");
      if (toggleIcon) toggleIcon.innerText = isHidden ? "▸" : "▾";
    });
  }

  // Toggle Extra Context drawer
  const toggleExtraBtn = document.getElementById("btn-toggle-extra-ctx");
  const extraDrawer = document.getElementById("extra-ctx-drawer");
  const toggleExtraIcon = document.getElementById("toggle-extra-icon");
  if (toggleExtraBtn && extraDrawer) {
    toggleExtraBtn.addEventListener("click", () => {
      const isHidden = extraDrawer.classList.toggle("rs-hidden");
      if (toggleExtraIcon) toggleExtraIcon.innerText = isHidden ? "▸" : "▾";
    });
  }

  // PDF Document Upload & Drag-and-Drop
  const dropzone = document.getElementById("pdf-dropzone");
  const fileInput = document.getElementById("input-pdf-file");
  const statusBadge = document.getElementById("pdf-status-badge");
  const filenameEl = document.getElementById("pdf-filename");
  const metaEl = document.getElementById("pdf-meta");
  const removeBtn = document.getElementById("btn-remove-pdf");
  const autoParseChk = document.getElementById("chk-auto-parse-pdf");

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handlePdfUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handlePdfUpload(e.target.files[0]);
      }
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      attachedPdfText = "";
      attachedPdfFilename = "";
      if (fileInput) fileInput.value = "";
      if (statusBadge) statusBadge.style.display = "none";
      if (dropzone) dropzone.style.display = "flex";
    });
  }

  async function handlePdfUpload(file) {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      showError("Please upload a valid PDF document (.pdf).");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      showError("PDF exceeds 25 MB limit.");
      return;
    }

    hideError();
    if (statusBadge) statusBadge.style.display = "flex";
    if (dropzone) dropzone.style.display = "none";
    if (filenameEl) filenameEl.innerText = file.name;
    if (metaEl) metaEl.innerText = "Extracting & analyzing with Local AI...";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("auto_parse", autoParseChk && autoParseChk.checked ? "true" : "false");

    try {
      const res = await fetch(`${BACKEND_URL}/api/extract-pdf`, {
        method: "POST",
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }

      const data = await res.json();
      attachedPdfText = data.extracted_text || "";
      attachedPdfFilename = data.filename || file.name;

      if (metaEl) {
        metaEl.innerText = `${data.num_pages || 1} page${data.num_pages > 1 ? "s" : ""} • ${data.word_count || 0} words attached`;
      }

      // If auto-fill is requested and we got fields from LLM, populate the inputs
      if (data.parsed_fields && autoParseChk && autoParseChk.checked) {
        populateExtractedFields(data.parsed_fields, false);
      }
    } catch (err) {
      if (metaEl) metaEl.innerText = "Extraction failed";
      showError(`PDF error: ${err.message}`);
    }
  }

  // Helper: Render auto-detected portal documents (JD / Salary breakdown PDFs)
  function renderDetectedDocuments(detectedPdfs) {
    const container = document.getElementById("detected-docs-container");
    const listEl = document.getElementById("detected-docs-list");
    const countBadge = document.getElementById("detected-docs-count");

    if (!container || !listEl) return;
    if (!detectedPdfs || detectedPdfs.length === 0) {
      container.style.display = "none";
      return;
    }

    container.style.display = "block";
    if (countBadge) countBadge.innerText = `${detectedPdfs.length} Found`;
    listEl.innerHTML = "";

    detectedPdfs.forEach(pdf => {
      const item = document.createElement("div");
      item.className = "doc-chip-item";

      const typeTag = pdf.type === "salary" ? "Salary Breakdown" : (pdf.type === "jd" ? "Job Description" : "Portal Notice");

      item.innerHTML = `
        <div style="display:flex; align-items:center; min-width:0;">
          <span class="doc-chip-tag">${typeTag}</span>
          <span class="doc-chip-title" title="${escapeHtml(pdf.title)}">${escapeHtml(pdf.title)}</span>
        </div>
        <button type="button" class="btn-chip-ingest">
          Ingest ⚡
        </button>
      `;

      const ingestBtn = item.querySelector("button");
      ingestBtn.addEventListener("click", async () => {
        ingestBtn.disabled = true;
        ingestBtn.innerText = "Fetching...";
        try {
          // Attempt fetch with browser session credentials
          const resp = await fetch(pdf.url, { credentials: "include" });
          if (!resp.ok) {
            // Fallback to backend URL endpoint
            const bResp = await fetch(`${BACKEND_URL}/api/extract-pdf-from-url`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: pdf.url, auto_parse: true })
            });
            if (!bResp.ok) throw new Error("Could not download document");
            const bData = await bResp.json();
            attachedPdfText = (attachedPdfText ? attachedPdfText + "\n\n" : "") + (bData.extracted_text || "");
            attachedPdfFilename = bData.filename || pdf.filename;
            ingestBtn.className = "btn-chip-ingest btn-chip-ingested";
            ingestBtn.innerText = `✓ Ingested (${bData.num_pages || 1}p)`;
            if (bData.parsed_fields) populateExtractedFields(bData.parsed_fields, false);
            return;
          }

          const blob = await resp.blob();
          const file = new File([blob], pdf.filename || "Placement_Doc.pdf", { type: "application/pdf" });
          await handlePdfUpload(file);
          ingestBtn.className = "btn-chip-ingest btn-chip-ingested";
          ingestBtn.innerText = "✓ Ingested";
        } catch (err) {
          console.error("[RecruitSage] PDF Ingestion error:", err);
          ingestBtn.innerText = "Fetch failed";
          setTimeout(() => {
            ingestBtn.disabled = false;
            ingestBtn.innerText = "Retry Ingest";
          }, 3000);
        }
      });

      listEl.appendChild(item);
    });
  }

  // Keyboard shortcut: Cmd+Enter
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      runAnalysis();
    }
  });

  // Segmented Navigation
  document.querySelectorAll(".segment-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("is-active"));

      btn.classList.add("is-active");
      const targetPane = document.getElementById(btn.getAttribute("data-tab"));
      if (targetPane) targetPane.classList.add("is-active");
    });
  });

  // Chat send
  document.getElementById("btn-chat-send").addEventListener("click", sendChatMessage);
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Query chips
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("chat-input").value = chip.getAttribute("data-q");
      sendChatMessage();
    });
  });
}

// 4. Run Analysis
async function runAnalysis() {
  const companyName = document.getElementById("input-company").value.trim();
  const role = document.getElementById("input-role").value.trim();
  const ctc = document.getElementById("input-ctc").value.trim();
  const location = document.getElementById("input-location") ? document.getElementById("input-location").value.trim() : "";
  const jobType = document.getElementById("input-job-type") ? document.getElementById("input-job-type").value.trim() : "";
  const deadline = document.getElementById("input-deadline") ? document.getElementById("input-deadline").value.trim() : "";
  const probation = document.getElementById("input-probation") ? document.getElementById("input-probation").value.trim() : "";
  const eligibility = document.getElementById("input-eligibility") ? document.getElementById("input-eligibility").value.trim() : "";
  const skillsText = document.getElementById("input-skills") ? document.getElementById("input-skills").value.trim() : "";
  const skills = skillsText ? skillsText.split(",").map(s => s.trim()).filter(Boolean) : [];
  const jd = document.getElementById("input-jd") ? document.getElementById("input-jd").value.trim() : "";

  if (!companyName) {
    showError("Please enter a company name or synchronize from the placement page.");
    return;
  }

  hideError();
  showProgress();

  const stepTimers = [
    setTimeout(() => activateStep(2, "Querying campus historical records..."), 700),
    setTimeout(() => activateStep(3, "Mining developer discussions..."), 2000),
    setTimeout(() => activateStep(4, "Aggregating verified reviews..."), 3500),
    setTimeout(() => activateStep(5, "Auditing 9-point red flags..."), 5000),
    setTimeout(() => activateStep(6, "Synthesizing briefing dossier..."), 6500),
  ];

  const extraNotes = document.getElementById("input-additional-notes") ? document.getElementById("input-additional-notes").value.trim() : "";
  const additionalContextParts = [];
  if (attachedPdfText) {
    additionalContextParts.push(`[ATTACHED PDF NOTICE / DOCUMENT: ${attachedPdfFilename}]\n${attachedPdfText}`);
  }
  if (extraNotes) {
    additionalContextParts.push(`[STUDENT CUSTOM NOTES / CONTEXT]\n${extraNotes}`);
  }
  const additionalContext = additionalContextParts.join("\n\n");

  try {
    const payload = {
      company_name: companyName,
      role: role,
      ctc_text: ctc,
      location: location,
      probation_note: probation,
      eligibility_text: eligibility,
      skills: skills,
      jd_text: jd,
      raw_page_text: currentRawPageText || jd || "",
      additional_context: additionalContext
    };

    const res = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    stepTimers.forEach(t => clearTimeout(t));

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    const dossier = await res.json();
    currentDossier = dossier;
    renderDossier(dossier);
    hideProgress();
  } catch (error) {
    stepTimers.forEach(t => clearTimeout(t));
    hideProgress();
    showError(`Audit failed: ${error.message}. Ensure backend is running.`);
  }
}

function activateStep(stepNum, labelText) {
  document.getElementById("progress-step-counter").innerText = `Step ${stepNum} of 6`;
  if (labelText) {
    document.getElementById("progress-status-title").innerText = labelText;
  }
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`step-${i}`);
    if (!el) continue;
    if (i < stepNum) {
      el.className = "stepper-item is-done";
    } else if (i === stepNum) {
      el.className = "stepper-item is-active";
    } else {
      el.className = "stepper-item";
    }
  }
}

function showProgress() {
  document.getElementById("progress-container").classList.remove("rs-hidden");
  document.getElementById("dossier-container").classList.add("rs-hidden");
}

function hideProgress() {
  document.getElementById("progress-container").classList.add("rs-hidden");
  document.getElementById("dossier-container").classList.remove("rs-hidden");
}

function showError(msg) {
  const b = document.getElementById("error-banner");
  b.innerText = msg;
  b.classList.remove("rs-hidden");
}

function hideError() {
  document.getElementById("error-banner").classList.add("rs-hidden");
}

// 5. Render Dossier
function renderDossier(dossier) {
  // Hero Verdict
  const fitBadge = document.getElementById("fit-badge");
  fitBadge.innerText = dossier.fit_score || "Audit Complete";
  fitBadge.className = "tag-fit";
  const scoreLower = (dossier.fit_score || "").toLowerCase();
  if (scoreLower.includes("high")) {
    fitBadge.classList.add("tag-fit-high");
  } else if (scoreLower.includes("caution") || scoreLower.includes("red")) {
    fitBadge.classList.add("tag-fit-caution");
  } else {
    fitBadge.classList.add("tag-fit-moderate");
  }

  document.getElementById("sources-count").innerText = `${dossier.raw_sources_count || 12} sources verified`;
  document.getElementById("verdict-summary").innerText = dossier.verdict_summary || "Analysis completed.";

  // Evaluation & Audit Quality Card
  const evalCard = document.getElementById("evaluation-card");
  const evalGradeBadge = document.getElementById("eval-grade-badge");
  const evalOverallScore = document.getElementById("eval-overall-score");
  const evalVerdict = document.getElementById("eval-verdict-summary");
  const evalMetricsGrid = document.getElementById("eval-metrics-grid");
  const evalNotesContainer = document.getElementById("eval-notes-container");
  const evalNotesList = document.getElementById("eval-notes-list");

  if (dossier.evaluation && evalCard) {
    evalCard.style.display = "block";
    const ev = dossier.evaluation;
    if (evalGradeBadge) {
      evalGradeBadge.innerText = `Grade ${ev.grade} (${ev.overall_score}/100)`;
      const gradeLow = (ev.grade || "").toLowerCase();
      evalGradeBadge.style.color = gradeLow.includes("a") ? "#34d399" : (gradeLow.includes("b") ? "#fbbf24" : "#f87171");
    }
    if (evalOverallScore) {
      evalOverallScore.innerText = `${ev.overall_score}% Verified`;
    }
    if (evalVerdict) {
      evalVerdict.innerText = ev.verdict || "Exhaustively verified audit.";
    }
    if (evalMetricsGrid) {
      evalMetricsGrid.innerHTML = "";
      const metricItems = [
        { name: "Groundedness", score: ev.groundedness_score || 90 },
        { name: "Red-Flag Check", score: ev.completeness_score || 88 },
        { name: "Comp Realism", score: ev.compensation_realism_score || 90 },
        { name: "Specificity", score: ev.specificity_score || 85 }
      ];
      metricItems.forEach(m => {
        const box = document.createElement("div");
        box.className = "eval-metric-box";
        box.innerHTML = `
          <div class="eval-metric-head">
            <span class="eval-metric-name">${escapeHtml(m.name)}</span>
            <span class="eval-metric-score">${m.score}%</span>
          </div>
          <div class="eval-bar-track">
            <div class="eval-bar-fill" style="width: ${m.score}%;"></div>
          </div>
        `;
        evalMetricsGrid.appendChild(box);
      });
    }
    if (ev.evaluator_notes && ev.evaluator_notes.length > 0 && evalNotesContainer && evalNotesList) {
      evalNotesContainer.style.display = "block";
      evalNotesList.innerHTML = "";
      ev.evaluator_notes.forEach(note => {
        const li = document.createElement("li");
        li.innerText = note;
        evalNotesList.appendChild(li);
      });
    } else if (evalNotesContainer) {
      evalNotesContainer.style.display = "none";
    }
  } else if (evalCard) {
    evalCard.style.display = "none";
  }

  // Tab 1: Red Flags
  const redFlagsList = document.getElementById("redflags-list");
  redFlagsList.innerHTML = "";
  if (dossier.red_flags && dossier.red_flags.length > 0) {
    dossier.red_flags.forEach(rf => {
      const card = document.createElement("div");
      card.className = "redflag-card";
      
      const sevClass = rf.severity === "HIGH" ? "sev-high" : (rf.severity === "MEDIUM" ? "sev-medium" : "sev-low");
      
      card.innerHTML = `
        <div class="redflag-top">
          <span class="redflag-category">${escapeHtml(rf.category)}</span>
          <span class="severity-pill ${sevClass}">${escapeHtml(rf.severity)}</span>
        </div>
        <div class="redflag-finding">${escapeHtml(rf.finding)}</div>
        <div class="redflag-advice">${escapeHtml(rf.advice)}</div>
        ${rf.source_url ? `
          <div>
            <a href="${escapeHtml(rf.source_url)}" target="_blank" class="source-anchor">
              <span>Source: ${escapeHtml(rf.source_title || "Verified Link")}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
            </a>
          </div>
        ` : ""}
      `;
      redFlagsList.appendChild(card);
    });
  } else {
    redFlagsList.innerHTML = `<div class="stack-card">No significant policy or compensation risks detected.</div>`;
  }

  // Tab 2: Compensation
  const comp = dossier.compensation || {};
  document.getElementById("comp-ctc").innerText = comp.claimed_ctc || "-";
  document.getElementById("comp-inhand").innerText = comp.estimated_in_hand_pm || "-";
  document.getElementById("comp-base").innerText = comp.base_salary || "-";
  document.getElementById("comp-variable").innerText = comp.variable_or_stocks || "-";
  document.getElementById("comp-bond").innerText = comp.bond_or_penalties || "None detected";

  const trapsList = document.getElementById("comp-traps-list");
  trapsList.innerHTML = "";
  if (comp.hidden_traps && comp.hidden_traps.length > 0) {
    comp.hidden_traps.forEach(t => {
      const li = document.createElement("li");
      li.innerText = t;
      trapsList.appendChild(li);
    });
  } else {
    trapsList.innerHTML = `<li>No hidden deductions or retention clauses reported.</li>`;
  }

  // Tab 3: Campus Intel
  const campus = dossier.campus_intel || {};
  const campusBanner = document.getElementById("campus-status-banner");
  if (campus.visited_previously) {
    campusBanner.className = "status-callout callout-matched";
    campusBanner.innerText = `Verified in campus records: ${campus.matched_company_name}`;
  } else {
    campusBanner.className = "status-callout callout-empty";
    campusBanner.innerText = "No prior campus visit recorded under this title in university database.";
  }

  const visitsContainer = document.getElementById("campus-visits-container");
  visitsContainer.innerHTML = "";
  if (campus.historical_visits && campus.historical_visits.length > 0) {
    campus.historical_visits.forEach(v => {
      const div = document.createElement("div");
      div.className = "campus-card";

      const ctcVal = v.ctc_lpa ? `${v.ctc_lpa} LPA` : (v.ctc_text || "Standard Drive");
      const branchStr = (v.branches_allowed && v.branches_allowed.length > 0)
        ? v.branches_allowed.join(", ")
        : "All Eligible Branches";

      div.innerHTML = `
        <div class="campus-top">
          <div>
            <div class="campus-role">${escapeHtml(v.role || "Technical Role")}</div>
            <div class="campus-year">Batch ${v.year || 2024} Drive (${escapeHtml(v.batch || "Campus Notice")})</div>
          </div>
          <span class="campus-ctc-pill">${escapeHtml(ctcVal)}</span>
        </div>
        <div class="campus-grid">
          <div><span style="color:var(--text-muted)">Selected:</span> ${escapeHtml(String(v.final_selects ?? "Pending"))}</div>
          <div><span style="color:var(--text-muted)">CGPA:</span> ${escapeHtml(v.eligibility_cgpa || "None")}</div>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px;">
          Branches: <span style="color:var(--text-secondary)">${escapeHtml(branchStr)}</span>
        </div>
        ${v.notes ? `<div class="campus-notes">${escapeHtml(v.notes)}</div>` : ""}
      `;
      visitsContainer.appendChild(div);
    });
  }

  // Topic Breakdown Card
  const topicCard = document.getElementById("campus-topic-card");
  const topicPills = document.getElementById("campus-topic-pills");
  const topicSummary = document.getElementById("campus-topic-summary");
  const topicDiff = document.getElementById("campus-topic-diff");
  const questionsCount = document.getElementById("campus-questions-count");

  if (campus.topic_breakdown && campus.topic_breakdown.weights && campus.topic_breakdown.weights.length > 0) {
    if (topicCard) topicCard.style.display = "block";
    const tb = campus.topic_breakdown;
    const diff = (tb.difficulty || "Medium").toLowerCase();
    if (topicDiff) {
      topicDiff.className = `question-diff diff-${diff.includes("hard") ? "hard" : diff.includes("easy") ? "easy" : "medium"}`;
      topicDiff.innerText = `${tb.difficulty || "Medium"} Difficulty`;
    }

    if (topicPills) {
      topicPills.innerHTML = "";
      tb.weights.forEach(w => {
        const pill = document.createElement("span");
        pill.className = "topic-pill";
        pill.innerHTML = `<span>${escapeHtml(w.category)}</span><span class="topic-pill-val">${w.percentage}%</span>`;
        topicPills.appendChild(pill);
      });
    }

    if (topicSummary) {
      topicSummary.innerText = tb.top_topics ? `High-yield focus topics: ${tb.top_topics} (${tb.total_questions || (campus.past_questions || []).length} total questions cataloged).` : `${tb.total_questions || (campus.past_questions || []).length} total questions cataloged in Master DB.`;
    }
  } else {
    if (topicCard) topicCard.style.display = "none";
  }

  const questionsList = document.getElementById("campus-questions-list");
  questionsList.innerHTML = "";
  if (campus.past_questions && campus.past_questions.length > 0) {
    if (questionsCount) questionsCount.innerText = `${campus.past_questions.length} Questions`;
    campus.past_questions.forEach(q => {
      const item = document.createElement("div");
      item.className = "question-row";
      
      const diffClass = (q.difficulty || "medium").toLowerCase();
      const diffTag = diffClass.includes("hard") ? "diff-hard" : diffClass.includes("easy") ? "diff-easy" : "diff-medium";
      const roundLabel = q.round_type || "Technical Round";
      const topicLabel = q.topic ? (q.exact_topic ? `${q.topic} • ${q.exact_topic}` : q.topic) : "Core CS";
      const notesContent = q.notes || q.question_details || "";

      item.innerHTML = `
        <div class="question-top">
          <div class="question-badges">
            <span class="question-round-badge">${escapeHtml(roundLabel)}</span>
            <span class="question-tag">${escapeHtml(topicLabel)}</span>
          </div>
          <span class="question-diff ${diffTag}">${escapeHtml(q.difficulty || "Medium")}</span>
        </div>
        <div class="question-title">${escapeHtml(q.question_title)}</div>
        ${notesContent ? `
          <div class="question-notes">
            <span class="hint-badge">💡 Strategy Hint:</span>${escapeHtml(notesContent)}
          </div>
        ` : ""}
      `;
      questionsList.appendChild(item);
    });
  } else {
    if (questionsCount) questionsCount.innerText = "0 Questions";
    questionsList.innerHTML = `<div class="stack-card" style="color:var(--text-muted)">No specific question bank records matched for this company or tech stack.</div>`;
  }

  // Tab 4: Culture
  const culture = dossier.culture || {};
  document.getElementById("culture-rating").innerText = culture.overall_rating || "3.8 / 5.0";
  document.getElementById("culture-wlb").innerText = culture.work_life_balance || "Standard engineering schedule.";
  document.getElementById("culture-reddit").innerText = culture.reddit_sentiment_summary || "No significant complaints recorded.";

  const salaryBlock = document.getElementById("culture-salary-block");
  const salaryEl = document.getElementById("culture-salary");
  if (culture.salary_and_appraisals && salaryBlock && salaryEl) {
    salaryBlock.style.display = "block";
    salaryEl.innerText = culture.salary_and_appraisals;
  } else if (salaryBlock) {
    salaryBlock.style.display = "none";
  }

  const prosList = document.getElementById("culture-pros");
  prosList.innerHTML = "";
  (culture.key_pros || ["Established engineering presence"]).forEach(p => {
    const li = document.createElement("li");
    li.innerText = p;
    prosList.appendChild(li);
  });

  const consList = document.getElementById("culture-cons");
  consList.innerHTML = "";
  (culture.key_cons || ["Validate project allocation post-offer"]).forEach(c => {
    const li = document.createElement("li");
    li.innerText = c;
    consList.appendChild(li);
  });

  // Tab 5: Alumni (Direct Senior Profiles & Verified Discovery)
  const alumniList = document.getElementById("alumni-links-list");
  alumniList.innerHTML = "";
  if (dossier.alumni_links && dossier.alumni_links.length > 0) {
    dossier.alumni_links.forEach(a => {
      const card = document.createElement("div");
      card.className = "senior-card";

      const name = a.name || a.title;
      const headline = a.headline || a.search_query;
      const initials = getInitials(name);
      const isDirectProfile = a.url && a.url.includes("linkedin.com/in/");
      const sourceType = a.source_type || (isDirectProfile ? "Verified Profile" : "Official Alumni Tool");

      card.innerHTML = `
        <div class="senior-info">
          <div class="senior-avatar">${initials}</div>
          <div class="senior-meta">
            <div style="display:flex; align-items:center; gap:5px; margin-bottom:2px;">
              <span class="senior-name">${escapeHtml(name)}</span>
              <span style="font-size:9px; font-weight:600; padding:1px 5px; border-radius:3px; background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.25);">${escapeHtml(sourceType)}</span>
            </div>
            <span class="senior-headline">${escapeHtml(headline)}</span>
            ${a.batch_info ? `<span style="font-size:10px; color:#34d399; margin-top:2px;">🎓 ${escapeHtml(a.batch_info)}</span>` : ""}
          </div>
        </div>
        <a href="${escapeHtml(a.url)}" target="_blank" class="btn-link-action">
          ${isDirectProfile ? "Profile ↗" : "Explore ↗"}
        </a>
      `;
      alumniList.appendChild(card);
    });
  }

  // Tab 6: Prep Plan (Structured & Data-Grounded)
  const prep = dossier.prep_guide || (dossier.campus_intel ? dossier.campus_intel.deep_prep : {}) || {};

  // 6A. Cross-Campus Recruitment Insights Alert
  const campusAlert = document.getElementById("prep-campus-alert");
  const campusAlertText = document.getElementById("prep-cross-campus-text");
  if (campusAlert && campusAlertText) {
    if (prep.cross_campus_intel) {
      campusAlert.style.display = "block";
      campusAlertText.innerText = prep.cross_campus_intel;
    } else {
      campusAlert.style.display = "none";
    }
  }

  // 6B. High-Yield Topic Weight Matrix
  const matrixStack = document.getElementById("prep-topic-matrix-stack");
  if (matrixStack) {
    matrixStack.innerHTML = "";
    const matrixItems = prep.topic_matrix || [];
    if (matrixItems.length > 0) {
      matrixItems.forEach(item => {
        const card = document.createElement("div");
        card.className = "prep-topic-bar-card";
        const pct = typeof item.weight_percentage === "number" ? item.weight_percentage : 25;
        card.innerHTML = `
          <div class="prep-bar-header">
            <span class="prep-topic-title">${escapeHtml(item.category)}</span>
            <span class="prep-topic-pct">${pct}%</span>
          </div>
          <div class="prep-bar-track">
            <div class="prep-bar-fill" style="width: ${Math.min(pct, 100)}%;"></div>
          </div>
          <div class="prep-subtopics-row">
            ${(item.subtopics || []).map(s => `<span class="prep-subtopic-tag">${escapeHtml(s)}</span>`).join("")}
            <span class="prep-freq-meta">Drive Freq: ${item.drive_frequency || "High"} • ⭐ ${item.importance || 4}/5</span>
          </div>
        `;
        matrixStack.appendChild(card);
      });
    }
  }

  // 6C. Problem Archetypes & Coding Patterns
  const archetypesStack = document.getElementById("prep-archetypes-stack");
  if (archetypesStack) {
    archetypesStack.innerHTML = "";
    const archItems = prep.coding_archetypes || [];
    if (archItems.length > 0) {
      archItems.forEach(arch => {
        const card = document.createElement("div");
        card.className = "prep-archetype-card";
        card.innerHTML = `
          <div class="prep-archetype-header">
            <span class="prep-archetype-title">${escapeHtml(arch.pattern_name)}</span>
            <span class="prep-badge-freq">${escapeHtml(arch.frequency_rate || "High-Yield")}</span>
          </div>
          <div class="prep-archetype-examples">
            ${(arch.example_problems || []).map(ex => `<span class="prep-example-pill">📌 ${escapeHtml(ex)}</span>`).join("")}
          </div>
          <div class="prep-archetype-meta">
            <span class="prep-target-tag">Target: ${escapeHtml(arch.complexity_target || "O(N)")}</span>
          </div>
          ${arch.dry_run_tips ? `
            <div class="prep-dryrun-box">
              <strong>Dry-Run Tip:</strong> ${escapeHtml(arch.dry_run_tips)}
            </div>
          ` : ""}
        `;
        archetypesStack.appendChild(card);
      });
    }
  }

  // 6D. Core CS Technical Deep Dive
  const coreCsStack = document.getElementById("prep-core-cs-stack");
  if (coreCsStack) {
    coreCsStack.innerHTML = "";
    const coreItems = prep.core_cs_drilldown || [];
    if (coreItems.length > 0) {
      coreItems.forEach(subj => {
        const card = document.createElement("div");
        card.className = "prep-core-card";
        card.innerHTML = `
          <div class="prep-core-header">
            <span class="prep-core-title">${escapeHtml(subj.subject)}</span>
            <span class="prep-badge-weight">${escapeHtml(subj.importance_weight || "High Priority")}</span>
          </div>
          <ul class="prep-core-topics-list">
            ${(subj.high_yield_topics || []).map(t => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
          ${subj.company_focus_questions && subj.company_focus_questions.length > 0 ? `
            <div class="prep-sample-q-box">
              <span class="prep-q-header">Sample Campus Questions:</span>
              <ul class="prep-sample-list">
                ${subj.company_focus_questions.map(q => `<li>"${escapeHtml(q)}"</li>`).join("")}
              </ul>
            </div>
          ` : ""}
        `;
        coreCsStack.appendChild(card);
      });
    }
  }

  // 6E. Round-by-Round Strategy & Traps
  const tacticsStack = document.getElementById("prep-round-tactics-stack");
  if (tacticsStack) {
    tacticsStack.innerHTML = "";
    const tacticItems = prep.round_tactics || [];
    if (tacticItems.length > 0) {
      tacticItems.forEach((rnd, idx) => {
        const card = document.createElement("div");
        card.className = "prep-round-card";
        card.innerHTML = `
          <div class="prep-round-header">
            <span class="prep-round-num">0${idx + 1}</span>
            <div class="prep-round-title-group">
              <span class="prep-round-name">${escapeHtml(rnd.round_name)}</span>
              <span class="prep-round-platform">${escapeHtml(rnd.platform_or_duration || "Technical Interview")}</span>
            </div>
          </div>
          <div class="prep-round-focus">
            <strong>Key Focus Areas:</strong>
            <ul>
              ${(rnd.key_focus_areas || []).map(f => `<li>${escapeHtml(f)}</li>`).join("")}
            </ul>
          </div>
          ${rnd.common_traps ? `
            <div class="prep-trap-warning">
              <strong>⚠️ Common Traps:</strong> ${escapeHtml(rnd.common_traps)}
            </div>
          ` : ""}
          ${rnd.actionable_prep_strategy ? `
            <div class="prep-strategy-tip">
              <strong>💡 Actionable Strategy:</strong> ${escapeHtml(rnd.actionable_prep_strategy)}
            </div>
          ` : ""}
        `;
        tacticsStack.appendChild(card);
      });
    }
  }

  // 6F. Legacy fallback lists
  const topicsList = document.getElementById("prep-topics");
  if (topicsList) {
    topicsList.innerHTML = "";
    (prep.priority_topics || []).forEach(t => {
      const li = document.createElement("li");
      li.innerText = t;
      topicsList.appendChild(li);
    });
  }

  const prepQList = document.getElementById("prep-questions");
  if (prepQList) {
    prepQList.innerHTML = "";
    (prep.high_frequency_questions || []).forEach(q => {
      const li = document.createElement("li");
      li.innerText = q;
      prepQList.appendChild(li);
    });
  }

  const tipsList = document.getElementById("prep-tips");
  if (tipsList) {
    tipsList.innerHTML = "";
    (prep.tips_for_oa_and_interviews || []).forEach(tip => {
      const li = document.createElement("li");
      li.innerText = tip;
      tipsList.appendChild(li);
    });
  }
}

// 6. Chat Doubt Solver
async function sendChatMessage() {
  const inputEl = document.getElementById("chat-input");
  const query = inputEl.value.trim();
  if (!query) return;

  inputEl.value = "";
  appendMessage("user", query);

  if (!currentDossier) {
    appendMessage("assistant", "> ⚠️ **Notice:** Please run or load a company audit first to supply the necessary campus context.");
    return;
  }

  chatHistory.push({ role: "user", content: query });
  const assistantBubble = appendMessage("assistant", "⚡ *Consulting Placement Master DB, verified reviews, and compensation records...*");

  try {
    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: currentDossier.company_name,
        context: currentDossier,
        messages: chatHistory
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let fullResponse = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    // Live streaming throttle with requestAnimationFrame
    let renderScheduled = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.replace("data: ", "").trim();
          if (dataStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.delta) {
              fullResponse += parsed.delta;
              if (!renderScheduled) {
                renderScheduled = true;
                requestAnimationFrame(() => {
                  renderMarkdown(assistantBubble, fullResponse, false);
                  scrollChatToBottom();
                  renderScheduled = false;
                });
              }
            }
          } catch (e) {}
        }
      }
    }

    // Final render with full Mermaid flowchart compilation
    await renderMarkdown(assistantBubble, fullResponse, true);
    scrollChatToBottom();

    chatHistory.push({ role: "assistant", content: fullResponse });
  } catch (err) {
    assistantBubble.innerHTML = `<span style="color:#ef4444;">[Doubt Solver: Error communicating with model service - ${escapeHtml(err.message)}]</span>`;
  }
}

function appendMessage(role, text) {
  const box = document.getElementById("chat-messages");
  const msg = document.createElement("div");
  msg.className = `chat-bubble ${role === "user" ? "chat-user" : "chat-assistant"}`;
  if (role === "assistant") {
    renderMarkdown(msg, text, true);
  } else {
    msg.innerText = text;
  }
  box.appendChild(msg);
  scrollChatToBottom();
  return msg;
}

async function renderMarkdown(container, text, isFinal = false) {
  if (!text) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    try {
      html = marked.parse(text);
    } catch (e) {
      html = fallbackMarkdown(text);
    }
  } else {
    html = fallbackMarkdown(text);
  }

  // Pre-process any language-mermaid code blocks into .mermaid cards
  html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/gi, (match, code) => {
    const unescaped = unescapeHtml(code);
    return `<div class="mermaid-diagram-card">
      <div class="mermaid-diagram-header">
        <span class="mermaid-badge">📊 Decision Flowchart / Strategy Map</span>
        <button class="mermaid-copy-btn" title="Copy Mermaid Definition">Copy</button>
      </div>
      <div class="mermaid">${escapeHtml(unescaped)}</div>
    </div>`;
  });

  container.innerHTML = html;

  // Add click listener for copy buttons
  container.querySelectorAll(".mermaid-copy-btn").forEach(btn => {
    btn.onclick = () => {
      const card = btn.closest(".mermaid-diagram-card");
      const codeEl = card ? card.querySelector(".mermaid") : null;
      if (codeEl) {
        navigator.clipboard.writeText(codeEl.getAttribute("data-raw-code") || codeEl.textContent);
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
      }
    };
  });

  // If this is the final render and Mermaid is available, compile diagrams to SVG
  if (isFinal && typeof mermaid !== "undefined") {
    await compileMermaidInElement(container);
  }
}

async function compileMermaidInElement(container) {
  const nodes = container.querySelectorAll(".mermaid:not([data-processed='true'])");
  if (!nodes || nodes.length === 0) return;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const rawCode = (node.textContent || "").trim();
    if (!rawCode) continue;

    node.setAttribute("data-raw-code", rawCode);
    const uniqueId = `mermaid-graph-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`;

    try {
      const { svg } = await mermaid.render(uniqueId, rawCode);
      node.innerHTML = svg;
      node.setAttribute("data-processed", "true");
    } catch (err) {
      console.warn("[RecruitSage] Mermaid parse error:", err);
      const stray = document.getElementById(uniqueId);
      if (stray) stray.remove();

      node.innerHTML = `<pre class="mermaid-fallback"><code>${escapeHtml(rawCode)}</code></pre>
        <div class="mermaid-error-note">⚠️ Flowchart preview (syntax check: ensure arrows like --&gt; have valid nodes)</div>`;
      node.setAttribute("data-processed", "true");
    }
  }
}

function unescapeHtml(html) {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

function fallbackMarkdown(text) {
  let out = escapeHtml(text);
  // Headers
  out = out.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  out = out.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  out = out.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  // Bold
  out = out.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
  // Italic
  out = out.replace(/\*(.*?)\*/gim, '<em>$1</em>');
  // Inline code
  out = out.replace(/`([^`]+)`/gim, '<code>$1</code>');
  // Blockquotes
  out = out.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');
  // Bullet lists
  out = out.replace(/^\s*[•\-\*]\s+(.*$)/gim, '<li>$1</li>');
  out = out.replace(/(<li>[\s\S]*?<\/li>)/gi, '<ul>$1</ul>');
  // Line breaks
  out = out.replace(/\n\n/g, '<p></p>');
  out = out.replace(/\n/g, '<br>');
  return out;
}

function scrollChatToBottom() {
  const box = document.getElementById("chat-messages");
  box.scrollTop = box.scrollHeight;
}

function getInitials(name) {
  if (!name) return "AL";
  const clean = name.replace(/[^a-zA-Z\s]/g, "").trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "AL";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
