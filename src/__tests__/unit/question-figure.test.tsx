import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuestionFigure } from '@/components/question-figure';
import { PrintableQuestion } from '@/components/print-preview/printable-question';
import { LanguageProvider } from '@/contexts/LanguageContext';

const render = (svg: string | null) => renderToStaticMarkup(<LanguageProvider><QuestionFigure svg={svg} /></LanguageProvider>);

describe('题目配图', () => {
    it('以 <img> 加载 SVG data URI，不把 SVG 直接插入页面', () => {
        const markup = render('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
        expect(markup).toContain('<img');
        expect(markup).toContain('src="data:image/svg+xml;charset=utf-8,');
        expect(markup).not.toContain('<svg');
        expect(markup).toContain('alt="题目配图"');
    });

    it('没有配图时不渲染', () => {
        expect(render(null)).toBe('');
    });

    it('旧题默认使用 100%，缩放同时影响图片大小和布局占位', () => {
        const svg = '<svg viewBox="0 0 200 100"/>';
        const markup = (scale?: number) => renderToStaticMarkup(<LanguageProvider><QuestionFigure svg={svg} scale={scale} /></LanguageProvider>);
        expect(markup()).toContain('zoom:1;max-width:100%');
        expect(markup(50)).toContain('zoom:0.5;max-width:50%');
        expect(markup(150)).toContain('zoom:1.5;max-width:100%');
        expect(markup(-1)).toContain('zoom:1;max-width:100%');
    });

    it('文字打印读取每道题的配图比例，原图打印仍使用打印页的图片比例', () => {
        const item = { id: 'q1', createdAt: '2026-11-01T00:00:00Z', questionText: '如图求面积', figureSvg: '<svg viewBox="0 0 200 100"/>', figureScale: 60, originalImageUrl: '/photo.png' };
        const markup = (showQuestionText: boolean) => renderToStaticMarkup(
            <LanguageProvider>
                <PrintableQuestion item={item} index={0} reserveAnswerSpace={false} options={{ showQuestionText, showAnswers: false, showAnalysis: false, showTags: false, imageScale: 70 }} />
            </LanguageProvider>,
        );
        expect(markup(true)).toContain('zoom:0.6;max-width:60%');
        expect(markup(true)).not.toContain('/photo.png');
        expect(markup(false)).toContain('src="/photo.png"');
        expect(markup(false)).toContain('max-width:70%');
        expect(markup(false)).not.toContain('question-figure');
    });
});
