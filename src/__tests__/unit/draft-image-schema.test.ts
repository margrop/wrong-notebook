import { describe, expect, it } from "vitest";
import { batchDraftSchema, draftItemSchema, MAX_DRAFT_IMAGE_LENGTH } from "@/lib/question-split/draft";

describe("draftItemSchema image 字段", () => {
    it("合法图片 data URL 通过校验", () => {
        const item = {
            key: "q1",
            label: null,
            text: "题干",
            material: null,
            section: null,
            selected: true,
            regions: [],
            hasFigure: false,
            flags: [],
            image: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==",
        };
        const parsed = draftItemSchema.safeParse(item);
        expect(parsed.success).toBe(true);
    });

    it("旧草稿无 image 字段照常工作", () => {
        const item = {
            key: "q1",
            label: null,
            text: "题干",
            material: null,
            section: null,
            selected: true,
            regions: [],
            hasFigure: false,
            flags: [],
        };
        const parsed = draftItemSchema.safeParse(item);
        expect(parsed.success).toBe(true);
        expect(parsed.data?.image).toBeUndefined();
    });

    it("image 为 null 通过校验", () => {
        const item = {
            key: "q1",
            label: null,
            text: "题干",
            material: null,
            section: null,
            selected: true,
            regions: [],
            hasFigure: false,
            flags: [],
            image: null,
        };
        const parsed = draftItemSchema.safeParse(item);
        expect(parsed.success).toBe(true);
    });

    it("格式不对返回 DRAFT_IMAGE_INVALID", () => {
        const item = {
            key: "q1",
            label: null,
            text: "题干",
            material: null,
            section: null,
            selected: true,
            regions: [],
            hasFigure: false,
            flags: [],
            image: "data:text/plain;base64,hello",
        };
        const parsed = draftItemSchema.safeParse(item);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues[0]?.message).toBe("DRAFT_IMAGE_INVALID");
        }
    });

    it("超限返回 DRAFT_IMAGE_TOO_LARGE", () => {
        const bigImage = `data:image/png;base64,${"A".repeat(MAX_DRAFT_IMAGE_LENGTH)}`;
        const item = {
            key: "q1",
            label: null,
            text: "题干",
            material: null,
            section: null,
            selected: true,
            regions: [],
            hasFigure: false,
            flags: [],
            image: bigImage,
        };
        const parsed = draftItemSchema.safeParse(item);
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            expect(parsed.error.issues[0]?.message).toBe("DRAFT_IMAGE_TOO_LARGE");
        }
    });
});

describe("batchDraftSchema 兼容旧草稿", () => {
    it("无 image 字段的旧草稿通过校验", () => {
        const draft = {
            items: [
                {
                    key: "q1",
                    label: null,
                    text: "题干一",
                    material: null,
                    section: null,
                    selected: true,
                    regions: [],
                    hasFigure: false,
                    flags: [],
                },
                {
                    key: "q2",
                    label: null,
                    text: "题干二",
                    material: null,
                    section: null,
                    selected: true,
                    regions: [],
                    hasFigure: false,
                    flags: [],
                },
            ],
            ignored: [],
            warnings: [],
        };
        const parsed = batchDraftSchema.safeParse(draft);
        expect(parsed.success).toBe(true);
    });

    it("带 image 字段的新草稿通过校验", () => {
        const draft = {
            items: [
                {
                    key: "q1",
                    label: null,
                    text: "题干",
                    material: null,
                    section: null,
                    selected: true,
                    regions: [],
                    hasFigure: false,
                    flags: [],
                    image: "data:image/png;base64,iVBORw0KGgo=",
                },
            ],
            ignored: [],
            warnings: [],
        };
        const parsed = batchDraftSchema.safeParse(draft);
        expect(parsed.success).toBe(true);
    });
});
