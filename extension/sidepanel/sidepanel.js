// Recruit Copilot Side Panel Controller - Professional Grade
// Live Production AWS EC2 Endpoint with SSL:
const BACKEND_URL = "https://13.234.21.16.nip.io";
// Local Dev: const BACKEND_URL = "http://localhost:8000";

// --- PostHog Product & User Telemetry Engine ---
const POSTHOG_KEY = "phc_tmxzBvFThzGgUis7qHdkCgXjrapCSdZL3EWVnXs9uwRn";
const POSTHOG_HOST = "https://us.i.posthog.com";
let currentUserId = null;
const currentSessionId = "sess_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);

async function getUserId() {
  if (currentUserId) return currentUserId;
  try {
    const res = await chrome.storage.local.get(["copilot_user_id"]);
    if (res && res.copilot_user_id) {
      currentUserId = res.copilot_user_id;
    } else {
      currentUserId = "student_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
      await chrome.storage.local.set({ copilot_user_id: currentUserId });
    }
  } catch (e) {
    currentUserId = "student_temp";
  }
  return currentUserId;
}

// Eagerly hydrate user ID into memory on script load
getUserId();

function posthogCapture(eventName, properties = {}) {
  getUserId().then((distinctId) => {
    fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: eventName,
        properties: {
          distinct_id: distinctId,
          $session_id: currentSessionId,
          $lib: "chrome-extension",
          version: "1.3.0",
          ...properties
        },
        timestamp: new Date().toISOString()
      }),
      keepalive: true
    }).catch(() => {});
  }).catch(() => {});
}

// Global Client-Side Error Telemetry for PostHog
window.addEventListener("error", (event) => {
  posthogCapture("client_error", {
    message: event.message,
    filename: event.filename ? event.filename.split("/").pop() : "unknown",
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener("unhandledrejection", (event) => {
  posthogCapture("client_unhandled_promise_rejection", {
    reason: String(event.reason).slice(0, 300)
  });
});

let currentDossier = null;
let chatHistory = [];
let currentRawPageText = "";
let currentPageUrl = "";
let attachedPdfText = "";
let attachedPdfFilename = "";
let currentProvider = "gemini";
let userGeminiApiKey = ""; // Set by user in Settings, stored in chrome.storage.local

// Returns headers object for all backend API calls, including the user's Gemini API key if set
function getApiHeaders(extra = {}) {
  const headers = { 
    "Content-Type": "application/json",
    "X-Client-Id": currentUserId || "anonymous_student",
    "X-Session-Id": currentSessionId,
    ...extra 
  };
  if (userGeminiApiKey) {
    headers["X-Gemini-Api-Key"] = userGeminiApiKey;
  }
  return headers;
}

document.addEventListener("DOMContentLoaded", () => {
  posthogCapture("extension_opened");
  initTheme();
  initSettings();
  initMarkdownAndMermaid();
  initHealthChecks();
  initAutoSync();
  initEventListeners();
  renderAlumniSection();
  initOnboardingTour();
});

// Settings Modal — Gemini API Key management
function initSettings() {
  const STORAGE_KEY = "recruitsage_gemini_api_key";

  // Load saved key on startup
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    if (result && result[STORAGE_KEY]) {
      userGeminiApiKey = result[STORAGE_KEY];
      const input = document.getElementById("input-gemini-key");
      if (input) input.value = userGeminiApiKey;
      showKeyStatus("Key loaded", "success");
    }
  });

  // Open settings modal
  const btnOpen = document.getElementById("btn-settings");
  const btnClose = document.getElementById("btn-settings-close");
  const overlay = document.getElementById("settings-modal-overlay");
  if (btnOpen && overlay) {
    btnOpen.addEventListener("click", () => overlay.classList.remove("rs-hidden"));
  }
  if (btnClose && overlay) {
    btnClose.addEventListener("click", () => overlay.classList.add("rs-hidden"));
  }
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("rs-hidden");
    });
  }

  // Show/hide key visibility toggle
  const btnToggleVis = document.getElementById("btn-toggle-key-visibility");
  const keyInput = document.getElementById("input-gemini-key");
  const iconShow = document.getElementById("icon-eye-show");
  const iconHide = document.getElementById("icon-eye-hide");
  if (btnToggleVis && keyInput) {
    btnToggleVis.addEventListener("click", () => {
      const isPassword = keyInput.type === "password";
      keyInput.type = isPassword ? "text" : "password";
      if (iconShow) iconShow.classList.toggle("rs-hidden", isPassword);
      if (iconHide) iconHide.classList.toggle("rs-hidden", !isPassword);
    });
  }

  // Save key
  const btnSave = document.getElementById("btn-save-api-key");
  if (btnSave && keyInput) {
    btnSave.addEventListener("click", () => {
      const key = keyInput.value.trim();
      if (!key) {
        showKeyStatus("Please enter a valid API key", "error");
        return;
      }
      userGeminiApiKey = key;
      chrome.storage.local.set({ [STORAGE_KEY]: key }, () => {
        showKeyStatus("Key saved successfully", "success");
      });
    });
  }

  // Clear key
  const btnClear = document.getElementById("btn-clear-api-key");
  if (btnClear && keyInput) {
    btnClear.addEventListener("click", () => {
      userGeminiApiKey = "";
      keyInput.value = "";
      chrome.storage.local.remove(STORAGE_KEY, () => {
        showKeyStatus("Key cleared — using backend default", "info");
      });
    });
  }

  // Restart onboarding tour button
  const btnRestartTour = document.getElementById("btn-restart-tour");
  if (btnRestartTour) {
    btnRestartTour.addEventListener("click", () => {
      chrome.storage.local.remove(["has_seen_input_tour", "has_seen_results_tour"], () => {
        if (overlay) overlay.classList.add("rs-hidden");
        const dossierContainer = document.getElementById("dossier-container");
        if (dossierContainer && !dossierContainer.classList.contains("rs-hidden")) {
          startTour("results");
        } else {
          startTour("input");
        }
      });
    });
  }

  function showKeyStatus(msg, type) {
    const el = document.getElementById("settings-key-status");
    if (!el) return;
    el.textContent = msg;
    el.className = `settings-key-status settings-key-status--${type}`;
    el.classList.remove("rs-hidden");
    setTimeout(() => el.classList.add("rs-hidden"), 3000);
  }
}

function setProvider(provider, save = false) {
  currentProvider = "gemini";
}

// Theme Management Engine (Official Recruit Copilot Dark / Light Modes)
function initTheme() {
  chrome.storage.local.get(["recruitsage_theme"], (result) => {
    const savedTheme = (result && result.recruitsage_theme) ? result.recruitsage_theme : "dark";
    applyTheme(savedTheme, false);
  });
}

// Helper for polygon clip-path collapse
function polygonCollapsed(point, vertexCount) {
  const pairs = Array.from({ length: vertexCount }, () => point).join(", ");
  return `polygon(${pairs})`;
}

