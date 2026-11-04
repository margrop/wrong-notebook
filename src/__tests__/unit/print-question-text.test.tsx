import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrintQuestionText } from '@/components/print-preview/print-question-text';

describe('PrintQuestionText', () => {
    it('逐行选项横向排成多列，非选择题按原文渲染', () => {
        const html = renderToStaticMarkup(<PrintQuestionText content={'下列是质数的是\nA. 4\nB. 6\nC. 7\nD. 9'} />);
        expect(html).toContain('choice-options');
        expect(html).toContain('print:grid-cols-4');
        expect(html.match(/<span class="shrink-0">/g)).toHaveLength(4);

        expect(renderToStaticMarkup(<PrintQuestionText content={'求解方程。'} />)).not.toContain('choice-options');
    });
});
