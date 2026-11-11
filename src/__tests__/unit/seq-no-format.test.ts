import { describe, it, expect } from 'vitest';
import { DEFAULT_QUESTION_NUMBERING, formatSeqNo, isQuestionNumbering, parseSeqNoQuery, questionNoLabel } from '@/lib/seq-no/seq-no-format';

describe('错题流水号', () => {
    it('默认显示 6 位 ID（现状）', () => {
        expect(DEFAULT_QUESTION_NUMBERING).toBe('shortId');
    });

    it('流水号显示为 #1000，缺失时为空', () => {
        expect(formatSeqNo(1000)).toBe('#1000');
        expect(formatSeqNo(null)).toBeNull();
        expect(formatSeqNo(undefined)).toBeNull();
        expect(formatSeqNo(0)).toBeNull();
    });

    it('按显示方式取编号，所选编号缺失时退回另一种', () => {
        const item = { shortId: 'oYMCZa', seqNo: 1003 };
        expect(questionNoLabel(item, 'shortId')).toBe('oYMCZa');
        expect(questionNoLabel(item, 'seqNo')).toBe('#1003');
        expect(questionNoLabel({ shortId: 'oYMCZa', seqNo: null }, 'seqNo')).toBe('oYMCZa');
        expect(questionNoLabel({ shortId: null, seqNo: 1003 }, 'shortId')).toBe('#1003');
        expect(questionNoLabel({}, 'seqNo')).toBeNull();
    });

    it('解析搜索与定位输入中的流水号', () => {
        expect(parseSeqNoQuery('#1000')).toBe(1000);
        expect(parseSeqNoQuery('＃1000')).toBe(1000);
        expect(parseSeqNoQuery(' 1000 ')).toBe(1000);
        expect(parseSeqNoQuery('# 12')).toBe(12);
        expect(parseSeqNoQuery('oYMCZa')).toBeNull();
        expect(parseSeqNoQuery('#0')).toBeNull();
        expect(parseSeqNoQuery('12a')).toBeNull();
        expect(parseSeqNoQuery('')).toBeNull();
        expect(parseSeqNoQuery(null)).toBeNull();
    });

    it('只接受两种显示方式', () => {
        expect(isQuestionNumbering('shortId')).toBe(true);
        expect(isQuestionNumbering('seqNo')).toBe(true);
        expect(isQuestionNumbering('serial')).toBe(false);
        expect(isQuestionNumbering(undefined)).toBe(false);
    });
});