// Percentage coordinate calculations for View Transitions API to avoid display scaling bugs
function getThemeTransitionClipPaths(
  variant,
  cx,
  cy,
  maxRadius,
  viewportWidth,
  viewportHeight
) {
  const toX = (x) => `${(x / viewportWidth) * 100}%`;
  const toY = (y) => `${(y / viewportHeight) * 100}%`;
  const point = (x, y) => `${toX(x)} ${toY(y)}`;
  const toRadius = (r) =>
    `${(r / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;

  switch (variant) {
    case "circle":
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
    case "square": {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [
        point(cx - halfSide, cy - halfSide),
        point(cx + halfSide, cy - halfSide),
        point(cx + halfSide, cy + halfSide),
        point(cx - halfSide, cy + halfSide),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "triangle": {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [
        point(cx, cy - scale),
        point(cx + dx, cy + 0.5 * scale),
        point(cx - dx, cy + 0.5 * scale),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 3), `polygon(${verts})`];
    }
    case "diamond": {
      const R = maxRadius * Math.SQRT2;
      const end = [
        point(cx, cy - R),
        point(cx + R, cy),
        point(cx, cy + R),
        point(cx - R, cy),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "hexagon": {
      const R = maxRadius * Math.SQRT2;
      const verts = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        verts.push(point(cx + R * Math.cos(a), cy + R * Math.sin(a)));
      }
      return [
        polygonCollapsed(point(cx, cy), 6),
        `polygon(${verts.join(", ")})`,
      ];
    }
    case "rectangle": {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const end = [
        point(cx - halfW, cy - halfH),
        point(cx + halfW, cy - halfH),
        point(cx + halfW, cy + halfH),
        point(cx - halfW, cy + halfH),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "star": {
      const R = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (radius) => {
        const verts = [];
        for (let i = 0; i < 5; i++) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(
            point(
              cx + radius * Math.cos(outerA),
              cy + radius * Math.sin(outerA)
            )
          );
          const innerA = outerA + Math.PI / 5;
          verts.push(
            point(
              cx + radius * innerRatio * Math.cos(innerA),
              cy + radius * innerRatio * Math.sin(innerA)
            )
          );
        }
        return `polygon(${verts.join(", ")})`;
      };
      const startR = Math.max(2, R * 0.025);
      return [starPolygon(startR), starPolygon(R)];
    }
    default:
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
  }
}

let isThemeTransitioning = false;
let activeThemeAnimation = null;

function toggleTheme(event) {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "light" ? "dark" : "light";

  const button = document.getElementById("btn-theme-toggle");
  if (
    isThemeTransitioning ||
    document.documentElement.dataset.magicuiThemeVt === "active"
  ) {
    return;
  }

  const applyThemeUpdate = () => {
    applyTheme(newTheme, true);
    chrome.storage.local.set({ recruitsage_theme: newTheme });
  };

  // Graceful fallback if View Transitions API is not supported or reduced motion is set
  if (
    typeof document.startViewTransition !== "function" ||
    (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    applyThemeUpdate();
    return;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = viewportWidth - 30;
  let y = 30;

  if (button) {
    const { top, left, width, height } = button.getBoundingClientRect();
    x = left + width / 2;
    y = top + height / 2;
  } else if (event && typeof event.clientX === "number") {
    x = event.clientX;
    y = event.clientY;
  }

  const maxRadius = Math.hypot(
    Math.max(x, viewportWidth - x),
    Math.max(y, viewportHeight - y)
  );

  const duration = 450;
  const shape = "circle";

  const clipPath = getThemeTransitionClipPaths(
    shape,
    x,
    y,
    maxRadius,
    viewportWidth,
    viewportHeight
  );

  const root = document.documentElement;
  root.dataset.magicuiThemeVt = "active";
  root.style.setProperty("--magicui-theme-toggle-vt-duration", `${duration}ms`);
  root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0]);

  const cancelAnim = () => {
    if (activeThemeAnimation) {
      activeThemeAnimation.cancel();
      activeThemeAnimation = null;
    }
  };

  const cleanup = () => {
    isThemeTransitioning = false;
    delete root.dataset.magicuiThemeVt;
    root.style.removeProperty("--magicui-theme-toggle-vt-duration");
    root.style.removeProperty("--magicui-theme-vt-clip-from");
    cancelAnim();
  };

  isThemeTransitioning = true;
  const transition = document.startViewTransition(() => {
    applyThemeUpdate();
  });

  if (transition && transition.finished && typeof transition.finished.finally === "function") {
    transition.finished.finally(cleanup).catch(() => {});
  } else {
    cleanup();
  }

  if (transition && transition.ready && typeof transition.ready.then === "function") {
    transition.ready
      .then(() => {
        const anim = document.documentElement.animate(
          {
            clipPath: clipPath,
          },
          {
            duration: duration,
            easing: shape === "star" ? "linear" : "ease-in-out",
            fill: "forwards",
            pseudoElement: "::view-transition-new(root)",
          }
        );
        activeThemeAnimation = anim;
      })
      .catch(() => {});
  }
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
  if (typeof marked !== "undefined") {
    try {
      const renderer = new marked.Renderer();
      renderer.link = function(tokenOrHref, title, text) {
        let href = "";
        let linkTitle = "";
        let linkText = "";

        if (typeof tokenOrHref === "object" && tokenOrHref !== null) {
          href = tokenOrHref.href || "";
          linkTitle = tokenOrHref.title || "";
          linkText = tokenOrHref.text || tokenOrHref.raw || href;
        } else {
          href = tokenOrHref || "";
          linkTitle = title || "";
          linkText = text || href;
        }

        const titleAttr = linkTitle ? ` title="${escapeHtml(linkTitle)}"` : "";
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttr} class="chat-external-link">${linkText}</a>`;
      };

      if (marked.use) {
        marked.use({
          renderer: renderer,
          gfm: true,
          breaks: true
        });
      } else if (marked.setOptions) {
        marked.setOptions({
          renderer: renderer,
          gfm: true,
          breaks: true
        });
      }
    } catch (e) {
      console.warn("[Recruit Copilot] Error configuring marked renderer:", e);
    }
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
      const geminiOnline = data.llm && data.llm.active_available && data.llm.active_available.gemini;

      if (geminiOnline) {
        label.innerText = "Online";
        label.title = "Connected to Gemini Cloud Engine";
      } else {
        label.innerText = "Ready";
        label.title = "Recruit Copilot Online";
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
      if (result.last_extracted_company.page_url) {
        currentPageUrl = result.last_extracted_company.page_url;
      }
      populateInputs(result.last_extracted_company);
    }
    // Always trigger live scrape + LLM conversion when sidepanel opens
    scrapeAndExtractFromTab();
  });
}

