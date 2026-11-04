import { describe, expect, it } from "vitest";
import { BACKUP_VERSION, parseBackupFile } from "@/lib/backup/format";

describe("parseBackupFile", () => {
    it("接受合法的最小 v1 备份文件", () => {
        const minimal = {
            version: 1,
            exportedAt: "2024-01-01T00:00:00.000Z",
            user: { id: "u1", email: "a@example.com", name: null },
            errorItems: [],
        };
        const result = parseBackupFile(minimal);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.version).toBe(1);
            expect(result.data.user.email).toBe("a@example.com");
            expect(result.data.errorItems).toEqual([]);
        }
    });

    it("接受当前版本的完整备份文件", () => {
        const full = {
            version: BACKUP_VERSION,
            exportedAt: "2026-11-04T00:00:00.000Z",
            scope: "user",
            user: {
                id: "u1",
                email: "a@example.com",
                name: "张三",
                educationStage: "middle",
                enrollmentYear: 2024,
                gradeRecognitionMode: "auto",
                fixedGradeSemester: null,
                role: "user",
                confirmBeforeImport: true,
                questionDuplicateThreshold: 80,
                masteryThreshold: 80,
                enableGeogebra: false,
                enableSvgAnimation: true,
                themePreference: "system",
            },
            subjects: [],
            systemTags: [],
            customTags: [],
            errorItems: [],
            reviewSchedules: [],
            practiceRecords: [],
            examPapers: [],
            paperGroups: [],
            ttsSpeeches: {},
            importTasks: [],
            importBatches: [],
            extensions: {},
        };
        const result = parseBackupFile(full);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.version).toBe(BACKUP_VERSION);
        }
    });

    it("拒绝缺少 user 的文件", () => {
        const result = parseBackupFile({ version: 1, errorItems: [] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBeTruthy();
        }
    });

    it("拒绝 errorItems 不是数组的文件", () => {
        const result = parseBackupFile({
            version: 1,
            user: { id: "u1", email: "a@example.com" },
            errorItems: {},
        });
        expect(result.success).toBe(false);
    });

    it("保留未知顶层字段", () => {
        const withUnknown = {
            version: 1,
            user: { id: "u1", email: "a@example.com" },
            errorItems: [],
            futureField: { foo: "bar" },
        };
        const result = parseBackupFile(withUnknown);
        expect(result.success).toBe(true);
        if (result.success) {
            expect((result.data as Record<string, unknown>).futureField).toEqual({ foo: "bar" });
        }
    });
});
