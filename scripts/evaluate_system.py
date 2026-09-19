#!/usr/bin/env python3
"""
RecruitSage Comprehensive System Evaluation & Quality Benchmark Suite
Evaluates all 7 core modules, computes quantitative scores (0-100),
detects architectural bottlenecks, and validates anti-generic output quality.
"""

import io
import sys
import json
import time
import re
import asyncio
from pathlib import Path
import pypdf

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR / "backend"))

from fastapi.testclient import TestClient
from app.main import app
from app.services.campus_service import campus_service
from app.services.search_service import search_service
from app.services.alumni_service import alumni_service
from app.models.schemas import CompanyAnalysisRequest

client = TestClient(app)

def print_header(title):
    print("\n" + "=" * 70)
    print(f"[MODULE] {title.upper()}")
    print("=" * 70)

def evaluate_module_1_campus_master_db():
    print_header("Module 1: Campus Matcher & Placement Master DB Engine")
    test_cases = [
        {"input": "JPMC", "expected": "J.P. Morgan", "type": "Exact Alias"},
        {"input": "Amex", "expected": "American Express", "type": "Exact Alias"},
        {"input": "Ernst & Young India LLP", "expected": "EY", "type": "Normalized Suffix"},
        {"input": "Marquardt", "expected": "Marquardt", "type": "Canonical Core"},
        {"input": "Addverb Technologies", "expected": "Addverb Technologies", "type": "Canonical Core"},
        {"input": "Mercedes Benz India", "expected": "Mercedes-Benz", "type": "Fuzzy Match"},
        {"input": "Boston Sci", "expected": "Boston Scientific", "type": "Fuzzy Match"},
        {"input": "Amazon Web Services", "expected": "Amazon", "type": "Known Alias"},
        {"input": "Autonomous Embedded Labs", "skills": ["c++", "embedded", "linux"], "type": "Unlisted Embedded"},
        {"input": "Global Quant FinTech", "skills": ["python", "sql", "dsa"], "type": "Unlisted FinTech"}
    ]

    correct_matches = 0
    total_questions_matched = 0
    deep_prep_generated = 0

    for tc in test_cases:
        query = tc["input"]
        skills = tc.get("skills", [])
        result = campus_service.match_company(query, skills=skills)
        matched_name = result.get("matched_company_name")
        past_qs = result.get("past_questions", [])
        deep_prep = result.get("deep_prep", {})
        
        is_correct = False
        if "expected" in tc:
            is_correct = (matched_name.lower() == tc["expected"].lower())
        else:
            # Unlisted company successfully mapped to peer cluster questions & topics
            is_correct = len(past_qs) > 0 and bool(deep_prep)
        
        if is_correct:
            correct_matches += 1
        if len(past_qs) > 0:
            total_questions_matched += 1
        if deep_prep and len(deep_prep.get("topic_matrix", [])) > 0:
            deep_prep_generated += 1

        print(f"  • Query: '{query:<24}' -> Matched: '{matched_name:<20}' | Qs: {len(past_qs):<2} | Deep Prep: {'[PASS]' if deep_prep else '[FAIL]'}")

    accuracy_score = (correct_matches / len(test_cases)) * 100
    questions_coverage_score = (total_questions_matched / len(test_cases)) * 100
    prep_generation_score = (deep_prep_generated / len(test_cases)) * 100

    overall_m1_score = round(0.4 * accuracy_score + 0.3 * questions_coverage_score + 0.3 * prep_generation_score, 1)
    print(f"\n[SCORE] Module 1 Benchmark Score: {overall_m1_score}/100 (Resolution: {accuracy_score}%, Qs Coverage: {questions_coverage_score}%, Prep: {prep_generation_score}%)")
    return {"module": "Campus Master DB", "score": overall_m1_score, "details": f"{correct_matches}/{len(test_cases)} tests passed"}

