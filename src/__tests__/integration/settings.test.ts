/**
 * /api/settings API 集成测试
 * 测试应用配置获取和更新接口
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mocks are initialized before module imports
const mocks = vi.hoisted(() => ({
    mockGetAppConfig: vi.fn(() => ({
        aiProvider: 'gemini',
        allowRegistration: true,
        timeZone: 'Asia/Shanghai',
        openai: {
            instances: [{
                id: 'test-instance',
                name: 'Test',
                apiKey: 'sk-test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-4o',
            }],
            activeInstanceId: 'test-instance',
        },
        gemini: {
            apiKey: 'AIza-test-key',
            baseUrl: '',
            model: 'gemini-2.5-flash',
        },
        prompts: {
            analyze: '',
            similar: '',
        },
    })),
    mockUpdateAppConfig: vi.fn((config: Partial<AppConfig>) => ({
        ...config,
        aiProvider: config.aiProvider || 'gemini',
    })),
}));

// Mock config module
vi.mock('@/lib/config', () => ({
    getAppConfig: mocks.mockGetAppConfig,
    updateAppConfig: mocks.mockUpdateAppConfig,
}));

const mockGetServerSession = vi.hoisted(() => vi.fn());
vi.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

// Import after mocks
import { GET, POST } from '@/app/api/settings/route';
import type { AppConfig } from '@/lib/config';

const adminSession = { user: { id: 'admin-1', email: 'admin@localhost', role: 'admin' }, expires: '2099-01-01' };
const userSession = { user: { id: 'user-1', email: 'user@localhost', role: 'user' }, expires: '2099-01-01' };

describe('/api/settings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetServerSession.mockResolvedValue(adminSession);
    });

    describe('访问控制', () => {
        it('未登录时 GET 返回 401，不泄露任何配置', async () => {
            mockGetServerSession.mockResolvedValue(null);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(401);
            expect(JSON.stringify(data)).not.toContain('sk-test-key');
        });

        it('普通用户 GET 只拿到非敏感字段', async () => {
            mockGetServerSession.mockResolvedValue(userSession);

            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.aiProvider).toBe('gemini');
            expect(Object.keys(data).filter((key) => !['aiProvider', 'timeouts', 'timeZone'].includes(key))).toEqual([]);
            expect(data.timeZone).toBe('Asia/Shanghai');
            expect(JSON.stringify(data)).not.toContain('sk-test-key');
            expect(JSON.stringify(data)).not.toContain('AIza-test-key');
        });

        it('未登录时 POST 返回 401，且不写配置', async () => {
            mockGetServerSession.mockResolvedValue(null);

            const response = await POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ allowRegistration: true }),
            }));

            expect(response.status).toBe(401);
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });

        it('普通用户 POST 返回 403，且不写配置', async () => {
            mockGetServerSession.mockResolvedValue(userSession);

            const response = await POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ allowRegistration: true }),
            }));

            expect(response.status).toBe(403);
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/settings', () => {
        it('管理员应该拿到完整的应用配置', async () => {
            const response = await GET();
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.aiProvider).toBe('gemini');
            expect(data.openai).toBeDefined();
            expect(data.gemini).toBeDefined();
            expect(data.prompts).toBeDefined();
        });

        it('应该返回 AI 提供商设置', async () => {
            const response = await GET();
            const data = await response.json();

            expect(data.openai.instances[0].apiKey).toBe('sk-test-key');
            expect(data.gemini.apiKey).toBe('AIza-test-key');
            expect(data.gemini.model).toBe('gemini-2.5-flash');
        });

        it('应该返回注册开关状态', async () => {
            const response = await GET();
            const data = await response.json();

            expect(data.allowRegistration).toBe(true);
        });
    });

    describe('POST /api/settings', () => {
        it('管理员可保存有效时区，去掉首尾空白', async () => {
            const response = await POST(new Request('http://localhost/api/settings', { method: 'POST', body: JSON.stringify({ timeZone: ' America/New_York ' }) }));
            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith({ timeZone: 'America/New_York' });
        });

        it.each(['invalid/zone', '', null, 8])('拒绝无效时区 %s 且不写配置', async (timeZone) => {
            const response = await POST(new Request('http://localhost/api/settings', { method: 'POST', body: JSON.stringify({ timeZone }) }));
            expect(response.status).toBe(400);
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });

        it('普通用户不能修改全局时区', async () => {
            mockGetServerSession.mockResolvedValue(userSession);
            const response = await POST(new Request('http://localhost/api/settings', { method: 'POST', body: JSON.stringify({ timeZone: 'UTC' }) }));
            expect(response.status).toBe(403);
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });
        it('应该成功更新 AI 提供商', async () => {
            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ aiProvider: 'openai' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(
                expect.objectContaining({ aiProvider: 'openai' })
            );
        });

        it('应该成功更新 OpenAI 配置', async () => {
            const newConfig = {
                openai: {
                    instances: [{
                        id: 'new-instance',
                        name: 'New Instance',
                        apiKey: 'sk-new-key',
                        baseUrl: 'https://custom.api.com',
                        model: 'gpt-4-turbo',
                    }],
                    activeInstanceId: 'new-instance',
                },
            };

            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify(newConfig),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    openai: expect.objectContaining({
                        instances: expect.arrayContaining([
                            expect.objectContaining({
                                apiKey: 'sk-new-key',
                                model: 'gpt-4-turbo',
                            }),
                        ]),
                    }),
                })
            );
        });

        it('应该成功更新 Gemini 配置', async () => {
            const newConfig = {
                gemini: {
                    apiKey: 'AIza-new-key',
                    model: 'gemini-3.0-flash',
                },
            };

            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify(newConfig),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    gemini: expect.objectContaining({
                        apiKey: 'AIza-new-key',
                    }),
                })
            );
        });

        it('应该保留掩码 API Key（********）的原有值', async () => {
            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({
                    openai: {
                        instances: [{
                            id: 'test-instance', // 使用 mock 中已存在的实例 ID
                            name: 'Masked',
                            apiKey: '********',
                            baseUrl: 'https://api.openai.com/v1',
                            model: 'gpt-4o',
                        }],
                    },
                    gemini: { apiKey: '********' },
                }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            // 验证更新时保留了原有的 key
            const updateCall = mocks.mockUpdateAppConfig.mock.calls[0][0];
            // OpenAI instances 应该保留，且 apiKey 应为原有值
            expect(updateCall.openai?.instances?.length).toBe(1);
            expect(updateCall.openai?.instances?.[0]?.apiKey).toBe('sk-test-key');
            expect(updateCall.gemini?.apiKey).toBe('AIza-test-key');
        });

        it('国产大模型渠道同样保留掩码 API Key 的原有值', async () => {
            const { VENDOR_PROVIDER_IDS } = await import('@/lib/ai/vendor-presets');
            const current = mocks.mockGetAppConfig();
            mocks.mockGetAppConfig.mockReturnValueOnce({
                ...current,
                ...Object.fromEntries(VENDOR_PROVIDER_IDS.map((id) => [id, { apiKey: `${id}-saved-key` }])),
            } as ReturnType<typeof mocks.mockGetAppConfig>);
            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify(Object.fromEntries(VENDOR_PROVIDER_IDS.map((id) => [id, { apiKey: '********', model: 'm' }]))),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            const updateCall = mocks.mockUpdateAppConfig.mock.calls[0][0];
            for (const id of VENDOR_PROVIDER_IDS) {
                expect(updateCall[id]).toEqual({ apiKey: `${id}-saved-key`, model: 'm' });
            }
        });

        it('云端语音设置按格式校验，豆包语音的掩码 Key 保留原有值', async () => {
            const current = mocks.mockGetAppConfig();
            mocks.mockGetAppConfig.mockReturnValueOnce({
                ...current,
                tts: { mode: 'volcengine', volcengine: { apiKey: 'speech-saved-key' } },
            } as ReturnType<typeof mocks.mockGetAppConfig>);
            const response = await POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ tts: { mode: 'volcengine', volcengine: { apiKey: '********', voice: 'zh_male_x' }, glm: { voice: 'tongtong' } } }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig.mock.calls[0][0].tts).toEqual({
                mode: 'volcengine',
                volcengine: { apiKey: 'speech-saved-key', voice: 'zh_male_x' },
                glm: { voice: 'tongtong' },
            });

            const invalid = await POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ tts: { mode: 'unknown' } }),
                headers: { 'Content-Type': 'application/json' },
            }));
            expect(invalid.status).toBe(400);
        });

        it('应该成功更新自定义提示词', async () => {
            const newConfig = {
                prompts: {
                    analyze: '自定义分析提示词',
                    similar: '自定义类似题提示词',
                },
            };

            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify(newConfig),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompts: expect.objectContaining({
                        analyze: '自定义分析提示词',
                    }),
                })
            );
        });

        it('保存每日 AI 次数，拒绝负数和小数', async () => {
            const post = (aiDailyLimit: unknown) => POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ aiDailyLimit }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect((await post(30)).status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(expect.objectContaining({ aiDailyLimit: 30 }));

            mocks.mockUpdateAppConfig.mockClear();
            for (const invalid of [-1, 2.5, '10']) {
                expect((await post(invalid)).status).toBe(400);
            }
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });

        it('MiniMax Code 只保存模型和自动签到开关，拒绝无效取值', async () => {
            const post = (minimaxCode: unknown) => POST(new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ minimaxCode }),
                headers: { 'Content-Type': 'application/json' },
            }));

            expect((await post({ model: ' MiniMax-M3 ', autoCheckin: false, accessToken: 'forged' })).status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith({ minimaxCode: { model: 'MiniMax-M3', autoCheckin: false } });

            mocks.mockUpdateAppConfig.mockClear();
            for (const invalid of [{ model: 123 }, { autoCheckin: 'yes' }, { model: 'x'.repeat(101) }, 'MiniMax-M3']) {
                expect((await post(invalid)).status).toBe(400);
            }
            expect(mocks.mockUpdateAppConfig).not.toHaveBeenCalled();
        });

        it('应该成功更新注册开关', async () => {
            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ allowRegistration: false }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);

            expect(response.status).toBe(200);
            expect(mocks.mockUpdateAppConfig).toHaveBeenCalledWith(
                expect.objectContaining({ allowRegistration: false })
            );
        });

        it('应该处理更新失败的情况', async () => {
            mocks.mockUpdateAppConfig.mockImplementationOnce(() => {
                throw new Error('Write failed');
            });

            const request = new Request('http://localhost/api/settings', {
                method: 'POST',
                body: JSON.stringify({ aiProvider: 'openai' }),
                headers: { 'Content-Type': 'application/json' },
            });

            const response = await POST(request);
            const data = await response.json();

            expect(response.status).toBe(500);
            expect(data.message).toBe('Failed to update settings');
        });
    });
});
