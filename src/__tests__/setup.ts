/**
 * Vitest 测试环境设置文件
 */
import { vi, beforeEach, afterEach } from 'vitest';

// Mock localStorage for tests that need it
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
            store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
            delete store[key];
        }),
        clear: vi.fn(() => {
            store = {};
        }),
        get length() {
            return Object.keys(store).length;
        },
        key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    };
})();

// Define window.localStorage for jsdom environment
Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    writable: true,
});

// AI 数据授权：默认视为已授权，其余测试专注各自的 AI 流程。
// 验证授权行为的测试在文件顶部调用 vi.unmock('@/lib/ai-consent-store') 使用真实实现。
vi.mock('@/lib/ai-consent-store', () => ({
    hasAiDataConsent: async () => true,
}));

// Reset mocks between tests
beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// jsdom 未实现 scrollIntoView，Radix Select 打开下拉时调用
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

// Export for use in individual tests
export { localStorageMock };
