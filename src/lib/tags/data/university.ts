/**
 * 大学学段的年级根节点。
 *
 * 大学没有内置课程知识点：只建「大一 ~ 大四」四个年级根节点，知识点由 AI 在错题本内
 * 自由生成后挂在对应年级下（见 src/lib/tags/retag.ts 与 src/lib/ai/prompts）。
 *
 * 本文件不导入任何模块：Docker 与安装包构建时用 tsc 单独编译种子脚本，不读取路径别名。
 */

/** 大学年级节点名，与 src/lib/grade-options.ts 的 GRADE_NAMES 尾部一致 */
export const UNIVERSITY_GRADES = ['大一', '大二', '大三', '大四'] as const;

/** 可创建大学错题本的学科，与 NOTEBOOK_SUBJECTS 一致（单测保证不漂移） */
export const UNIVERSITY_SUBJECTS = [
    'math', 'english', 'chinese', 'science', 'physics', 'chemistry', 'biology', 'history', 'geography', 'politics',
] as const;