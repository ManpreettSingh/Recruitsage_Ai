from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")

# College identifiers for alumni LinkedIn dorks & entity matching
COLLEGE_NAMES = ["Thapar", "TIET", "Thapar Institute of Engineering and Technology", "Thapar University"]
PRIMARY_COLLEGE_KEYWORD = "Thapar"

# Data file paths with fallback to templates
PLACEMENTS_FILE = DATA_DIR / "campus_placements.json"
PLACEMENTS_TEMPLATE = DATA_DIR / "campus_placements_template.json"

QUESTIONS_FILE = DATA_DIR / "question_bank.csv"
QUESTIONS_TEMPLATE = DATA_DIR / "question_bank_template.csv"
MASTER_DB_FILE = DATA_DIR / "assets" / "Placement_Master_DB.xlsx"