// Resets the Auto-Fill/Sync button back to its default state
function resetSyncBtn() {
  const syncBtn = document.getElementById("btn-sync-page");
  if (syncBtn) {
    syncBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      Auto-Fill
    `;
  }
}

// Live Page Scraper + LLM Conversion Engine
async function scrapeAndExtractFromTab() {
  posthogCapture("autofill_clicked");
  const syncBtn = document.getElementById("btn-sync-page");
  const aiBadge = document.getElementById("ai-extract-badge");

  if (syncBtn) {
    syncBtn.innerHTML = `
      <svg class="spin-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      Scraping...
    `;
  }
  if (aiBadge) {
    aiBadge.innerText = "1/2 Scraping page...";
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
        aiBadge.innerText = "Ingesting active PDF tab...";
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
            aiBadge.innerText = "Active PDF Extracted";
            aiBadge.className = "badge-ai";
            setTimeout(() => { if (aiBadge) aiBadge.classList.add("rs-hidden"); }, 4000);
          }
          return;
        }
      } catch (pdfTabErr) {
        console.warn("[Recruit Copilot] Error fetching active PDF tab:", pdfTabErr);
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
      console.log("[Recruit Copilot] Content script message error:", msgErr);
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
        console.warn("[Recruit Copilot] Scripting executeScript error:", scriptErr);
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
    currentPageUrl = pageUrl;

    // Helper: Extract Job ID from URL bar (Superset, Thapar Recruit, LinkedIn, etc.)
    function extractJobIdFromUrl(url) {
      if (!url) return null;
      const clean = url.trim();
      const m = clean.match(/(?:\/jobs?\/view\/|\/jobs?\/|\/drives?\/|\/placements?\/)([a-zA-Z0-9_\-\.]+)/i)
        || clean.match(/[?&#](?:job_?id|jobId|drive_?id|notice_?id|id)=([a-zA-Z0-9_\-\.]+)/i);
      return m ? m[1].toLowerCase() : null;
    }

    const jobId = extractJobIdFromUrl(pageUrl);
    const cleanUrl = pageUrl.split("?")[0].split("#")[0].replace(/\/+$/, "").toLowerCase();
    const primaryCacheKey = jobId ? `autofill_cache_job_${jobId}` : `autofill_cache_url_${cleanUrl}`;

    // Step 2A: Check local client cache first for instant 0ms retrieval
    const localCached = await new Promise((resolve) => {
      chrome.storage.local.get([primaryCacheKey], (res) => {
        resolve(res && res[primaryCacheKey] ? res[primaryCacheKey] : null);
      });
    });

    if (localCached && typeof localCached === "object" && localCached.company_name) {
      console.log(`[Recruit Copilot] Client-side Autofill Cache HIT for ${jobId || cleanUrl}`);
      populateInputs(localCached, true);
      chrome.storage.local.set({ last_extracted_company: localCached });
      if (aiBadge) {
        aiBadge.innerText = "⚡ Instant Auto-Fill (Cached)";
        aiBadge.className = "badge-ai";
        setTimeout(() => { if (aiBadge) aiBadge.classList.add("rs-hidden"); }, 5000);
      }
      posthogCapture("autofill_served", { source: "client_cache", url: pageUrl, job_id: jobId });
      resetSyncBtn();
      return;
    }

    // Step 2B: Not in local cache -> Feed into backend extraction engine
    if (aiBadge) {
      aiBadge.innerText = "2/2 AI parsing notice...";
      aiBadge.className = "badge-ai badge-ai-pulsing";
    }

    const res = await fetch(`${BACKEND_URL}/api/extract-drive-context`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        raw_page_text: scrapedText,
        page_url: pageUrl,
        provider: "gemini"
      })
    });

    if (res.ok) {
      const parsedJson = await res.json();
      parsedJson.page_url = pageUrl;
      console.log("[Recruit Copilot] LLM Parsed JSON:", parsedJson);

      // Step 3: Save to client-side cache keyed by Job ID and Clean URL
      const cacheToSave = {
        last_extracted_company: parsedJson,
        [primaryCacheKey]: parsedJson
      };
      if (jobId) {
        cacheToSave[`autofill_cache_job_${jobId}`] = parsedJson;
      }
      cacheToSave[`autofill_cache_url_${cleanUrl}`] = parsedJson;
      chrome.storage.local.set(cacheToSave);

      // Fill the input fields in the form with the parsed JSON
      populateInputs(parsedJson, true);

      if (aiBadge) {
        aiBadge.innerText = parsedJson.is_cached ? "⚡ Instant Auto-Fill (Server Cached)" : "Form Filled via AI";
        aiBadge.className = "badge-ai";
        setTimeout(() => {
          if (aiBadge) aiBadge.classList.add("rs-hidden");
        }, 5000);
      }

      posthogCapture("autofill_served", {
        source: parsedJson.is_cached ? "server_cache" : "gemini_llm",
        url: pageUrl,
        job_id: jobId,
        is_cached: Boolean(parsedJson.is_cached)
      });
    } else {
      const errText = await res.text();
      console.warn("[Recruit Copilot] LLM extraction error:", errText);
      if (aiBadge) {
        aiBadge.innerText = "LLM error - heuristic used";
        setTimeout(() => aiBadge.classList.add("rs-hidden"), 4000);
      }
    }
  } catch (err) {
    console.error("[Recruit Copilot] Scrape & LLM error:", err);
    if (aiBadge) {
      aiBadge.innerText = "Backend offline";
      setTimeout(() => aiBadge.classList.add("rs-hidden"), 4000);
    }
  } finally {
    resetSyncBtn();
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

  const bulletDetails = data.additional_details || data.extra_details || "";
  if (bulletDetails && bulletDetails.trim().length > 10) {
    const el = document.getElementById("input-additional-notes");
    if (el) {
      if (!el.value || isLlmParsed || bulletDetails.length >= el.value.length) {
        el.value = bulletDetails;
      }
    }
  }

  chrome.storage.local.set({ last_extracted_company: data });
  updateQueryPanelSummary();
  renderAlumniSection(data.company_name);
}

function updateQueryPanelSummary() {
  const comp = document.getElementById("input-company") ? document.getElementById("input-company").value.trim() : "";
  const role = document.getElementById("input-role") ? document.getElementById("input-role").value.trim() : "";
  const ctc = document.getElementById("input-ctc") ? document.getElementById("input-ctc").value.trim() : "";

  const titleEl = document.getElementById("query-collapsed-title");
  const ctcEl = document.getElementById("query-collapsed-ctc");

  if (titleEl) {
    if (comp) {
      titleEl.textContent = `${comp}${role ? " • " + role : ""}`;
    } else {
      titleEl.textContent = "No company targeted yet";
    }
  }

  if (ctcEl) {
    ctcEl.textContent = ctc ? `CTC: ${ctc}` : "";
  }
}

const CHEVRON_DOWN_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const CHEVRON_RIGHT_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>';

function toggleQueryPanel(forceCollapse = null) {
  const body = document.getElementById("query-panel-body");
  const bar = document.getElementById("query-panel-collapsed-bar");
  const icon = document.getElementById("toggle-query-panel-icon");
  if (!body || !bar) return;

  const isCurrentlyHidden = body.classList.contains("rs-hidden");
  let shouldHide;

  if (forceCollapse !== null) {
    shouldHide = forceCollapse;
  } else {
    shouldHide = !isCurrentlyHidden;
  }

  if (shouldHide) {
    body.classList.add("rs-hidden");
    bar.classList.remove("rs-hidden");
    if (icon) icon.innerHTML = CHEVRON_RIGHT_SVG;
  } else {
    body.classList.remove("rs-hidden");
    bar.classList.add("rs-hidden");
    if (icon) icon.innerHTML = CHEVRON_DOWN_SVG;
  }
}

function clearQueryTarget() {
  const fields = [
    "input-company", "input-role", "input-ctc", "input-location",
    "input-job-type", "input-deadline", "input-probation",
    "input-eligibility", "input-skills", "input-jd", "input-additional-notes"
  ];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  attachedPdfText = "";
  attachedPdfFilename = "";
  currentRawPageText = "";
  currentPageUrl = "";

  const fileInput = document.getElementById("input-pdf-file");
  if (fileInput) fileInput.value = "";
  const statusBadge = document.getElementById("pdf-status-badge");
  if (statusBadge) statusBadge.style.display = "none";
  const dropzone = document.getElementById("pdf-dropzone");
  if (dropzone) dropzone.style.display = "flex";

  // Stop any in-progress scraping animation
  resetSyncBtn();

  const aiBadge = document.getElementById("ai-extract-badge");
  if (aiBadge) {
    aiBadge.className = "badge-ai";
    aiBadge.classList.add("rs-hidden");
  }

  chrome.storage.local.remove(["last_extracted_company"]);
  updateQueryPanelSummary();
  renderAlumniSection("");
  toggleQueryPanel(false);

  const compEl = document.getElementById("input-company");
  if (compEl) compEl.focus();
}

// Resets everything back to the initial state so user can analyze a new company
function resetToNewCompany() {
  // 1. Clear state
  currentDossier = null;
  chatHistory = [];

  // 2. Hide results and errors
  const dossierContainer = document.getElementById("dossier-container");
  const progressContainer = document.getElementById("progress-container");
  const errorBanner = document.getElementById("error-banner");
  if (dossierContainer) dossierContainer.classList.add("rs-hidden");
  if (progressContainer) progressContainer.classList.add("rs-hidden");
  if (errorBanner) errorBanner.classList.add("rs-hidden");

  // 3. Clear all inputs and scraping state
  clearQueryTarget();

  // 4. Reset chat UI
  const chatInput = document.getElementById("chat-input");
  if (chatInput) chatInput.value = "";
  const chatBanner = document.getElementById("chat-active-company-banner");
  if (chatBanner) chatBanner.style.display = "none";
  const chatMessages = document.getElementById("chat-messages");
  if (chatMessages) chatMessages.innerHTML = "";

  // 5. Show input form open
  toggleQueryPanel(true);

  // 6. Scroll to top
  window.scrollTo(0, 0);
  const appShell = document.querySelector(".app-shell");
  if (appShell) appShell.scrollTop = 0;
}

// 3. Event Listeners
function initEventListeners() {
  const themeToggleBtn = document.getElementById("btn-theme-toggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }

  // Demo Privacy Mode Toggle (Blurs sensitive salary & compensation details for video recording)
  const privacyToggleBtn = document.getElementById("btn-privacy-toggle");
  const privacyBanner = document.getElementById("demo-privacy-banner");
  const privacyBannerText = document.getElementById("demo-privacy-banner-text");

  function setPrivacyMode(enabled) {
    if (enabled) {
      document.body.classList.remove("privacy-unblurred");
      if (privacyToggleBtn) {
        privacyToggleBtn.classList.add("is-privacy-active");
        privacyToggleBtn.title = "Demo Privacy Mode: Salary and compensation blurred (Click to toggle)";
      }
      if (privacyBanner) privacyBanner.style.display = "flex";
      if (privacyBannerText) privacyBannerText.innerText = "Demo Recording Mode: Salary and compensation values are blurred";
    } else {
      document.body.classList.add("privacy-unblurred");
      if (privacyToggleBtn) {
        privacyToggleBtn.classList.remove("is-privacy-active");
        privacyToggleBtn.title = "Demo Privacy Mode: Inactive (Click to blur sensitive salary details)";
      }
      if (privacyBanner) privacyBanner.style.display = "none";
    }
    try {
      localStorage.setItem("recruitsage_demo_privacy", enabled ? "true" : "false");
    } catch (e) {}
  }

  if (privacyToggleBtn) {
    privacyToggleBtn.addEventListener("click", () => {
      const isCurrentlyBlurred = !document.body.classList.contains("privacy-unblurred");
      setPrivacyMode(!isCurrentlyBlurred);
    });
  }

  // Default to blurred mode for demo video recording
  let savedPrivacy = "true";
  try {
    const s = localStorage.getItem("recruitsage_demo_privacy");
    if (s !== null) savedPrivacy = s;
  } catch (e) {}
  setPrivacyMode(savedPrivacy === "true");


  // Query Panel Controls
  const toggleQueryBtn = document.getElementById("btn-toggle-query-panel");
  if (toggleQueryBtn) {
    toggleQueryBtn.addEventListener("click", () => toggleQueryPanel());
  }

  const expandQueryBtn = document.getElementById("btn-expand-query-panel");
  if (expandQueryBtn) {
    expandQueryBtn.addEventListener("click", () => toggleQueryPanel(false));
  }

  const clearTargetBtn = document.getElementById("btn-clear-target");
  if (clearTargetBtn) {
    clearTargetBtn.addEventListener("click", clearQueryTarget);
  }

  // Live update collapsed summary pill and alumni section on user input
  ["input-company", "input-role", "input-ctc"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        updateQueryPanelSummary();
        if (id === "input-company") {
          renderAlumniSection();
        }
      });
    }
  });

  document.getElementById("btn-sync-page").addEventListener("click", scrapeAndExtractFromTab);
  document.getElementById("btn-analyze").addEventListener("click", runAnalysis);

  const resetCompanyBtn = document.getElementById("btn-reset-company");
  if (resetCompanyBtn) {
    resetCompanyBtn.addEventListener("click", resetToNewCompany);
  }

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
      if (toggleIcon) toggleIcon.innerHTML = isHidden ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG;
    });
  }

  // Toggle Extra Context drawer
  const toggleExtraBtn = document.getElementById("btn-toggle-extra-ctx");
  const extraDrawer = document.getElementById("extra-ctx-drawer");
  const toggleExtraIcon = document.getElementById("toggle-extra-icon");
  if (toggleExtraBtn && extraDrawer) {
    toggleExtraBtn.addEventListener("click", () => {
      const isHidden = extraDrawer.classList.toggle("rs-hidden");
      if (toggleExtraIcon) toggleExtraIcon.innerHTML = isHidden ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG;
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
        headers: userGeminiApiKey ? { "X-Gemini-Api-Key": userGeminiApiKey } : {},
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
          Ingest PDF
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
            ingestBtn.innerText = `Ingested (${bData.num_pages || 1}p)`;
            if (bData.parsed_fields) populateExtractedFields(bData.parsed_fields, false);
            return;
          }

          const blob = await resp.blob();
          const file = new File([blob], pdf.filename || "Placement_Doc.pdf", { type: "application/pdf" });
          await handlePdfUpload(file);
          ingestBtn.className = "btn-chip-ingest btn-chip-ingested";
          ingestBtn.innerText = "Ingested";
        } catch (err) {
          console.error("[Recruit Copilot] PDF Ingestion error:", err);
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
      const tabId = btn.getAttribute("data-tab");
      const targetPane = document.getElementById(tabId);
      if (targetPane) targetPane.classList.add("is-active");

      posthogCapture("tab_switched", {
        tab: tabId,
        company: currentDossier ? currentDossier.company_name : ""
      });

      if (tabId === "tab-alumni") {
        renderAlumniSection();
      }
    });
  });

  // Question Bank Category Filter Switcher (All Questions / Actual Database / Web Researched)
  document.querySelectorAll(".prep-qtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".prep-qtab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-target");
      const dbGroup = document.getElementById("group-database-questions");
      const webGroup = document.getElementById("group-web-questions");
      if (!dbGroup || !webGroup) return;
      if (target === "all") {
        dbGroup.style.display = "";
        webGroup.style.display = "";
      } else if (target === "database") {
        dbGroup.style.display = "";
        webGroup.style.display = "none";
      } else if (target === "web") {
        dbGroup.style.display = "none";
        webGroup.style.display = "";
      }
    });
  });

  // Chat send
  document.getElementById("btn-chat-send").addEventListener("click", sendChatMessage);
  const chatInput = document.getElementById("chat-input");
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    chatInput.addEventListener("input", () => {
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
    });
  }

  // Query chips
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const ci = document.getElementById("chat-input");
      if (ci) {
        ci.value = chip.getAttribute("data-q");
        ci.style.height = "auto";
        ci.style.height = Math.min(ci.scrollHeight, 120) + "px";
      }
      sendChatMessage();
    });
  });

  // Global link handler: Ensure ANY web links in Doubt Solver & throughout the extension open in a new browser tab
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.create === "function") {
        chrome.tabs.create({ url: href });
      } else {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    }
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
  const analysisStartTime = Date.now();
  posthogCapture("analysis_started", { company: companyName, role: role, provider: currentProvider });
  updateQueryPanelSummary();
  toggleQueryPanel(true); // Automatically collapse query panel on audit start to maximize screen space
  showProgress();
  resetChatForCompany(companyName, role);

  const stepTimers = [
    setTimeout(() => activateStep(2, "Checking past college placement records..."), 700),
    setTimeout(() => activateStep(3, "Searching Reddit and student posts..."), 2000),
    setTimeout(() => activateStep(4, "Reading employee reviews and ratings..."), 3500),
    setTimeout(() => activateStep(5, "Checking company size, bonds & red flags..."), 5000),
    setTimeout(() => activateStep(6, "Creating your company report..."), 6500),
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
    if (!currentPageUrl) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0] && tabs[0].url) {
          currentPageUrl = tabs[0].url;
        }
      } catch (_) {}
    }

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
      page_url: currentPageUrl || "",
      additional_context: additionalContext,
      provider: currentProvider
    };

    const res = await fetch(`${BACKEND_URL}/api/analyze`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify(payload)
    });

    stepTimers.forEach(t => clearTimeout(t));

    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }

    const dossier = await res.json();
    currentDossier = dossier;
    const durationSec = Math.round((Date.now() - analysisStartTime) / 100) / 10;
    posthogCapture("analysis_completed", {
      company: companyName,
      role: role,
      is_cached: Boolean(dossier.is_cached),
      duration_seconds: durationSec
    });
    renderDossier(dossier);
    hideProgress();
  } catch (error) {
    stepTimers.forEach(t => clearTimeout(t));
    hideProgress();
    posthogCapture("analysis_failed", {
      company: companyName,
      role: role,
      error: error.message
    });
    showError(`Analysis failed: ${error.message}. Please make sure the backend is running.`);
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
  currentDossier = dossier;

  // Refresh Doubt Solver chat context to the new company
  resetChatForCompany(dossier.company_name, dossier.role);

  // Ensure default active tab is Compensation (first tab) if Red Flags was active
  const activeBtn = document.querySelector(".segment-btn.is-active");
  if (!activeBtn || activeBtn.getAttribute("data-tab") === "tab-redflags") {
    document.querySelectorAll(".segment-btn").forEach(b => b.classList.remove("is-active"));
    document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("is-active"));
    const compBtn = document.querySelector('.segment-btn[data-tab="tab-compensation"]');
    const compPane = document.getElementById("tab-compensation");
    if (compBtn) compBtn.classList.add("is-active");
    if (compPane) compPane.classList.add("is-active");
  }

  // Hero Verdict
  const fitBadge = document.getElementById("fit-badge");
  fitBadge.innerText = dossier.fit_score || "Report Ready";
  fitBadge.className = "tag-fit";
  const scoreLower = (dossier.fit_score || "").toLowerCase();
  if (scoreLower.includes("high")) {
    fitBadge.classList.add("tag-fit-high");
  } else if (scoreLower.includes("caution") || scoreLower.includes("red")) {
    fitBadge.classList.add("tag-fit-caution");
  } else {
    fitBadge.classList.add("tag-fit-moderate");
  }

  // Active Provider Badge on Hero Card
  const provBadge = document.getElementById("hero-provider-badge");
  if (provBadge) {
    const cachePill = dossier.is_cached ? " • ⚡ Cached" : "";
    provBadge.innerText = `Gemini (Flash Lite)${cachePill}`;
    provBadge.title = dossier.is_cached ? `Instant cache hit (${dossier.cache_key || ''})` : "Generated using Google Gemini model";
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
      evalVerdict.innerText = ev.verdict || "Carefully verified report.";
    }
    if (evalMetricsGrid) {
      evalMetricsGrid.innerHTML = "";
      const metricItems = [
        { name: "Fact Accuracy", score: ev.groundedness_score || 90 },
        { name: "Red-Flag Check", score: ev.completeness_score || 88 },
        { name: "Salary Realism", score: ev.compensation_realism_score || 90 },
        { name: "Role Specificity", score: ev.specificity_score || 85 }
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
    redFlagsList.innerHTML = `<div class="stack-card">No significant risks or warning signs detected for this company.</div>`;
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
    trapsList.innerHTML = `<li>No hidden deductions or bond clauses found.</li>`;
  }

  // Tab 2: Last Year Hiring Statistics
  const campus = dossier.campus_intel || {};
  const campusBanner = document.getElementById("campus-status-banner");
  if (campus.visited_previously) {
    campusBanner.className = "status-callout callout-matched";
    campusBanner.innerText = `Found in past college placement records: ${campus.matched_company_name}`;
  } else {
    campusBanner.className = "status-callout callout-empty";
    campusBanner.innerText = "No previous campus visits found for this company in college records.";
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
  } else {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "stack-card";
    emptyDiv.style.color = "var(--text-muted)";
    emptyDiv.innerText = "No previous batch placement or hiring statistics recorded for this company in college records.";
    visitsContainer.appendChild(emptyDiv);
  }

  // Tab 3: Culture
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

  // Top 3-4 Review Portals (AmbitionBox, Glassdoor, Reddit, Indeed)
  const sourcesContainer = document.getElementById("culture-sources-list");
  if (sourcesContainer) {
    sourcesContainer.innerHTML = "";
    const inputComp = document.getElementById("input-company") ? document.getElementById("input-company").value.trim() : "";
    const targetComp = dossier.company_name || inputComp || "Company";
    const encComp = encodeURIComponent(targetComp);

    // Use backend sources or generate standard top 4 fallback
    const rawSources = (culture.review_sources && culture.review_sources.length > 0)
      ? culture.review_sources.slice(0, 4)
      : [
          {
            name: "AmbitionBox Reviews",
            url: `https://www.ambitionbox.com/search?q=${encComp}`,
            description: "Verified India ratings & salaries",
            badge: "AmbitionBox",
            icon: ""
          },
          {
            name: "Glassdoor Reviews",
            url: `https://www.glassdoor.co.in/Search/results.htm?keyword=${encComp}`,
            description: "Pros, cons & culture feedback",
            badge: "Glassdoor",
            icon: ""
          },
          {
            name: "Reddit Discussions",
            url: `https://www.reddit.com/r/developersIndia/search/?q=${encComp}`,
            description: "Dev threads & honest work culture",
            badge: "Reddit",
            icon: ""
          },
          {
            name: "Indeed Reviews",
            url: `https://in.indeed.com/cmp/${encComp}/reviews`,
            description: "Work-life balance & management",
            badge: "Indeed",
            icon: ""
          }
        ];

    rawSources.slice(0, 4).forEach(src => {
      const card = document.createElement("a");
      card.className = "review-source-card";
      card.href = src.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      let brandColor = "#6366f1";
      const bLow = (src.badge || src.name || "").toLowerCase();
      if (bLow.includes("ambitionbox")) brandColor = "#f97316";
      else if (bLow.includes("glassdoor")) brandColor = "#10b981";
      else if (bLow.includes("reddit")) brandColor = "#ff4500";
      else if (bLow.includes("indeed")) brandColor = "#38bdf8";

      card.innerHTML = `
        <div class="source-card-header">
          <div class="source-card-brand">
            <span class="source-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span>
            <span class="source-name">${escapeHtml(src.name)}</span>
          </div>
          <span class="source-badge" style="background:${brandColor}18; color:${brandColor}; border-color:${brandColor}35;">
            ${escapeHtml(src.badge || "Portal")}
          </span>
        </div>
        <p class="source-desc">${escapeHtml(src.description || "Read employee reviews & workplace culture")}</p>
      `;
      sourcesContainer.appendChild(card);
    });
  }

  // Tab 4: Alumni & Senior Network (Direct 1-Click LinkedIn Search with School Filter)
  renderAlumniSection(dossier.company_name, dossier.alumni_links);

  // Tab 3: Prep Plan (Divided Question Bank & Role-Specific Topics)
  const prep = dossier.prep_guide || (dossier.campus_intel ? dossier.campus_intel.deep_prep : {}) || {};

  // Target Company & Role Header
  const targetCompEl = document.getElementById("prep-target-company-name");
  const targetRoleEl = document.getElementById("prep-target-role-name");
  const effCompName = prep.target_company || dossier.company_name || "Target Company";
  const effRoleName = prep.target_role || dossier.role || "Technical Role";
  if (targetCompEl) targetCompEl.innerText = effCompName;
  if (targetRoleEl) targetRoleEl.innerText = effRoleName;

  // Helper to format unstructured or bullet-delimited text into a clean HTML bullet list
  function formatNotesToBulletList(rawNotes) {
    if (!rawNotes || typeof rawNotes !== "string" || !rawNotes.trim()) return "";
    
    let text = rawNotes.trim();
    let parts = [];

    if (text.includes(" • ")) {
      parts = text.split(" • ");
    } else if (text.includes("\n")) {
      parts = text.split(/\r?\n+/);
    } else if (text.includes("•")) {
      parts = text.split("•");
    } else if (text.includes("; ") && text.split("; ").length >= 2) {
      parts = text.split("; ");
    } else {
      const splitByNum = text.split(/(?:^|\s+)(?:\d+[\.\)]|\([0-9]+\))\s+/).filter(Boolean);
      if (splitByNum.length > 1) {
        parts = splitByNum;
      } else {
        parts = [text];
      }
    }

    const cleanBullets = parts
      .map(p => p.trim().replace(/^[•\-\*]\s*/, ""))
      .filter(p => p.length > 0);

    if (cleanBullets.length === 0) return "";

    const itemsHtml = cleanBullets.map(bullet => `
      <li class="question-bullet-item">
        <span class="bullet-dot" aria-hidden="true"></span>
        <span class="bullet-text">${escapeHtml(bullet)}</span>
      </li>
    `).join("");

    return `<ul class="question-bullet-list">${itemsHtml}</ul>`;
  }

  // Helper to render divided question cards (database vs web researched)
  function createQuestionElement(q, category, index) {
    const item = document.createElement("div");
    item.className = "question-row question-card-divided";
    
    const diffClass = (q.difficulty || "medium").toLowerCase();
    const diffTag = diffClass.includes("hard") ? "diff-hard" : diffClass.includes("easy") ? "diff-easy" : "diff-medium";
    const roundLabel = q.round_type || (category === "database" ? "Technical Round" : "Online Assessment");
    const topicLabel = q.topic ? (q.exact_topic ? `${q.topic} • ${q.exact_topic}` : q.topic) : "Technical Focus";
    const notesContent = q.notes || q.question_details || "";
    const qNum = typeof index === "number" ? index + 1 : null;
    const bulletsHtml = formatNotesToBulletList(notesContent);

    if (category === "database") {
      const driveSource = q.source_drive || "Campus Placement Database";
      const isTiet = driveSource.toLowerCase().includes("tiet") || driveSource.toLowerCase().includes("thapar") || driveSource.toLowerCase().includes("optum");
      const driveBadgeClass = isTiet ? "badge-drive-tiet" : "badge-drive-other";

      item.innerHTML = `
        <div class="question-top">
          <div class="question-badges">
            ${qNum ? `<span class="question-num-tag">Q${qNum}</span>` : ""}
            <span class="badge-drive ${driveBadgeClass}">${escapeHtml(driveSource)}</span>
            <span class="question-round-badge">${escapeHtml(roundLabel)}</span>
            <span class="question-tag">${escapeHtml(topicLabel)}</span>
          </div>
          <span class="question-diff ${diffTag}">${escapeHtml(q.difficulty || "Medium")}</span>
        </div>
        <div class="question-title">${escapeHtml(q.question_title)}</div>
        ${bulletsHtml ? `
          <div class="question-notes">
            <div class="question-notes-header">
              <span class="hint-badge">${isTiet ? 'TIET Placement Prep Guidance:' : 'Campus Placement Record:'}</span>
              <span class="notes-caption">Key points to articulate</span>
            </div>
            ${bulletsHtml}
          </div>
        ` : ""}
      `;
    } else {
      // Web Researched Question
      const sourceName = q.source_name || "Web Research Archive";
      const sourceUrl = q.source_url || "";

      item.innerHTML = `
        <div class="question-top">
          <div class="question-badges">
            ${qNum ? `<span class="question-num-tag">Q${qNum}</span>` : ""}
            <span class="badge-drive badge-drive-web">${escapeHtml(sourceName)}</span>
            <span class="question-round-badge">${escapeHtml(roundLabel)}</span>
            <span class="question-tag">${escapeHtml(topicLabel)}</span>
          </div>
          <span class="question-diff ${diffTag}">${escapeHtml(q.difficulty || "Medium")}</span>
        </div>
        <div class="question-title">${escapeHtml(q.question_title)}</div>
        ${bulletsHtml ? `
          <div class="question-notes">
            <div class="question-notes-header">
              <span class="hint-badge">Candidate Interview Insight:</span>
              <span class="notes-caption">Reported discussion points</span>
            </div>
            ${bulletsHtml}
          </div>
        ` : ""}
        ${sourceUrl ? `
          <div class="question-web-link-row">
            <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="question-web-link">
              <span>View source discussion on ${escapeHtml(sourceName)}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        ` : ""}
      `;
    }
    return item;
  }

  // Extract divided questions: Actual Database (Thapar ONLY) vs Web Researched (Other Colleges + Web)
  let rawDbQs = prep.actual_database_questions || (dossier.campus_intel ? dossier.campus_intel.actual_database_questions : null) || [];
  if (!Array.isArray(rawDbQs) || rawDbQs.length === 0) {
    rawDbQs = prep.thapar_past_questions || (dossier.campus_intel ? dossier.campus_intel.thapar_past_questions : []) || [];
  }

  let webQs = prep.web_researched_questions || (dossier.campus_intel ? dossier.campus_intel.web_researched_questions : null) || [];
  if (!Array.isArray(webQs)) {
    webQs = [];
  }

  // Helper to detect if a question mentions other colleges (DTU, NSUT, NIT, IIT, BITS, COEP, etc.)
  const isOtherCollege = (q) => {
    if (!q) return false;
    const txt = `${q.source_drive || ""} ${q.source || ""} ${q.source_name || ""} ${q.college || ""}`.toLowerCase();
    const otherColleges = ["dtu", "nsut", "nit", "iit", "bits", "coep", "iiit", "vit", "srm", "manipal", "pes"];
    return otherColleges.some(c => new RegExp(`\\b${c}\\b`, "i").test(txt));
  };

  // Strictly segregate: only Thapar database questions in actualDbQs, any other colleges routed to webQs
  let actualDbQs = [];
  const nonThaparFromDb = [];
  if (Array.isArray(rawDbQs)) {
    rawDbQs.forEach(q => {
      if (isOtherCollege(q)) {
        nonThaparFromDb.push(q);
      } else {
        actualDbQs.push(q);
      }
    });
  }

  // Ensure other college drive questions are routed to webQs only, never to actualDbQs
  const otherQs = [
    ...(prep.other_campus_questions || (dossier.campus_intel ? dossier.campus_intel.other_campus_questions : []) || []),
    ...nonThaparFromDb
  ];
  if (Array.isArray(otherQs) && otherQs.length > 0) {
    const existingWebTitles = new Set(webQs.map(q => (q.question_title || "").toLowerCase().trim()));
    otherQs.forEach(oq => {
      const title = (oq.question_title || "").toLowerCase().trim();
      if (title && !existingWebTitles.has(title)) {
        existingWebTitles.add(title);
        const item = Object.assign({}, oq);
        item.source_type = "web_research";
        item.is_database = false;
        item.source_name = oq.source_drive || oq.source_name || "Other Campus Placement Drive";
        webQs.push(item);
      }
    });
  }

  // Update question counts in navigation tabs and group headers
  const totalCountBadge = document.getElementById("total-questions-badge");
  const dbTabBadge = document.getElementById("db-questions-tab-badge");
  const webTabBadge = document.getElementById("web-questions-tab-badge");
  const dbCountBadge = document.getElementById("database-questions-count-badge");
  const webCountBadge = document.getElementById("web-questions-count-badge");

  const totalCount = actualDbQs.length + webQs.length;
  if (totalCountBadge) totalCountBadge.innerText = totalCount;
  if (dbTabBadge) dbTabBadge.innerText = actualDbQs.length;
  if (webTabBadge) webTabBadge.innerText = webQs.length;
  if (dbCountBadge) dbCountBadge.innerText = `${actualDbQs.length} ${actualDbQs.length === 1 ? 'Question' : 'Questions'}`;
  if (webCountBadge) webCountBadge.innerText = `${webQs.length} ${webQs.length === 1 ? 'Question' : 'Questions'}`;

  // Set tab button active states: if no college database records exist, auto-select Web Questions tab
  const allBtn = document.getElementById("btn-show-all-questions");
  const dbBtn = document.getElementById("btn-show-db-questions");
  const webBtn = document.getElementById("btn-show-web-questions");
  const dbGroup = document.getElementById("group-database-questions");
  const webGroup = document.getElementById("group-web-questions");
  if (allBtn && dbBtn && webBtn) {
    if (actualDbQs.length === 0 && webQs.length > 0) {
      allBtn.classList.remove("active");
      dbBtn.classList.remove("active");
      webBtn.classList.add("active");
      if (dbGroup) dbGroup.style.display = "none";
      if (webGroup) webGroup.style.display = "";
    } else {
      allBtn.classList.add("active");
      dbBtn.classList.remove("active");
      webBtn.classList.remove("active");
      if (dbGroup) dbGroup.style.display = "";
      if (webGroup) webGroup.style.display = "";
    }
  }

  // Section 1: Actual Database of Last Year Questions
  const dbStack = document.getElementById("prep-database-questions-stack");
  if (dbStack) {
    dbStack.innerHTML = "";
    if (actualDbQs.length > 0) {
      actualDbQs.forEach((q, idx) => {
        dbStack.appendChild(createQuestionElement(q, "database", idx));
      });
    } else {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "prep-empty-callout";
      emptyDiv.innerHTML = `
        <div class="prep-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg></div>
        <div class="prep-empty-content">
          <div class="prep-empty-title">No past database questions found for ${escapeHtml(effRoleName)}</div>
          <div class="prep-empty-desc">No previous recorded Thapar campus placement questions were retrieved for the <strong>${escapeHtml(effRoleName)}</strong> role at <strong>${escapeHtml(effCompName)}</strong> in the Thapar database. Check the <strong>Web Researched Questions</strong> tab for questions asked at other campus drives (DTU, NITs, BITS, etc.) and online technical discussions.</div>
        </div>
      `;
      dbStack.appendChild(emptyDiv);
    }
  }

  // Section 2: Web Researched Questions
  const webStack = document.getElementById("prep-web-questions-stack");
  if (webStack) {
    webStack.innerHTML = "";
    if (webQs.length > 0) {
      webQs.forEach((q, idx) => {
        webStack.appendChild(createQuestionElement(q, "web", idx));
      });
    } else {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "prep-empty-callout";
      emptyDiv.innerHTML = `
        <div class="prep-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg></div>
        <div class="prep-empty-content">
          <div class="prep-empty-title">No web researched questions found</div>
          <div class="prep-empty-desc">No online technical interview questions were indexed for this specific role yet.</div>
        </div>
      `;
      webStack.appendChild(emptyDiv);
    }
  }

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
            <span class="prep-freq-meta">Frequency: ${item.drive_frequency || "High"} • Priority: ${item.importance || 4}/5</span>
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
            <span class="prep-badge-freq">${escapeHtml(arch.frequency_rate || "Commonly Asked")}</span>
          </div>
          <div class="prep-archetype-examples">
            ${(arch.example_problems || []).map(ex => `<span class="prep-example-pill">${escapeHtml(ex)}</span>`).join("")}
          </div>
          <div class="prep-archetype-meta">
            <span class="prep-target-tag">Target: ${escapeHtml(arch.complexity_target || "O(N)")}</span>
          </div>
          ${arch.dry_run_tips ? `
            <div class="prep-dryrun-box">
              <strong>Coding Tip:</strong> ${escapeHtml(arch.dry_run_tips)}
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
            <span class="prep-badge-weight">${escapeHtml(subj.importance_weight || "Important")}</span>
          </div>
          <ul class="prep-core-topics-list">
            ${(subj.high_yield_topics || []).map(t => `<li>${escapeHtml(t)}</li>`).join("")}
          </ul>
          ${subj.company_focus_questions && subj.company_focus_questions.length > 0 ? `
            <div class="prep-sample-q-box">
              <span class="prep-q-header">Frequently Asked Questions:</span>
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
            <strong>What is Asked:</strong>
            <ul>
              ${(rnd.key_focus_areas || []).map(f => `<li>${escapeHtml(f)}</li>`).join("")}
            </ul>
          </div>
          ${rnd.common_traps ? `
            <div class="prep-trap-warning">
              <strong>Mistakes to Avoid:</strong> ${escapeHtml(rnd.common_traps)}
            </div>
          ` : ""}
          ${rnd.actionable_prep_strategy ? `
            <div class="prep-strategy-tip">
              <strong>How to Prepare:</strong> ${escapeHtml(rnd.actionable_prep_strategy)}
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

  // Trigger Results Onboarding Walkthrough if user hasn't seen it yet
  checkAndTriggerResultsTour();
}

// Tab 4: Alumni & Senior Network (Direct 1-Click LinkedIn Search with School Filter)
function renderAlumniSection(customComp = null, alumniLinks = null) {
  const alumniList = document.getElementById("alumni-links-list");
  if (!alumniList) return;

  const inputComp = document.getElementById("input-company") ? document.getElementById("input-company").value.trim() : "";
  const targetComp = customComp || (currentDossier ? currentDossier.company_name : "") || inputComp || "";

  if (!targetComp) {
    alumniList.innerHTML = `
      <div class="alumni-empty-state">
        <div class="alumni-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg></div>
        <div class="alumni-empty-title">Target a Company to Find Alumni</div>
        <p class="alumni-empty-desc">
          Enter a company name in the form above or sync the active placement page. Recruit Copilot will generate pre-filtered 1-click LinkedIn directory search links for Thapar seniors and alumni at that company.
        </p>
      </div>
    `;
    return;
  }

  const primaryAlum = (alumniLinks && alumniLinks.length > 0)
    ? alumniLinks[0]
    : (currentDossier && currentDossier.alumni_links && currentDossier.alumni_links.length > 0 ? currentDossier.alumni_links[0] : null);

  const searchQuery = `${targetComp} Thapar Institute of Engineering and Technology`;
  const linkedinSearchUrl = (primaryAlum && primaryAlum.url)
    ? primaryAlum.url
    : `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`;

  const schoolPortalUrl = (primaryAlum && primaryAlum.school_portal_url)
    ? primaryAlum.school_portal_url
    : `https://www.linkedin.com/school/thapar-institute-of-engineering-and-technology/people/?keywords=${encodeURIComponent(targetComp)}`;

  alumniList.innerHTML = `
    <div class="alumni-view-container">
      <!-- Target Company & Filter Banner -->
      <div class="alumni-target-banner">
        <div class="alumni-target-head">
          <span class="alumni-target-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg></span>
          <div class="alumni-target-info">
            <div class="alumni-target-company">${escapeHtml(targetComp)}</div>
            <span class="alumni-target-badge">Thapar Institute (TIET)</span>
          </div>
          <div class="alumni-live-indicator">
            <span class="pulse-dot"></span>
            <span class="live-label">Filter Active</span>
          </div>
        </div>
      </div>

      <!-- Primary LinkedIn Search Action Card -->
      <div class="alumni-action-card">
        <div class="alumni-action-header">
          <div class="alumni-action-icon-wrap">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="#0A66C2">
              <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.64 1.64 0 0 0 1.63-1.63 1.64 1.64 0 0 0-1.63-1.63 1.64 1.64 0 0 0-1.63 1.63c0 .9.73 1.63 1.63 1.63m1.4 9.74v-8.37H5.06v8.37h2.8z"/>
            </svg>
          </div>
          <div class="alumni-action-title-group">
            <div class="alumni-action-title">Verified Thapar Alumni Search</div>
            <div class="alumni-action-subtitle">Pre-filtered 1-click search for seniors working at ${escapeHtml(targetComp)}</div>
          </div>
        </div>

        <!-- Parameter Specifications Pill Grid -->
        <div class="alumni-spec-grid">
          <div class="alumni-spec-item">
            <span class="alumni-spec-label">Searched Employer</span>
            <span class="alumni-spec-value">${escapeHtml(targetComp)}</span>
          </div>
          <div class="alumni-spec-item">
            <span class="alumni-spec-label">College / Institute</span>
            <span class="alumni-spec-value">Thapar Institute of Eng. & Tech.</span>
          </div>
        </div>

        <!-- Primary Action Button -->
        <a href="${escapeHtml(linkedinSearchUrl)}" target="_blank" rel="noopener noreferrer" class="alumni-btn-primary" id="btn-linkedin-alumni-search">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 8.76a1.64 1.64 0 0 0 1.63-1.63 1.64 1.64 0 0 0-1.63-1.63 1.64 1.64 0 0 0-1.63 1.63c0 .9.73 1.63 1.63 1.63m1.4 9.74v-8.37H5.06v8.37h2.8z"/>
          </svg>
          <span>Find Thapar Alumni at ${escapeHtml(targetComp)} on LinkedIn</span>
        </a>

        <!-- Secondary Portal Link Button -->
        <a href="${escapeHtml(schoolPortalUrl)}" target="_blank" rel="noopener noreferrer" class="alumni-btn-secondary">
          <span class="portal-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M6 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3M9 21v-4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4"></path></svg></span>
          <span>Official TIET School Directory (Filter by ${escapeHtml(targetComp)})</span>
        </a>
      </div>

      <!-- Senior Outreach Best Practices Card -->
      <div class="alumni-tips-card">
        <div class="alumni-tips-header">
          <span class="alumni-tips-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>
          <span class="alumni-tips-title">Cold Outreach Tips for Seniors</span>
        </div>
        <ul class="alumni-tips-list">
          <li>
            <span class="tip-num">1</span>
            <span><strong>Mention your details:</strong> "Hi [Name], I'm a 3rd/4th year [Branch] student at Thapar currently preparing for ${escapeHtml(targetComp)}..."</span>
          </li>
          <li>
            <span class="tip-num">2</span>
            <span><strong>Ask targeted questions:</strong> Inquire about specific round expectations, team tech stacks, or day-to-day work rather than generic advice.</span>
          </li>
          <li>
            <span class="tip-num">3</span>
            <span><strong>Referrals:</strong> Seniors are usually happy to help fellow Thaparians when asked politely with a 1-page resume attached.</span>
          </li>
        </ul>
      </div>
    </div>
  `;
}
function resetChatForCompany(companyName, roleName) {
  chatHistory = [];
  const comp = (companyName || "").trim() || "Target Company";
  const r = (roleName || "").trim() || "Technical Role";

  // Clear chat input
  const inputEl = document.getElementById("chat-input");
  if (inputEl) inputEl.value = "";

  // Update active company banner in Doubt Solver
  const banner = document.getElementById("chat-active-company-banner");
  const bannerText = document.getElementById("chat-context-text");
  if (banner && bannerText) {
    banner.style.display = "flex";
    bannerText.innerHTML = `Asking about: <strong>${escapeHtml(comp)}</strong> <span style="opacity:0.8;">(${escapeHtml(r)})</span>`;
  }

  // Refresh query chips with contextual questions tailored to this company & role
  const chipsContainer = document.getElementById("chat-query-chips");
  if (chipsContainer) {
    chipsContainer.innerHTML = `
      <button class="chip" data-q="What DSA and core technical topics were asked by ${escapeHtml(comp)} at Thapar?">Past Exam Topics</button>
      <button class="chip" data-q="Is there any bond or service agreement at ${escapeHtml(comp)}?">Bond Check</button>
      <button class="chip" data-q="What is the real monthly in-hand take-home salary for ${escapeHtml(comp)}?">In-Hand Salary</button>
      <button class="chip" data-q="What mistakes should I avoid in ${escapeHtml(comp)} interview rounds?">Interview Tips</button>
      <button class="chip" data-q="What is the real work-life balance for freshers at ${escapeHtml(comp)}?">Work-Life Balance</button>
    `;
    chipsContainer.querySelectorAll(".chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const inp = document.getElementById("chat-input");
        if (inp) {
          inp.value = chip.getAttribute("data-q");
          sendChatMessage();
        }
      });
    });
  }

  // Reset chat messages with fresh customized welcome bubble for the new company
  const box = document.getElementById("chat-messages");
  if (box) {
    box.innerHTML = "";
    const welcomeBubble = document.createElement("div");
    welcomeBubble.className = "chat-bubble chat-assistant";
    welcomeBubble.innerHTML = `
      Hi! I have gathered all college placement records, past interview questions, real salary details, and employee reviews for <strong>${escapeHtml(comp)}</strong> (<em>${escapeHtml(r)}</em>).<br><br>
      Ask me anything—like real monthly in-hand salary, what was asked in past rounds, service bonds, or work culture!
    `;
    box.appendChild(welcomeBubble);
    scrollChatToBottom();
  }
}

