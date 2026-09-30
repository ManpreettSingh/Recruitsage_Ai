export interface DriveExtractionRequest {
  raw_page_text?: string;
  page_url?: string;
  provider?: string;
  force_refresh?: boolean;
}

export interface DriveExtractionResponse {
  company_name: string;
  role: string;
  ctc_text: string;
  location?: string;
  job_type?: string;
  probation_or_bond_note?: string;
  deadline?: string;
  eligibility_summary?: string;
  skills_required: string[];
  clean_jd_summary?: string;
  additional_details?: string;
  active_provider?: string;
  is_cached?: boolean;
  cache_key?: string | null;
}

export interface PdfUrlExtractRequest {
  url: string;
  auto_parse?: boolean;
}

export interface MermaidEvaluationRequest {
  mermaid_code: string;
  error?: string;
  provider?: string;
}

export interface MermaidEvaluationResponse {
  valid: boolean;
  corrected_code: string;
  original_code: string;
  fixed_by: string;
}

export interface PrepTopicMatrixItem {
  category: string;
  subtopics: string[];
  weight_percentage: number;
  drive_frequency?: number;
  importance?: number;
}

export interface CodingArchetypeItem {
  pattern_name: string;
  frequency_rate: string;
  example_problems: string[];
  complexity_target: string;
  dry_run_tips: string;
}

export interface CoreCSDrilldownItem {
  subject: string;
  importance_weight: string;
  high_yield_topics: string[];
  company_focus_questions: string[];
}

export interface RoundTacticItem {
  round_name: string;
  platform_or_duration: string;
  key_focus_areas: string[];
  common_traps: string;
  actionable_prep_strategy: string;
}

export interface PastQuestionItem {
  year?: number | null;
  round_type?: string;
  category?: string;
  topic?: string;
  exact_topic?: string;
  question_title: string;
  question_details?: string;
  difficulty?: string;
  frequency?: string;
  importance?: number;
  tags?: string;
  notes?: string;
  source?: string;
  source_drive?: string;
  source_url?: string;
  source_type?: string;
  source_name?: string;
  is_database?: boolean;
  company?: string;
  company_name?: string;
  role?: string;
}

export interface DeepPrepGuide {
  target_company?: string;
  target_role?: string;
  thapar_past_questions: PastQuestionItem[];
  other_campus_questions: PastQuestionItem[];
  actual_database_questions?: PastQuestionItem[];
  web_researched_questions?: Record<string, any>[];
  topic_matrix: PrepTopicMatrixItem[];
  coding_archetypes: CodingArchetypeItem[];
  core_cs_drilldown: CoreCSDrilldownItem[];
  round_tactics: RoundTacticItem[];
  cross_campus_intel?: string;
  priority_topics: string[];
  high_frequency_questions: string[];
  tips_for_oa_and_interviews: string[];
}

export interface CompanyAnalysisRequest {
  company_name: string;
  role?: string;
  ctc_text?: string;
  location?: string;
  probation_note?: string;
  eligibility_text?: string;
  skills?: string[];
  jd_text?: string;
  raw_page_text?: string;
  additional_context?: string;
  provider?: string;
  page_url?: string;
}

export interface RedFlagItem {
  category: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | string;
  finding: string;
  advice: string;
  source_title?: string;
  source_url?: string;
}

export interface HistoricalVisitItem {
  year?: number;
  batch?: string;
  role?: string;
  ctc_lpa?: number | null;
  ctc_text?: string;
  base_pay_lpa?: number | null;
  shortlisted_oa?: any;
  final_selects?: any;
  interview_rounds: string[];
  eligibility_cgpa?: string;
  branches_allowed: string[];
  notes?: string;
}

export interface TopicWeight {
  category: string;
  percentage: number;
}

export interface CompanyTopicBreakdown {
  total_questions?: number;
  top_topics?: string;
  difficulty?: string;
  weights: TopicWeight[];
}

export interface CampusIntel {
  matched_company_name: string;
  confidence_score: number;
  visited_previously: boolean;
  historical_visits: HistoricalVisitItem[];
  past_questions: PastQuestionItem[];
  thapar_past_questions: PastQuestionItem[];
  other_campus_questions: PastQuestionItem[];
  actual_database_questions: PastQuestionItem[];
  web_researched_questions: Record<string, any>[];
  topic_breakdown?: CompanyTopicBreakdown | null;
  deep_prep?: Record<string, any> | null;
  additional_details?: string;
  known_red_flags?: RedFlagItem[];
}

export interface CompensationAnalysis {
  claimed_ctc: string;
  estimated_in_hand_pm: string;
  base_salary: string;
  variable_or_stocks: string;
  bond_or_penalties: string;
  hidden_traps: string[];
}

export interface ReviewSourceItem {
  name: string;
  url: string;
  description?: string;
  badge?: string;
  icon?: string;
}

export interface CultureAndSentiment {
  overall_rating?: string;
  work_life_balance: string;
  reddit_sentiment_summary: string;
  salary_and_appraisals?: string;
  verified_reviews_count?: number;
  key_pros: string[];
  key_cons: string[];
  review_sources?: ReviewSourceItem[];
}

export interface AlumniLink {
  title: string;
  search_query: string;
  url: string;
  name?: string;
  headline?: string;
  school_portal_url?: string;
  is_profile?: boolean;
  batch_info?: string;
  source_type?: string;
  role?: string;
  company?: string;
  linkedin_url?: string;
}

export interface EvaluationMetric {
  name: string;
  score: number; // 0 to 100
  status: "EXCELLENT" | "GOOD" | "NEEDS_ATTENTION" | string;
  critique: string;
}

export interface EvaluationReport {
  overall_score: number;
  grade: string;
  verdict: string;
  groundedness_score: number;
  completeness_score: number;
  compensation_realism_score: number;
  specificity_score: number;
  metrics: EvaluationMetric[];
  evaluator_notes: string[];
}

export interface DossierResponse {
  company_name: string;
  role: string;
  fit_score: "High Fit" | "Moderate Fit" | "Caution / Red Flag" | string;
  verdict_summary: string;
  compensation: CompensationAnalysis;
  red_flags: RedFlagItem[];
  campus_intel: CampusIntel;
  culture: CultureAndSentiment;
  alumni_links: AlumniLink[];
  prep_guide: Record<string, any>;
  raw_sources_count: number;
  evaluation?: EvaluationReport | null;
  active_provider?: string;
  is_cached?: boolean;
  cache_key?: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant" | string;
  content: string;
}

export interface ChatQueryRequest {
  company_name: string;
  context: Record<string, any>;
  messages: ChatMessage[];
  provider?: string;
}
