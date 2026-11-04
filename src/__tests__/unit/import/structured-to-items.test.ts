import { describe, expect, it } from "vitest";
import {
    countIgnoredFields,
    structuredQuestionToItem,
    structuredQuestionsToItems,
    structuredQuestionsToItemsAsync,
} from "@/lib/import/structured-to-items";
import type { ImageRenderer, SourceImage } from "@/lib/import/question-images";
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
        ]);
    });

    it("空数组与全空字段返回空统计", () => {
        expect(countIgnoredFields([])).toEqual([]);
        expect(countIgnoredFields([{ text: "a", subject: "" }])).toEqual([]);
    });

    it("images 不再计入未导入字段", () => {
        const questions: StructuredQuestion[] = [
            { text: "a", images: [{ dataUrl: "data:image/png;base64,x" }] },
        ];
        const counts = countIgnoredFields(questions);
        // images 已从 IGNORED_FIELDS 中移除，不会出现在统计中
        expect(counts).toEqual([]);
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

describe("structuredQuestionsToItemsAsync", () => {
    const fakeRenderer: ImageRenderer = {
        async renderComposite(images: SourceImage[], layout) {
            return `composite:${layout.canvasWidth}x${layout.canvasHeight}:${images.length}`;
        },
        async renderSingle(image: SourceImage) {
            return `single:${image.width}x${image.height}`;
        },
    };
    const fakeDecode = async (dataUrl: string): Promise<SourceImage> => ({
        source: {} as CanvasImageSource,
        width: dataUrl.length * 2,
        height: dataUrl.length,
    });

    it("无 images 的题不调用 renderer，image 为 undefined", async () => {
        const questions: StructuredQuestion[] = [{ text: "a" }, { text: "b" }];
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: fakeDecode,
        });
        expect(items).toHaveLength(2);
        expect(items[0].image).toBeUndefined();
        expect(items[1].image).toBeUndefined();
    });

    it("有 images 的题合成 image", async () => {
        const questions: StructuredQuestion[] = [
            { text: "a", images: [{ dataUrl: "data:image/png;base64,AAA" }] },
        ];
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: fakeDecode,
        });
        expect(items[0].image).toMatch(/^single:/);
    });

    it("多图合成 composite", async () => {
        const questions: StructuredQuestion[] = [
            {
                text: "a",
                images: [
                    { dataUrl: "data:image/png;base64,AAA" },
                    { dataUrl: "data:image/png;base64,BBB" },
                ],
            },
        ];
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: fakeDecode,
        });
        expect(items[0].image).toMatch(/^composite:/);
    });

    it("通过 onProgress 报告进度", async () => {
        const questions: StructuredQuestion[] = [{ text: "a" }, { text: "b" }, { text: "c" }];
        const progress: Array<[number, number]> = [];
        await structuredQuestionsToItemsAsync(questions, {
            onProgress: (done, total) => progress.push([done, total]),
        });
        expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    });

    it("图片合成失败不阻断该题", async () => {
        const questions: StructuredQuestion[] = [
            { text: "a", images: [{ dataUrl: "bad" }] },
        ];
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: async () => { throw new Error("decode failed"); },
        });
        expect(items[0].text).toBe("a");
        expect(items[0].image).toBeNull();
    });
});
