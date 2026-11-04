/**
 * to-xlsx.ts 的单元测试：
 * 1. 纯函数 questionsToSheetRows / splitOptionsFromText / questionTypeDisplayName；
 * 2. 往返测试——用 write-excel-file/universal 生成真实 .xlsx，再用 read-excel-file 读取，
 *    经 parseXlsxFile 解析，结果应与原题目一致（列与导入模板一致，保证导出→再导入闭环）。
 */
import { describe, expect, it } from "vitest";
import {
    buildXlsxSheet,
    questionTypeDisplayName,
    questionsToSheetRows,
    splitOptionsFromText,
} from "@/lib/question-format/to-xlsx";
import { TEMPLATE_COLUMNS } from "@/lib/import/file-parsers/table-template";
import { parseXlsxFile } from "@/lib/import/file-parsers/xlsx";
import type { StructuredQuestion } from "@/lib/question-format/types";

const sampleQuestions: StructuredQuestion[] = [
    {
        text: "下列哪个选项是正确的？\nA．选项一\nB．选项二\nC．选项三\nD．选项四",
        answer: "A",
        analysis: "这是解析内容。",
        knowledgePoints: ["知识点一", "知识点二"],
        difficultyStars: 3,
        questionType: "single_choice",
        subject: "数学",
        gradeSemester: "七年级上学期",
        source: "2025 期中",
        section: "第一大题",
        label: "1",
    },
    {
        text: "1+1=____。",
        answer: "2",
        analysis: "基础加法运算。",
        knowledgePoints: ["基础运算"],
        difficultyStars: 1,
        questionType: "fill_blank",
        subject: "数学",
        gradeSemester: "一年级上学期",
        source: "课堂练习",
        section: "第一大题",
        label: "2",
    },
    {
        // 无选项、无题型的极简题
        text: "简述勾股定理。",
        answer: "直角三角形两直角边平方和等于斜边平方。",
    },
];

describe("splitOptionsFromText", () => {
    it("拆分末尾连续选项行", () => {
        const { text, options } = splitOptionsFromText("题干\nA．甲\nB．乙\nC．丙");
        expect(text).toBe("题干");
        expect(options).toEqual(["甲", "乙", "丙"]);
    });

    it("正文中的选项行不在末尾块则不拆", () => {
        const { text, options } = splitOptionsFromText("A．甲\n这是正文\nB．乙");
        expect(options).toEqual([]);
        expect(text).toBe("A．甲\n这是正文\nB．乙");
    });

    it("末尾空行不影响拆分", () => {
        const { text, options } = splitOptionsFromText("题干\n\nA．甲\n\n");
        expect(text).toBe("题干");
        expect(options).toEqual(["甲"]);
    });

    it("无选项时原文返回", () => {
        const { text, options } = splitOptionsFromText("纯题干");
        expect(text).toBe("纯题干");
        expect(options).toEqual([]);
    });

    it("不按 A 开头顺序的块不拆（避免误拆正文）", () => {
        const { text, options } = splitOptionsFromText("题干\nC．丙\nD．丁");
        expect(options).toEqual([]);
        expect(text).toBe("题干\nC．丙\nD．丁");
    });
});

describe("questionTypeDisplayName", () => {
    it("标准 key 返回中文显示名", () => {
        expect(questionTypeDisplayName("single_choice")).toBe("单选题");
        expect(questionTypeDisplayName("fill_blank")).toBe("填空题");
    });

    it("中文别名可识别", () => {
        expect(questionTypeDisplayName("多选题")).toBe("多选题");
    });

    it("无法识别时原样保留", () => {
        expect(questionTypeDisplayName("自定义题型")).toBe("自定义题型");
    });

    it("空值返回空字符串", () => {
        expect(questionTypeDisplayName(undefined)).toBe("");
    });
});

describe("questionsToSheetRows", () => {
    it("首行与导入模板列一致", () => {
        const rows = questionsToSheetRows(sampleQuestions);
        expect(rows[0]).toEqual(TEMPLATE_COLUMNS);
    });

    it("选项拆到选项列、其余字段落列", () => {
        const rows = questionsToSheetRows(sampleQuestions);
        const q1 = rows[1];
        expect(q1[0]).toBe("下列哪个选项是正确的？");
        expect(q1[1]).toBe("选项一");
        expect(q1[2]).toBe("选项二");
        expect(q1[3]).toBe("选项三");
        expect(q1[4]).toBe("选项四");
        expect(q1[5]).toBe("A");
        expect(q1[6]).toBe("这是解析内容。");
        expect(q1[7]).toBe("知识点一、知识点二");
        expect(q1[8]).toBe("3");
        expect(q1[9]).toBe("单选题");
        expect(q1[10]).toBe("数学");
        expect(q1[11]).toBe("七年级上学期");
        expect(q1[12]).toBe("2025 期中");
        expect(q1[13]).toBe("第一大题");
        expect(q1[14]).toBe("1");
    });

    it("无选项题目选项列为空", () => {
        const rows = questionsToSheetRows(sampleQuestions);
        const q3 = rows[3];
        expect(q3[0]).toBe("简述勾股定理。");
        expect(q3[1]).toBe("");
        expect(q3[2]).toBe("");
    });

    it("难度非法值为空字符串", () => {
        const rows = questionsToSheetRows([
            { text: "t", difficultyStars: 6 },
            { text: "t2", difficultyStars: 2.5 },
        ]);
        expect(rows[1][8]).toBe("");
        expect(rows[2][8]).toBe("");
    });
});

describe("导出→导入往返", () => {
    it("生成的 .xlsx 经 parseXlsxFile 解析与原题一致", async () => {
        const { default: writeExcelFile } = await import("write-excel-file/universal");
        const { data, sheet, columns, stickyRowsCount } = buildXlsxSheet(sampleQuestions);
        const blob = await writeExcelFile(data, { sheet, columns, stickyRowsCount }).toBlob();

        const result = await parseXlsxFile(blob);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(3);

        const [q1, q2, q3] = result.questions;
        // 第 1 题：选项拼回题干（与导入端拼接格式一致）
        expect(q1.text).toContain("下列哪个选项是正确的？");
        expect(q1.text).toContain("A．选项一");
        expect(q1.text).toContain("D．选项四");
        expect(q1.answer).toBe("A");
        expect(q1.analysis).toBe("这是解析内容。");
        expect(q1.knowledgePoints).toEqual(["知识点一", "知识点二"]);
        expect(q1.difficultyStars).toBe(3);
        // 题型往返后为中英文显示名（导入端别名表可再识别为标准 key）
        expect(q1.questionType).toBe("单选题");
        expect(q1.subject).toBe("数学");
        expect(q1.gradeSemester).toBe("七年级上学期");
        expect(q1.source).toBe("2025 期中");
        expect(q1.section).toBe("第一大题");
        expect(q1.label).toBe("1");

        // 第 2 题：填空题
        expect(q2.text).toBe("1+1=____。");
        expect(q2.answer).toBe("2");
        expect(q2.analysis).toBe("基础加法运算。");
        expect(q2.difficultyStars).toBe(1);
        expect(q2.questionType).toBe("填空题");

        // 第 3 题：极简题
        expect(q3.text).toBe("简述勾股定理。");
        expect(q3.answer).toBe("直角三角形两直角边平方和等于斜边平方。");
    });
});
