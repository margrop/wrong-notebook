
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function findParentTagIdForGrade(gradeSemester: string | null | undefined, subjectKey: string, client: Prisma.TransactionClient = prisma): Promise<string | null> {
    if (!gradeSemester || !subjectKey) return null;

    // Fetch all system root tags for the subject (which are typically Grades)
    // We filter by parentId: null to get only the top level (Grades)
    const rootTags = await client.knowledgeTag.findMany({
        where: {
            subject: subjectKey,
            isSystem: true,
            parentId: null
        },
        select: { id: true, name: true }
    });

    if (rootTags.length === 0) return null;

    const normalizedInput = gradeSemester.trim();

    // 1. Try Exact Match
    const exactMatch = rootTags.find(t => t.name === normalizedInput);
    if (exactMatch) return exactMatch.id;

    // 2. Try Mapped Match (Text Heuristics)
    // Convert input specifically to match the likely seed data format (e.g. "七年级上")
    // Input might be "初一，上期", "Grade 7, 1st Semester", etc.

    // Helper map for Chinese Grade names
    const gradeLevelMap: Record<string, string> = {
        "一年级": "一年级", "Grade 1": "一年级",
        "二年级": "二年级", "Grade 2": "二年级",
        "三年级": "三年级", "Grade 3": "三年级",
        "四年级": "四年级", "Grade 4": "四年级",
        "五年级": "五年级", "Grade 5": "五年级",
        "六年级": "六年级", "Grade 6": "六年级",
        "初一": "七年级", "Grade 7": "七年级", "七年级": "七年级",
        "初二": "八年级", "Grade 8": "八年级", "八年级": "八年级",
        "初三": "九年级", "Grade 9": "九年级", "九年级": "九年级",
        "高一": "高一", "Grade 10": "高一", "Senior 1": "高一",
        "高二": "高二", "Grade 11": "高二", "Senior 2": "高二",
        "高三": "高三", "Grade 12": "高三", "Senior 3": "高三",
    };

    // 先匹配较长的写法，否则 "Grade 12" 会先命中 "Grade 1" 被当成一年级
    let targetGradePrefix = "";
    const entries = Object.entries(gradeLevelMap).sort(([a], [b]) => b.length - a.length);
    for (const [key, value] of entries) {
        if (normalizedInput.includes(key)) {
            targetGradePrefix = value;
            break; // Found the grade level
        }
    }

    if (!targetGradePrefix) return null; // Couldn't identify grade level

    // Special case: "高三" in seed data often doesn't have semesters (based on previous check)
    // But let's check what root tags are available.

    // Determine Semester
    let targetSemester = "";
    if (normalizedInput.includes("上") || normalizedInput.includes("1st") || normalizedInput.includes("First")) {
        targetSemester = "上";
    } else if (normalizedInput.includes("下") || normalizedInput.includes("2nd") || normalizedInput.includes("Second")) {
        targetSemester = "下";
    }

    // Construct candidates
    // Candidate 1: Grade + Semester (e.g. "七年级上")
    // Candidate 2: Grade (e.g. "一年级", or "高三")

    const candidates = [];
    if (targetSemester) {
        candidates.push(`${targetGradePrefix}${targetSemester}`); // e.g. "七年级上"
    }
    candidates.push(targetGradePrefix); // e.g. "一年级", "高三"

    for (const candidate of candidates) {
        const match = rootTags.find(t => t.name === candidate);
        if (match) return match.id;
    }



    return null;
}
