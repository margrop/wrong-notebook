import { describe, expect, it } from "vitest";
import {
    buildImportSummary,
    describeIgnoredFields,
    describeQuestionError,
    describeWarning,
    MAX_SHOWN_ERRORS,
} from "@/lib/import/file-import-summary";
import type { QuestionParseResult } from "@/lib/question-format/types";

describe("describeQuestionError", () => {
    it("已知错误码返回中英文提示", () => {
        expect(describeQuestionError("INVALID_JSON", "zh")).toContain("JSON");
        expect(describeQuestionError("INVALID_JSON", "en")).toContain("JSON");
        expect(describeQuestionError("LEGACY_DOC_NOT_SUPPORTED", "zh")).toContain("另存为 .docx");
        expect(describeQuestionError("TEXT_COLUMN_NOT_FOUND", "en")).toContain("column");
    });

    it("PDF 相关错误码返回中英文提示", () => {
        expect(describeQuestionError("PDF_NO_TEXT_LAYER", "zh")).toContain("扫描版");
        expect(describeQuestionError("PDF_NO_TEXT_LAYER", "en")).toContain("scanned");
        expect(describeQuestionError("PDF_ENCRYPTED", "zh")).toContain("加密");
        expect(describeQuestionError("PDF_ENCRYPTED", "en")).toContain("password");
        expect(describeQuestionError("INVALID_PDF", "zh")).toContain("损坏");
        expect(describeQuestionError("INVALID_PDF", "en")).toContain("corrupted");
    });

    it("参数化错误码解析参数", () => {
        expect(describeQuestionError("UNKNOWN_COLUMN:难度星级", "zh")).toContain("难度星级");
        expect(describeQuestionError("UNKNOWN_COLUMN:难度星级", "en")).toContain("难度星级");
        expect(describeQuestionError("IGNORED_PARAGRAPHS:3", "zh")).toContain("3");
    });

    it("未知错误码原样返回", () => {
        expect(describeQuestionError("SOME_NEW_CODE", "zh")).toContain("SOME_NEW_CODE");
        expect(describeQuestionError("SOME_NEW_CODE", "en")).toContain("SOME_NEW_CODE");
    });
});

describe("describeWarning", () => {
    it("已知警告码返回中英文提示", () => {
        expect(describeWarning("SINGLE_QUESTION", "zh")).toContain("一道题");
        expect(describeWarning("TOO_MANY_QUESTIONS", "en")).toContain("truncated");
    });

    it("参数化警告码解析参数", () => {
        expect(describeWarning("UNKNOWN_COLUMN:备注", "zh")).toContain("备注");
    });

    it("metafile 渲染警告解析参数", () => {
        expect(describeWarning("METAFILE_RENDERED:3", "zh")).toContain("3");
        expect(describeWarning("METAFILE_RENDERED:3", "en")).toContain("3");
        expect(describeWarning("METAFILE_FAILED:1", "zh")).toContain("1");
        expect(describeWarning("METAFILE_FAILED:1", "en")).toContain("1");
        expect(describeWarning("METAFILE_TRUNCATED:2", "zh")).toContain("2");
        expect(describeWarning("METAFILE_TRUNCATED:2", "en")).toContain("2");
    });

    it("保留 xlsx 工作表前缀", () => {
        const text = describeWarning("[Sheet1] UNKNOWN_COLUMN:备注", "zh");
        expect(text).toContain("[Sheet1]");
        expect(text).toContain("备注");
    });

    it("PDF 页数与空白页警告解析参数", () => {
        expect(describeWarning("PAGES:3", "zh")).toContain("3");
        expect(describeWarning("PAGES:1", "en")).toContain("1 page");
        expect(describeWarning("PAGES:2", "en")).toContain("2 pages");
        expect(describeWarning("EMPTY_PAGES:2", "zh")).toContain("2");
        expect(describeWarning("EMPTY_PAGES:1", "en")).toContain("1 page");
    });
});

describe("describeIgnoredFields", () => {
    it("生成带次数的可读文案", () => {
        const texts = describeIgnoredFields(
            [
                { field: "subject", count: 2 },
                { field: "figureSvg", count: 1 },
            ],
            "zh",
        );
        expect(texts[0]).toContain("学科");
        expect(texts[0]).toContain("2");
        const enTexts = describeIgnoredFields([{ field: "figureSvg", count: 3 }], "en");
        expect(enTexts[0]).toContain("figureSvg");
        expect(enTexts[0]).toContain("3 questions");
    });
});

describe("buildImportSummary", () => {
    it("统计题数、错误、警告与未导入字段，错误最多展示 MAX_SHOWN_ERRORS 条", () => {
        const result: QuestionParseResult = {
            questions: [
                { text: "a", subject: "数学" },
                { text: "b", figureSvg: "<svg/>" },
            ],
            errors: Array.from({ length: 8 }, (_, i) => ({ index: i, reason: "TEXT_REQUIRED" })),
            warnings: ["SINGLE_QUESTION", "UNKNOWN_COLUMN:备注"],
        };
        const summary = buildImportSummary(result, "zh");
        expect(summary.total).toBe(2);
        expect(summary.errorCount).toBe(8);
        expect(summary.errors).toHaveLength(MAX_SHOWN_ERRORS);
        expect(summary.warnings).toHaveLength(2);
        expect(summary.ignoredFields).toEqual([
            { field: "subject", count: 1 },
            { field: "figureSvg", count: 1 },
        ]);
        expect(summary.ignoredFieldTexts.length).toBe(2);
    });

    it("整体错误（index 为 -1）不带题号展示", () => {
        const result: QuestionParseResult = {
            questions: [],
            errors: [{ index: -1, reason: "INVALID_JSON" }],
            warnings: [],
        };
        const summary = buildImportSummary(result, "zh");
        expect(summary.errors[0].index).toBe(-1);
        expect(summary.errors[0].message).toContain("JSON");
    });
});
