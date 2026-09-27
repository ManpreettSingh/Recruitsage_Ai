from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class DriveExtractionRequest(BaseModel):
    raw_page_text: Optional[str] = ""
    page_url: Optional[str] = ""
    provider: Optional[str] = "gemini"
    force_refresh: Optional[bool] = False

class DriveExtractionResponse(BaseModel):
    company_name: Optional[str] = "Unknown Company"
    role: Optional[str] = "Technical Role"
    ctc_text: Optional[str] = "Not Disclosed"
    location: Optional[str] = ""
    job_type: Optional[str] = ""
    probation_or_bond_note: Optional[str] = ""
    deadline: Optional[str] = ""
    eligibility_summary: Optional[str] = ""
    skills_required: List[str] = []
    clean_jd_summary: Optional[str] = ""
    additional_details: Optional[str] = ""
    active_provider: Optional[str] = "gemini"
    is_cached: Optional[bool] = False
    cache_key: Optional[str] = None

class PdfUrlExtractRequest(BaseModel):
    url: str
    auto_parse: Optional[bool] = True

class MermaidEvaluationRequest(BaseModel):
    mermaid_code: str
    error: Optional[str] = ""
    provider: Optional[str] = "gemini"

class MermaidEvaluationResponse(BaseModel):
    valid: bool = True
    corrected_code: str
    original_code: str
    fixed_by: str = "gemini"

class PrepTopicMatrixItem(BaseModel):
    category: str
    subtopics: List[str] = []
    weight_percentage: float = 0.0
    drive_frequency: Optional[int] = 0
    importance: Optional[float] = 4.0

class CodingArchetypeItem(BaseModel):
    pattern_name: str
    frequency_rate: str
    example_problems: List[str] = []
    complexity_target: str
    dry_run_tips: str

class CoreCSDrilldownItem(BaseModel):
    subject: str
    importance_weight: str
    high_yield_topics: List[str] = []
    company_focus_questions: List[str] = []

class RoundTacticItem(BaseModel):
    round_name: str
    platform_or_duration: str
    key_focus_areas: List[str] = []
    common_traps: str
    actionable_prep_strategy: str

class DeepPrepGuide(BaseModel):
    target_company: Optional[str] = ""
    target_role: Optional[str] = ""
    thapar_past_questions: List['PastQuestionItem'] = []
    other_campus_questions: List['PastQuestionItem'] = []
    topic_matrix: List[PrepTopicMatrixItem] = []
    coding_archetypes: List[CodingArchetypeItem] = []
    core_cs_drilldown: List[CoreCSDrilldownItem] = []
    round_tactics: List[RoundTacticItem] = []
    cross_campus_intel: Optional[str] = ""
    priority_topics: List[str] = []
    high_frequency_questions: List[str] = []
    tips_for_oa_and_interviews: List[str] = []

class CompanyAnalysisRequest(BaseModel):
    company_name: str
    role: Optional[str] = "Software Engineer / Technical Role"
    ctc_text: Optional[str] = ""
    location: Optional[str] = ""
    probation_note: Optional[str] = ""
    eligibility_text: Optional[str] = ""
    skills: Optional[List[str]] = []
    jd_text: Optional[str] = ""
    raw_page_text: Optional[str] = ""
    additional_context: Optional[str] = ""
    provider: Optional[str] = "gemini"
    page_url: Optional[str] = ""  # Used as cache key when available

class RedFlagItem(BaseModel):
    category: str
    severity: str = Field(description="'HIGH', 'MEDIUM', or 'LOW'")
    finding: str
    advice: str
    source_title: Optional[str] = ""
    source_url: Optional[str] = ""

class HistoricalVisitItem(BaseModel):
    year: Optional[int] = 2024
    batch: Optional[str] = ""
    role: Optional[str] = ""
    ctc_lpa: Optional[float] = None
    ctc_text: Optional[str] = ""
    base_pay_lpa: Optional[float] = None
    shortlisted_oa: Optional[Any] = None
    final_selects: Optional[Any] = None
    interview_rounds: List[str] = []
    eligibility_cgpa: Optional[str] = ""
    branches_allowed: List[str] = []
    notes: Optional[str] = ""

