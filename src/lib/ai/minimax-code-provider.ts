import { AnthropicProvider } from "./anthropic-provider";
import type { AIService } from "./types";
import { MINIMAX_CODE_LLM_BASE_URL } from "../minimax-code/api";
import { withAccessToken } from "../minimax-code/auth";
import { DEFAULT_MINIMAX_CODE_MODEL } from "../minimax-code/constants";
import type { MiniMaxCodeConfig } from "../minimax-code/constants";

/**
 * MiniMax Code OAuth 渠道：用网页登录得到的 Access Token 调用 MiniMax Code 的 Anthropic 兼容接口。
 * 每次调用前取有效 Token（快到期时自动续期），上游返回 401 时刷新后重试一次。
 */
export class MiniMaxCodeProvider implements AIService {
    private model: string;

    constructor(config?: MiniMaxCodeConfig) {
        this.model = config?.model?.trim() || DEFAULT_MINIMAX_CODE_MODEL;
    }

    private run<T>(call: (provider: AnthropicProvider) => Promise<T>): Promise<T> {
        return withAccessToken((authToken) => call(new AnthropicProvider({
            authToken,
            baseUrl: MINIMAX_CODE_LLM_BASE_URL,
            model: this.model,
        })));
    }

    analyzeImage(...args: Parameters<AIService['analyzeImage']>) {
        return this.run((p) => p.analyzeImage(...args));
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
}
