import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, parseBackupFile } from "@/lib/backup/format";
import type { ImportableBackupFile } from "@/lib/backup/format";
import {
    mapSubjectIds,
    normalizeBackupForImport,
    parsePreferences,
    safeLastPractice,
    safeMasteryLevel,
    safeMasteryProbability,
    safeParseDate,
} from "@/lib/backup/import-parser";

function buildMinimal(version: number, overrides: Record<string, unknown> = {}) {
    return {
        version,
        exportedAt: "2024-01-01T00:00:00.000Z",
        user: { id: "u1", email: "a@example.com", name: null, role: "user" },
        errorItems: [],
        ...overrides,
    };
}

function asImportable(raw: unknown): ImportableBackupFile {
    const parsed = parseBackupFile(raw);
    if (!parsed.success) throw new Error(parsed.error);
    return parsed.data;
}

describe("safe* 工具函数", () => {
    it("safeParseDate 只接受合法日期", () => {
        expect(safeParseDate("2024-01-01T00:00:00.000Z")).toEqual(new Date("2024-01-01T00:00:00.000Z"));
        expect(safeParseDate("not-a-date")).toBeUndefined();
        expect(safeParseDate(null)).toBeUndefined();
        expect(safeParseDate(undefined)).toBeUndefined();
    });

    it("safeMasteryProbability 限定 [0,1]", () => {
        expect(safeMasteryProbability(0.5)).toBe(0.5);
        expect(safeMasteryProbability(0)).toBe(0);
        expect(safeMasteryProbability(1)).toBe(1);
        expect(safeMasteryProbability(1.5)).toBeNull();
        expect(safeMasteryProbability(-0.1)).toBeNull();
        expect(safeMasteryProbability("0.5")).toBeNull();
        expect(safeMasteryProbability(NaN)).toBeNull();
    });

    it("safeMasteryLevel 限定 [0,2] 的整数", () => {
        expect(safeMasteryLevel(0)).toBe(0);
        expect(safeMasteryLevel(2)).toBe(2);
        expect(safeMasteryLevel(3)).toBe(0);
        expect(safeMasteryLevel(-1)).toBe(0);
        expect(safeMasteryLevel("1")).toBe(1);
        expect(safeMasteryLevel("abc")).toBe(0);
    });

    it("safeLastPractice 只保留可解析的暂存内容", () => {
        expect(safeLastPractice(null)).toBeNull();
        expect(safeLastPractice("not-json")).toBeNull();
    });

    it("mapSubjectIds 替换为新 ID 并丢弃未知 ID", () => {
        const map = new Map([["s1", "n1"]]);
        expect(mapSubjectIds('["s1","s2"]', map)).toBe('["n1"]');
        expect(mapSubjectIds(null, map)).toBe("[]");
        expect(mapSubjectIds("bad", map)).toBe("[]");
    });
});

describe("parsePreferences", () => {
    it("逐项校验，非法项跳过", () => {
        const prefs = parsePreferences({
            id: "u1",
            email: "a@example.com",
            name: null,
            educationStage: null,
            enrollmentYear: null,
            role: "user",
            gradeRecognitionMode: "ai",
            fixedGradeSemester: null,
            confirmBeforeImport: true,
            questionDuplicateThreshold: 80,
            masteryThreshold: 80,
            enableGeogebra: false,
            enableSvgAnimation: true,
            themePreference: "system",
        } as ImportableBackupFile["user"]);
        expect(prefs).toEqual({
            gradeRecognitionMode: "ai",
            fixedGradeSemester: null,
            confirmBeforeImport: true,
            questionDuplicateThreshold: 80,
            masteryThreshold: 80,
            enableGeogebra: false,
            enableSvgAnimation: true,
            themePreference: "system",
        });
    });

    it("不合法的单项被跳过", () => {
        const prefs = parsePreferences({
            id: "u1",
            email: "a@example.com",
            name: null,
            educationStage: null,
            enrollmentYear: null,
            role: "user",
            gradeRecognitionMode: "bogus",
            masteryThreshold: 1000,
            themePreference: "dark",
        } as ImportableBackupFile["user"]);
        expect(prefs).toEqual({ themePreference: "dark" });
    });
});

