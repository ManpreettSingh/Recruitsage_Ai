import { RAG_ENABLED, UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN } from "../config";
import { campusService, OPTUM_HR_TIPS } from "./campus_service";

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/\b[a-zA-Z0-9_\+#\.-]{2,}\b/g) || [];
  const stopwords = new Set([
    "the", "and", "for", "with", "that", "this", "from", "are", "was",
    "were", "will", "would", "can", "could", "have", "has", "had", "what",
    "which", "who", "whom", "how", "why", "when", "where", "been", "being", "about",
  ]);

  const cleaned = matches.filter((t) => !stopwords.has(t));
  const stems: string[] = [];

  for (const t of cleaned) {
    let st = t;
    if (t.includes("resolv") || t.includes("resolution")) {
      st = "resolv";
    } else if (t.includes("conflict")) {
      st = "conflict";
    } else if (t.includes("lead")) {
      st = "leader";
    } else if (t.includes("fail")) {
      st = "fail";
    } else {
      for (const suff of ["tion", "sion", "ing", "ies", "ed", "es", "s"]) {
        if (t.endsWith(suff) && t.length - suff.length >= 3) {
          st = t.slice(0, t.length - suff.length);
          break;
        }
      }
    }
    if (!cleaned.includes(st)) {
      stems.push(st);
    }
  }

  return [...cleaned, ...stems];
}

export class LocalVectorStore {
  public name: string;
  public documents: Record<string, any>[] = [];
  public docTokens: string[][] = [];
  public docFreqs: Map<string, number> = new Map();
  public avgDocLen: number = 0.0;

  constructor(name: string) {
    this.name = name;
  }

  addDocuments(docs: Record<string, any>[]): void {
    for (const doc of docs) {
      const text = doc.text || "";
      const tokens = tokenize(text);
      this.documents.push(doc);
      this.docTokens.push(tokens);

      const seen = new Set(tokens);
      for (const token of seen) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    const totalLen = this.docTokens.reduce((sum, toks) => sum + toks.length, 0);
    this.avgDocLen = totalLen / Math.max(this.docTokens.length, 1);
  }

  search(
    query: string,
    topK: number = 5,
    filterFn?: (doc: Record<string, any>) => boolean
  ): Record<string, any>[] {
    if (!this.documents.length) return [];

    const qTokens = tokenize(query);
    if (!qTokens.length) return this.documents.slice(0, topK);

    const nDocs = this.documents.length;
    const k1 = 1.5;
    const b = 0.75;
    const scoredDocs: [number, Record<string, any>][] = [];

    for (let idx = 0; idx < this.documents.length; idx++) {
      const doc = this.documents[idx];
      const tokens = this.docTokens[idx];

      if (filterFn && !filterFn(doc)) continue;

      const docLen = tokens.length;
      let score = 0.0;
      const tokenCounts = new Map<string, number>();
      for (const t of tokens) {
        tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
      }

      for (const qt of qTokens) {
        if (tokenCounts.has(qt)) {
          const df = this.docFreqs.get(qt) || 1;
          const idf = Math.log((nDocs - df + 0.5) / (df + 0.5) + 1.0);
          const tf = tokenCounts.get(qt)!;
          const num = tf * (k1 + 1.0);
          const denom = tf + k1 * (1.0 - b + b * (docLen / Math.max(this.avgDocLen, 1.0)));
          score += idf * (num / denom);
        }
      }

      // Boost exact substring match
      const queryLower = query.toLowerCase();
      const textLower = (doc.text || "").toLowerCase();
      if (textLower.includes(queryLower)) {
        score += 3.0;
      }

      if (score > 0) {
        scoredDocs.push([score, doc]);
      }
    }

    scoredDocs.sort((a, b) => b[0] - a[0]);
    return scoredDocs.slice(0, topK).map((item) => item[1]);
  }
}

export class RAGService {
  public enabled: boolean = RAG_ENABLED;
  public useUpstashVector: boolean = Boolean(UPSTASH_VECTOR_REST_URL && UPSTASH_VECTOR_REST_TOKEN);
  public mode: string = this.useUpstashVector ? "upstash_vector" : "local_bm25";

  public interviewExperiences = new LocalVectorStore("interview_experiences");
  public behavioralPlaybook = new LocalVectorStore("behavioral_playbook");
  public questionBankSemantic = new LocalVectorStore("question_bank_semantic");

  private initialized: boolean = false;

