import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FigureScaleEditor } from '@/components/error-detail/figure-scale-editor';
import { ExamFigureScaleBar } from '@/components/exam/exam-figure-scale-bar';
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
        const markup = (scale?: number, align?: string) => renderToStaticMarkup(<LanguageProvider><QuestionFigure svg={svg} scale={scale} align={align} /></LanguageProvider>);
        expect(markup()).toContain('zoom:1;max-width:100%');
        expect(markup()).toContain('mx-auto');
        expect(markup(50)).toContain('zoom:0.5;max-width:50%');
        expect(markup(150)).toContain('zoom:1.5;max-width:100%');
        expect(markup(-1)).toContain('zoom:1;max-width:100%');
        expect(markup(80, 'left')).toContain('mr-auto');
        expect(markup(80, 'left')).toContain('margin-left:0;margin-right:auto');
        expect(markup(80, 'right')).toContain('ml-auto');
        expect(markup(80, 'right')).toContain('margin-left:auto;margin-right:0');
        expect(markup(80, 'invalid')).toContain('mx-auto');
    });

    it('文字打印读取每道题的配图比例与显示位置，原图打印仍使用打印页的图片比例', () => {
        const item = { id: 'q1', createdAt: '2026-11-01T00:00:00Z', questionText: '如图求面积', figureSvg: '<svg viewBox="0 0 200 100"/>', figureScale: 60, figureAlign: 'right', originalImageUrl: '/photo.png' };
        const markup = (showQuestionText: boolean) => renderToStaticMarkup(
            <LanguageProvider>
                <PrintableQuestion item={item} index={0} reserveAnswerSpace={false} options={{ showQuestionText, showAnswers: false, showAnalysis: false, showTags: false, imageScale: 70 }} />
            </LanguageProvider>,
        );
        expect(markup(true)).toContain('zoom:0.6;max-width:60%');
        expect(markup(true)).toContain('ml-auto');
        expect(markup(true)).toContain('margin-left:auto;margin-right:0');
        expect(markup(true)).not.toContain('/photo.png');
        expect(markup(false)).toContain('src="/photo.png"');
        expect(markup(false)).toContain('max-width:70%');
        expect(markup(false)).not.toContain('question-figure');

        const fillMarkup = renderToStaticMarkup(
            <LanguageProvider>
                <PrintableQuestion item={{ ...item, questionText: '1 + 1 = ____' }} index={0} reserveAnswerSpace={true} options={{ showQuestionText: true, showAnswers: false, showAnalysis: false, showTags: false, imageScale: 70 }} />
            </LanguageProvider>,
        );
        const solutionMarkup = renderToStaticMarkup(
            <LanguageProvider>
                <PrintableQuestion item={{ ...item, questionText: '已知二次函数，求其最小值及对称轴。' }} index={0} reserveAnswerSpace={true} options={{ showQuestionText: true, showAnswers: false, showAnalysis: false, showTags: false, imageScale: 70 }} />
            </LanguageProvider>,
        );
        const customSpaceMarkup = renderToStaticMarkup(
            <LanguageProvider>
                <PrintableQuestion
                    item={{ ...item, questionText: '1 + 1 = ____' }}
                    index={0}
                    reserveAnswerSpace={true}
                    customAnswerSpacePx={180}
                    onCustomAnswerSpaceChange={vi.fn()}
                    options={{ showQuestionText: true, showAnswers: false, showAnalysis: false, showTags: false, imageScale: 70, answerSpace: 'auto' }}
                />
            </LanguageProvider>,
        );
        expect(fillMarkup).toContain('min-height:16px');
        expect(solutionMarkup).toContain('min-height:240px');
        expect(customSpaceMarkup).toContain('min-height:180px');
        expect(customSpaceMarkup).toContain('本题留白: 180px');
        expect(customSpaceMarkup).toContain('恢复默认');
    });

    it('试卷配图支持单题与全卷统一调整比例和显示位置，无配图时不渲染控件', () => {
        const svg = '<svg viewBox="0 0 200 100"/>';
        const singleMarkup = renderToStaticMarkup(
            <LanguageProvider>
                <FigureScaleEditor svg={svg} scale={75} align="left" previewScaleOverride={120} previewAlignOverride="right" onSave={vi.fn()} />
            </LanguageProvider>,
        );
        expect(singleMarkup).toContain('zoom:1.2;max-width:100%');
        expect(singleMarkup).toContain('ml-auto');
        expect(singleMarkup).toContain('value="75"');
        expect(singleMarkup).toContain('居左');
        expect(singleMarkup).toContain('居中');
        expect(singleMarkup).toContain('居右');
        expect(singleMarkup).toContain('figure-scale-editor-controls');

        const emptyBar = renderToStaticMarkup(
            <LanguageProvider>
                <ExamFigureScaleBar scales={[]} onSave={vi.fn()} />
            </LanguageProvider>,
        );
        expect(emptyBar).toBe('');

        const uniformBar = renderToStaticMarkup(
            <LanguageProvider>
                <ExamFigureScaleBar scales={[80, 80]} aligns={['left', 'left']} onSave={vi.fn()} />
            </LanguageProvider>,
        );
        expect(uniformBar).toContain('统一配图比例');
        expect(uniformBar).toContain('统一配图位置');
        expect(uniformBar).toContain('value="80"');
    });
});
