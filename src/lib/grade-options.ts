/** 年级学期统一用中文保存，界面按当前语言显示。 */
export const GRADE_NAMES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三', '大一', '大二', '大三', '大四'] as const;

export const GRADE_SEMESTERS = GRADE_NAMES.flatMap((grade) => [`${grade}上`, `${grade}下`]);

/** 各教育阶段对应的年级名列表（索引区间，与 GRADE_NAMES 对齐） */
export const STAGE_GRADE_RANGES: Record<string, { start: number; end: number }> = {
    primary: { start: 0, end: 6 },
    junior_high: { start: 6, end: 9 },
    senior_high: { start: 9, end: 12 },
    university: { start: 12, end: 16 },
};

/** 某学段下的全部年级名 */
export function gradesForStage(educationStage: string): string[] {
    const range = STAGE_GRADE_RANGES[educationStage];
    if (!range) return [];
    return GRADE_NAMES.slice(range.start, range.end);
}

/** 从年级学期值（如「四年级上」「初一下」）解析出年级名和学期 */
export function parseGradeSemester(value: string): { grade: string; semester: '上' | '下' } | null {
    if (value.endsWith('上')) return { grade: value.slice(0, -1), semester: '上' };
    if (value.endsWith('下')) return { grade: value.slice(0, -1), semester: '下' };
    return null;
}
