import sys
import json
import urllib.request
import urllib.error

POSTHOG_HOST = "https://us.i.posthog.com"

def create_dashboard_via_api(personal_api_key: str):
    headers = {
        "Authorization": f"Bearer {personal_api_key}",
        "Content-Type": "application/json"
    }

    # 1. Fetch current project ID
    print("🔍 Fetching PostHog projects...")
    req = urllib.request.Request(f"{POSTHOG_HOST}/api/projects/", headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
            results = data.get("results", [])
            if not results:
                print("❌ No projects found in this PostHog account.")
                return False
            project = results[0]
            project_id = project["id"]
            print(f"✓ Found project: '{project.get('name')}' (ID: {project_id})")
    except urllib.error.HTTPError as e:
        print(f"❌ Failed to authenticate with PostHog API: HTTP {e.code} - {e.read().decode('utf-8')}")
        return False

    # 2. Create the Dashboard
    print("\n📊 Creating 'Recruit Copilot - Placement Intelligence' Dashboard...")
    dash_payload = {
        "name": "Recruit Copilot - Placement Intelligence",
        "description": "Real-time metrics for student engagement, company audits, and doubt solving.",
        "pinned": True,
        "filters": {"date_from": "-14d"}
    }
    req_dash = urllib.request.Request(
        f"{POSTHOG_HOST}/api/projects/{project_id}/dashboards/",
        data=json.dumps(dash_payload).encode("utf-8"),
        headers=headers
    )
    try:
        with urllib.request.urlopen(req_dash) as resp:
            dash_data = json.loads(resp.read())
            dash_id = dash_data["id"]
            print(f"✓ Dashboard created successfully! (Dashboard ID: {dash_id})")
    except urllib.error.HTTPError as e:
        print(f"❌ Failed to create dashboard: HTTP {e.code} - {e.read().decode('utf-8')}")
        return False

    # 3. Create Key Insights
    insights = [
        {
            "name": "Daily Active Students (Unique)",
            "query": {
                "kind": "InsightVizNode",
                "source": {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "extension_opened", "math": "dau", "name": "Active Students"}
                    ]
                }
            }
        },
        {
            "name": "Most Researched Companies",
            "query": {
                "kind": "InsightVizNode",
                "source": {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "analysis_started", "math": "total", "name": "Audits"}
                    ],
                    "breakdownFilter": {"breakdown": "company", "breakdown_type": "event"}
                }
            }
        },
        {
            "name": "Student Journey Funnel",
            "query": {
                "kind": "InsightVizNode",
                "source": {
                    "kind": "FunnelsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "extension_opened", "name": "1. Opened Extension"},
                        {"kind": "EventsNode", "event": "autofill_clicked", "name": "2. Clicked Auto-Fill"},
                        {"kind": "EventsNode", "event": "analysis_completed", "name": "3. Audit Completed"},
                        {"kind": "EventsNode", "event": "chat_message_sent", "name": "4. Asked AI Doubt"}
                    ]
                }
            }
        },
        {
            "name": "Cache Efficiency (Hit vs Fresh AI Run)",
            "query": {
                "kind": "InsightVizNode",
                "source": {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "company_analysis_cache_hit", "name": "Cache Hits (Instant)"},
                        {"kind": "EventsNode", "event": "company_analysis_success", "name": "Fresh AI Syntheses"}
                    ]
                }
            }
        },
        {
            "name": "Total Doubt Solver Questions Asked",
            "query": {
                "kind": "InsightVizNode",
                "source": {
                    "kind": "TrendsQuery",
                    "series": [
                        {"kind": "EventsNode", "event": "chat_message_sent", "math": "total", "name": "Questions Asked"}
                    ]
                }
            }
        }
    ]

    print(f"\n📈 Generating {len(insights)} insight tiles for dashboard...")
    for item in insights:
        item["dashboards"] = [dash_id]
        req_ins = urllib.request.Request(
            f"{POSTHOG_HOST}/api/projects/{project_id}/insights/",
            data=json.dumps(item).encode("utf-8"),
            headers=headers
        )
        try:
            with urllib.request.urlopen(req_ins) as resp:
                ins_data = json.loads(resp.read())
                print(f"  ✓ Added insight: '{item['name']}' (ID: {ins_data.get('id')})")
        except urllib.error.HTTPError as e:
            # Fallback for simpler insight format if v2 query schema is rejected
            try:
                fallback_payload = {
                    "name": item["name"],
                    "dashboards": [dash_id],
                    "filters": {"events": [{"id": item["query"]["source"]["series"][0]["event"]}]}
                }
                req_fallback = urllib.request.Request(
                    f"{POSTHOG_HOST}/api/projects/{project_id}/insights/",
                    data=json.dumps(fallback_payload).encode("utf-8"),
                    headers=headers
                )
                with urllib.request.urlopen(req_fallback) as f_resp:
                    print(f"  ✓ Added insight (fallback): '{item['name']}'")
            except Exception:
                print(f"  ⚠️ Could not auto-create tile '{item['name']}' (HTTP {e.code})")

    dashboard_url = f"{POSTHOG_HOST}/project/{project_id}/dashboard/{dash_id}"
    print(f"\n🎉 ALL SET! Your custom dashboard is live at:\n👉 {dashboard_url}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/create_posthog_dashboard.py <POSTHOG_PERSONAL_API_KEY>")
        print("Note: Personal API Key starts with 'phx_...'")
        sys.exit(1)

    key = sys.argv[1].strip()
    create_dashboard_via_api(key)
