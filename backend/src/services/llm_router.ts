import { DEFAULT_LLM_PROVIDER } from "../config";
import { geminiService, GeminiService } from "./gemini_service";
import { ollamaService, OllamaService } from "./ollama_service";

export class LLMRouter {
  public defaultProvider: string;

  constructor() {
    this.defaultProvider = DEFAULT_LLM_PROVIDER || "gemini";
  }

  async getStatus(): Promise<Record<string, any>> {
    const [geminiHealth, ollamaHealth] = await Promise.all([
      geminiService.checkHealth(),
      ollamaService.checkHealth(),
    ]);

    return {
      default_provider: this.defaultProvider,
      gemini: geminiHealth,
      ollama: ollamaHealth,
      active_available: {
        gemini: geminiHealth.status === "online",
        ollama: ollamaHealth.status === "online",
      },
    };
  }

  private resolveProvider(requested?: string): "gemini" | "ollama" {
    const prov = (requested || this.defaultProvider).toLowerCase().trim();
    if (prov.includes("ollama") || prov.includes("local") || prov.includes("qwen")) {
      return "ollama";
    }
    return "gemini";
  }

  private getService(chosen: "gemini" | "ollama", geminiSvc?: GeminiService): GeminiService | OllamaService {
    if (chosen === "ollama") return ollamaService;
    return geminiSvc || geminiService;
  }

  async extractDriveContext(
    rawPageText: string,
    provider?: string,
    geminiSvc?: GeminiService
  ): Promise<[Record<string, any>, string]> {
    const chosen = this.resolveProvider(provider);
    const service = this.getService(chosen, geminiSvc);

    if (chosen === "gemini" && !(service as GeminiService).apiKey) {
      throw new Error("Gemini API key is not set. Please add your key in Settings.");
    }

    try {
      const res = await service.extractDriveContext(rawPageText);
      return [res || {}, chosen];
    } catch (e: any) {
      throw new Error(`${chosen.toUpperCase()} failed to extract drive context: ${e.message}`);
    }
  }

  async synthesizeDossier(
    params: {
      company_name: string;
      role: string;
      ctc_text: string;
      jd_text: string;
      campus_intel: Record<string, any>;
      reddit_snippets: Record<string, any>[];
      review_snippets: Record<string, any>[];
      red_flag_snippets: Record<string, any>[];
      alumni_links: Record<string, any>[];
      interview_snippets?: Record<string, any>[];
      location?: string;
      probation_note?: string;
      eligibility_text?: string;
      skills?: string[];
      additional_context?: string;
      provider?: string;
    },
    geminiSvc?: GeminiService
  ): Promise<[Record<string, any>, string]> {
    const chosen = this.resolveProvider(params.provider);
    const service = this.getService(chosen, geminiSvc);

    if (chosen === "gemini" && !(service as GeminiService).apiKey) {
      throw new Error("Gemini API key is not set. Please add your key in Settings.");
    }

    console.log(`[LLMRouter] Invoking '${chosen}' for dossier synthesis...`);
    try {
      const res = await service.synthesizeDossier(
        params.company_name,
        params.role,
        params.ctc_text,
        params.jd_text,
        params.campus_intel,
        params.reddit_snippets,
        params.review_snippets,
        params.red_flag_snippets,
        params.alumni_links,
        params.interview_snippets || [],
        params.location || "",
        params.probation_note || "",
        params.eligibility_text || "",
        params.skills || [],
        params.additional_context || ""
      );
      return [res || {}, chosen];
    } catch (e: any) {
      throw new Error(`${chosen.toUpperCase()} failed during synthesis: ${e.message}`);
    }
  }

  async evaluateDossier(
    params: {
      dossier_data: Record<string, any>;
      company_name: string;
      role: string;
      jd_text: string;
      campus_intel: Record<string, any>;
      review_snippets: Record<string, any>[];
      red_flag_snippets: Record<string, any>[];
      provider?: string;
    },
    geminiSvc?: GeminiService
  ): Promise<[Record<string, any>, string]> {
    const chosen = this.resolveProvider(params.provider);
    const service = this.getService(chosen, geminiSvc);

    if (chosen === "gemini" && !(service as GeminiService).apiKey) {
      console.log("[LLMRouter] Skipping evaluation — Gemini key not set.");
      return [{}, chosen];
    }

    try {
      const res = await service.evaluateDossier(
        params.dossier_data,
        params.company_name,
        params.role,
        params.jd_text,
        params.campus_intel,
        params.review_snippets,
        params.red_flag_snippets
      );
      return [res || {}, chosen];
    } catch (e: any) {
      console.warn(`[LLMRouter] Evaluation step failed on '${chosen}': ${e.message}. Skipping (non-fatal).`);
      return [{}, chosen];
    }
  }

  async *streamChat(
    companyName: string,
    context: Record<string, any>,
    messages: { role: string; content: string }[],
    provider?: string,
    geminiSvc?: GeminiService
  ): AsyncGenerator<string, void, unknown> {
    const chosen = this.resolveProvider(provider);
    const service = this.getService(chosen, geminiSvc);

    if (chosen === "gemini" && !(service as GeminiService).apiKey) {
      yield "Error: Gemini API key is not set. Please open Settings (gear icon) and add your Gemini API key to continue.";
      return;
    }

    try {
      for await (const chunk of service.streamChat(companyName, context, messages)) {
        yield chunk;
      }
    } catch (e: any) {
      yield `Error: ${chosen.toUpperCase()} is unavailable. ${e.message}`;
    }
  }

  async evaluateAndFixMermaid(
    mermaidCode: string,
    errorContext: string = "",
    provider?: string,
    geminiSvc?: GeminiService
  ): Promise<[string, string]> {
    const chosen = this.resolveProvider(provider);
    const service = this.getService(chosen, geminiSvc);

    if (chosen === "gemini" && !(service as GeminiService).apiKey) {
      return [GeminiService.sanitizeMermaid(mermaidCode), "deterministic_compiler"];
    }

    try {
      const fixed = await service.evaluateAndFixMermaid(mermaidCode, errorContext);
      if (fixed && (fixed.includes("graph ") || fixed.includes("flowchart "))) {
        return [fixed, chosen];
      }
    } catch (e: any) {
      console.warn(`[LLMRouter] evaluateAndFixMermaid failed on '${chosen}': ${e.message}`);
    }

    return [GeminiService.sanitizeMermaid(mermaidCode), "deterministic_compiler"];
  }
}

export const llmRouter = new LLMRouter();
