import { describe, expect, it } from "vitest";
import {
    countIgnoredFields,
    structuredQuestionToItem,
    structuredQuestionsToItems,
} from "@/lib/import/structured-to-items";
import type { StructuredQuestion } from "@/lib/question-format/types";

describe("structuredQuestionToItem", () => {
    it("草稿支持的字段直接对应", () => {
        const question: StructuredQuestion = {
            text: "题干",
            material: "材料",
            section: "大题",
            label: "1",
            answer: "A",
            analysis: "解析",
            knowledgePoints: ["知识点1", "知识点2"],
            difficultyStars: 3,
            wrongAnswer: "B",
            questionType: "单选题",
        };
        const item = structuredQuestionToItem(question);
        expect(item).toEqual({
            text: "题干",
            material: "材料",
            section: "大题",
            label: "1",
            answer: "A",
            analysis: "解析",
            knowledgePoints: ["知识点1", "知识点2"],
            difficultyStars: 3,
            wrongAnswer: "B",
            questionType: "单选题",
        });
    });

    it("缺省字段为 null", () => {
        const item = structuredQuestionToItem({ text: "只有题干" });
        expect(item.text).toBe("只有题干");
        expect(item.material).toBeNull();
        expect(item.answer).toBeNull();
        expect(item.knowledgePoints).toBeNull();
        expect(item.difficultyStars).toBeNull();
    });
});

describe("countIgnoredFields", () => {
    it("统计草稿不支持字段的出现次数（有值才计）", () => {
        const questions: StructuredQuestion[] = [
            { text: "a", subject: "数学" },
            { text: "b", subject: "数学", source: "2025 期中", images: [{ dataUrl: "data:image/png;base64,x" }] },
            { text: "c" },
        ];
        const counts = countIgnoredFields(questions);
        expect(counts).toEqual([
            { field: "subject", count: 2 },
            { field: "source", count: 1 },
            { field: "images", count: 1 },
        ]);
    });

    it("空数组与全空字段返回空统计", () => {
        expect(countIgnoredFields([])).toEqual([]);
        expect(countIgnoredFields([{ text: "a", subject: "" }])).toEqual([]);
    });
});

describe("structuredQuestionsToItems", () => {
    it("批量映射，忽略字段不进入 items", () => {
        const questions: StructuredQuestion[] = [
            { text: "a", subject: "数学", extensions: { x: 1 } },
            { text: "b" },
        ];
        const items = structuredQuestionsToItems(questions);
        expect(items).toHaveLength(2);
        expect(items[0]).not.toHaveProperty("subject");
        expect(items[0]).not.toHaveProperty("extensions");
    });
});
