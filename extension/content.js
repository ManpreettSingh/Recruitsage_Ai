// Recruit Copilot Content Script for recruit.thapar.edu
// High-Precision Extraction Engine for Thapar Placement Portal with Deep Dropdown & PDF Detection

(function () {
  console.log("[Recruit Copilot] Content script loaded on recruit.thapar.edu");

  // 1. Create and inject floating action button (Sleek minimalist capsule)
  function injectFloatingButton() {
    // Purge any lingering buttons with old or new IDs
    const oldBtns = document.querySelectorAll(
      "#recruitsage-floating-btn, #recruitcopilot-floating-btn, button[id*='recruitsage'], button[id*='recruitcopilot']"
    );
    oldBtns.forEach(el => el.remove());

    const logoUrl = chrome.runtime.getURL("icons/recruitcopilot_icon48.png");

    const btn = document.createElement("button");
    btn.id = "recruitcopilot-floating-btn";
    btn.setAttribute("title", "Open Recruit Copilot");
    btn.innerHTML = `
      <img src="${logoUrl}" style="width:18px; height:18px; border-radius:50%; object-fit:cover; display:block; box-shadow: 0 0 6px rgba(16,185,129,0.4);" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';" alt="Recruit Copilot" />
      <span style="display:none; width:8px; height:8px; border-radius:50%; background:#10B981; box-shadow: 0 0 6px #10B981;"></span>
      <span>Recruit Copilot</span>
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
      expandAllAccordions();
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
      expandAllAccordions();
      setTimeout(() => {
        const data = extractPageData();
        chrome.storage.local.set({ last_extracted_company: data }, () => {
          chrome.runtime.sendMessage({ action: "OPEN_SIDEPANEL" });
          chrome.runtime.sendMessage({ action: "TRIGGER_EXTRACTION_IN_PANEL" });
        });
      }, 100);
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
  // ACCORDION AUTO-EXPANDER: Safely opens closed accordions and dropdowns
  // ─────────────────────────────────────────────────────────────────────────────
  function expandAllAccordions() {
    try {
      // 1. Native <details> elements
      document.querySelectorAll("details:not([open])").forEach(d => {
        try { d.open = true; } catch (e) {}
      });

      // 2. ARIA collapsed triggers
      document.querySelectorAll("[aria-expanded='false']").forEach(el => {
        try {
          const t = (el.innerText || el.textContent || "").toLowerCase();
          if (/eligib|date|salary|selection|spr|criteria|round|workflow|duty|process|stipend|ctc|bond|schedule|notice/i.test(t)) {
            el.click();
          }
        } catch (e) {}
      });

      // 3. UI Framework Accordion triggers (Bootstrap, AntD, Angular Material, etc.)
      const frameworkTriggers = document.querySelectorAll(
        ".accordion-button.collapsed, " +
        ".ant-collapse-header[aria-expanded='false'], " +
        ".mat-expansion-panel:not(.mat-expanded) .mat-expansion-panel-header, " +
        "[class*='accordion'] [class*='header'], [class*='accordion'] button, " +
        "[class*='collapse'] [class*='header'], [class*='collapsible']:not(.active)"
      );
      frameworkTriggers.forEach(trig => {
        try {
          const t = (trig.innerText || trig.textContent || "").toLowerCase();
          if (/eligib|date|salary|selection|spr|criteria|round|workflow|duty|process|stipend|ctc/i.test(t)) {
            trig.click();
          }
        } catch (e) {}
      });

      // 4. Superset / Custom placement portal accordion rows (as shown in user's image)
      const targetHeaderPatterns = [
        "eligibility criteria",
        "important dates",
        "salary information",
        "selection procedure",
        "selection process",
        "hiring workflow",
        "spr on duty",
        "bond & agreement",
        "terms & conditions",
        "probation period"
      ];

      document.querySelectorAll("div, button, a, li, tr, span, p, h1, h2, h3, h4, h5, h6").forEach(el => {
        const raw = (el.innerText || "").trim();
        if (raw.length < 2 || raw.length > 80) return;
        const norm = raw.replace(/[\s\n\r>›»\u25BC\u25B2v\^:|]+/g, " ").trim().toLowerCase();

        const isTarget = targetHeaderPatterns.some(pat => norm === pat || norm.startsWith(pat));
        if (isTarget) {
          const trigger = el.closest("[role='button'], button, .accordion-item, .card, div") || el;
          if (!trigger.dataset.copilotExpanded) {
            const textHasRightChevron = /[>›»\u2192\u25BA]/.test(raw);
            const iconHasRight = !!trigger.querySelector("[class*='right'], [class*='chevron-right'], [data-icon*='right'], svg");
            const isAriaClosed = trigger.getAttribute("aria-expanded") === "false";
            const textHasDown = /[v\u25BC\u25BE\u25B2]/.test(raw);
            const iconHasDown = !!trigger.querySelector("[class*='down'], [class*='chevron-down'], [data-icon*='down']");
            const isAriaOpen = trigger.getAttribute("aria-expanded") === "true";

            // If it is closed, click once to expand; if already open (like Salary Information v), do not click!
            if ((textHasRightChevron || iconHasRight || isAriaClosed) && !(textHasDown || iconHasDown || isAriaOpen)) {
              trigger.dataset.copilotExpanded = "true";
              try { trigger.click(); } catch (e) {}
            }
          }
        }
      });
    } catch (expErr) {
      console.warn("[Recruit Copilot] Accordion expansion warning:", expErr);
    }
  }

  // Helper: Convert multiline section text into clean sub-bullet items
  function formatLinesToSubBullets(rawText, maxLines = 16) {
    if (!rawText) return [];

    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/[\t\r]+/g, " ").trim())
      .filter(l => l.length > 0 && !/^[\s>›»\u25BC\u25B2v\^:|–—\-]+$/.test(l));

    // Merge consecutive label-value pairs (e.g. "For course:" followed by "B.E./B.Tech")
    const merged = [];
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      if (i + 1 < lines.length && /:$/.test(cur) && cur.length < 35 && lines[i + 1].length < 100) {
        merged.push(`${cur} ${lines[i + 1]}`);
        i++;
      } else {
        merged.push(cur);
      }
    }

    const cleaned = merged
      .map(l => l.replace(/^[•·\u25BA\u25AA*\-–—]+\s*/, "").trim())
      .filter(l => {
        if (l.length < 2) return false;
        if (/^(?:details|information|view|click\s+here|dropdown|accordion|chevron|arrow|expand|collapse)$/i.test(l)) return false;
        return true;
      });

    const unique = Array.from(new Set(cleaned)).slice(0, maxLines);
    return unique.map(l => `  - ${l}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DEEP EXTRACTION ENGINE: Accordions, Collapsible Containers & Dropdowns
  // ─────────────────────────────────────────────────────────────────────────────
  function extractDropdownsAndAccordions() {
    expandAllAccordions();

    const collapsedSections = [];
    const bodyText = (document.body ? document.body.innerText : "") || "";

    // Helper: Finds a section by keywords in DOM or regex fallback
    function locateSection(patterns, regexFallback) {
      const allEls = document.querySelectorAll("div, button, a, h1, h2, h3, h4, h5, h6, summary, dt, th, label, strong, span, p");
      let foundContainer = null;
      let foundHeader = null;

      for (const el of allEls) {
        const raw = (el.innerText || "").trim();
        if (!raw || raw.length > 80) continue;
        const norm = raw.replace(/[\s\n\r>›»\u25BC\u25B2v\^:|]+/g, " ").trim().toLowerCase();
        if (patterns.some(p => norm === p || norm.startsWith(p))) {
          foundHeader = el;
          foundContainer = el.closest(".accordion-item, .card, .panel, [class*='accordion'], [class*='card'], [class*='section'], [class*='item'], tr, li") || el.parentElement;
          break;
        }
      }

      if (foundHeader && foundContainer) {
        const bodyEl = foundContainer.querySelector(".accordion-body, .accordion-collapse, .collapse, [class*='content'], [class*='body'], [class*='detail'], [class*='desc'], [role='tabpanel'], [role='region'], table, ul, dl");
        if (bodyEl && bodyEl !== foundHeader) {
          const bodyTxt = (bodyEl.innerText || bodyEl.textContent || "").trim();
          if (bodyTxt.length > 5) return bodyTxt;
        }

        const next = foundHeader.nextElementSibling;
        if (next && next.textContent.trim().length > 5) {
          return (next.innerText || next.textContent || "").trim();
        }

        const fullText = (foundContainer.innerText || foundContainer.textContent || "").trim();
        const hText = (foundHeader.innerText || foundHeader.textContent || "").trim();
        if (fullText.length > hText.length + 5) {
          return fullText.replace(hText, "").trim();
        }
      }

      if (regexFallback) {
        const m = bodyText.match(regexFallback);
        if (m && m[1]) return m[1].trim();
      }

      return "";
    }

    // 1. Selection Procedure
    const rawSelection = locateSection(
      ["selection procedure", "selection process", "hiring workflow", "interview rounds", "recruitment process", "evaluation process", "test pattern"],
      /(?:Selection\s+Procedure|Selection\s+Process|Hiring\s+Workflow|Interview\s+Process|Recruitment\s+Process)[\s:\-]+([\s\S]{10,800}?)(?=(?:Eligibility|Salary|Important\s+Dates|SPR|Bond|Application\s+Deadline|$))/i
    );

    // 2. CGPA Cutoff & Eligibility
    const rawEligibility = locateSection(
      ["eligibility criteria", "eligibility", "cgpa cutoff", "academic criteria", "branch eligibility", "branches allowed", "degrees allowed"],
      /(?:Eligibility\s+Criteria|Eligibility|CGPA\s+Cutoff|Branches\s+Allowed|Academic\s+Criteria)[\s:\-]+([\s\S]{10,800}?)(?=(?:Selection|Salary|Important\s+Dates|SPR|Bond|Application\s+Deadline|$))/i
    );

    // 3. Salary Information & Breakdown
    const rawSalary = locateSection(
      ["salary information", "salary details", "ctc breakdown", "compensation", "internship phase", "full time phase", "stipend details", "remuneration"],
      /(?:Salary\s+Information|CTC\s+Breakdown|Internship\s+Phase|Compensation|Stipend\s+Breakdown)[\s:\-]+([\s\S]{10,800}?)(?=(?:Eligibility|Selection|Important\s+Dates|SPR|Bond|Application\s+Deadline|$))/i
    );

    // 4. Important Dates & Deadlines
    let appDeadline = "";
    const deadlineMatch = bodyText.match(/(?:Application\s+Deadline|Apply\s+Before|Registration\s+Closes)[\s:\-]+([^\n\r]+(?:\n[^\n\r]+)?)/i);
    if (deadlineMatch && deadlineMatch[1]) {
      appDeadline = deadlineMatch[1].trim().replace(/\n+/g, " ");
    }

    const rawDates = locateSection(
      ["important dates", "schedule", "timeline", "key dates", "placement schedule"],
      /(?:Important\s+Dates|Timeline|Placement\s+Schedule)[\s:\-]+([\s\S]{10,600}?)(?=(?:Eligibility|Salary|Selection|SPR|Bond|Application\s+Deadline|$))/i
    );

    // 5. Probation & Bond Terms
    const rawBond = locateSection(
      ["probation period", "service agreement", "bond terms", "training period", "retention agreement", "bond & agreement"],
      /(?:Probation(?:\s+Period)?|Service\s+Agreement|Bond(?:\s+Period)?|Training\s+Period)[\s:\-]+([^\n\r]+(?:\n[^\n\r]+)?)/i
    );

    // 6. SPR on Duty
    const rawSpr = locateSection(
      ["spr on duty", "student placement representative", "student coordinator", "placement coordinator", "spr contact"],
      /(?:SPR\s+on\s+Duty|Student\s+Placement\s+Representative|Placement\s+Coordinator)[\s:\-]+([^\n\r]+(?:\n[^\n\r]+)?)/i
    );

    // Format all sections into clean sub-bullet points
    const selectionBullets = formatLinesToSubBullets(rawSelection);
    const eligibilityBullets = formatLinesToSubBullets(rawEligibility);
    const salaryBullets = formatLinesToSubBullets(rawSalary);
    
    const datesBullets = [];
    if (appDeadline) {
      datesBullets.push(`  - Application Deadline: ${appDeadline}`);
    }
    datesBullets.push(...formatLinesToSubBullets(rawDates).filter(b => !appDeadline || !b.includes(appDeadline.slice(0, 15))));

    const bondBullets = formatLinesToSubBullets(rawBond);
    const sprBullets = formatLinesToSubBullets(rawSpr);

    // Also scan any other collapsible containers on the page
    const candidateNodes = Array.from(document.querySelectorAll(
      ".accordion-item, .accordion-body, .collapse, .collapsible, [role='tabpanel'], .tab-pane, " +
      "[aria-expanded], details, .card, .panel, [class*='dropdown'], [class*='accordion']"
    ));
    const seenTexts = new Set();
    const otherSections = [];

    candidateNodes.forEach(node => {
      const txt = (node.textContent || "").replace(/[\t\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
      if (!txt || txt.length < 25 || seenTexts.has(txt)) return;
      seenTexts.add(txt);

      const headerEl = node.querySelector("h1, h2, h3, h4, h5, h6, .accordion-header, .accordion-button, summary, [class*='title'], [class*='header'], button");
      const title = headerEl ? headerEl.innerText.trim() : (node.getAttribute("id") || "Dropdown Section");
      const titleLow = title.toLowerCase();

      if (!/eligib|salary|date|select|spr|bond|criteria|deadline/i.test(titleLow) && txt.length > 30) {
        otherSections.push({
          title: title,
          bullets: formatLinesToSubBullets(txt, 6)
        });
      }
    });

    // Assemble the complete structured bullet list for the Additional Details box
    const bulletSections = [];

    if (selectionBullets.length > 0) {
      bulletSections.push(`• Selection Procedure:\n${selectionBullets.join("\n")}`);
    }
    if (eligibilityBullets.length > 0) {
      bulletSections.push(`• CGPA Cutoff & Eligibility:\n${eligibilityBullets.join("\n")}`);
    }
    if (salaryBullets.length > 0) {
      bulletSections.push(`• Salary & Stipend Breakdown:\n${salaryBullets.join("\n")}`);
    }
    if (datesBullets.length > 0) {
      bulletSections.push(`• Important Dates & Deadlines:\n${datesBullets.join("\n")}`);
    }
    if (bondBullets.length > 0) {
      bulletSections.push(`• Probation & Bond Terms:\n${bondBullets.join("\n")}`);
    }
    if (sprBullets.length > 0) {
      bulletSections.push(`• SPR on Duty:\n${sprBullets.join("\n")}`);
    }
    otherSections.forEach(os => {
      if (os.bullets.length > 0) {
        bulletSections.push(`• ${os.title}:\n${os.bullets.join("\n")}`);
      }
    });

    const formattedBullets = bulletSections.join("\n\n");

    return {
      collapsedSections,
      eligibilitySection: rawEligibility,
      salarySection: rawSalary,
      selectionSection: rawSelection,
      datesSection: rawDates || appDeadline,
      sprSection: rawSpr,
      bondSection: rawBond,
      formattedBullets,
      allCollapsedText: bulletSections.join("\n\n").slice(0, 6000)
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

    console.log("[Recruit Copilot Extractor] Extracted:", { 
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
      additional_details: dropdownData.formattedBullets,
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
      expandAllAccordions();
      setTimeout(() => {
        const data = extractPageData();
        sendResponse(data);
      }, 120);
      return true; // Keep message channel open for async sendResponse
    }
  });

  // Inject when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectFloatingButton);
  } else {
    injectFloatingButton();
  }

  // Ensure button stays present & updated even across SPA view changes
  setInterval(() => {
    const oldBtn = document.getElementById("recruitsage-floating-btn");
    if (oldBtn) {
      oldBtn.id = "recruitcopilot-floating-btn";
      oldBtn.setAttribute("title", "Open Recruit Copilot");
      const span = oldBtn.querySelector("span:last-child");
      if (span) span.textContent = "Recruit Copilot";
    }
  }, 1000);
})();