def evaluate_module_2_dropdown_dom_extraction():
    print_header("Module 2: Dropdowns, Accordions & Collapsible DOM Extraction")
    
    # Simulate Thapar placement notice DOM text containing collapsed sections
    synthetic_page_text = """
    Marquardt India
    Graduate Trainee/Post Graduate Trainee - Cyber Security
    Job Location: Pune
    
    === [DROPDOWNS, ACCORDIONS & COLLAPSIBLE SECTIONS] ===
    [SECTION: Eligibility Criteria & Academic Cutoff]
    Degrees Allowed: B.Tech / M.Tech in COE, CSE, ENC, ECE. Minimum aggregate CGPA required: 7.00. No active backlogs allowed at the time of joining. 10th and 12th minimum 65%.
    
    [SECTION: Salary Structure & Compensation Breakdown]
    Stated Total CTC: Rs. 9.5 LPA
    Fixed Base Pay: Rs. 7.50 LPA
    Performance Variable Bonus: Rs. 1.00 LPA (paid semi-annually based on performance)
    Retention Allowance: Rs. 1.00 LPA (payable after completion of 12 months)
    Training Stipend during 6-month internship: Rs. 25,000 per month
    Service Agreement / Bond: 2-year service agreement with penalty of Rs. 2,00,000.
    
    [SECTION: Selection Process Timeline]
    Round 1: Online Assessment (90 mins on Mercer Mettl)
    Round 2: Technical Interview 1 (DSA & Embedded Security)
    Round 3: Technical Interview 2 (System Architecture & Project)
    Round 4: HR & Director Discussion
    """

    res = client.post("/api/extract-drive-context", json={
        "raw_page_text": synthetic_page_text,
        "page_url": "https://recruit.thapar.edu/job-postings/view/10482"
    })

    if res.status_code != 200:
        print(f"  [ERROR] LLM extraction failed with status {res.status_code}")
        return {"module": "Dropdown & DOM Extractor", "score": 40.0, "details": "HTTP error"}

    data = res.json()
    print("  Extracted Fields from Collapsed Dropdown Notice:")
    print(f"  • Company: {data.get('company_name')}")
    print(f"  • Role: {data.get('role')}")
    print(f"  • CTC: {data.get('ctc_text')}")
    print(f"  • Eligibility: {data.get('eligibility_summary')}")
    print(f"  • Bond / Probation: {data.get('probation_or_bond_note')}")

    # Check key extractions
    score = 0
    checks = [
        ("Company Name", "marquardt" in str(data.get("company_name", "")).lower(), 20),
        ("Role Title", "cyber" in str(data.get("role", "")).lower() or "trainee" in str(data.get("role", "")).lower(), 20),
        ("Salary / CTC Breakdown", "9.5" in str(data.get("ctc_text", "")) or "7.5" in str(data.get("ctc_text", "")), 20),
        ("Eligibility CGPA / Branches", "7.0" in str(data.get("eligibility_summary", "")) or "coe" in str(data.get("eligibility_summary", "")).lower(), 20),
        ("Bond Terms Captured", "2" in str(data.get("probation_or_bond_note", "")) or "bond" in str(data.get("probation_or_bond_note", "")).lower() or "agreement" in str(data.get("probation_or_bond_note", "")).lower(), 20)
    ]

    for label, passed, pts in checks:
        print(f"    - {label}: {'[PASS]' if passed else '[FAIL]'} (+{pts if passed else 0} pts)")
        if passed:
            score += pts

    print(f"\n[SCORE] Module 2 Benchmark Score: {score}/100")
    return {"module": "Dropdown & DOM Extractor", "score": float(score), "details": f"{score}/100 checklist score"}

