/**
 * 统计图表颜色常量集中管理。
 *
 * 所有颜色均引用 CSS 主题变量（globals.css 中定义），
 * 亮色 / 暗色模式下自动适配，组件中不再出现十六进制颜色。
 *
 * recharts 的 fill / stroke / tick 等属性均可直接接收
 * "var(--xxx)" 字符串；SVG linearGradient 的 stopColor 同理。
 */

/** 网格线颜色 */
export const CHART_GRID_COLOR = 'var(--border)';

/** 坐标轴刻度文字颜色 */
export const CHART_AXIS_COLOR = 'var(--muted-foreground)';

/** 分类配色（饼图、柱状图等图表使用），对应 globals.css 中的 --chart-1 ~ --chart-6 */
export const COLORS: string[] = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
    'var(--chart-6)',
];

/** 错题趋势：新增与新掌握两个系列的颜色 */
export const CHART_ADDED_COLOR = 'var(--chart-1)';
export const CHART_MASTERED_COLOR = 'var(--success)';


/** 难度配色（语义固定，深色模式下仍可辨识） */
export const DIFFICULTY_COLORS: Record<string, string> = {
    'easy': 'var(--success)',
    'medium': 'var(--warning)',
    'hard': 'oklch(0.7 0.17 55)',
    'harder': 'oklch(0.65 0.2 25)',
    'Unknown': 'var(--muted-foreground)',
};
