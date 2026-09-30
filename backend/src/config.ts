import path from "path";
import dotenv from "dotenv";
import fs from "fs";

// Load backend/.env or root .env
const backendEnvPath = path.resolve(__dirname, "..", ".env");
const rootEnvPath = path.resolve(__dirname, "..", "..", ".env");

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
}
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}

export const BASE_DIR = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(BASE_DIR, "data");

export const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/['"]/g, "").trim();
export const OLLAMA_MODEL = (process.env.OLLAMA_MODEL || "qwen2.5:7b").replace(/['"]/g, "").trim();

// Gemini Cloud API configuration
export const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").replace(/['"]/g, "").trim();
export const GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.8-flash"];
export const DEFAULT_LLM_PROVIDER = (process.env.DEFAULT_LLM_PROVIDER || "gemini").replace(/['"]/g, "").trim();

// Redis / Upstash cache configuration
export const REDIS_URL = (process.env.REDIS_URL || process.env.UPSTASH_REDIS_URL || "").replace(/['"]/g, "").trim();
export const UPSTASH_REDIS_REST_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/['"]/g, "").trim().replace(/\/+$/, "");
export const UPSTASH_REDIS_REST_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").replace(/['"]/g, "").trim();
export const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || "21600", 10);
export const CACHE_ENABLED = ["true", "1", "yes"].includes((process.env.CACHE_ENABLED || "true").toLowerCase());

// College identifiers
export const COLLEGE_NAMES = ["Thapar", "TIET", "Thapar Institute of Engineering and Technology", "Thapar University"];
export const PRIMARY_COLLEGE_KEYWORD = "Thapar";

// Data file paths
export const PLACEMENTS_FILE = path.join(DATA_DIR, "campus_placements.json");
export const PLACEMENTS_TEMPLATE = path.join(DATA_DIR, "campus_placements_template.json");
export const QUESTIONS_FILE = path.join(DATA_DIR, "question_bank.csv");
export const QUESTIONS_TEMPLATE = path.join(DATA_DIR, "question_bank_template.csv");
export const MASTER_DB_FILE = path.join(DATA_DIR, "assets", "Placement_Master_DB.xlsx");
export const MASTER_CACHE_FILE = path.join(DATA_DIR, "placement_master_cache.json");
export const OPTUM_QUESTIONS_FILE = path.join(DATA_DIR, "optum.txt");

// Vector RAG Configuration
export const UPSTASH_VECTOR_REST_URL = (process.env.UPSTASH_VECTOR_REST_URL || "").replace(/\/+$/, "");
export const UPSTASH_VECTOR_REST_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN || "";
export const RAG_ENABLED = ["true", "1", "yes"].includes((process.env.RAG_ENABLED || "true").toLowerCase());

// Administrative Security
export const ADMIN_SECRET_KEY = (process.env.ADMIN_SECRET_KEY || "recruitsage-dev-admin-secret").replace(/['"]/g, "").trim();

// Langfuse LLM Observability & Tracing
export const LANGFUSE_SECRET_KEY = (process.env.LANGFUSE_SECRET_KEY || "").replace(/['"]/g, "").trim();
export const LANGFUSE_PUBLIC_KEY = (process.env.LANGFUSE_PUBLIC_KEY || "").replace(/['"]/g, "").trim();
export const LANGFUSE_BASE_URL = (process.env.LANGFUSE_BASE_URL || "https://cloud.langfuse.com").replace(/['"]/g, "").trim();
export const LANGFUSE_ENABLED = Boolean(LANGFUSE_SECRET_KEY && LANGFUSE_PUBLIC_KEY);

// PostHog Product & API Telemetry
export const POSTHOG_API_KEY = (process.env.POSTHOG_API_KEY || "").replace(/['"]/g, "").trim();
export const POSTHOG_HOST = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/['"]/g, "").trim();
export const POSTHOG_ENABLED = Boolean(POSTHOG_API_KEY);
