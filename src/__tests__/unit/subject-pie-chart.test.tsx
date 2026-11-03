/**
 * SubjectPieChart：学科分布饼图组件
 * 验证图例渲染、百分比计算、空数据处理
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SubjectPieChart } from '@/components/stats/subject-pie-chart';

// recharts 在服务端渲染时需要 mock ResponsiveContainer
vi.mock('recharts', async () => {
    const actual = await vi.importActual('recharts');
    return {
        ...actual,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
            <div data-testid="responsive-container">{children}</div>
        ),
    };
});

const render = (title: string, data: Array<{ name: string; value: number }>) =>
    renderToStaticMarkup(<SubjectPieChart title={title} data={data} />);

describe('SubjectPieChart', () => {
    const mockData = [
        { name: '数学', value: 10 },
        { name: '物理', value: 5 },
        { name: '化学', value: 5 },
    ];

    it('应该渲染标题和图例', () => {
        const html = render('学科分布', mockData);

        // 验证标题
        expect(html).toContain('学科分布');

        // 验证图例项（色块 + 名称 + 数量 + 百分比）
        expect(html).toContain('数学 10 (50%)');
        expect(html).toContain('物理 5 (25%)');
        expect(html).toContain('化学 5 (25%)');
    });

    it('应该正确计算百分比', () => {
        const data = [
            { name: 'A', value: 3 },
            { name: 'B', value: 1 },
        ];
        const html = render('测试', data);

        expect(html).toContain('A 3 (75%)');
        expect(html).toContain('B 1 (25%)');
    });

    it('空数据时应该显示 0%', () => {
        const data = [{ name: 'A', value: 0 }];
        const html = render('测试', data);

        expect(html).toContain('A 0 (0%)');
    });
});
