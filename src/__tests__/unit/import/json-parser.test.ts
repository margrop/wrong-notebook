import { describe, expect, it } from "vitest";
import { parseJsonQuestionFile, ERROR_INVALID_JSON } from "@/lib/import/file-parsers/json";

function toBuffer(text: string): ArrayBuffer {
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe("parseJsonQuestionFile", () => {
    it("解析合法的题目交换格式文件", async () => {
        const data = {
            format: "wrong-notebook-questions",
            version: 1,
            questions: [
                { text: "1+1=？", answer: "2", analysis: "基础加法" },
                { text: "下列哪个正确？", questionType: "单选题" },
            ],
        };
        const result = await parseJsonQuestionFile(toBuffer(JSON.stringify(data)));
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].text).toBe("1+1=？");
        expect(result.questions[0].answer).toBe("2");
        expect(result.questions[1].questionType).toBe("单选题");
    });

    it("JSON 语法错误返回 INVALID_JSON（index 为 -1）", async () => {
        const result = await parseJsonQuestionFile(toBuffer("{ not valid json"));
        expect(result.questions).toEqual([]);
        expect(result.errors).toEqual([{ index: -1, reason: ERROR_INVALID_JSON }]);
    });

    it("v1 宽松规则：单题不合格不影响其余题目，并给出逐题错误", async () => {
        const data = {
            questions: [{ text: "" }, { text: "有效题", difficultyStars: 3 }],
        };
        const result = await parseJsonQuestionFile(toBuffer(JSON.stringify(data)));
        // 空题干题被跳过，另一题保留
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toBe("有效题");
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("缺少 questions 字段返回 QUESTIONS_REQUIRED", async () => {
        const result = await parseJsonQuestionFile(toBuffer(JSON.stringify({ format: "wrong-notebook-questions", version: 1 })));
        expect(result.questions).toEqual([]);
        expect(result.errors[0].reason).toBe("QUESTIONS_REQUIRED");
    });
});