  initializeKnowledgeBase(): void {
    if (this.initialized) return;

    // 1. Index Behavioral & STAR Scenarios Playbook
    const behavioralDocs: Record<string, any>[] = [];
    for (const [topic, adviceList] of Object.entries(OPTUM_HR_TIPS)) {
      const combinedText = `Behavioral Scenario / Question: ${topic}\nRecommended Strategy:\n${adviceList.join("\n")}`;
      behavioralDocs.push({
        id: `behav_${topic.replace(/\s+/g, "_")}`,
        text: combinedText,
        topic,
        category: "Behavioral & HR",
        advice: adviceList,
      });
    }

    const universalScenarios: Record<string, string[]> = {
      "leadership and taking initiative": [
        "Detail a project where requirements were vague or the team stalled, and you stepped forward to organize sprints.",
        "Highlight listening to all team viewpoints, assigning tasks based on strengths, and driving to an on-time release.",
      ],
      "handling failure or mistakes": [
        "Choose a real technical mistake (e.g., misconfigured database index or missed edge case in an algorithm).",
        "Emphasize immediate accountability: writing reproducible unit tests, fixing root cause, and documenting lessons learned.",
      ],
      "handling tight deadlines and priority conflicts": [
        "Explain applying the Eisenhower matrix or agile backlog grooming to separate critical blockers from nice-to-haves.",
        "Communicate early and transparently with stakeholders or professors to reset timeline expectations.",
      ],
    };

    for (const [topic, adviceList] of Object.entries(universalScenarios)) {
      const combinedText = `Behavioral Scenario / Question: ${topic}\nRecommended Strategy:\n${adviceList.join("\n")}`;
      behavioralDocs.push({
        id: `behav_${topic.replace(/\s+/g, "_")}`,
        text: combinedText,
        topic,
        category: "Behavioral & HR",
        advice: adviceList,
      });
    }

    this.behavioralPlaybook.addDocuments(behavioralDocs);

    // 2. Index Master Question Bank for Semantic Retrieval
    const questionDocs: Record<string, any>[] = [];
    for (const q of campusService.questions_data) {
      const qTitle = q.question_title || "";
      if (!qTitle) continue;
      const text = `${q.company || ""} ${q.topic || ""} ${q.exact_topic || ""}: ${qTitle}. Tags: ${q.tags || ""}. Notes: ${q.notes || ""}`;
      questionDocs.push({
        id: q.exact_topic || `q_${questionDocs.length}`,
        text,
        question_title: qTitle,
        company_name: q.company || "",
        role: q.role || "Software Engineer",
        topic: q.topic || "",
        exact_topic: q.exact_topic || "",
        difficulty: q.difficulty || "Medium",
        importance: q.importance || 3,
        notes: q.notes || "",
      });
    }

    this.questionBankSemantic.addDocuments(questionDocs);
    console.log(
      `[RAGService] Knowledge Base initialized in '${this.mode}' mode (${behavioralDocs.length} behavioral scenarios, ${questionDocs.length} questions)`
    );
    this.initialized = true;
  }

  indexInterviewExperience(company: string, role: string, snippets: Record<string, any>[]): void {
    if (!snippets || !snippets.length) return;
    const docs: Record<string, any>[] = [];
    const normCompany = company.toLowerCase().trim();

    for (let idx = 0; idx < snippets.length; idx++) {
      const s = snippets[idx];
      const title = s.title || "";
      const body = s.snippet || s.text || "";
      if (!body && !title) continue;

      const text = `Company: ${company} (${role})\nSource: ${title}\nReview/Debrief: ${body}`;
      docs.push({
        id: `exp_${normCompany}_${this.interviewExperiences.documents.length + idx}`,
        company: normCompany,
        role,
        title,
        text,
        url: s.url || "",
      });
    }

    this.interviewExperiences.addDocuments(docs);
  }

  searchBehavioral(query: string, topK: number = 3): Record<string, any>[] {
    this.initializeKnowledgeBase();
    return this.behavioralPlaybook.search(query, topK);
  }

  searchQuestions(
    query: string,
    company?: string,
    role?: string,
    topK: number = 6
  ): Record<string, any>[] {
    this.initializeKnowledgeBase();

    let filterFn: ((d: Record<string, any>) => boolean) | undefined;
    if (company) {
      const normComp = company.toLowerCase().trim();
      filterFn = (d) => String(d.company_name || "").toLowerCase().includes(normComp);
    }

    let results = this.questionBankSemantic.search(query, topK, filterFn);
    if (results.length < 3 && filterFn) {
      results = this.questionBankSemantic.search(query, topK);
    }
    return results;
  }

  searchInterviewExperiences(company: string, query: string, topK: number = 4): Record<string, any>[] {
    const normComp = company ? company.toLowerCase().trim() : "";
    const filterFn = normComp ? (d: Record<string, any>) => String(d.company || "").includes(normComp) : undefined;
    return this.interviewExperiences.search(query, topK, filterFn);
  }

  buildGroundedRagContext(companyName: string, userQuery: string, role?: string): string {
    this.initializeKnowledgeBase();
    const sections: string[] = [];

    // 1. Behavioral Playbook
    const behavResults = this.searchBehavioral(userQuery, 2);
    if (behavResults.length > 0) {
      const bTexts = behavResults.map((b) => `• [${b.topic}]: ${(b.advice || []).join(" ")}`);
      sections.push("### Recommended Behavioral Strategy (STAR Framework):\n" + bTexts.join("\n"));
    }

    // 2. Campus Question Bank
    const qResults = this.searchQuestions(userQuery, companyName, role, 4);
    if (qResults.length > 0) {
      const qTexts = qResults.map((q) => `• ${q.question_title} [${q.company_name} | ${q.topic} | ${q.difficulty}]`);
      sections.push("### Relevant Verified Campus Questions:\n" + qTexts.join("\n"));
    }

    // 3. Senior Interview Experiences
    const expResults = this.searchInterviewExperiences(companyName, userQuery, 2);
    if (expResults.length > 0) {
      const eTexts = expResults.map((e) => `• ${e.title}: ${(e.text || "").slice(0, 300)}...`);
      sections.push("### Senior Experiences & Debriefs:\n" + eTexts.join("\n"));
    }

    return sections.join("\n\n");
  }

  getStats(): Record<string, any> {
    this.initializeKnowledgeBase();
    return {
      mode: this.mode,
      enabled: this.enabled,
      collections: {
        interview_experiences: this.interviewExperiences.documents.length,
        behavioral_playbook: this.behavioralPlaybook.documents.length,
        question_bank_semantic: this.questionBankSemantic.documents.length,
      },
      total_indexed_documents:
        this.interviewExperiences.documents.length +
        this.behavioralPlaybook.documents.length +
        this.questionBankSemantic.documents.length,
    };
  }
}

export const ragService = new RAGService();
