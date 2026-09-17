// RecruitSage Content Script for recruit.thapar.edu
// High-Precision Extraction Engine for Thapar Placement Portal with Deep Dropdown & PDF Detection

(function () {
  console.log("[RecruitSage] Content script loaded on recruit.thapar.edu");

  // 1. Create and inject floating action button (Sleek minimalist capsule)
  function injectFloatingButton() {
    const existing = document.getElementById("recruitsage-floating-btn");
    if (existing) existing.remove();

    const logoUrl = chrome.runtime.getURL("icons/recruitsage_icon48.png");

    const btn = document.createElement("button");
    btn.id = "recruitsage-floating-btn";
    btn.innerHTML = `
      <img src="${logoUrl}" style="width:18px; height:18px; border-radius:50%; object-fit:cover; display:block; box-shadow: 0 0 6px rgba(16,185,129,0.4);" alt="RecruitSage" />
      <span>RecruitSage</span>
    `;

    btn.style.position = "fixed";
    btn.style.bottom = "24px";
    btn.style.right = "24px";
    btn.style.zIndex = "9999999";
    btn.style.display = "flex";
    btn.style.alignItems = "center";
    btn.style.gap = "8px";
    btn.style.padding = "9px 15px";
    btn.style.borderRadius = "20px";
    btn.style.backgroundColor = "rgba(18, 19, 22, 0.94)";
    btn.style.backdropFilter = "blur(12px)";
    btn.style.webkitBackdropFilter = "blur(12px)";
    btn.style.color = "#F3F4F6";
    btn.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "500";
    btn.style.letterSpacing = "-0.01em";
    btn.style.border = "1px solid rgba(255, 255, 255, 0.12)";
    btn.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.4)";
    btn.style.cursor = "pointer";
    btn.style.transition = "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)";

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "translateY(-2px)";
      btn.style.borderColor = "rgba(255, 255, 255, 0.25)";
      btn.style.boxShadow = "0 10px 28px rgba(0, 0, 0, 0.55)";
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "translateY(0)";
      btn.style.borderColor = "rgba(255, 255, 255, 0.12)";
      btn.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.4)";
    });

    btn.addEventListener("click", () => {
      const data = extractPageData();
      chrome.storage.local.set({ last_extracted_company: data }, () => {
        chrome.runtime.sendMessage({ action: "OPEN_SIDEPANEL" });
        chrome.runtime.sendMessage({ action: "TRIGGER_EXTRACTION_IN_PANEL" });
      });
    });

    document.body.appendChild(btn);
  }

  // Helper: Detect if a text string is a Job Role rather than a Company Name
  function isLikelyJobRole(text) {
    if (!text) return false;
    const clean = text.toLowerCase().trim();
    if (/back to|apply|full-time|part-time|internship|pune|noida|bangalore|hyderabad|gurugram|delhi/i.test(clean)) {
      return true;
    }
    const rolePattern = /\b(developer|engineer|analyst|trainee|intern|associate|manager|consultant|specialist|lead|architect|sde|full stack|backend|frontend|devops|qa|testing|member technical|get|pgt|graduate|post graduate|cyber security|security|software|cloud|data scientist|ai\/ml)\b/i;
    return rolePattern.test(clean);
  }

  // Clean raw company name candidate
  function cleanCompanyName(name) {
    if (!name) return "";
    let clean = name.trim();
    clean = clean.replace(/^(?:company(?:\s*name)?|organization|employer|recruiter)[\s:\-]+/i, "");
    clean = clean.replace(/[\n\r\t]+/g, " ").trim();
    clean = clean.replace(/^[–\-:|]+|[–\-:|]+$/g, "").trim();
    return clean;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEEP EXTRACTION ENGINE: Accordions, Collapsible Containers & Dropdowns
  // Specifically captures eligibility criteria, branch cutoffs, CGPA, and
  // salary breakdown tables that standard innerText misses when collapsed.
  // ─────────────────────────────────────────────────────────────────────────────
  function extractDropdownsAndAccordions() {
    const collapsedSections = [];
    let eligibilitySection = "";
    let salarySection = "";

    // 1. Automatically expand native <details> elements
    const detailsEls = document.querySelectorAll("details");
    detailsEls.forEach(d => {
      try {
        if (!d.open) d.open = true;
      } catch (e) {}
    });

    // 2. Query all collapsible triggers and panels (Bootstrap, Tailwind, custom portal)
    const candidateNodes = Array.from(document.querySelectorAll(
      ".accordion-item, .accordion-body, .collapse, .collapsible, [role='tabpanel'], .tab-pane, " +
      "[aria-expanded], details, .card, .panel, [class*='dropdown'], [class*='accordion'], " +
      "[id*='eligib'], [id*='salary'], [id*='criteria'], [id*='breakdown'], [id*='selection'], " +
      "[class*='eligib'], [class*='salary'], [class*='criteria'], [class*='breakdown'], [class*='selection'], " +
      "table, .table"
    ));

    const seenTexts = new Set();

    candidateNodes.forEach(node => {
      // textContent extracts text even from hidden/collapsed DOM nodes (display: none, height: 0)
      const rawText = (node.textContent || "").replace(/[\t\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
      if (!rawText || rawText.length < 15 || seenTexts.has(rawText)) return;
      seenTexts.add(rawText);

      // Extract section heading
      let headerText = "";
      const headerEl = node.querySelector("h1, h2, h3, h4, h5, h6, .accordion-header, .accordion-button, summary, [class*='title'], [class*='header'], button");
      if (headerEl) {
        headerText = headerEl.innerText.trim();
      } else {
        const prev = node.previousElementSibling;
        if (prev && /h[1-6]|button|summary|title|label/i.test(prev.tagName)) {
          headerText = prev.innerText.trim();
        } else {
          headerText = node.getAttribute("id") || node.getAttribute("aria-label") || "";
        }
      }

      const combined = `${headerText ? headerText + ": " : ""}${rawText}`;
      const lower = combined.toLowerCase();

      // Check for Eligibility & Branch Criteria
      const isEligibility = /eligib|criteria|cgpa|cut[\s\-]?off|branch(?:es)?\s+allowed|academic|backlog|passing\s+year|percentage|10th|12th|coe|cse|enc|ece/i.test(lower);
      // Check for Salary / CTC / Compensation Breakdown
      const isSalary = /salary|ctc|breakdown|compensation|stipend|fixed|variable|allowance|retention|bond|perk|gratuity|in[\s\-]?hand|take[\s\-]?home|base\s+pay/i.test(lower);

      if (isEligibility) {
        eligibilitySection += (eligibilitySection ? "\n\n" : "") + combined.slice(0, 1500);
      }
      if (isSalary) {
        salarySection += (salarySection ? "\n\n" : "") + combined.slice(0, 1500);
      }

      collapsedSections.push({
        title: headerText || "Collapsible Section",
        text: rawText.slice(0, 1500),
        is_eligibility: isEligibility,
        is_salary: isSalary
      });
    });

    return {
      collapsedSections,
      eligibilitySection: eligibilitySection.trim(),
      salarySection: salarySection.trim(),
      allCollapsedText: collapsedSections.map(s => `[SECTION: ${s.title}]\n${s.text}`).join("\n\n").slice(0, 6000)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DOCUMENT DETECTOR: Detects JD and Salary Breakdown PDF links & Web Embeds
  // ─────────────────────────────────────────────────────────────────────────────
  function detectPagePdfLinks() {
    const detected = [];
    const seenUrls = new Set();

    const candidateElements = document.querySelectorAll("a[href], iframe[src], embed[src], object[data]");
    candidateElements.forEach(el => {
      let rawUrl = el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data") || "";
      if (!rawUrl || rawUrl.startsWith("javascript:") || rawUrl.startsWith("#")) return;

      let fullUrl = "";
      try {
        fullUrl = new URL(rawUrl, window.location.href).href;
      } catch (e) {
        return;
      }

      if (seenUrls.has(fullUrl)) return;

      const linkText = (el.innerText || el.getAttribute("title") || el.getAttribute("aria-label") || "").trim();
      const urlLower = fullUrl.toLowerCase();
      const textLower = linkText.toLowerCase();

      // Check if URL points to a PDF or document endpoint
      const isPdfUrl = /\.pdf(\?.*)?$/i.test(urlLower) || 
                       urlLower.includes("/pdf/") || 
                       urlLower.includes("/download") || 
                       urlLower.includes("/attachments/") || 
                       urlLower.includes("/files/") ||
                       urlLower.includes("/docs/") ||
                       urlLower.includes("drive.google.com/file");

      // Check if text indicates a Job Description or Salary Breakdown document
      const isDocText = /\b(pdf|jd|job\s*description|salary|breakdown|annexure|notice|document|download|ctc|compensation|eligibility)\b/i.test(textLower);

      if (isPdfUrl || (isDocText && !/logout|home|login|profile|feedback|help/i.test(urlLower))) {
        seenUrls.add(fullUrl);

        let docType = "notice";
        if (/salary|ctc|breakdown|compensation|annexure|package/i.test(textLower) || /salary|ctc|breakdown/i.test(urlLower)) {
          docType = "salary";
        } else if (/jd|job\s*description|profile|role|qualification/i.test(textLower) || /jd|job/i.test(urlLower)) {
          docType = "jd";
        }

        let filename = fullUrl.split("/").pop().split("?")[0] || "";
        if (!filename.toLowerCase().endsWith(".pdf")) {
          filename = (linkText ? linkText.replace(/[^a-zA-Z0-9_\-\. ]/g, "").slice(0, 35) : "Placement_Document") + ".pdf";
        }

        detected.push({
          url: fullUrl,
          title: linkText || filename,
          filename: filename,
          type: docType
        });
      }
    });

    return detected;
  }

  // 2. High-Precision DOM Extractor for recruit.thapar.edu
  function extractPageData() {
    let companyName = "";
    let role = "";
    let ctcText = "";
    let eligibility = "";
    let jdText = "";

    // Run deep accordion/dropdown extraction
    const dropdownData = extractDropdownsAndAccordions();
    const detectedPdfs = detectPagePdfLinks();

    // Combine visible innerText with all collapsed dropdown text so no data is omitted
    const basePageText = document.body.innerText || "";
    const pageText = `${basePageText}\n\n=== [DROPDOWNS, ACCORDIONS & COLLAPSIBLE SECTIONS] ===\n${dropdownData.allCollapsedText}`;

    // STRATEGY 1: Layout-Specific Sibling Detection (Thapar Job Header Card)
    const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, .title, [class*='title']"));
    let detectedRoleEl = null;

    for (const h of allHeadings) {
      const text = h.innerText.trim();
      if (text.length > 3 && isLikelyJobRole(text)) {
        detectedRoleEl = h;
        role = text;
        break;
      }
    }

    if (detectedRoleEl) {
      const prevEl = detectedRoleEl.previousElementSibling;
      if (prevEl) {
        const cand = cleanCompanyName(prevEl.innerText);
        if (cand && cand.length > 1 && cand.length < 60 && !isLikelyJobRole(cand)) {
          companyName = cand;
        }
      }

      if (!companyName && detectedRoleEl.parentElement) {
        const siblings = Array.from(detectedRoleEl.parentElement.children);
        const idx = siblings.indexOf(detectedRoleEl);
        if (idx > 0) {
          const cand = cleanCompanyName(siblings[idx - 1].innerText);
          if (cand && cand.length > 1 && cand.length < 60 && !isLikelyJobRole(cand)) {
            companyName = cand;
          }
        }
      }
    }

    // STRATEGY 2: Logo Image `alt` or `title` attributes
    if (!companyName) {
      const headerLogos = document.querySelectorAll("header img, .job-header img, [class*='logo'] img, [class*='company'] img, img");
      for (const img of headerLogos) {
        const alt = cleanCompanyName(img.getAttribute("alt") || img.getAttribute("title") || "");
        if (alt && alt.length > 1 && alt.length < 50 && !/logo|icon|avatar|thapar|profile|banner|image/i.test(alt) && !isLikelyJobRole(alt)) {
          companyName = alt;
          break;
        }
      }
    }

    // STRATEGY 3: Structured Table / Label-Value Pairs
    if (!companyName) {
      const allLabels = document.querySelectorAll("td, th, dt, dd, label, span, div, strong, b");
      for (const el of allLabels) {
        const text = el.innerText.trim();
        if (/^(?:Company(?:\s*Name)?|Organization|Employer)\s*[:\-]?$/i.test(text)) {
          let valEl = el.nextElementSibling;
          if (!valEl && el.parentElement) {
            const siblings = Array.from(el.parentElement.children);
            const idx = siblings.indexOf(el);
            if (idx !== -1 && idx + 1 < siblings.length) {
              valEl = siblings[idx + 1];
            }
          }
          if (valEl && valEl.innerText.trim()) {
            const cand = cleanCompanyName(valEl.innerText);
            if (cand && cand.length > 1 && cand.length < 80 && !isLikelyJobRole(cand)) {
              companyName = cand;
              break;
            }
          }
        }
      }
    }

    // STRATEGY 4: Website URL Extraction
    if (!companyName) {
      const siteMatch = pageText.match(/(?:Website|Web|Site)[\s:\-]+https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+)\.[a-z]+/i);
      if (siteMatch && siteMatch[1]) {
        const domain = siteMatch[1].trim();
        if (domain && domain.length > 2 && !/thapar|google|linkedin|recruit|portal/i.test(domain)) {
          companyName = domain.charAt(0).toUpperCase() + domain.slice(1);
        }
      }
    }

    // STRATEGY 5: Regex in "About the role" or Description
    if (!companyName) {
      const aboutMatch = pageText.match(/(?:About\s+the\s+role|About\s+Us|Company\s+Profile)[\s\S]{0,100}?([A-Z][a-zA-Z0-9\s]{2,30}?)\s+(?:GmbH|Pvt|Ltd|Inc|Group|India|founded|is\s+a)/i);
      if (aboutMatch && aboutMatch[1]) {
        const cand = cleanCompanyName(aboutMatch[1]);
        if (cand && cand.length > 2 && !isLikelyJobRole(cand)) {
          companyName = cand;
        }
      }
    }

    // STRATEGY 6: CTC Extraction (Prioritize dropdown salary breakdown if available)
    if (dropdownData.salarySection) {
      ctcText = dropdownData.salarySection.slice(0, 300);
    } else {
      const ctcMatches = pageText.match(/(?:CTC|Package|Salary|Compensation|Stipend)[\s:]*([^\n\r]+)/i);
      if (ctcMatches && ctcMatches[1]) {
        ctcText = ctcMatches[1].trim().slice(0, 150);
      } else {
        const lpaMatch = pageText.match(/([₹Rs.\s]*\d+(?:\.\d+)?\s*(?:LPA|Lakhs?|Per Annum))/i);
        if (lpaMatch && lpaMatch[1]) {
          ctcText = lpaMatch[1].trim();
        }
      }
    }

    // STRATEGY 7: Role Fallback
    if (!role) {
      const roleMatches = pageText.match(/(?:Profile|Designation|Role|Job Title|Position)[\s:]*([^\n\r]+)/i);
      if (roleMatches && roleMatches[1]) {
        role = roleMatches[1].trim().slice(0, 100);
      } else if (detectedRoleEl) {
        role = detectedRoleEl.innerText.trim();
      } else {
        role = "Software Engineer / Technical Role";
      }
    }

    // STRATEGY 8: Eligibility & JD Context (Prioritize dropdown eligibility section)
    if (dropdownData.eligibilitySection) {
      eligibility = dropdownData.eligibilitySection.slice(0, 500);
    } else {
      const eligMatches = pageText.match(/(?:Eligibility|CGPA|Branches Allowed|Criteria)[\s:]*([^\n\r]+)/i);
      if (eligMatches && eligMatches[1]) {
        eligibility = eligMatches[1].trim().slice(0, 300);
      }
    }

    const jdContainers = document.querySelectorAll(".job-description, .jd, .details, #job-details, article, .content, [class*='description']");
    if (jdContainers.length > 0) {
      jdText = Array.from(jdContainers).map(el => el.innerText).join("\n\n").slice(0, 4500);
    } else {
      jdText = basePageText.slice(0, 3500);
    }

    // STRATEGY 9: Location Extraction
    let location = "";
    const locMatch = pageText.match(/(?:Job\s+Location|Location|Place\s+of\s+Posting|Posting\s+Location)[\s:]*([^\n\r]+)/i);
    if (locMatch && locMatch[1]) {
      location = locMatch[1].trim().slice(0, 100);
    }

    // STRATEGY 10: Probation & Bond Extraction
    let probationNote = "";
    const probMatch = pageText.match(/(?:Probation(?:\s+Period)?|Service\s+Agreement|Bond(?:\s+Period)?|Training\s+Period)[\s:]*([^\n\r]+)/i);
    if (probMatch && probMatch[1]) {
      probationNote = probMatch[1].trim().slice(0, 200);
    }

    // STRATEGY 11: Job Type & Deadline
    let jobType = "";
    const typeMatch = pageText.match(/(?:Employment\s+Type|Job\s+Type|Hiring\s+Type)[\s:]*([^\n\r]+)/i);
    if (typeMatch && typeMatch[1]) {
      jobType = typeMatch[1].trim().slice(0, 60);
    }

    let deadline = "";
    const deadMatch = pageText.match(/(?:Deadline|Last\s+Date|Apply\s+Before|Registration\s+Closes)[\s:]*([^\n\r]+)/i);
    if (deadMatch && deadMatch[1]) {
      deadline = deadMatch[1].trim().slice(0, 80);
    }

    if (isLikelyJobRole(companyName)) {
      if (!role) role = companyName;
      companyName = "";
    }

    console.log("[RecruitSage Extractor] Extracted:", { 
      companyName, 
      role, 
      ctcText: ctcText.slice(0, 60), 
      detectedPdfsCount: detectedPdfs.length,
      collapsedSectionsCount: dropdownData.collapsedSections.length
    });

    return {
      company_name: companyName.trim(),
      role: role.trim() || "Technical Role",
      ctc_text: ctcText.trim(),
      location: location.trim(),
      job_type: jobType.trim(),
      probation_or_bond_note: probationNote.trim(),
      deadline: deadline.trim(),
      eligibility_text: eligibility.trim(),
      jd_text: jdText.trim(),
      raw_page_text: pageText.trim().slice(0, 10000),
      page_url: window.location.href,
      detected_pdfs: detectedPdfs,
      dropdown_sections: dropdownData.collapsedSections,
      eligibility_dropdown_text: dropdownData.eligibilitySection,
      salary_dropdown_text: dropdownData.salarySection,
      extracted_at: new Date().toISOString()
    };
  }

  // 3. Listen for requests from the Side Panel
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "EXTRACT_PAGE_DATA") {
      const data = extractPageData();
      sendResponse(data);
    }
  });

  // Inject when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFloatingButton);
  } else {
    injectFloatingButton();
  }
})();
