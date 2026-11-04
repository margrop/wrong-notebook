import { describe, expect, it } from "vitest";
import {
    countIgnoredFields,
    limitQuestionImages,
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

describe("structuredQuestionsToItemsAsync：metafile（WMF/EMF）渲染", () => {
    const fakeRenderer: ImageRenderer = {
        async renderComposite(images: SourceImage[], layout) {
            return `composite:${layout.canvasWidth}x${layout.canvasHeight}:${images.length}`;
        },
        async renderSingle(image: SourceImage) {
            return `single:${image.width}x${image.height}`;
        },
    };

    /** 注入的假 metafile 渲染器：WMF 渲染为固定 SVG，光栅化为固定 PNG */
    const metafileDeps = {
        renderWmfSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
        rasterize: async () => "data:image/png;base64,METAFILEPNG",
    };

    // 本组用例专用的 decode：width = height = dataUrl.length
    const squareDecode = async (dataUrl: string): Promise<SourceImage> => ({
        source: {} as CanvasImageSource,
        width: dataUrl.length,
        height: dataUrl.length,
    });

    it("待渲染 WMF 图片先渲染为 PNG 再参与合成", async () => {
        const questions: StructuredQuestion[] = [
            {
                text: "a",
                images: [
                    { dataUrl: "data:image/wmf;base64,AAAA", alt: "metafile;200x100" },
                    { dataUrl: "data:image/wmf;base64,BBBB", alt: "metafile;300x150" },
                ],
            },
        ];
        const counts = { rendered: 0, failed: 0 };
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: squareDecode,
            metafileDeps,
            metafileCounts: counts,
        });
        // 两张 metafile 都渲染为 data:image/png;base64,METAFILEPNG（长 33），
        // 两张一起 composite：宽 33、高 33×2 + 16 = 82
        expect(items[0].image).toBe("composite:33x82:2");
        expect(counts).toEqual({ rendered: 2, failed: 0 });
    });

    it("EMF 待渲染图片本任务起不再渲染，剔除并计入 failed", async () => {
        const questions: StructuredQuestion[] = [
            {
                text: "a",
                images: [
                    { dataUrl: "data:image/emf;base64,BBBB", alt: "metafile;300x150" },
                    { dataUrl: "data:image/png;base64,AAAA" },
                ],
            },
        ];
        const counts = { rendered: 0, failed: 0 };
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: squareDecode,
            metafileDeps,
            metafileCounts: counts,
        });
        // EMF 渲染失败被剔除，普通 PNG 走 renderSingle 单图路径
        expect(items[0].image).toMatch(/^single:/);
        expect(counts).toEqual({ rendered: 0, failed: 1 });
    });

    it("metafile 渲染失败剔除并计入 failed，其余图片照常合成", async () => {
        const questions: StructuredQuestion[] = [
            {
                text: "a",
                images: [
                    { dataUrl: "data:image/wmf;base64,BADWMF" },
                    { dataUrl: "data:image/png;base64,AAAA" },
                ],
            },
        ];
        const counts = { rendered: 0, failed: 0 };
        const failingDeps = { ...metafileDeps, rasterize: async () => null };
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: squareDecode,
            metafileDeps: failingDeps,
            metafileCounts: counts,
        });
        expect(items[0].image).toMatch(/^single:/);
        expect(counts).toEqual({ rendered: 0, failed: 1 });
    });

    it("单题 metafile 超过 12 张只拼接前 12 张并计截断", async () => {
        // base64 主体长度取 4 的倍数，保证 atob 可解码
        const images = Array.from({ length: 14 }, (_, i) => ({
            dataUrl: `data:image/wmf;base64,${"AAAA".repeat(i + 1)}`,
            alt: "metafile;100x50",
        }));
        images.push({ dataUrl: "data:image/png;base64,QQ==", alt: "普通图" });
        const questions: StructuredQuestion[] = [{ text: "a", images }];
        const counts = { rendered: 0, failed: 0 };
        const truncated = { count: 0 };
        const items = await structuredQuestionsToItemsAsync(questions, {
            renderer: fakeRenderer,
            decodeFn: squareDecode,
            metafileDeps,
            metafileCounts: counts,
            metafileTruncated: truncated,
        });
        // 12 张 metafile（渲染后为 data:image/png;base64,METAFILEPNG，长 33，等宽 33）
        // + 1 张普通图 data:image/png;base64,QQ==（长 26，缩放宽 33 → 高 33）
        // composite 宽 33；高 12×33 + 33 + 13×16 = 625（普通图缩放高度取整为 29）
        expect(items[0].image).toBe("composite:33x621:13");
        expect(counts.rendered).toBe(12);
        expect(truncated.count).toBe(2);
    });

    it("limitQuestionImages：普通图片不受 metafile 上限限制", () => {
        const images = [
            ...Array.from({ length: 15 }, () => ({ dataUrl: "data:image/png;base64,AA" })),
            ...Array.from({ length: 13 }, () => ({ dataUrl: "data:image/wmf;base64,AA" })),
        ];
        const { images: kept, truncatedMetafiles } = limitQuestionImages(images);
        expect(kept).toHaveLength(15 + 12);
        expect(truncatedMetafiles).toBe(1);
    });
});
