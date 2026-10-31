/** 年级学期统一用中文保存，界面按当前语言显示。 */
export const GRADE_NAMES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三', '大一', '大二', '大三', '大四'] as const;

export const GRADE_SEMESTERS = GRADE_NAMES.flatMap((grade) => [`${grade}上`, `${grade}下`]);
