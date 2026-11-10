// 标签树节点类型
export interface TagTreeNode {
    id: string;
    name: string;
    code: string | null;
    isSystem: boolean;
    children: TagTreeNode[];
}

// 学科配置
export const SUBJECTS = [
    { key: 'math', name: '数学' },
    { key: 'english', name: '英语' },
    { key: 'science', name: '科学' },
    { key: 'physics', name: '物理' },
    { key: 'chemistry', name: '化学' },
    { key: 'biology', name: '生物' },
    { key: 'chinese', name: '语文' },
    { key: 'history', name: '历史' },
    { key: 'geography', name: '地理' },
    { key: 'politics', name: '政治' },
] as const;

export type SubjectKey = typeof SUBJECTS[number]['key'];

/** 取学科的界面名称，缺省时回退到内置中文名 */
export function getSubjectName(subjects: unknown, key: SubjectKey, fallback: string): string {
    return (subjects as Record<string, string | undefined> | undefined)?.[key] || fallback;
}