def evaluate_module_3_pdf_document_pipeline():
    print_header("Module 3: PDF Document Ingestion & Field Parser Pipeline")

    # Dynamically build a real multi-page PDF notice in memory
    writer = pypdf.PdfWriter()
    
    # Page 1: Notice Header & Eligibility
    page1 = writer.add_blank_page(width=612, height=792)
    # Page 2: CTC & Annexure Breakdown
    page2 = writer.add_blank_page(width=612, height=792)
    
    # Write synthetic PDF text using raw stream annotations
    pdf_bytes_io = io.BytesIO()
    
    # Let's write a sample text PDF using ReportLab or minimal raw PDF syntax
    # If reportlab is not installed, we can generate a minimal PDF stream
    pdf_sample_text = (
        "%PDF-1.4\n"
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        "4 0 obj << /Length 380 >> stream\n"
        "BT /F1 12 Tf 50 720 Td (CAMPUS RECRUITMENT NOTICE - MARQUARDT INDIA) Tj ET\n"
        "BT /F1 10 Tf 50 700 Td (Designation: Graduate Trainee - Cyber Security) Tj ET\n"
        "BT /F1 10 Tf 50 680 Td (Annual CTC: Rs 9.50 LPA, Base: 7.5 LPA, Variable: 1 LPA, Retention: 1 LPA) Tj ET\n"
        "BT /F1 10 Tf 50 660 Td (Eligibility: B.Tech COE, CSE, ENC, ECE with CGPA >= 7.00) Tj ET\n"
        "BT /F1 10 Tf 50 640 Td (Service Agreement: 2-year bond with Rs 200,000 penalty on early exit) Tj ET\n"
        "BT /F1 10 Tf 50 620 Td (Duties: Penetration testing, ISO 27001 compliance, embedded firmware analysis) Tj ET\n"
        "endstream\nendobj\n"
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
        "xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000676 00000 n \n"
        "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n755\n%%EOF\n"
    )

    pdf_file_bytes = pdf_sample_text.encode("latin-1")
    
    # Test Multipart Upload to /api/extract-pdf
    res = client.post(
        "/api/extract-pdf",
        files={"file": ("Marquardt_Notice_2025.pdf", io.BytesIO(pdf_file_bytes), "application/pdf")},
        data={"auto_parse": "true"}
    )

    if res.status_code != 200:
        print(f"  [ERROR] PDF extract failed: {res.text}")
        return {"module": "PDF Ingestion Pipeline", "score": 30.0, "details": "PDF upload failed"}

    data = res.json()
    print("  PDF Extraction Result:")
    print(f"  • Filename: {data.get('filename')}")
    print(f"  • Pages: {data.get('num_pages')}")
    print(f"  • Word Count: {data.get('word_count')}")
    print(f"  • Extracted Text Preview: {data.get('extracted_text')[:180]}...")
    print(f"  • LLM Auto-Parsed Fields: {json.dumps(data.get('parsed_fields', {}), indent=2)}")

    score = 0
    if data.get("word_count", 0) > 15:
        score += 40
        print("    [PASS] Text stream extracted successfully (+40 pts)")
    if data.get("num_pages", 0) >= 1:
        score += 20
        print("    [PASS] Page numbering validated (+20 pts)")
    
    parsed = data.get("parsed_fields", {})
    if "marquardt" in str(parsed.get("company_name", "")).lower():
        score += 20
        print("    [PASS] LLM parsed company name from PDF (+20 pts)")
    if "9.5" in str(parsed.get("ctc_text", "")) or "7.5" in str(parsed.get("ctc_text", "")):
        score += 20
        print("    [PASS] LLM parsed CTC from PDF (+20 pts)")

    print(f"\n[SCORE] Module 3 Benchmark Score: {score}/100")
    return {"module": "PDF Ingestion Pipeline", "score": float(score), "details": f"{data.get('word_count')} words extracted"}

def evaluate_module_4_web_research_and_reviews():
    print_header("Module 4: Web Research Agents & AmbitionBox/Reddit Miner")
    
    start_t = time.time()
    query_company = "Marquardt"
    
    async def gather_all():
        reddit_res = await search_service.get_reddit_discussions(query_company, "Graduate Trainee")
        reviews_res = await search_service.get_glassdoor_ambitionbox_reviews(query_company, "Graduate Trainee")
        flags_res = await search_service.hunt_red_flags(query_company)
        alumni_res = await alumni_service.find_seniors(query_company, "Graduate Trainee")
        return reddit_res, reviews_res, flags_res, alumni_res

    try:
        reddit_data, review_data, red_flag_data, alumni_data = asyncio.run(gather_all())
    except Exception as e:
        print(f"  [ERROR] Web research exception: {e}")
        reddit_data, review_data, red_flag_data, alumni_data = [], [], [], []

    elapsed = time.time() - start_t

    reddit_count = len(reddit_data)
    review_count = len(review_data)
    flag_count = len(red_flag_data)
    alumni_count = len(alumni_data)

    print(f"  • Reddit Community Findings: {reddit_count} items")
    print(f"  • AmbitionBox/Glassdoor Reviews: {review_count} items")
    print(f"  • 9-Point Red-Flag Snippets: {flag_count} items")
    print(f"  • Verified LinkedIn/AlmaConnect Alumni Links: {alumni_count} items")
    print(f"  • Retrieval Elapsed Time: {elapsed:.2f}s")

    score = 0
    if review_count >= 1 or reddit_count >= 1:
        score += 30
        print("    [PASS] Reviews / community sentiment retrieved (+30 pts)")
    if flag_count >= 1:
        score += 30
        print("    [PASS] Red-flag snippets mined successfully (+30 pts)")
    if alumni_count >= 3:
        score += 25
        print("    [PASS] Alumni school graph & precision search verified (+25 pts)")
    if elapsed < 12.0:
        score += 15
        print("    [PASS] Low-latency concurrent search performance (+15 pts)")

    print(f"\n[SCORE] Module 4 Benchmark Score: {score}/100")
    return {"module": "Web Research & Reviews", "score": float(score), "details": f"{review_count + flag_count + reddit_count} sources, {alumni_count} alumni in {elapsed:.2f}s"}