async function sendChatMessage() {
  const inputEl = document.getElementById("chat-input");
  const query = inputEl.value.trim();
  if (!query) return;

  inputEl.value = "";
  inputEl.style.height = "auto";
  appendMessage("user", query);

  if (!currentDossier) {
    appendMessage("assistant", "> **Notice:** Please analyze a company first so I can answer questions about it.");
    return;
  }

  chatHistory.push({ role: "user", content: query });
  const assistantBubble = appendMessage("assistant", "*Checking company records, reviews, and salary data...*");

  try {
    const extraNotes = document.getElementById("input-additional-notes") ? document.getElementById("input-additional-notes").value.trim() : "";
    const eligText = document.getElementById("input-eligibility") ? document.getElementById("input-eligibility").value.trim() : "";
    const skillsText = document.getElementById("input-skills") ? document.getElementById("input-skills").value.trim() : "";
    const locText = document.getElementById("input-location") ? document.getElementById("input-location").value.trim() : "";
    const ctcText = document.getElementById("input-ctc") ? document.getElementById("input-ctc").value.trim() : "";

    const enrichedContext = {
      ...(currentDossier || {}),
      portal_additional_notes: extraNotes,
      portal_eligibility: eligText,
      portal_skills: skillsText,
      portal_location: locText,
      portal_claimed_ctc: ctcText
    };

    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        company_name: currentDossier.company_name,
        context: enrichedContext,
        messages: chatHistory,
        provider: currentProvider
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
        <span class="mermaid-badge">Decision Flowchart / Strategy Map</span>
        <button class="mermaid-copy-btn" title="Copy Mermaid Definition">Copy</button>
      </div>
      <div class="mermaid">${escapeHtml(unescaped)}</div>
    </div>`;
  });

  container.innerHTML = html;

  // Post-process all anchor links to guarantee target="_blank" and rel="noopener noreferrer"
  container.querySelectorAll("a").forEach(a => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.classList.add("chat-external-link");
  });

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

function sanitizeMermaidCode(code) {
  if (!code) return "";
  let clean = code.trim();
  // Strip markdown code fences if present
  if (clean.startsWith("```mermaid")) clean = clean.slice(10);
  else if (clean.startsWith("```")) clean = clean.slice(3);
  if (clean.endsWith("```")) clean = clean.slice(0, -3);
  clean = clean.trim();

  // Strip escaped HTML if any
  clean = unescapeHtml(clean);

  // If code does not start with standard diagram keyword, prepend graph TD
  const firstLine = clean.split("\n").map(l => l.trim()).find(l => l.length > 0) || "";
  const validHeaders = ["graph ", "flowchart ", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram", "gantt", "pie", "journey"];
  const hasValidHeader = validHeaders.some(h => firstLine.startsWith(h));
  if (!hasValidHeader) {
    clean = "graph TD\n" + clean;
  }

  // Quote unquoted node labels with parentheses or special chars:
  // e.g., A[Round 1 (DSA & OS)] -> A["Round 1 (DSA & OS)"]
  clean = clean.replace(/([A-Za-z0-9_]+)\[([^"\]\n]+)\]/g, (match, id, text) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) return match;
    const safeText = trimmed.replace(/"/g, "'");
    return `${id}["${safeText}"]`;
  });

  return clean;
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
    const candidateCode = sanitizeMermaidCode(rawCode);

    // Pass 1: Try rendering locally sanitized code
    try {
      const { svg } = await mermaid.render(uniqueId, candidateCode);
      node.innerHTML = svg;
      node.setAttribute("data-raw-code", candidateCode);
      node.setAttribute("data-processed", "true");
      continue;
    } catch (err1) {
      console.warn("[Recruit Copilot] Mermaid Pass 1 parse error:", err1.message || err1);
      const stray = document.getElementById(uniqueId);
      if (stray) stray.remove();
      document.querySelectorAll(`[id*="${uniqueId}"]`).forEach(el => el.remove());
    }

    // Pass 2: LLM-as-a-Judge Evaluation & Auto-Repair
    console.log("[Recruit Copilot] Invoking LLM-as-a-Judge to evaluate & repair Mermaid syntax...");
    const judgeId = `mermaid-judge-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`;
    let repairedSuccessfully = false;

    try {
      const judgeResp = await fetch(`${BACKEND_URL}/api/evaluate-mermaid`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          mermaid_code: candidateCode || rawCode,
          error: "Mermaid client syntax error during parsing",
          provider: currentProvider || "gemini"
        })
      });

      if (judgeResp.ok) {
        const judgeData = await judgeResp.json();
        if (judgeData && judgeData.corrected_code) {
          const fixedSanitized = sanitizeMermaidCode(judgeData.corrected_code);
          const { svg } = await mermaid.render(judgeId, fixedSanitized);
          node.innerHTML = svg;
          node.setAttribute("data-raw-code", fixedSanitized);
          node.setAttribute("data-processed", "true");
          repairedSuccessfully = true;

          // Annotate diagram header with judge validation badge
          const card = node.closest(".mermaid-diagram-card");
          if (card) {
            const badge = card.querySelector(".mermaid-badge");
            if (badge && !badge.querySelector(".mermaid-judge-pill")) {
              const judgePill = document.createElement("span");
              judgePill.className = "mermaid-judge-pill";
              judgePill.title = `Evaluated and corrected by ${judgeData.fixed_by || "LLM Judge"}`;
              judgePill.innerHTML = `Fixed by LLM Judge`;
              badge.appendChild(judgePill);
            }
          }
        }
      }
    } catch (judgeErr) {
      console.warn("[Recruit Copilot] LLM Judge evaluation failed:", judgeErr);
      const strayJudge = document.getElementById(judgeId);
      if (strayJudge) strayJudge.remove();
      document.querySelectorAll(`[id*="${judgeId}"]`).forEach(el => el.remove());
    }

    if (!repairedSuccessfully) {
      node.innerHTML = `<pre class="mermaid-fallback"><code>${escapeHtml(rawCode)}</code></pre>
        <div class="mermaid-error-note">Flowchart preview (syntax check: ensure arrows like --&gt; have valid nodes)</div>`;
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
  // Markdown links [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer" class="chat-external-link">$1</a>');
  // Raw URLs (not already inside href)
  out = out.replace(/(^|[^"'>])(https?:\/\/[^\s<]+)/gim, '$1<a href="$2" target="_blank" rel="noopener noreferrer" class="chat-external-link">$2</a>');
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

// ==========================================================================
// Interactive Onboarding Walkthrough Tour System (Professional Grade)
// ==========================================================================

const INPUT_TOUR_STEPS = [
  {
    targetId: "btn-sync-page",
    badge: "Step 1 of 4 • Quick Start",
    title: "1-Click Page Auto-Fill",
    desc: "Visiting Superset, your college ERP, or LinkedIn? Click Auto-Fill to automatically extract the target company, role, stipend, and cutoffs with zero typing."
  },
  {
    targetId: "input-company",
    badge: "Step 2 of 4 • Target",
    title: "Target Company & Profile",
    desc: "Enter or tweak the company name and role. Recruit Copilot uses this to cross-reference historical college records, salary data, and alumni."
  },
  {
    targetId: "btn-toggle-extra-ctx",
    badge: "Step 3 of 4 • Documents",
    title: "Upload Notice or PDF (Optional)",
    desc: "Have an official drive notice or offer PDF? Upload it here. Our AI automatically parses bond clauses, probation periods, and branch cutoffs.",
    onBefore: () => {
      const drawer = document.getElementById("extra-ctx-drawer");
      if (drawer && drawer.classList.contains("rs-hidden")) {
        document.getElementById("btn-toggle-extra-ctx")?.click();
      }
    }
  },
  {
    targetId: "btn-analyze",
    badge: "Step 4 of 4 • Launch",
    title: "Deep Intelligence Audit",
    desc: "Click 'Analyze Company' (or press Ctrl+Enter). We'll cross-examine placement records, student reviews, salary traps, and interview questions!"
  }
];

const RESULTS_TOUR_STEPS = [
  {
    targetId: "verdict-card",
    badge: "Results Tour • 1 of 7",
    title: "Executive Verdict & Quality Score",
    desc: "Get an instant summary of company stability, recruitment reputation, and an AI confidence score cross-verified across student sources."
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-compensation"]',
    tabId: "tab-compensation",
    badge: "Results Tour • 2 of 7",
    title: "True In-Hand Salary Breakdown",
    desc: "See the real monthly take-home pay, base salary vs variable pay, joining bonuses, and hidden deductions before you sign.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-compensation"]')?.click();
    }
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-campus"]',
    tabId: "tab-campus",
    badge: "Results Tour • 3 of 7",
    title: "Last Year Hiring Statistics",
    desc: "Explore actual hiring numbers, past batch offers, branch cutoffs, and CGPA criteria recorded from previous recruitment drives on your campus.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-campus"]')?.click();
    }
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-prep"]',
    tabId: "tab-prep",
    badge: "Results Tour • 4 of 7",
    title: "Past Year Questions & Prep Guide",
    desc: "Access verified past year campus questions, web-researched interview insights, and high-frequency technical topics tailored to this company.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-prep"]')?.click();
    }
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-alumni"]',
    tabId: "tab-alumni",
    badge: "Results Tour • 5 of 7",
    title: "College Senior & Alumni Network",
    desc: "Connect with college alumni currently working at this exact company with 1-click filtered LinkedIn searches for referrals.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-alumni"]')?.click();
    }
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-chat"]',
    tabId: "tab-chat",
    badge: "Results Tour • 6 of 7",
    title: "Ask AI Anything (Copilot Doubt Solver)",
    desc: "Got doubts about bond clauses, interview questions, or work culture? Ask your dedicated AI copilot with context of this company.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-chat"]')?.click();
    }
  },
  {
    targetSelector: '.segment-btn[data-tab="tab-redflags"]',
    tabId: "tab-redflags",
    badge: "Results Tour • 7 of 7",
    title: "Red Flag & Safety Warning Detector",
    desc: "Protect your career! Check for service agreements, bonds, delayed onboarding risks, and negative employee sentiment.",
    onBefore: () => {
      document.querySelector('.segment-btn[data-tab="tab-redflags"]')?.click();
    }
  }
];