describe("normalizeBackupForImport", () => {
    it("v1 最小备份：字段补默认值，空数组归一", () => {
        const data = asImportable(buildMinimal(1));
        const result = normalizeBackupForImport(data, true);
        expect(result.subjects).toEqual([]);
        expect(result.systemTags).toEqual([]);
        expect(result.customTags).toEqual([]);
        expect(result.reviewSchedules).toEqual([]);
        expect(result.practiceRecords).toEqual([]);
        expect(result.examPapers).toEqual([]);
        expect(result.paperGroups).toEqual([]);
        expect(result.hasPreferences).toBe(false);
    });

    it("v3 备份：系统标签与卷别分组透传", () => {
        const data = asImportable(buildMinimal(3, {
            systemTags: [{
                id: "t1", name: "数与代数", subject: "math", parentId: null,
                order: 1, code: null, isSystem: true, tagSet: "default",
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
            }],
            paperGroups: [{
                id: "g1", userId: "u1", key: "a", name: "A卷",
                order: 0, isActive: true,
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
            }],
        }));
        const result = normalizeBackupForImport(data, true);
        expect(result.systemTags).toHaveLength(1);
        expect(result.paperGroups).toHaveLength(1);
    });

    it("v6 备份：导入批次字段透传，偏好设置解析", () => {
        const data = asImportable(buildMinimal(6, {
            importBatches: [{ id: "b1" }],
            importTasks: [{ id: "t1" }],
            user: {
                id: "u1", email: "a@example.com", name: null, role: "user",
                confirmBeforeImport: false, themePreference: "light",
            },
        }));
        const result = normalizeBackupForImport(data, true);
        expect(result.data.importBatches).toEqual([{ id: "b1" }]);
        expect(result.hasPreferences).toBe(true);
        expect(result.preferences.confirmBeforeImport).toBe(false);
        expect(result.preferences.themePreference).toBe("light");
    });

    it("当前版本备份：错题字段规范化（日期/概率/数值）", () => {
        const data = asImportable(buildMinimal(BACKUP_VERSION, {
            subjects: [{
                id: "s1", name: "数学", userId: "u1",
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
            }],
            errorItems: [{
                id: "e1", userId: "u1", subjectId: "s1",
                originalImageUrl: "", ocrText: null, questionText: "q", answerText: null,
                analysis: null, wrongAnswerText: null, mistakeAnalysis: null,
                mistakeStatus: null, knowledgePoints: null, source: null, errorType: null,
                userNotes: null, masteryLevel: 1, gradeSemester: null, paperLevel: null,
                difficultyStars: 4, masteryProbability: 0.8, masteryEvaluatedAt: "2024-02-01T00:00:00.000Z",
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
                tags: [],
            }],
        }));
        const result = normalizeBackupForImport(data, true);
        expect(result.errorItems).toHaveLength(1);
        const item = result.errorItems[0];
        expect(item.masteryProbability).toBe(0.8);
        expect(item.masteryEvaluatedAt).toEqual(new Date("2024-02-01T00:00:00.000Z"));
        expect(item.masteryLevel).toBe(1);
        expect(item.difficultyStars).toBe(4);
        expect(item.createdAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
        expect(item.hasFigure).toBe(false);
        expect(item.figureSvg).toBeNull();
        expect(item.lastPractice).toBeNull();
    });

    it("错题缺 masteryEvaluatedAt 时评估时间为 undefined（写入时不成对保留）", () => {
        const data = asImportable(buildMinimal(BACKUP_VERSION, {
            errorItems: [{
                id: "e1", userId: "u1", subjectId: null,
                originalImageUrl: "", masteryLevel: 0,
                masteryProbability: 0.9, masteryEvaluatedAt: null,
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
                tags: [],
            }],
        }));
        const item = normalizeBackupForImport(data, true).errorItems[0];
        // 概率值本身保留；写入侧要求概率与评估时间成对，缺任一项则不写入
        expect(item.masteryProbability).toBe(0.9);
        expect(item.masteryEvaluatedAt).toBeUndefined();
    });

    it("非当前用户备份不解析偏好设置", () => {
        const data = asImportable(buildMinimal(BACKUP_VERSION, {
            user: {
                id: "u2", email: "b@example.com", name: null, role: "user",
                themePreference: "dark",
            },
        }));
        const result = normalizeBackupForImport(data, false);
        expect(result.hasPreferences).toBe(false);
        expect(result.preferences).toEqual({});
    });

    it("试卷：mode/difficulty/requestedCount 缺省值", () => {
        const data = asImportable(buildMinimal(BACKUP_VERSION, {
            examPapers: [{
                id: "p1", userId: "u1", title: "卷", status: "ready",
                scope: "all", difficulty: "medium", requestedCount: 0,
                subjectIds: "[]", tagNames: null, resultsRecordedAt: null,
                createdAt: "2024-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z",
                questions: [{ id: "q1", order: 0, errorItemId: null, sourceShortId: "", status: "ready" }],
            }],
        }));
        const paper = normalizeBackupForImport(data, true).examPapers[0];
        expect(paper.mode).toBe("generate");
        expect(paper.difficulty).toBe("medium");
        expect(paper.requestedCount).toBe(1);
        expect(paper.statuses).toEqual(["ready"]);
    });

    it("练习记录：source 缺省为 practice，非法 result 忽略", () => {
        const data = asImportable(buildMinimal(BACKUP_VERSION, {
            practiceRecords: [{
                id: "r1", userId: "u1", subject: null, difficulty: null,
                isCorrect: true, errorItemId: null, result: "bogus",
                createdAt: "2024-01-01T00:00:00.000Z",
            }],
        }));
        const record = normalizeBackupForImport(data, true).practiceRecords[0];
        expect(record.result).toBeUndefined();
        expect(record.source).toBe("practice");
    });
});
