import { AnthropicProvider } from "./anthropic-provider";
import type { AIService } from "./types";
import type { CompletionObserver } from "./completion";
import { withAccessToken } from "../minimax-code/auth";
import { MINIMAX_CODE_HEADERS, MINIMAX_CODE_SITES } from "../minimax-code/constants";
import type { MiniMaxCodeConfig, MiniMaxCodeSite } from "../minimax-code/constants";

/**
 * MiniMax Code OAuth 渠道（中国站与国际站）：用网页登录得到的 Access Token 调用 MiniMax Code 的 Anthropic 兼容接口。
 * 每次调用前取该站点的有效 Token（快到期时自动续期），上游返回 401 时刷新后重试一次。
 */
export class MiniMaxCodeProvider implements AIService {
    private model: string;
    private site: MiniMaxCodeSite;
    private completionObserver?: CompletionObserver;

    constructor(config?: MiniMaxCodeConfig, site: MiniMaxCodeSite = 'cn') {
        this.site = site;
        this.model = config?.model?.trim() || MINIMAX_CODE_SITES[site].defaultModel;
    }

    /** 补全观察者传给每次创建的 Anthropic 提供商 */
    observeCompletions(observer: CompletionObserver | undefined): void {
        this.completionObserver = observer;
    }

    private run<T>(call: (provider: AnthropicProvider) => Promise<T>): Promise<T> {
        return withAccessToken(this.site, (authToken) => {
            const provider = new AnthropicProvider({
                authToken,
                baseUrl: MINIMAX_CODE_SITES[this.site].llmBaseUrl,
                model: this.model,
                headers: MINIMAX_CODE_HEADERS,
            });
            provider.observeCompletions(this.completionObserver);
            return call(provider);
        });
    }

    analyzeImage(...args: Parameters<AIService['analyzeImage']>) {
        return this.run((p) => p.analyzeImage(...args));
    }

    recognizeGrade(...args: Parameters<AIService['recognizeGrade']>) {
        return this.run((p) => p.recognizeGrade(...args));
    }

    generateSimilarQuestion(...args: Parameters<AIService['generateSimilarQuestion']>) {
        return this.run((p) => p.generateSimilarQuestion(...args));
    }

    generateFigureSvg(...args: Parameters<AIService['generateFigureSvg']>) {
        return this.run((p) => p.generateFigureSvg(...args));
    }

    reanswerQuestion(...args: Parameters<AIService['reanswerQuestion']>) {
        return this.run((p) => p.reanswerQuestion(...args));
    }

    analyzeForGeogebra(...args: Parameters<AIService['analyzeForGeogebra']>) {
        return this.run((p) => p.analyzeForGeogebra(...args));
    }

    fixLatex(...args: Parameters<AIService['fixLatex']>) {
        return this.run((p) => p.fixLatex(...args));
    }

    generateSvgAnimation(...args: Parameters<AIService['generateSvgAnimation']>) {
        return this.run((p) => p.generateSvgAnimation(...args));
    }

    generateSvgNarration(...args: Parameters<AIService['generateSvgNarration']>) {
        return this.run((p) => p.generateSvgNarration(...args));
    }

    evaluateMastery(...args: Parameters<AIService['evaluateMastery']>) {
        return this.run((p) => p.evaluateMastery(...args));
    }

    gradeAnswer(...args: Parameters<AIService['gradeAnswer']>) {
        return this.run((p) => p.gradeAnswer(...args));
    }

    suggestKnowledgeTags(...args: Parameters<AIService['suggestKnowledgeTags']>) {
        return this.run((p) => p.suggestKnowledgeTags(...args));
    }

    splitQuestions(...args: Parameters<AIService['splitQuestions']>) {
        return this.run((p) => p.splitQuestions(...args));
    }

    fixQuestionText(...args: Parameters<AIService['fixQuestionText']>) {
        return this.run((p) => p.fixQuestionText(...args));
    }
}
