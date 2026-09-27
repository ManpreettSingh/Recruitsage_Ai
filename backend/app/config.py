from pathlib import Path
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

# Automatically load backend/.env or root .env
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(BASE_DIR / ".env")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").strip('"\'')
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b").strip('"\'')

# Gemini Cloud API configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip('"\'')
GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"]
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "gemini").strip('"\'')

# Redis / Upstash cache configuration
# Supports either:
# 1. Upstash REST API: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (recommended, zero-dep)
# 2. Redis Connection URL: REDIS_URL or UPSTASH_REDIS_URL (rediss://... or redis://...)
# If neither is set, an in-memory TTL cache is automatically used!
REDIS_URL = os.getenv("REDIS_URL", os.getenv("UPSTASH_REDIS_URL", "")).strip('"\'')
UPSTASH_REDIS_REST_URL = os.getenv("UPSTASH_REDIS_REST_URL", "").strip('"\'').rstrip("/")
UPSTASH_REDIS_REST_TOKEN = os.getenv("UPSTASH_REDIS_REST_TOKEN", "").strip('"\'')
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "21600"))  # 6 hours default
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").lower() in ("true", "1", "yes")

# College identifiers for alumni LinkedIn dorks & entity matching
COLLEGE_NAMES = ["Thapar", "TIET", "Thapar Institute of Engineering and Technology", "Thapar University"]
PRIMARY_COLLEGE_KEYWORD = "Thapar"

# Data file paths with fallback to templates
PLACEMENTS_FILE = DATA_DIR / "campus_placements.json"
PLACEMENTS_TEMPLATE = DATA_DIR / "campus_placements_template.json"

QUESTIONS_FILE = DATA_DIR / "question_bank.csv"
QUESTIONS_TEMPLATE = DATA_DIR / "question_bank_template.csv"
MASTER_DB_FILE = DATA_DIR / "assets" / "Placement_Master_DB.xlsx"
MASTER_CACHE_FILE = DATA_DIR / "placement_master_cache.json"
OPTUM_QUESTIONS_FILE = DATA_DIR / "optum.txt"

# Vector RAG Configuration (Upstash Vector or Local Semantic Engine)
UPSTASH_VECTOR_REST_URL = os.getenv("UPSTASH_VECTOR_REST_URL", "").rstrip("/")
UPSTASH_VECTOR_REST_TOKEN = os.getenv("UPSTASH_VECTOR_REST_TOKEN", "")
RAG_ENABLED = os.getenv("RAG_ENABLED", "true").lower() in ("true", "1", "yes")

# Administrative Security
ADMIN_SECRET_KEY = os.getenv("ADMIN_SECRET_KEY", "recruitsage-dev-admin-secret").strip('"\'')

# Langfuse LLM Observability & Tracing
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "").strip('"\'')
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "").strip('"\'')
LANGFUSE_BASE_URL = os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com").strip('"\'')
LANGFUSE_ENABLED = bool(LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY)

# PostHog Product & API Telemetry
POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", "").strip('"\'')
POSTHOG_HOST = os.getenv("POSTHOG_HOST", "https://us.i.posthog.com").strip('"\'')
POSTHOG_ENABLED = bool(POSTHOG_API_KEY)

