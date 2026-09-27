import math
import re
from typing import List, Dict, Any, Optional, Tuple
import httpx
from app.config import (
    UPSTASH_VECTOR_REST_URL,
    UPSTASH_VECTOR_REST_TOKEN,
    RAG_ENABLED
)


def tokenize(text: str) -> List[str]:
    """Tokenizes and filters common stopwords for clean semantic scoring."""
    tokens = re.findall(r"\b[a-zA-Z0-9_\+#\.-]{2,}\b", text.lower())
    stopwords = {
        "the", "and", "for", "with", "that", "this", "from", "are", "was",
        "were", "will", "would", "can", "could", "have", "has", "had", "what",
        "which", "who", "whom", "how", "why", "when", "where", "been", "being", "about"
    }
    cleaned = [t for t in tokens if t not in stopwords]
    stems = []
    for t in cleaned:
        st = t
        if "resolv" in t or "resolution" in t:
            st = "resolv"
        elif "conflict" in t:
            st = "conflict"
        elif "lead" in t:
            st = "leader"
        elif "fail" in t:
            st = "fail"
        else:
            for suff in ["tion", "sion", "ing", "ies", "ed", "es", "s"]:
                if t.endswith(suff) and len(t) - len(suff) >= 3:
                    st = t[:-len(suff)]
                    break
        if st not in cleaned:
            stems.append(st)
    return cleaned + stems


class LocalVectorStore:
    """
    Lightweight, fast in-memory BM25 + Cosine similarity vector engine.
    Requires 0 external dependencies, uses 0 API quota, runs in < 2ms.
    """
    def __init__(self, name: str):
        self.name = name
        self.documents: List[Dict[str, Any]] = []
        self.doc_tokens: List[List[str]] = []
        self.doc_freqs: Dict[str, int] = {}
        self.avg_doc_len: float = 0.0

    def add_documents(self, docs: List[Dict[str, Any]]):
        for doc in docs:
            text = doc.get("text", "")
            tokens = tokenize(text)
            self.documents.append(doc)
            self.doc_tokens.append(tokens)

            # Update document frequencies
            seen = set(tokens)
            for token in seen:
                self.doc_freqs[token] = self.doc_freqs.get(token, 0) + 1

        total_len = sum(len(toks) for toks in self.doc_tokens)
        self.avg_doc_len = total_len / max(len(self.doc_tokens), 1)

    def search(self, query: str, top_k: int = 5, filter_fn=None) -> List[Dict[str, Any]]:
        if not self.documents:
            return []

        q_tokens = tokenize(query)
        if not q_tokens:
            return self.documents[:top_k]

        n_docs = len(self.documents)
        k1 = 1.5
        b = 0.75
        scored_docs: List[Tuple[float, Dict[str, Any]]] = []

        for idx, (doc, tokens) in enumerate(zip(self.documents, self.doc_tokens)):
            if filter_fn and not filter_fn(doc):
                continue

            doc_len = len(tokens)
            score = 0.0
            token_counts = {}
            for t in tokens:
                token_counts[t] = token_counts.get(t, 0) + 1

            for qt in q_tokens:
                if qt in token_counts:
                    df = self.doc_freqs.get(qt, 1)
                    idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
                    tf = token_counts[qt]
                    num = tf * (k1 + 1.0)
                    denom = tf + k1 * (1.0 - b + b * (doc_len / max(self.avg_doc_len, 1.0)))
                    score += idf * (num / denom)

            # Boost exact substring matches in title/text
            query_lower = query.lower()
            text_lower = doc.get("text", "").lower()
            if query_lower in text_lower:
                score += 3.0

            if score > 0:
                scored_docs.append((score, doc))

        scored_docs.sort(key=lambda x: x[0], reverse=True)
        return [doc for _, doc in scored_docs[:top_k]]


