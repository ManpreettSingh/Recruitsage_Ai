# ⚡ RecruitSage — Thapar Placement Intelligence Copilot

**RecruitSage** is a 100% free, local-first Agentic AI placement copilot tailored specifically for students at **Thapar Institute of Engineering & Technology (TIET)**.

Operating directly inside the Thapar placement portal ([recruit.thapar.edu](https://recruit.thapar.edu/)) through a Chrome Extension side panel, it automates deep company research, audits an exhaustive **9-point Red-Flag checklist**, cross-references historical campus question banks and past visit records, and provides an interactive placement doubt-solving AI chat.

---

## 🏗️ Architecture & Orchestration (Option A: Lean Task-Graph)

```
                       [ recruit.thapar.edu ]
                                 │
           (Click "✨ RecruitSage Intel" on Company Drive Page)
                                 ▼
                     [ Chrome Side-Panel UI ]
                                 │ HTTP POST /api/analyze
                                 ▼
                   [ FastAPI Python Orchestrator ]
                                 │
       ┌─────────────────────────┼─────────────────────────┐
       ▼                         ▼                         ▼
[ Campus Intel Worker ]   [ DuckDuckGo Miner ]     [ Alumni Dork Worker ]
 - RapidFuzz Matcher      - Reddit (r/devIndia)    - TIET Senior Dorks
 - Historical visits      - Glassdoor & Ambition   - Direct LinkedIn links
 - Campus Question Bank   - 9-Point Red Flag Probe
       └─────────────────────────┬─────────────────────────┘
                                 │ Aggregated Context
                                 ▼
         [ Central Synthesis & Auditor Agent (Ollama: qwen2.5:7b) ]
          - Calculates Base vs In-Hand Take-Home
          - Audits 9-point Red-Flag Checklist
          - Formulates 48-Hour High-Yield Prep Roadmap
                                 │
                                 ▼
             [ Structured Dossier & Streaming Doubt Solver ]
```

---

## 🚩 The 9-Point Red-Flag Audit Checklist

Every company drive is automatically scanned against:
1. **Service Bonds & Monetary Penalties** (1–3 year bonds, document retention, financial penalties).
2. **CTC Inflation vs. Real In-Hand Pay** (Low base salary disguised by deferred stock cliffs and non-guaranteed bonuses).
3. **Delayed Joining Dates & Offer Revocation History** (Uncovering delayed onboarding patterns from Reddit & Blind).
4. **Probation Traps & Aggressive PIP Culture** (Firing after 6 months or strict forced-curve ratings).
5. **Role Bait-and-Switch** (Hired under SDE title, but deployed to L1/L2 support or legacy maintenance).
6. **Toxic Management & Unpaid Overtime / Weekend Work**.
7. **Rotational & Night Shifts** (US/UK support hours imposed on campus freshers).
8. **Mass Layoffs, Hiring Freezes & Financial Instability**.
9. **Stagnant Tech Stacks** (Outdated proprietary tools that harm future career mobility).

---

## 🚀 Quick Setup & Usage Guide

### Step 1: Pull the Local Ollama Model
In your terminal, pull and start `qwen2.5:7b`:
```bash
ollama run qwen2.5:7b
```
*(Runs locally on your M4 Mac with Apple Metal GPU acceleration, consuming ~4.7 GB RAM and zero cloud API costs.)*

---

### Step 2: Start the RecruitSage Backend
In the project root folder:
```bash
./run_backend.sh
```
* The API will start at: `http://localhost:8000`
* Interactive API docs: `http://localhost:8000/docs`

---

### Step 3: Load the Chrome Extension
1. Open Google Chrome or Brave and navigate to `chrome://extensions/`.
2. Toggle on **"Developer mode"** in the top-right corner.
3. Click **"Load unpacked"**.
4. Select the `extension/` folder inside this repository:
   `/Users/arjunsingh/Desktop/Recruitsage job research/extension`
5. The **RecruitSage** icon will appear in your Chrome toolbar!

---

### Step 4: Supply Your Campus Data (Optional / Whenever Ready)
Place your Thapar datasets in the `data/` folder:
* **Placement Statistics**: `data/campus_placements.json` (see `campus_placements_template.json` for structure).
* **Question Bank**: Export your Google Sheet as CSV and save as `data/question_bank.csv`.
*(The system automatically matches variations like "DE Shaw" vs "D. E. Shaw & Co." using RapidFuzz.)*

---

### Step 5: Open Thapar Placement Portal
1. Go to `https://recruit.thapar.edu/` and open any company drive details page.
2. Click the floating **"✨ RecruitSage Intel"** button on the bottom right (or click the extension icon in the toolbar).
3. The side panel slides open, extracts the drive context, and runs the multi-agent research.
4. Explore tabs:
   * 🚩 **Red Flags** (9-point audit)
   * 💰 **Compensation** (CTC vs realistic monthly in-hand take-home)
   * 🎓 **Campus Intel** (Previous visits, shortlist numbers, exact interview questions)
   * ⭐ **Culture** (Glassdoor/AmbitionBox ratings + Reddit r/developersIndia quotes)
   * 👥 **Alumni** (1-click direct links to Thapar seniors on LinkedIn)
   * 🎯 **Prep Guide** (High-yield DSA topics & interview tips)
   * 💬 **Ask AI** (Real-time ChatGPT-style doubt solver with streaming answers)