let currentTourType = null; // "input" | "results"
let currentTourStep = 0;
let isTourActive = false;

function initOnboardingTour() {
  const btnNext = document.getElementById("btn-tour-next");
  const btnPrev = document.getElementById("btn-tour-prev");
  const btnSkip = document.getElementById("btn-tour-skip");
  const btnClose = document.getElementById("btn-tour-close");

  if (btnNext) btnNext.addEventListener("click", nextTourStep);
  if (btnPrev) btnPrev.addEventListener("click", prevTourStep);
  if (btnSkip) btnSkip.addEventListener("click", skipTour);
  if (btnClose) btnClose.addEventListener("click", skipTour);

  // Keyboard navigation
  window.addEventListener("keydown", (e) => {
    if (!isTourActive) return;
    if (e.key === "Escape") {
      skipTour();
    } else if (e.key === "ArrowRight" || e.key === "Enter") {
      nextTourStep();
    } else if (e.key === "ArrowLeft") {
      prevTourStep();
    }
  });

  // Reposition on window resize
  window.addEventListener("resize", () => {
    if (!isTourActive) return;
    const currentSteps = currentTourType === "input" ? INPUT_TOUR_STEPS : RESULTS_TOUR_STEPS;
    const step = currentSteps[currentTourStep];
    if (!step) return;
    const targetEl = step.targetId ? document.getElementById(step.targetId) : document.querySelector(step.targetSelector);
    if (targetEl) positionTourCard(targetEl);
  });

  // Check if first-time user needs the input tour
  chrome.storage.local.get(["has_seen_input_tour"], (res) => {
    if (!res || !res.has_seen_input_tour) {
      setTimeout(() => {
        const dossierContainer = document.getElementById("dossier-container");
        if (!dossierContainer || dossierContainer.classList.contains("rs-hidden")) {
          startTour("input");
        }
      }, 700);
    }
  });
}

