/**
 * Azure OpenAI Provider 单元测试
 *
 * 测试 Azure OpenAI 服务初始化和错误处理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAzureCompletionCreate = vi.hoisted(() => vi.fn());

// Mock Azure OpenAI SDK
vi.mock('openai', () => {
    return {
        AzureOpenAI: class MockAzureOpenAI {
            chat = {
                completions: {
                    create: mockAzureCompletionCreate,
                },
            };
        },
    };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        box: vi.fn(),
        divider: vi.fn(),
    })),
}));

// Mock config
vi.mock('@/lib/config', () => ({
    getAppConfig: vi.fn(() => ({
        aiProvider: 'azure',
        azure: {
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
            apiVersion: '2024-02-15-preview',
        },
    })),
}));

// Mock tag service
vi.mock('@/lib/ai/tag-service', () => ({
    getMathTagsFromDB: vi.fn(() => Promise.resolve([])),
    getTagsFromDB: vi.fn(() => Promise.resolve([])),
    prefetchSubjectTags: vi.fn(() => Promise.resolve({})),
}));

// Delayed import to ensure mocks are applied
import { AzureOpenAIProvider } from '@/lib/ai/azure-provider';
import type { ParsedQuestion } from '@/lib/ai/types';

type PrivateAzureProvider = {
    parseResponse(text: string): ParsedQuestion;
    extractTag(text: string, tagName: string): string | null;
    handleError(error: unknown): never;
};

function asPrivateProvider(provider: AzureOpenAIProvider): PrivateAzureProvider {
    return provider as unknown as PrivateAzureProvider;
}

describe('Azure OpenAI Provider 初始化', () => {
    it('举一反三清理题号和分值，拒绝返回选择题', async () => {
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });
        const response = (question: string) => ({ choices: [{ finish_reason: 'stop', message: { content: `<question_text>${question}</question_text><answer_text>4</answer_text><analysis>计算</analysis><subject>数学</subject>` } }] });
        mockAzureCompletionCreate.mockResolvedValue(response('1. （5分）求 2+2 的值。'));
        expect((await provider.generateSimilarQuestion('原题', [])).questionText).toBe('求 2+2 的值。');
        expect(mockAzureCompletionCreate.mock.calls[0][0].messages[0].content).toContain('只能生成填空题或解答题');
        mockAzureCompletionCreate.mockResolvedValue(response('求和。\nA. 2\nB. 4'));
        await expect(provider.generateSimilarQuestion('原题', [])).rejects.toThrow('AI_RESPONSE_ERROR');
    });
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('构造函数验证', () => {
        it('缺少 API Key 时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            })).toThrow('AI_AUTH_ERROR');
            expect(() => new AzureOpenAIProvider({
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            })).toThrow('AZURE_OPENAI_API_KEY is required');
        });

        it('API Key 为空字符串时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                apiKey: '',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            })).toThrow('AI_AUTH_ERROR');
        });

        it('缺少 endpoint 时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                deploymentName: 'gpt-4o',
            })).toThrow('AI_AUTH_ERROR');
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                deploymentName: 'gpt-4o',
            })).toThrow('AZURE_OPENAI_ENDPOINT is required');
        });

        it('endpoint 为空字符串时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: '',
                deploymentName: 'gpt-4o',
            })).toThrow('AI_AUTH_ERROR');
        });

        it('缺少 deploymentName 时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
            })).toThrow('AI_AUTH_ERROR');
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
            })).toThrow('AZURE_OPENAI_DEPLOYMENT is required');
        });

        it('deploymentName 为空字符串时应该抛出 AI_AUTH_ERROR', () => {
            expect(() => new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: '',
            })).toThrow('AI_AUTH_ERROR');
        });

        it('有效配置时应该成功创建实例', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            });

            expect(provider).toBeDefined();
            expect(typeof provider.analyzeImage).toBe('function');
            expect(typeof provider.generateSimilarQuestion).toBe('function');
            expect(typeof provider.reanswerQuestion).toBe('function');
        });

        it('应该使用默认 API 版本', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            });

            expect(provider).toBeDefined();
        });

        it('应该支持自定义 API 版本', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
                apiVersion: '2024-06-01',
            });

            expect(provider).toBeDefined();
        });

        it('应该支持自定义 model 显示名称', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'my-gpt-4o-deployment',
                model: 'gpt-4o',
            });

            expect(provider).toBeDefined();
        });
    });

    describe('方法验证', () => {
        it('analyzeImage 方法应该存在并且是函数', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            });

            expect(provider.analyzeImage).toBeDefined();
            expect(typeof provider.analyzeImage).toBe('function');
        });

        it('generateSimilarQuestion 方法应该存在并且是函数', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            });

            expect(provider.generateSimilarQuestion).toBeDefined();
            expect(typeof provider.generateSimilarQuestion).toBe('function');
        });

        it('reanswerQuestion 方法应该存在并且是函数', () => {
            const provider = new AzureOpenAIProvider({
                apiKey: 'test-key',
                endpoint: 'https://test.openai.azure.com',
                deploymentName: 'gpt-4o',
            });

            expect(provider.reanswerQuestion).toBeDefined();
            expect(typeof provider.reanswerQuestion).toBe('function');
        });
    });
});

describe('Azure OpenAI Provider 响应解析', () => {
    let provider: AzureOpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AzureOpenAIProvider({
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
        });
    });

    describe('parseResponse', () => {
        it('应该正确解析包含所有必需标签的响应', () => {
            const mockResponse = `
<question_text>求函数 f(x) = x^2 的最小值</question_text>
<answer_text>最小值为 0</answer_text>
<analysis>这是一个二次函数,开口向上,顶点在原点,因此最小值为 0</analysis>
<subject>数学</subject>
<knowledge_points>二次函数, 函数最值</knowledge_points>
<requires_image>true</requires_image>
            `.trim();

            // Access private method via type assertion
            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.questionText).toBe('求函数 f(x) = x^2 的最小值');
            expect(result.answerText).toBe('最小值为 0');
            expect(result.analysis).toContain('二次函数');
            expect(result.subject).toBe('数学');
            expect(result.knowledgePoints).toContain('二次函数');
            expect(result.knowledgePoints).toContain('函数最值');
            expect(result.requiresImage).toBe(true);
        });

        it('应该正确处理 requiresImage 为 false', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
<requires_image>false</requires_image>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.requiresImage).toBe(false);
        });

        it('应该解析错因分析相关可选标签', () => {
            const mockResponse = `
<question_text>求 2x + 3 = 7</question_text>
<answer_text>x = 2</answer_text>
<analysis>移项后计算。</analysis>
<wrong_answer_text>x = 4</wrong_answer_text>
<mistake_status>wrong_attempt</mistake_status>
<mistake_analysis>移项后没有正确处理常数项。</mistake_analysis>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.wrongAnswerText).toBe('x = 4');
            expect(result.mistakeStatus).toBe('wrong_attempt');
            expect(result.mistakeAnalysis).toContain('常数项');
        });

        it('缺少错因标签时应该兼容旧响应并标记为未判断', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.wrongAnswerText).toBe('');
            expect(result.mistakeAnalysis).toBe('');
            expect(result.mistakeStatus).toBe('unknown');
        });

        it('应该正确处理无效学科返回默认值"其他"', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
<subject>无效学科</subject>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.subject).toBe('其他');
        });

        it('应该正确分割知识点(逗号分隔)', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
<knowledge_points>知识点1, 知识点2, 知识点3</knowledge_points>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.knowledgePoints).toHaveLength(3);
            expect(result.knowledgePoints).toContain('知识点1');
            expect(result.knowledgePoints).toContain('知识点2');
            expect(result.knowledgePoints).toContain('知识点3');
        });

        it('应该正确分割知识点(中文逗号分隔)', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
<analysis>测试解析</analysis>
<knowledge_points>知识点1,知识点2,知识点3</knowledge_points>
            `.trim();

            const result = asPrivateProvider(provider).parseResponse(mockResponse);

            expect(result.knowledgePoints).toHaveLength(3);
        });

        it('缺少必需标签时应该抛出错误', () => {
            const mockResponse = `
<question_text>测试题目</question_text>
<answer_text>测试答案</answer_text>
            `.trim();

            expect(() => asPrivateProvider(provider).parseResponse(mockResponse)).toThrow('Missing critical XML tags');
        });
    });

    describe('extractTag', () => {
        it('应该正确提取标签内容', () => {
            const text = '<test>content</test>';
            const result = asPrivateProvider(provider).extractTag(text, 'test');

            expect(result).toBe('content');
        });

        it('应该去除首尾空格', () => {
            const text = '<test>  content with spaces  </test>';
            const result = asPrivateProvider(provider).extractTag(text, 'test');

            expect(result).toBe('content with spaces');
        });

        it('标签不存在时应该返回 null', () => {
            const text = '<other>content</other>';
            const result = asPrivateProvider(provider).extractTag(text, 'test');

            expect(result).toBeNull();
        });

        it('应该处理多行内容', () => {
            const text = `
<test>
line 1
line 2
line 3
</test>
            `.trim();
            const result = asPrivateProvider(provider).extractTag(text, 'test');

            expect(result).toContain('line 1');
            expect(result).toContain('line 2');
            expect(result).toContain('line 3');
        });
    });
});

describe('Azure OpenAI Provider 重新解题错因同步', () => {
    let provider: AzureOpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AzureOpenAIProvider({
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
        });
    });

    it('重新解题应该返回新的错因字段，供前端覆盖旧错因', async () => {
        mockAzureCompletionCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: `
<answer_text>x = 2</answer_text>
<analysis>两边同时减 3，再除以 2。</analysis>
<knowledge_points>一元一次方程</knowledge_points>
<wrong_answer_text>x = 4</wrong_answer_text>
<mistake_status>wrong_attempt</mistake_status>
<mistake_analysis>把 7 - 3 算错了。</mistake_analysis>
                    `.trim(),
                },
            }],
        });

        const result = await provider.reanswerQuestion('求解 2x + 3 = 7', 'zh', '数学');

        expect(result.answerText).toBe('x = 2');
        expect(result.knowledgePoints).toEqual(['一元一次方程']);
        expect(result.wrongAnswerText).toBe('x = 4');
        expect(result.mistakeStatus).toBe('wrong_attempt');
        expect(result.mistakeAnalysis).toContain('算错');
    });
});

describe('Azure OpenAI Provider 错误处理', () => {
    let provider: AzureOpenAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AzureOpenAIProvider({
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
        });
    });

    describe('handleError', () => {
        it('应该将网络错误转换为 AI_CONNECTION_FAILED', () => {
            const networkError = new Error('fetch failed');

            expect(() => asPrivateProvider(provider).handleError(networkError)).toThrow('AI_CONNECTION_FAILED');
        });

        it('应该将连接错误转换为 AI_CONNECTION_FAILED', () => {
            const connectionError = new Error('Failed to connect to server');

            expect(() => asPrivateProvider(provider).handleError(connectionError)).toThrow('AI_CONNECTION_FAILED');
        });

        it('应该将认证错误转换为 AI_AUTH_ERROR', () => {
            const authError = new Error('Unauthorized: Invalid API key');

            expect(() => asPrivateProvider(provider).handleError(authError)).toThrow('AI_AUTH_ERROR');
        });

        it('应该将 401 错误转换为 AI_AUTH_ERROR', () => {
            const authError = new Error('Request failed with status 401');

            expect(() => asPrivateProvider(provider).handleError(authError)).toThrow('AI_AUTH_ERROR');
        });

        it('应该将 JSON 解析错误转换为 AI_RESPONSE_ERROR', () => {
            const parseError = new Error('Invalid JSON format');

            expect(() => asPrivateProvider(provider).handleError(parseError)).toThrow('AI_RESPONSE_ERROR');
        });

        it('未知错误应该转换为 AI_UNKNOWN_ERROR', () => {
            const unknownError = new Error('Something went wrong');

            expect(() => asPrivateProvider(provider).handleError(unknownError)).toThrow('AI_UNKNOWN_ERROR');
        });

        it('非 Error 对象应该转换为 AI_UNKNOWN_ERROR', () => {
            const unknownError = 'string error';

            expect(() => asPrivateProvider(provider).handleError(unknownError)).toThrow('AI_UNKNOWN_ERROR');
        });
    });
});

describe('Azure OpenAI Provider 掌握概率评估', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('应该解析掌握概率评估结果', async () => {
        const provider = new AzureOpenAIProvider({
            apiKey: 'test-key',
            endpoint: 'https://test.openai.azure.com',
            deploymentName: 'gpt-4o',
        });
        mockAzureCompletionCreate.mockResolvedValueOnce({
            choices: [{ message: { content: '评估如下：{"probability": 88, "reason": "连续做对"}' } }],
        });

        const result = await provider.evaluateMastery({
            questionText: '题目',
            knowledgePoints: ['函数'],
            history: [],
            ruleProbability: 0.5,
        });

        expect(result).toEqual({ probability: 0.88, reason: '连续做对' });
        expect(mockAzureCompletionCreate.mock.calls[0][0].model).toBe('gpt-4o');
    });
});

describe('Azure OpenAI Provider 知识点重新标注', () => {
    it('返回清单内的知识点', async () => {
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });
        mockAzureCompletionCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"tags": ["相遇问题"]}' } }] });

        const tags = await provider.suggestKnowledgeTags({ questionText: '题目', subject: '数学', allowedTags: ['相遇问题'] });

        expect(tags).toEqual({ tags: ['相遇问题'], difficultyStars: null });
    });
});

describe('Azure OpenAI Provider SVG 动画讲解', () => {
    const animation = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><circle r="5" opacity="0"><set attributeName="opacity" to="1" begin="2s" fill="freeze"/></circle><script>alert(1)</script></svg>';

    it('解析并净化动画', async () => {
        mockAzureCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: `<svg_animation>${animation}</svg_animation>` } }] });
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });

        const svg = await provider.generateSvgAnimation('求面积', '6', '解析');

        expect(mockAzureCompletionCreate.mock.calls.at(-1)?.[0].messages[0].content).toContain('求面积');
        expect(svg).toContain('<set attributeName="opacity"');
        expect(svg).not.toContain('<script');
    });
});

const narrationSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><metadata id="narration">[{"begin":0,"text":"旧的"}]</metadata><text y="480">第一步<set attributeName="opacity" to="1" begin="3s"/></text></svg>';
const narrationReply = '<narration>[{"begin":3,"text":"第二步"},{"begin":0,"text":"第一步"}]</narration>';
const expectedNarration = [{ begin: 0, text: '第一步' }, { begin: 3, text: '第二步' }];

describe('Azure OpenAI Provider 补写语音讲解稿', () => {
    it('提示词包含动画，解析讲解稿', async () => {
        mockAzureCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: narrationReply } }] });
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });

        expect(await provider.generateSvgNarration('求面积', '6', '解析', narrationSvg, 'en')).toEqual(expectedNarration);

        const request = mockAzureCompletionCreate.mock.calls.at(-1)?.[0];
        expect(request.messages[0].content).toContain('begin="3s"');
        expect(request.messages[0].content).toContain('Write the narration in English');
        expect(request.messages[1].content).toContain('in English');
    });
});

describe('Azure OpenAI Provider 修复 LaTeX', () => {
    const latexInput = { answerText: { text: '$\\frac{1}{2$', issues: ['Expected }'] } };

    it('解析修复结果', async () => {
        mockAzureCompletionCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '<answer_text>$\\frac{1}{2}$</answer_text>' } }] });
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });

        expect(await provider.fixLatex(latexInput)).toEqual({ answerText: '$\\frac{1}{2}$' });
    });
});

describe('Azure OpenAI Provider 判题', () => {
    it('使用部署名称并解析判定结果', async () => {
        const provider = new AzureOpenAIProvider({ apiKey: 'test-key', endpoint: 'https://test.openai.azure.com', deploymentName: 'gpt-4o' });
        mockAzureCompletionCreate.mockResolvedValueOnce({ choices: [{ message: { content: '判定：{"correct": true, "reason": "数值相等"}' } }] });

        const result = await provider.gradeAnswer({ questionText: '1/2 等于多少', answerText: '0.5', userAnswer: '1/2' });

        expect(result).toEqual({ correct: true, reason: '数值相等' });
        expect(mockAzureCompletionCreate.mock.calls.at(-1)?.[0].model).toBe('gpt-4o');
    });
});
