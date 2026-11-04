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
        groupByType: false,
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
            questionType: null,
            errorItemQuestionType: null,
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

    it('groupByType 开启时按大题分组：标题行含题数与分值小计，题号全卷连续编号', () => {
        const paper = buildPaper([
            { questionType: 'single_choice', score: 2 },
            { questionType: 'single_choice', score: 3 },
            { questionType: 'fill_blank' },
        ]);
        paper.groupByType = true;
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
        expect(html).toContain('一、单选题');
        expect(html).toContain('二、填空题');
        expect(html).toContain('共 2 题，共 5 分');
        // 填空题大题无已设分值，只显示题数
        expect(html).toContain('共 1 题');
        expect(html).not.toContain('共 1 题，共');
        expect(html).toContain('exam-section-head');
        // 连续编号：1. 2. 3.
        expect(html).toContain('1.');
        expect(html).toContain('2.');
        expect(html).toContain('3.');
        // 满分仍按全卷统计
        expect(html).toContain('满分 5 分');
    });

    it('groupByType 关闭时打印与旧版一致：无大题标题', () => {
        const paper = buildPaper([
            { questionType: 'single_choice', score: 2 },
            { questionType: 'fill_blank', score: 3 },
        ]);
        paper.groupByType = false;
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
        expect(html).not.toContain('exam-section-head');
        expect(html).not.toContain('一、单选题');
        expect(html).not.toContain('Part I.');
        expect(html).toContain('满分 5 分');
    });

    it('分组时答案页同样分组且题号与正文一致', () => {
        const paper = buildPaper([
            { questionType: 'single_choice', score: 2, answerText: 'A' },
            { questionType: 'fill_blank', score: 3, answerText: 'B' },
        ]);
        paper.groupByType = true;
        const html = render(
            <ExamPrintSheet
                paper={paper}
                includeAnswers
                answerSpace="none"
                customSpaces={{}}
                uniformPreview={{ scale: null, align: null }}
                onSaveFigureScale={NOOP}
                onChangeCustomSpace={() => {}}
            />
        );
        expect(html).toContain('exam-answer-key');
        // 大题标题在正文与答案页各出现一次
        expect(html.match(/一、单选题/g)).toHaveLength(2);
        expect(html.match(/二、填空题/g)).toHaveLength(2);
    });
});