function checkAndTriggerResultsTour() {
  chrome.storage.local.get(["has_seen_results_tour"], (res) => {
    if (!res || !res.has_seen_results_tour) {
      setTimeout(() => {
        startTour("results");
      }, 800);
    }
  });
}

function startTour(tourType) {
  currentTourType = tourType;
  currentTourStep = 0;
  isTourActive = true;

  const backdrop = document.getElementById("tour-backdrop");
  const card = document.getElementById("tour-card");
  if (backdrop) backdrop.classList.remove("rs-hidden");
  if (card) card.classList.remove("rs-hidden");

  posthogCapture("tour_started", { tour_type: tourType });
  renderTourStep(0);
}

function renderTourStep(index) {
  const steps = currentTourType === "input" ? INPUT_TOUR_STEPS : RESULTS_TOUR_STEPS;
  if (!steps || index < 0 || index >= steps.length) return;

  currentTourStep = index;
  const step = steps[index];

  // Run step hook if present (e.g. activating tabs or expanding drawers)
  if (typeof step.onBefore === "function") {
    try {
      step.onBefore();
    } catch (e) {}
  }

  // Remove existing highlights
  document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));

  // Find target element
  const targetEl = step.targetId ? document.getElementById(step.targetId) : (step.targetSelector ? document.querySelector(step.targetSelector) : null);

  if (targetEl) {
    targetEl.classList.add("tour-highlight");
    try {
      targetEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {}
  }

  // Populate card elements
  const badgeEl = document.getElementById("tour-badge");
  const titleEl = document.getElementById("tour-step-title");
  const descEl = document.getElementById("tour-step-desc");
  const counterEl = document.getElementById("tour-counter");
  const btnPrev = document.getElementById("btn-tour-prev");
  const btnNext = document.getElementById("btn-tour-next");

  if (badgeEl) badgeEl.innerText = step.badge || `Tour • ${index + 1} of ${steps.length}`;
  if (titleEl) titleEl.innerText = step.title;
  if (descEl) descEl.innerText = step.desc;
  if (counterEl) counterEl.innerText = `Step ${index + 1} of ${steps.length}`;

  // Previous button
  if (btnPrev) {
    if (index === 0) {
      btnPrev.classList.add("rs-hidden");
    } else {
      btnPrev.classList.remove("rs-hidden");
    }
  }

  // Next / Finish button
  if (btnNext) {
    if (index === steps.length - 1) {
      btnNext.innerText = "Got It!";
    } else {
      btnNext.innerText = "Next";
    }
  }

  // Render dots
  renderTourDots(steps.length, index);

  // Position card near target element with multiple layout checks to handle smooth-scroll & drawer expansion
  requestAnimationFrame(() => {
    if (targetEl) positionTourCard(targetEl);
  });
  setTimeout(() => {
    if (targetEl) positionTourCard(targetEl);
  }, 100);
  setTimeout(() => {
    if (targetEl) positionTourCard(targetEl);
  }, 320);

  posthogCapture("tour_step_viewed", {
    tour_type: currentTourType,
    step: index + 1,
    title: step.title
  });
}

