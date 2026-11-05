/** 把 token 数格式化为简短形式：中文用「万」，英文用 K/M，如 12345 → 1.2万 / 12K */
export function formatTokenCount(value: number, language: 'zh' | 'en'): string {
    return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(Math.max(0, value));
}
