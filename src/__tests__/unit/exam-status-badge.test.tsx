import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExamStatusBadge, getExamDisplayStatus } from '@/components/exam/exam-status-badge';
import { LanguageProvider } from '@/contexts/LanguageContext';

const render = (element: React.ReactElement) => renderToStaticMarkup(<LanguageProvider>{element}</LanguageProvider>);

describe('试卷状态徽章', () => {
    it('生成完成但未录入任何结果时显示「已生成」', () => {
        expect(getExamDisplayStatus('ready', 0, 3)).toBe('ready');
        expect(render(<ExamStatusBadge status="ready" gradedCount={0} totalCount={3} />)).toContain('已生成');
    });

    it('只录入部分结果时仍保持「已生成」', () => {
        expect(getExamDisplayStatus('ready', 1, 3)).toBe('ready');
        expect(getExamDisplayStatus('partial', 1, 3)).toBe('partial');
        expect(render(<ExamStatusBadge status="ready" gradedCount={1} totalCount={3} />)).toContain('已生成');
    });

    it('全部可批改题目都录入结果后显示「已完成」', () => {
        expect(getExamDisplayStatus('ready', 3, 3)).toBe('completed');
        // 部分失败试卷：失败的题不进入分母，已生成题全部录入即完成
        expect(getExamDisplayStatus('partial', 2, 2)).toBe('completed');
        expect(render(<ExamStatusBadge status="ready" gradedCount={3} totalCount={3} />)).toContain('已完成');
    });

    it('没有可批改题目时不显示完成', () => {
        expect(getExamDisplayStatus('ready', 0, 0)).toBe('ready');
        expect(getExamDisplayStatus('partial', 0, 0)).toBe('partial');
    });

    it('生成中与生成失败保持原状态', () => {
        expect(getExamDisplayStatus('generating', 1, 3)).toBe('generating');
        expect(getExamDisplayStatus('failed', 1, 3)).toBe('failed');
        expect(render(<ExamStatusBadge status="partial" gradedCount={0} totalCount={3} />)).toContain('部分失败');
    });
});