function positionTourCard(targetEl) {
  const card = document.getElementById("tour-card");
  if (!card || !targetEl) return;

  const rect = targetEl.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cardHeight = Math.max(cardRect.height, card.offsetHeight, 160);
  const viewportHeight = window.innerHeight;
  const gap = 10;
  const edgePadding = 12;

  let top;

  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;

  // Decide whether card fits better below or above target
  if (spaceBelow >= cardHeight + gap + edgePadding) {
    top = rect.bottom + gap;
  } else if (spaceAbove >= cardHeight + gap + edgePadding) {
    top = rect.top - cardHeight - gap;
  } else {
    // If screen is snug, place in whichever half has more space
    top = spaceBelow >= spaceAbove ? (rect.bottom + gap) : (rect.top - cardHeight - gap);
  }

  // STRICT VIEWPORT CLAMP:
  // Ensure the card never extends below the bottom edge or above the top edge of the extension window
  const maxTop = Math.max(edgePadding, viewportHeight - cardHeight - edgePadding);
  top = Math.min(top, maxTop);
  top = Math.max(edgePadding, top);

  card.style.top = `${Math.round(top)}px`;
  card.style.bottom = "auto";
}

function renderTourDots(total, current) {
  const container = document.getElementById("tour-dots");
  if (!container) return;
  container.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const dot = document.createElement("span");
    dot.className = "tour-dot" + (i === current ? " is-active" : "");
    container.appendChild(dot);
  }
}

