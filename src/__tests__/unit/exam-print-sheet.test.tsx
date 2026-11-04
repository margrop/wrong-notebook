import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExamPrintSheet } from '@/app/exams/[id]/print/exam-print-sheet';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { ExamPaperDetail } from '@/types/api';

const render = (element: React.ReactElement) => renderToStaticMarkup(<LanguageProvider>{element}</LanguageProvider>);

function buildPaper(questions: Partial<ExamPaperDetail['questions'][number]>[]): ExamPaperDetail {
    return {
        id: 'p1',
        title: '周测',
        status: 'ready',
        scope: 'all',
        difficulty: 'medium',
        mode: 'generate',
        requestedCount: questions.length,
        resultsRecordedAt: null,
        createdAt: '2026-11-04T00:00:00.000Z',
        questions: questions.map((question, index) => ({
            id: `q${index + 1}`,
            order: index,
            errorItemId: null,
            sourceShortId: `S${index + 1}`,
            status: 'ready',
            questionText: `题目 ${index + 1}`,
            answerText: null,
            analysis: null,
            figureSvg: null,
            figureScale: 100,
            figureAlign: 'center',
            answerSpacePx: null,
            score: null,
            error: null,
            notebookName: null,
            attempts: [],
            ...question,
        })),
    };
}

const NOOP = async () => {};

describe('ExamPrintSheet 分值打印', () => {
    it('已设分值的题号后显示（N 分），标题下显示满分', () => {
        const paper = buildPaper([{ score: 2 }, { score: 2.5 }]);
        const html = render(
            <ExamPrintSheet
                paper={paper}
                includeAnswers={false}
                answerSpace="none"
                customSpaces={{}}
                uniformPreview={{ scale: null, align: null }}
                onSaveFigureScale={NOOP}
                onChangeCustomSpace={() => {}}
            />
        );
        expect(html).toContain('（2 分）');
        expect(html).toContain('（2.5 分）');
        expect(html).toContain('满分 4.5 分');
    });

    it('未设分值时打印与旧版一致：无满分行、题号后无分值', () => {
        const paper = buildPaper([{}, {}]);
        const html = render(
            <ExamPrintSheet
                paper={paper}
                includeAnswers={false}
                answerSpace="none"
                customSpaces={{}}
                uniformPreview={{ scale: null, align: null }}
                onSaveFigureScale={NOOP}
                onChangeCustomSpace={() => {}}
            />
        );
        expect(html).not.toContain('exam-full-score');
        expect(html).not.toContain('（');
        expect(html).not.toContain('满分');
    });

    it('部分题未设分值时满分只累加已设分值的题', () => {
        const paper = buildPaper([{ score: 3 }, {}]);
        const html = render(
            <ExamPrintSheet
                paper={paper}
                includeAnswers={false}
                answerSpace="none"
                customSpaces={{}}
                uniformPreview={{ scale: null, align: null }}
                onSaveFigureScale={NOOP}
                onChangeCustomSpace={() => {}}
            />
        );
        expect(html).toContain('（3 分）');
        expect(html).toContain('满分 3 分');
    });
});
