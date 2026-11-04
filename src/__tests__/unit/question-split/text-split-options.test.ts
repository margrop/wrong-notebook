import { describe, expect, it } from 'vitest';
import {
    MAX_CLIENT_SPLIT_QUESTIONS,
    MAX_CLIENT_SPLIT_TEXT_LENGTH,
    splitQuestionText,
} from '@/lib/question-split/text';

describe('splitQuestionText 可选上限参数', () => {
    it('默认参数与不传参数结果一致', () => {
        const text = Array.from({ length: 80 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const defaultResult = splitQuestionText(text);
        const explicitResult = splitQuestionText(text, { maxLength: 20000, maxQuestions: 60 });
        expect(defaultResult.questions.length).toBe(60);
        expect(explicitResult.questions.length).toBe(60);
        expect(defaultResult.overflow).toBe(20);
        expect(explicitResult.overflow).toBe(20);
    });

    it('maxQuestions 限制单批题数，超出部分列入 overflow', () => {
        const text = Array.from({ length: 10 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const result = splitQuestionText(text, { maxQuestions: 5 });
        expect(result.questions).toHaveLength(5);
        expect(result.overflow).toBe(5);
    });

    it('maxLength 限制处理文字长度，超出部分截断并标记 tooLong', () => {
        const text = Array.from({ length: 10 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const result = splitQuestionText(text, { maxLength: 1000 });
        expect(result.tooLong).toBe(false);
        expect(result.questions.length).toBeGreaterThan(0);
        const truncated = splitQuestionText(text + '字'.repeat(2000), { maxLength: 1000 });
        expect(truncated.tooLong).toBe(true);
    });

    it('maxLength 与 maxQuestions 同时生效', () => {
        const text = Array.from({ length: 20 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const result = splitQuestionText(text, { maxLength: 500, maxQuestions: 3 });
        expect(result.questions.length).toBeLessThanOrEqual(3);
        expect(result.overflow).toBeGreaterThan(0);
    });

    it('客户端可放大 maxQuestions 到 MAX_CLIENT_SPLIT_QUESTIONS', () => {
        // 80 题超过默认 60，但放大后不再 overflow
        const text = Array.from({ length: 80 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const result = splitQuestionText(text, { maxQuestions: MAX_CLIENT_SPLIT_QUESTIONS });
        expect(result.questions).toHaveLength(80);
        expect(result.overflow).toBe(0);
    });

    it('客户端可放大 maxLength 到 MAX_CLIENT_SPLIT_TEXT_LENGTH', () => {
        // 25000 字超过默认 20000，但放大后不再 tooLong
        const text = Array.from({ length: 10 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n') + '字'.repeat(20000);
        const result = splitQuestionText(text, { maxLength: MAX_CLIENT_SPLIT_TEXT_LENGTH });
        expect(result.tooLong).toBe(false);
    });

    it('maxQuestions 超过 MAX_CLIENT_SPLIT_QUESTIONS 被夹紧', () => {
        const text = Array.from({ length: 10 }, (_, index) => `${index + 1}．计算 ${index + 1} + ${index + 1}。`).join('\n');
        const result = splitQuestionText(text, { maxQuestions: MAX_CLIENT_SPLIT_QUESTIONS + 100 });
        expect(result.questions.length).toBe(10);
        expect(result.overflow).toBe(0);
    });
});
