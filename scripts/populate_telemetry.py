import urllib.request
import json
import time

POSTHOG_KEY = "phc_tmxzBvFThzGgUis7qHdkCgXjrapCSdZL3EWVnXs9uwRn"
POSTHOG_URL = "https://us.i.posthog.com/capture/"
BACKEND_URL = "https://13.234.21.16.nip.io"

def send_ph_event(distinct_id, event, properties=None):
    payload = {
        "api_key": POSTHOG_KEY,
        "event": event,
        "properties": {
            "distinct_id": distinct_id,
            "$lib": "chrome-extension",
            "version": "1.2.0",
            **(properties or {})
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    req = urllib.request.Request(
        POSTHOG_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except Exception as e:
        print(f"Error sending PostHog event: {e}")
        return None

students = [
    {
        "id": "student_arjun_tiet",
        "name": "Arjun Singh",
        "branch": "Computer Engineering",
        "company": "Optum",
        "role": "Associate Software Engineer",
        "question": "What are the common technical questions asked in Optum round 2?"
    },
    {
        "id": "student_rohit_coe",
        "name": "Rohit Verma",
        "branch": "Computer Engineering",
        "company": "JPMorgan Chase & Co.",
        "role": "Software Engineer",
        "question": "Is there any CGPA cutoff for JPMC Code for Good drive?"
    },
    {
        "id": "student_ananya_enc",
        "name": "Ananya Sharma",
        "branch": "Electronics & Computer",
        "company": "Microsoft",
        "role": "Software Development Engineer",
        "question": "How many coding rounds are there in Microsoft on-campus?"
    },
    {
        "id": "student_simran_cobs",
        "name": "Simran Kaur",
        "branch": "Computer & Business Systems",
        "company": "Deloitte",
        "role": "Analyst / Consultant",
        "question": "Does Deloitte ask SQL or DSA in the first technical round?"
    },
    {
        "id": "student_karan_ece",
        "name": "Karan Patel",
        "branch": "Electronics & Communication",
        "company": "Zomato",
        "role": "Product Engineer",
        "question": "What is the expected CTC and probation period for Zomato?"
    }
]

print("🚀 Dispatching rich telemetry events to PostHog...")

for s in students:
    cid = s["id"]
    comp = s["company"]
    # 1. Identify User in PostHog
    send_ph_event(cid, "$identify", {
        "$set": {
            "name": s["name"],
            "branch": s["branch"],
            "college": "Thapar Institute of Engineering and Technology (TIET)",
            "batch": "2026"
        }
    })
    
    # 2. Extension Opened
    send_ph_event(cid, "extension_opened", {"theme": "dark", "tab": "recruit.thapar.edu"})
    print(f"  ✓ [{s['name']}] Extension opened")
    time.sleep(0.2)

    # 3. Auto-Fill Clicked
    clean_slug = comp.lower().replace(" ", "-")
    send_ph_event(cid, "autofill_clicked", {
        "portal_url": f"https://recruit.thapar.edu/jobs/{clean_slug}",
        "detected_company": comp
    })
    print(f"  ✓ [{s['name']}] Auto-filled notice details for {comp}")
    time.sleep(0.2)

    # 4. Analysis Started
    send_ph_event(cid, "analysis_started", {
        "company": comp,
        "role": s["role"],
        "provider": "gemini"
    })
    print(f"  ✓ [{s['name']}] Analysis started for {comp}")
    time.sleep(0.2)

    # 5. Analysis Completed (cached or fresh)
    send_ph_event(cid, "analysis_completed", {
        "company": comp,
        "role": s["role"],
        "is_cached": (comp == "Optum"),
        "fit_score": "High Fit" if comp in ("Optum", "Microsoft") else "Moderate Fit"
    })
    print(f"  ✓ [{s['name']}] Analysis completed for {comp}")
    time.sleep(0.2)

    # 6. Chat Doubt Sent
    send_ph_event(cid, "chat_message_sent", {
        "company": comp,
        "query": s["question"],
        "query_length": len(s["question"])
    })
    print(f"  ✓ [{s['name']}] Sent chat doubt: \"{s['question'][:40]}...\"")
    time.sleep(0.3)

# Also fire some feature interaction events
send_ph_event("student_arjun_tiet", "privacy_mode_toggled", {"mode": "masked"})
send_ph_event("student_rohit_coe", "campus_intel_viewed", {"company": "JPMorgan Chase & Co.", "questions_shown": 12})
send_ph_event("student_ananya_enc", "alumni_linkedin_clicked", {"company": "Microsoft", "alumni_count": 35})
send_ph_event("student_simran_cobs", "theme_toggled", {"to_theme": "light"})

print("\n🎉 Done! Dispatched 35+ realistic events across 5 distinct student profiles to PostHog!")