class TopicWeight(BaseModel):
    category: str
    percentage: float

class CompanyTopicBreakdown(BaseModel):
    total_questions: Optional[int] = 0
    top_topics: Optional[str] = ""
    difficulty: Optional[str] = "Medium"
    weights: List[TopicWeight] = []

class PastQuestionItem(BaseModel):
    year: Optional[int] = None
    round_type: Optional[str] = ""
    category: Optional[str] = ""
    topic: Optional[str] = ""
    exact_topic: Optional[str] = ""
    question_title: str
    question_details: Optional[str] = ""
    difficulty: Optional[str] = "Medium"
    frequency: Optional[str] = "Medium"
    importance: Optional[int] = 3
    tags: Optional[str] = ""
    notes: Optional[str] = ""
    source: Optional[str] = "Placement Master DB"
    source_drive: Optional[str] = ""
    source_url: Optional[str] = ""
    source_type: Optional[str] = "database"

class CampusIntel(BaseModel):
    matched_company_name: str
    confidence_score: float
    visited_previously: bool
    historical_visits: List[HistoricalVisitItem] = []
    past_questions: List[PastQuestionItem] = []
    thapar_past_questions: List[PastQuestionItem] = []
    other_campus_questions: List[PastQuestionItem] = []
    actual_database_questions: List[PastQuestionItem] = []
    web_researched_questions: List[Dict[str, Any]] = []
    topic_breakdown: Optional[CompanyTopicBreakdown] = None
    deep_prep: Optional[Dict[str, Any]] = None
    additional_details: Optional[str] = ""

DeepPrepGuide.model_rebuild()

class CompensationAnalysis(BaseModel):
    claimed_ctc: str
    estimated_in_hand_pm: str
    base_salary: str
    variable_or_stocks: str
    bond_or_penalties: str
    hidden_traps: List[str] = []

class ReviewSourceItem(BaseModel):
    name: str
    url: str
    description: Optional[str] = ""
    badge: Optional[str] = "Reviews"
    icon: Optional[str] = ""

class CultureAndSentiment(BaseModel):
    overall_rating: Optional[str] = "N/A"
    work_life_balance: str
    reddit_sentiment_summary: str
    salary_and_appraisals: Optional[str] = ""
    verified_reviews_count: Optional[int] = 0
    key_pros: List[str] = []
    key_cons: List[str] = []
    review_sources: List[ReviewSourceItem] = []

class AlumniLink(BaseModel):
    title: str
    search_query: str
    url: str
    name: Optional[str] = ""
    headline: Optional[str] = ""
    school_portal_url: Optional[str] = ""
    is_profile: Optional[bool] = False
    batch_info: Optional[str] = ""
    source_type: Optional[str] = "LinkedIn"

class EvaluationMetric(BaseModel):
    name: str
    score: int # 0 to 100
    status: str # "EXCELLENT", "GOOD", "NEEDS_ATTENTION"
    critique: str

class EvaluationReport(BaseModel):
    overall_score: int # 0 to 100
    grade: str # "A+", "A", "B", "C"
    verdict: str
    groundedness_score: int
    completeness_score: int
    compensation_realism_score: int
    specificity_score: int
    metrics: List[EvaluationMetric] = []
    evaluator_notes: List[str] = []

class DossierResponse(BaseModel):
    company_name: str
    role: str
    fit_score: str = Field(description="'High Fit', 'Moderate Fit', or 'Caution / Red Flag'")
    verdict_summary: str
    compensation: CompensationAnalysis
    red_flags: List[RedFlagItem] = []
    campus_intel: CampusIntel
    culture: CultureAndSentiment
    alumni_links: List[AlumniLink] = []
    prep_guide: Dict[str, Any] = Field(default_factory=dict)
    raw_sources_count: int = 0
    evaluation: Optional[EvaluationReport] = None
    active_provider: Optional[str] = "gemini"
    is_cached: Optional[bool] = False
    cache_key: Optional[str] = None

class ChatMessage(BaseModel):
    role: str # "user" or "assistant"
    content: str

class ChatQueryRequest(BaseModel):
    company_name: str
    context: Dict[str, Any] # Complete or partial dossier context
    messages: List[ChatMessage]
    provider: Optional[str] = "gemini"
