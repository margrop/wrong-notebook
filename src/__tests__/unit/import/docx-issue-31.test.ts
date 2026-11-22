/**
 * issue #31 回归测试：真实 Word 题库按分组标题（作业卷/晚课卷/第X章作业）切分为多段，
 * 每段题号重新从 1 开始；行首题型标记（如「（选做）」「（多选）」「（答选）」）不影响题号识别；
 * 同段内允许重复题号与少量跳号。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseDocx } from '@/lib/import/file-parsers/docx';

const documentXml = readFileSync(join(__dirname, '../../fixtures/issue-31-word-document.xml'), 'utf8');

/** 把 fixture 的 word/document.xml 单独打包成最小 docx */
function makeFixtureDocx(): ArrayBuffer {
    const zipped = zipSync({ 'word/document.xml': strToU8(documentXml) });
    return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

/** 闭区间整数序列 */
function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

describe('docx 解析：issue #31 真实题库分段', () => {
    it('按分组标题切出全部题目，题号序列与原文一致', async () => {
        const result = await parseDocx(makeFixtureDocx());
        expect(result.errors).toEqual([]);
        // 首段 9～15；第二段 1～8、10～12（8 与 10 之间缺 9，共 11 题）；
        // 第三段 1～8 后重复 9、10、11（共 12 题）；第四段 1～8
        const expectedLabels = [
            ...range(9, 15),
            ...range(1, 8), 10, 11, 12,
            ...range(1, 8), 9, 9, 10, 11,
            ...range(1, 8),
        ];
        expect(result.questions.map((question) => question.label)).toEqual(expectedLabels.map(String));
        expect(result.questions.length).toBe(38);
        expect(result.questions).toHaveLength(38);
    });

    it('分段标题作为 section，首段无 section；各段题干不丢失', async () => {
        const result = await parseDocx(makeFixtureDocx());
        const questions = result.questions;
        expect(questions[0].section ?? null).toBeNull();
        expect(questions[0].text).toContain('舞蹈演员');
        // 第一段 7 题后进入「第四章 第三节 平面镜成像(一) 作业」
        expect(questions[7].section).toBe('第四章 第三节 平面镜成像(一) 作业');
        // 第二段 11 题后进入「晚课卷 （10月26日-30日）」
        expect(questions[18].section).toBe('晚课卷 （10月26日-30日）');
        expect(questions.slice(18).some((question) => question.text.includes('奋斗者'))).toBe(true);
        // 第三段 12 题后进入「作业卷」
        expect(questions[30].section).toBe('作业卷');
        expect(questions[questions.length - 1].text).toContain('甘肃敦煌');
    });

    it('三段全部计入题目，未计入内容为空', async () => {
        const result = await parseDocx(makeFixtureDocx());
        // parseDocx 不暴露 split.ignored，以「无 IGNORED_PARAGRAPHS 警告」为可观察结果
        expect(result.warnings.filter((warning) => /^IGNORED_PARAGRAPHS:\d+$/.test(warning))).toEqual([]);
    });
});
