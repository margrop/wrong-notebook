import { describe, expect, it } from "vitest";
import { bankPackageUrl, parseBankFile, parseBankIndex } from "@/lib/question-bank/format";

function bankFile(overrides: Record<string, unknown> = {}) {
    return {
        format: "wrong-notebook-question-bank",
        version: 1,
        meta: {
            id: "primary-math",
            title: "小学数学题库",
            stage: "primary",
            subject: "math",
            grades: [1, 2],
            count: 2,
            tagged: true,
            source: "test-source",
            license: "MIT",
            ...overrides,
        },
        questions: [
            {
                id: "q1",
                stage: "primary",
                subjectKey: "math",
                grade: 1,
                semester: "上",
                questionType: "fill_blank",
                difficultyStars: 2,
                text: "3 的后面一个数是几？",
                answer: "4",
                analysis: "从 1 往后数。",
                knowledgePoints: ["数的认识", "数的认识"],
            },
            {
                text: "1 + 1 = ?",
                options: { A: "1", B: "2" },
                answer: "B",
            },
        ],
    };
}

describe("题库包解析", () => {
    it("规范化题库包：补全单题学段/学科、去重知识点、保留选项 JSON", () => {
        const parsed = parseBankFile(bankFile());
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.meta).toMatchObject({ stage: "primary", subject: "math", count: 2, tagged: true });
        expect(parsed.data.questions[0]).toMatchObject({
            stage: "primary",
            subjectKey: "math",
            knowledgePoints: ["数的认识"],
            optionsJson: null,
        });
        expect(parsed.data.questions[1]).toMatchObject({
            stage: "primary",
            subjectKey: "math",
            optionsJson: '{"A":"1","B":"2"}',
            grade: null,
        });
    });

    it("meta.count 与实际题数不一致时以实际题数为准", () => {
        const parsed = parseBankFile(bankFile({ count: 99 }));
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.meta.count).toBe(2);
    });

    it("拒绝未知学段、未知学科与空题干", () => {
        expect(parseBankFile(bankFile({ stage: "kindergarten" })).success).toBe(false);
        expect(parseBankFile(bankFile({ subject: "art" })).success).toBe(false);
        const file = bankFile();
        file.questions[0].text = "   ";
        expect(parseBankFile(file).success).toBe(false);
    });

    it("索引只保留合法学段/学科的包，并生成同目录下载地址", () => {
        const parsed = parseBankIndex({
            format: "wrong-notebook-question-bank-index",
            version: 1,
            updatedAt: "2026-11-11",
            packages: [
                { id: "a", title: "A", stage: "primary", subject: "math", count: 1, source: "s", license: "MIT", file: "banks/a.json" },
                { id: "b", title: "B", stage: "primary", subject: "art", count: 1, source: "s", license: "MIT", file: "banks/b.json" },
            ],
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.packages.map((item) => item.id)).toEqual(["a"]);
        expect(bankPackageUrl("https://example.com/repo/main/index.json", "banks/a.json"))
            .toBe("https://example.com/repo/main/banks/a.json");
    });
});