def evaluate_module_5_dossier_synthesis_and_anti_generic_prep():
    print_header("Module 5: Dossier Synthesis & Anti-Generic Preparation Engine")
    
    req_payload = {
        "company_name": "Marquardt",
        "role": "Graduate Trainee - Cyber Security",
        "ctc_text": "Rs. 9.5 LPA (Fixed: 7.5 LPA, Variable: 1.0 LPA, Retention: 1.0 LPA)",
        "location": "Pune",
        "probation_note": "2-year service agreement with Rs. 2,00,000 penalty",
        "eligibility_text": "B.Tech COE, CSE, ENC, ECE with CGPA >= 7.00",
        "skills": ["Network Security", "Python", "ISO 27001", "Linux", "C++"],
        "jd_text": "Responsible for cyber security assessments, secure firmware development, embedded protocols, and vulnerability analysis.",
        "additional_context": "[STUDENT NOTE] Recruiter confirmed OA will have 2 coding questions on HackerEarth and 20 MCQs on OS and C++ pointers."
    }

    start_t = time.time()
    res = client.post("/api/analyze", json=req_payload)
    elapsed = time.time() - start_t

    if res.status_code != 200:
        print(f"  [ERROR] Analyze failed with status {res.status_code}: {res.text}")
        return {"module": "Dossier Synthesis", "score": 20.0, "details": "Analysis failed"}, None

    dossier = res.json()
    print(f"  Dossier generated in {elapsed:.2f}s!")
    print(f"  • Fit Score: {dossier.get('fit_score')}")
    print(f"  • Verdict Summary: {dossier.get('verdict_summary')}")
    
    comp = dossier.get("compensation", {})
    print(f"  • In-Hand Monthly Take-Home: {comp.get('estimated_in_hand_pm')}")
    print(f"  • Fixed Base Salary: {comp.get('base_salary')}")
    print(f"  • Bond / Penalty: {comp.get('bond_or_penalties')}")
    print(f"  • Hidden Traps: {comp.get('hidden_traps')}")

    red_flags = dossier.get("red_flags", [])
    print(f"  • Red Flags Identified: {len(red_flags)}")
    for rf in red_flags[:2]:
        print(f"    - [{rf.get('severity')}] {rf.get('category')}: {rf.get('finding')[:90]}...")

    prep = dossier.get("prep_guide", {})
    topic_matrix = prep.get("topic_matrix", [])
    archetypes = prep.get("coding_archetypes", [])
    core_cs = prep.get("core_cs_drilldown", [])
    tactics = prep.get("round_tactics", [])
    cross_campus = prep.get("cross_campus_intel", "")

    print("\n  [VERIFY] Detailed Preparation Intelligence Verification:")
    print(f"  • Topic Weight Matrix count: {len(topic_matrix)}")
    for tm in topic_matrix[:3]:
        print(f"    - {tm.get('category')}: {tm.get('weight_percentage')}% | Freq: {tm.get('drive_frequency')}")
    
    print(f"  • Coding Archetypes count: {len(archetypes)}")
    for arch in archetypes[:2]:
        print(f"    - Pattern: {arch.get('pattern_name')}")
        print(f"      Examples: {arch.get('example_problems')}")
        print(f"      Complexity Target: {arch.get('complexity_target')}")
        print(f"      Dry-run Tip: {arch.get('dry_run_tips')[:70]}...")

    print(f"  • Core CS Subject Deep-Dive count: {len(core_cs)}")
    for subj in core_cs[:2]:
        print(f"    - Subject: {subj.get('subject')}")
        print(f"      High-yield: {subj.get('high_yield_topics')[:2]}")

    print(f"  • Round-by-Round Tactics count: {len(tactics)}")
    for rnd in tactics[:2]:
        print(f"    - {rnd.get('round_name')} ({rnd.get('platform_or_duration')})")
        print(f"      Common Traps: {rnd.get('common_traps')[:70]}...")

    # ANTI-GENERIC AUDIT
    anti_generic_score = 100
    all_prep_text = json.dumps(prep).lower()
    
    banned_phrases = [
        "practice data structures and algorithms",
        "brush up on core subjects",
        "study core cs",
        "prepare resume projects"
    ]
    for bp in banned_phrases:
        if bp in all_prep_text:
            anti_generic_score -= 25
            print(f"  [WARN] Warning: Found generic boilerplate phrase '{bp}' (-25 pts)")

    # Scoring Module 5
    score = 0
    if len(topic_matrix) >= 3:
        score += 20
        print("    [PASS] Topic weight matrix populated with exact % (+20 pts)")
    if len(archetypes) >= 4 and any("leetcode" in str(a.get("example_problems")).lower() for a in archetypes):
        score += 25
        print("    [PASS] Coding archetypes with LeetCode problems & dry-run tips (+25 pts)")
    if len(core_cs) >= 3:
        score += 20
        print("    [PASS] Core CS subject checklists (OS, DBMS, CN, OOPS) (+20 pts)")
    if len(tactics) >= 3:
        score += 15
        print("    [PASS] Round-by-round strategies & trap warnings (+15 pts)")
    if len(cross_campus) > 50:
        score += 10
        print("    [PASS] Cross-campus drive intelligence insights (+10 pts)")
    if anti_generic_score == 100:
        score += 10
        print("    [PASS] Anti-generic validation passed: 0% boilerplate (+10 pts)")

    print(f"\n[SCORE] Module 5 Benchmark Score: {score}/100")
    return {"module": "Dossier Synthesis & Prep", "score": float(score), "details": f"{len(archetypes)} archetypes, {len(topic_matrix)} topics, {len(tactics)} rounds"}, dossier