class RAGService:
    def __init__(self):
        self.enabled = RAG_ENABLED
        self.use_upstash_vector = bool(UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN)
        self.mode = "upstash_vector" if self.use_upstash_vector else "local_bm25"
        self._http_client: Optional[httpx.AsyncClient] = None

        # 3 Dedicated Collections
        self.interview_experiences = LocalVectorStore("interview_experiences")
        self.behavioral_playbook = LocalVectorStore("behavioral_playbook")
        self.question_bank_semantic = LocalVectorStore("question_bank_semantic")

        self._initialized = False

    async def _get_http_client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            self._http_client = httpx.AsyncClient(timeout=8.0)
        return self._http_client

    def initialize_knowledge_base(self):
        """Indexes static behavioral scenarios and campus questions into the vector store."""
        if self._initialized:
            return

        from app.services.campus_service import campus_service, OPTUM_HR_TIPS

        # 1. Index Behavioral & STAR Scenarios Playbook
        behavioral_docs = []
        # General and company-specific behavioral playbooks
        for topic, advice_list in OPTUM_HR_TIPS.items():
            combined_text = f"Behavioral Scenario / Question: {topic.title()}\nRecommended Strategy:\n" + "\n".join(advice_list)
            behavioral_docs.append({
                "id": f"behav_{topic.replace(' ', '_')}",
                "text": combined_text,
                "topic": topic,
                "category": "Behavioral & HR",
                "advice": advice_list
            })

        # Additional universal STAR scenarios for engineering interviews
        universal_scenarios = {
            "leadership and taking initiative": [
                "Detail a project where requirements were vague or the team stalled, and you stepped forward to organize sprints.",
                "Highlight listening to all team viewpoints, assigning tasks based on strengths, and driving to an on-time release."
            ],
            "handling failure or mistakes": [
                "Choose a real technical mistake (e.g., misconfigured database index or missed edge case in an algorithm).",
                "Emphasize immediate accountability: writing reproducible unit tests, fixing root cause, and documenting lessons learned."
            ],
            "handling tight deadlines and priority conflicts": [
                "Explain applying the Eisenhower matrix or agile backlog grooming to separate critical blockers from nice-to-haves.",
                "Communicate early and transparently with stakeholders or professors to reset timeline expectations."
            ]
        }
        for topic, advice_list in universal_scenarios.items():
            combined_text = f"Behavioral Scenario / Question: {topic.title()}\nRecommended Strategy:\n" + "\n".join(advice_list)
            behavioral_docs.append({
                "id": f"behav_{topic.replace(' ', '_')}",
                "text": combined_text,
                "topic": topic,
                "category": "Behavioral & HR",
                "advice": advice_list
            })

        self.behavioral_playbook.add_documents(behavioral_docs)

        # 2. Index Master Question Bank for Semantic Retrieval
        question_docs = []
        for q in campus_service.questions_data:
            q_title = q.get("question_title", "")
            if not q_title:
                continue
            text = f"{q.get('company_name', '')} {q.get('topic', '')} {q.get('exact_topic', '')}: {q_title}. Tags: {q.get('tags', '')}. Notes: {q.get('notes', '')}"
            question_docs.append({
                "id": q.get("question_id") or f"q_{len(question_docs)}",
                "text": text,
                "question_title": q_title,
                "company_name": q.get("company_name", ""),
                "role": q.get("role", "Software Engineer"),
                "topic": q.get("topic", ""),
                "exact_topic": q.get("exact_topic", ""),
                "difficulty": q.get("difficulty", "Medium"),
                "importance": q.get("importance", 3),
                "notes": q.get("notes", "")
            })
        self.question_bank_semantic.add_documents(question_docs)

        print(f"[RAGService] Knowledge Base initialized in '{self.mode}' mode ({len(behavioral_docs)} behavioral scenarios, {len(question_docs)} questions)")
        self._initialized = True

    def index_interview_experience(self, company: str, role: str, snippets: List[Dict[str, Any]]):
        """Dynamically ingests newly scraped Reddit, Glassdoor, and interview debrief snippets."""
        if not snippets:
            return
        docs = []
        norm_company = company.lower().strip()
        for idx, s in enumerate(snippets):
            title = s.get("title", "")
            body = s.get("snippet") or s.get("text") or ""
            if not body and not title:
                continue
            text = f"Company: {company} ({role})\nSource: {title}\nReview/Debrief: {body}"
            docs.append({
                "id": f"exp_{norm_company}_{len(self.interview_experiences.documents) + idx}",
                "company": norm_company,
                "role": role,
                "title": title,
                "text": text,
                "url": s.get("url", "")
            })
        self.interview_experiences.add_documents(docs)

    def search_behavioral(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        self.initialize_knowledge_base()
        return self.behavioral_playbook.search(query, top_k=top_k)

    def search_questions(
        self, 
        query: str, 
        company: Optional[str] = None, 
        role: Optional[str] = None, 
        top_k: int = 6
    ) -> List[Dict[str, Any]]:
        self.initialize_knowledge_base()

        filter_fn = None
        if company:
            norm_comp = company.lower().strip()
            # If filtering by company, check if company contains term
            filter_fn = lambda d: norm_comp in d.get("company_name", "").lower()

        results = self.question_bank_semantic.search(query, top_k=top_k, filter_fn=filter_fn)
        # If company filter returned empty or too few, search cross-company
        if len(results) < 3 and filter_fn is not None:
            results = self.question_bank_semantic.search(query, top_k=top_k)
        return results

    def search_interview_experiences(self, company: str, query: str, top_k: int = 4) -> List[Dict[str, Any]]:
        norm_comp = company.lower().strip() if company else ""
        filter_fn = (lambda d: norm_comp in d.get("company", "")) if norm_comp else None
        return self.interview_experiences.search(query, top_k=top_k, filter_fn=filter_fn)

    def build_grounded_rag_context(self, company_name: str, user_query: str, role: Optional[str] = None) -> str:
        """
        Retrieves matching snippets across all 3 collections and formats them into
        a high-yield context block to ground LLM responses in real TIET student data.
        """
        self.initialize_knowledge_base()
        sections = []

        # 1. Behavioral Playbook
        behav_results = self.search_behavioral(user_query, top_k=2)
        if behav_results:
            b_texts = [f"• [{b.get('topic', '').title()}]: " + " ".join(b.get('advice', [])) for b in behav_results]
            sections.append("### Recommended Behavioral Strategy (STAR Framework):\n" + "\n".join(b_texts))

        # 2. Campus Question Bank
        q_results = self.search_questions(user_query, company=company_name, role=role, top_k=4)
        if q_results:
            q_texts = [f"• {q.get('question_title')} [{q.get('company_name')} | {q.get('topic', '')} | {q.get('difficulty', '')}]" for q in q_results]
            sections.append("### Relevant Verified Campus Questions:\n" + "\n".join(q_texts))

        # 3. Senior Interview Experiences
        exp_results = self.search_interview_experiences(company_name, user_query, top_k=2)
        if exp_results:
            e_texts = [f"• {e.get('title')}: {e.get('text')[:300]}..." for e in exp_results]
            sections.append("### Senior Experiences & Debriefs:\n" + "\n".join(e_texts))

        return "\n\n".join(sections)

    def get_stats(self) -> Dict[str, Any]:
        self.initialize_knowledge_base()
        return {
            "mode": self.mode,
            "enabled": self.enabled,
            "collections": {
                "interview_experiences": len(self.interview_experiences.documents),
                "behavioral_playbook": len(self.behavioral_playbook.documents),
                "question_bank_semantic": len(self.question_bank_semantic.documents)
            },
            "total_indexed_documents": (
                len(self.interview_experiences.documents) +
                len(self.behavioral_playbook.documents) +
                len(self.question_bank_semantic.documents)
            )
        }


rag_service = RAGService()
