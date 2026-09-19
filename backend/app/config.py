from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

# Gemini Cloud API configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "REMOVED_SECRET")
GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"]
DEFAULT_LLM_PROVIDER = os.getenv("DEFAULT_LLM_PROVIDER", "gemini")

# College identifiers for alumni LinkedIn dorks & entity matching
COLLEGE_NAMES = ["Thapar", "TIET", "Thapar Institute of Engineering and Technology", "Thapar University"]
PRIMARY_COLLEGE_KEYWORD = "Thapar"

# Data file paths with fallback to templates
PLACEMENTS_FILE = DATA_DIR / "campus_placements.json"
PLACEMENTS_TEMPLATE = DATA_DIR / "campus_placements_template.json"

QUESTIONS_FILE = DATA_DIR / "question_bank.csv"
QUESTIONS_TEMPLATE = DATA_DIR / "question_bank_template.csv"
MASTER_DB_FILE = DATA_DIR / "assets" / "Placement_Master_DB.xlsx"
OPTUM_QUESTIONS_FILE = DATA_DIR / "optum.txt"