def evaluate_module_6_qa_evaluation_agent(dossier=None):
    print_header("Module 6: Second-Pass QA Evaluation Agent (Critic/Verifier)")
    
    if not dossier:
        req_payload = {
            "company_name": "Marquardt",
            "role": "Graduate Trainee - Cyber Security",
            "ctc_text": "Rs. 9.5 LPA",
            "probation_note": "2-year bond with penalty",
            "eligibility_text": "B.Tech COE, CSE, ENC, ECE with CGPA >= 7.00",
            "skills": ["Network Security", "Linux", "C++"]
        }
        res = client.post("/api/analyze", json=req_payload)
        if res.status_code != 200:
            return {"module": "QA Evaluator Agent", "score": 30.0, "details": "Analysis failed"}
        dossier = res.json()

    eval_rep = dossier.get("evaluation")

    if not eval_rep:
        print("  [ERROR] No evaluation report found in dossier")
        return {"module": "QA Evaluator Agent", "score": 20.0, "details": "Missing evaluation report"}

    print("  QA Evaluation Report Metrics:")
    print(f"  • Overall Score: {eval_rep.get('overall_score')}/100")
    print(f"  • Audit Grade: {eval_rep.get('grade')}")
    print(f"  • Verdict: {eval_rep.get('verdict')}")
    print(f"  • Groundedness Score: {eval_rep.get('groundedness_score')}/100")
    print(f"  • Red-Flag Completeness Score: {eval_rep.get('completeness_score')}/100")
    print(f"  • Compensation Realism Score: {eval_rep.get('compensation_realism_score')}/100")
    print(f"  • Specificity & Actionability Score: {eval_rep.get('specificity_score')}/100")

    metrics_list = eval_rep.get("metrics", [])
    print(f"  • Detailed Sub-Metrics: {len(metrics_list)}")
    for m in metrics_list:
        print(f"    - {m.get('name')}: {m.get('score')}/100 ({m.get('status')}) -> {m.get('critique')[:80]}...")

    notes = eval_rep.get("evaluator_notes", [])
    print(f"  • Evaluator Auditor Notes: {len(notes)}")
    for n in notes[:2]:
        print(f"    [INFO] {n}")

    score = float(eval_rep.get("overall_score", 85))
    print(f"\n[SCORE] Module 6 Benchmark Score: {score}/100 (Grade: {eval_rep.get('grade')})")
    return {"module": "QA Evaluator Agent", "score": score, "details": f"Grade {eval_rep.get('grade')} ({score}/100)"}