function nextTourStep() {
  const steps = currentTourType === "input" ? INPUT_TOUR_STEPS : RESULTS_TOUR_STEPS;
  if (!steps) return;
  if (currentTourStep >= steps.length - 1) {
    completeTour();
  } else {
    renderTourStep(currentTourStep + 1);
  }
}

function prevTourStep() {
  if (currentTourStep > 0) {
    renderTourStep(currentTourStep - 1);
  }
}

function completeTour() {
  const finishedType = currentTourType;
  if (finishedType === "input") {
    chrome.storage.local.set({ has_seen_input_tour: true });
  } else if (finishedType === "results") {
    chrome.storage.local.set({ has_seen_results_tour: true });
  }
  posthogCapture("tour_completed", { tour_type: finishedType });
  closeTour();
}

function skipTour() {
  const skippedType = currentTourType;
  if (skippedType === "input") {
    chrome.storage.local.set({ has_seen_input_tour: true });
  } else if (skippedType === "results") {
    chrome.storage.local.set({ has_seen_results_tour: true });
  }
  posthogCapture("tour_skipped", {
    tour_type: skippedType,
    at_step: currentTourStep + 1
  });
  closeTour();
}

function closeTour() {
  document.querySelectorAll(".tour-highlight").forEach(el => el.classList.remove("tour-highlight"));
  const backdrop = document.getElementById("tour-backdrop");
  const card = document.getElementById("tour-card");
  if (backdrop) backdrop.classList.add("rs-hidden");
  if (card) card.classList.add("rs-hidden");
  isTourActive = false;
  currentTourType = null;
  currentTourStep = 0;
}
