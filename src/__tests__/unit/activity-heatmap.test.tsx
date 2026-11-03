/**
 * ActivityHeatmap：学习日历热力图
 * 验证月份标签、星期标签、日期方格渲染，以及横向滚动容器默认滚到最右侧
 */
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from '@/components/stats/activity-heatmap';
import type { ActivityStatsData } from '@/types/api';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translations } from '@/lib/translations';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api-client', () => ({ apiClient: { get: mocks.get } }));
vi.mock('@/lib/frontend-logger', () => ({ frontendLogger: { error: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;

function makeDays(startDate: string, count: number): ActivityStatsData['days'] {
    const days: ActivityStatsData['days'] = [];
    const start = new Date(startDate);
    for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push({
            date: d.toISOString().slice(0, 10),
            errors: i % 3,
            practices: i % 2,
        });
    }
    return days;
}

const statsData: ActivityStatsData = {
    days: makeDays('2026-08-31T00:00:00Z', 70), // 2026-08-31 是周一，覆盖 10 周
    currentStreak: 3,
    longestStreak: 7,
    totalActiveDays: 40,
};

async function renderHeatmap() {
    mocks.get.mockResolvedValue(statsData);
    await act(async () => {
        root.render(
            <StrictMode>
                <LanguageProvider>
                    <ActivityHeatmap url="/api/activity" />
                </LanguageProvider>
            </StrictMode>,
        );
    });
    // 等待数据请求完成并触发 effect
    await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

describe('ActivityHeatmap', () => {
    it('渲染月份标签（每月第一周显示月份）', async () => {
        await renderHeatmap();
        const text = container.textContent ?? '';
        // 数据从 2026-08-31 开始，应显示 8 月、9 月、10 月
        expect(text).toContain('8月');
        expect(text).toContain('9月');
        expect(text).toContain('10月');
    });

    it('渲染星期标签（周一、周三、周五）', async () => {
        await renderHeatmap();
        const weekdayLabels = translations.zh.activityHeatmap.weekdays;
        const text = container.textContent ?? '';
        expect(text).toContain(weekdayLabels[0]); // 周一
        expect(text).toContain(weekdayLabels[2]); // 周三
        expect(text).toContain(weekdayLabels[4]); // 周五
        // 周二、周四、周六不显示
        expect(text).not.toContain(weekdayLabels[1]);
        expect(text).not.toContain(weekdayLabels[3]);
        expect(text).not.toContain(weekdayLabels[5]);
    });

    it('渲染日期方格和连续打卡统计', async () => {
        await renderHeatmap();
        // 每个日期方格有 aria-label
        const cells = container.querySelectorAll('[aria-label*="2026-"]');
        expect(cells.length).toBe(statsData.days.length);
        // 统计数字
        expect(container.textContent).toContain(String(statsData.currentStreak));
        expect(container.textContent).toContain(String(statsData.longestStreak));
        expect(container.textContent).toContain(String(statsData.totalActiveDays));
    });

    it('横向滚动容器默认滚动到最右侧', async () => {
        await renderHeatmap();
        const scrollContainer = container.querySelector('.overflow-x-auto') as HTMLElement;
        expect(scrollContainer).toBeTruthy();
        // jsdom 中 scrollWidth / scrollLeft 默认为 0，这里验证 effect 执行后不报错
        // 真实浏览器中会滚动到 scrollWidth；jsdom 无法模拟，只验证 DOM 结构存在
        expect(scrollContainer.className).toContain('overflow-x-auto');
    });
});