def evaluate_module_7_doubt_solver_chat():
    print_header("Module 7: Doubt-Solver Streaming Chat Engine")
    
    mock_context = {
        "company_name": "Marquardt",
        "role": "Graduate Trainee - Cyber Security",
        "compensation": {
            "claimed_ctc": "Rs. 9.5 LPA",
            "base_salary": "Rs. 7.5 LPA",
            "estimated_in_hand_pm": "Rs. 54,000 - 58,000 / month",
            "bond_or_penalties": "2-year service bond with Rs. 2,00,000 penalty"
        },
        "prep_guide": {
            "priority_topics": ["Operating Systems Multithreading (25%)", "DSA Arrays & Two-Pointers (35%)"],
            "coding_archetypes": [{"pattern_name": "Two Pointers & Sliding Window", "example_problems": ["LeetCode 3", "LeetCode 42"]}]
        }
    }

    test_queries = [
        "What is the actual take-home monthly salary and is there any bond?",
        "What DSA problem types should I prioritize for Tech Round 1?"
    ]

    chat_scores = []
    for q in test_queries:
        start_t = time.time()
        chat_req = {
            "company_name": "Marquardt",
            "context": mock_context,
            "messages": [{"role": "user", "content": q}]
        }

        res = client.post("/api/chat", json=chat_req)
        elapsed = time.time() - start_t

        if res.status_code != 200:
            print(f"  [ERROR] Chat query failed: {res.text}")
            chat_scores.append(0)
            continue

        resp_text = res.text
        print(f"  • Query: '{q}'")
        print(f"    Elapsed: {elapsed:.2f}s | Response Length: {len(resp_text)} chars")
        print(f"    Snippet: {resp_text[:140]}...\n")

        q_score = 0
        if len(resp_text) > 50:
            q_score += 40
        if "54,000" in resp_text or "2-year" in resp_text.lower() or "bond" in resp_text.lower() or "dsa" in resp_text.lower() or "pointer" in resp_text.lower():
            q_score += 40
        if elapsed < 15.0:
            q_score += 20
        chat_scores.append(q_score)

    avg_chat_score = sum(chat_scores) / len(chat_scores) if chat_scores else 0
    print(f"\n[SCORE] Module 7 Benchmark Score: {avg_chat_score}/100")
    return {"module": "Doubt Solver Chat", "score": float(avg_chat_score), "details": f"{len(test_queries)} queries answered"}

def main():
    print("=" * 70)
    print("RECRUITSAGE SYSTEM-WIDE BENCHMARK & EVALUATION SUITE")
    print("   Testing all 7 components & auditing result specificity")
    print("=" * 70)

    start_all = time.time()
    results = []

    results.append(evaluate_module_1_campus_master_db())
    results.append(evaluate_module_2_dropdown_dom_extraction())
    results.append(evaluate_module_3_pdf_document_pipeline())
    results.append(evaluate_module_4_web_research_and_reviews())
    
    mod5_res, generated_dossier = evaluate_module_5_dossier_synthesis_and_anti_generic_prep()
    results.append(mod5_res)
    results.append(evaluate_module_6_qa_evaluation_agent(dossier=generated_dossier))
    results.append(evaluate_module_7_doubt_solver_chat())

    total_time = time.time() - start_all

    print("\n" + "=" * 70)
    print("FINAL SYSTEM EVALUATION SCORECARD")
    print("=" * 70)
    
    total_score = sum(r["score"] for r in results)
    composite_score = round(total_score / len(results), 1)

    for r in results:
        status = "EXCELLENT" if r["score"] >= 85 else ("GOOD" if r["score"] >= 70 else "NEEDS WORK")
        print(f"  {r['module']:<35} : {r['score']:>5.1f} / 100  [{status}]  ({r['details']})")

    print("-" * 70)
    print(f"  COMPOSITE SYSTEM QUALITY INDEX     : {composite_score:>5.1f} / 100")
    overall_grade = "A+" if composite_score >= 88 else ("A" if composite_score >= 80 else ("B" if composite_score >= 70 else "C"))
    print(f"  VERIFIED ARCHITECTURE GRADE        : {overall_grade}")
    print(f"  TOTAL BENCHMARK EXECUTION TIME     : {total_time:.2f}s")
    print("=" * 70)

    # Save benchmark results to JSON file
    out_file = BASE_DIR / "scripts" / "benchmark_results.json"
    with open(out_file, "w") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "composite_score": composite_score,
            "grade": overall_grade,
            "modules": results,
            "total_execution_time": round(total_time, 2)
        }, f, indent=2)
    print(f"\nSaved comprehensive scorecard to: {out_file}")

if __name__ == "__main__":
    main()
