"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { getCalendarDate } from "@/lib/date-time";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";
import { frontendLogger } from "@/lib/frontend-logger";

interface TagTreeNode {
    id: string;
    name: string;
    code: string | null;
    isSystem: boolean;
    children: TagTreeNode[];
}

interface KnowledgeFilterProps {
    gradeSemester?: string;
    tag?: string | null;
    subjectName?: string;
    tagSet?: string;
    onFilterChange: (filters: {
        gradeSemester?: string;
        chapter?: string;
        tag?: string;
    }) => void;
    className?: string;
}

// 年级编号到学期key的映射
// 注意：小学目前数据库中只存储了"一年级"这种粒度，没有分上下册，后续如果有变化需要更新这里
const GRADE_TO_SEMESTERS: Record<number, string[]> = {
    1: ['一年级'],
    2: ['二年级'],
    3: ['三年级'],
    4: ['四年级'],
    5: ['五年级'],
    6: ['六年级'],
    7: ['七年级上', '七年级下', '七年级'], // 兼容可能存在的不同命名
    8: ['八年级上', '八年级下', '八年级'],
    9: ['九年级上', '九年级下', '九年级'],
    10: ['高一上', '高一下', '高一'],
    11: ['高二上', '高二下', '高二'],
    12: ['高三上', '高三下', '高三'],
};

export function KnowledgeFilter({
    gradeSemester: initialGrade,
    tag: initialTag,
    subjectName,
    tagSet = 'default',
    onFilterChange,
    className
}: KnowledgeFilterProps) {
    const { t } = useLanguage();
    const { timeZone } = useTimeZone();
    const [gradeSemester, setGradeSemester] = useState<string>(initialGrade || "");
    const [chapter, setChapter] = useState<string>("");
    const [tag, setTag] = useState<string>(initialTag || "");

    // 从数据库加载的标签树
    const [tagTree, setTagTree] = useState<TagTreeNode[]>([]);
    const [loading, setLoading] = useState(true);

    // 用户信息 (教育阶段和入学年份)

    // 可用的年级学期选项 (根据用户信息过滤)
    const [availableGrades, setAvailableGrades] = useState<string[]>([]);

    // Sync with props：在渲染时比较上一次的值，避免 effect 中多渲染一次
    const [prevInitialGrade, setPrevInitialGrade] = useState(initialGrade);
    if (initialGrade !== prevInitialGrade) {
        setPrevInitialGrade(initialGrade);
        if (initialGrade !== undefined) setGradeSemester(initialGrade);
    }

    const [prevInitialTag, setPrevInitialTag] = useState(initialTag);
    if (initialTag !== prevInitialTag) {
        setPrevInitialTag(initialTag);
        if (initialTag !== undefined) setTag(initialTag || "");
    }

    // 计算用户当前年级 (返回原始年级数值，不进行范围截断，以便判断由初升高等情况)
    const calculateCurrentGrade = useCallback((educationStage: string, enrollmentYear: number): number => {
        const now = getCalendarDate(new Date(), timeZone);
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12

        // 学年从9月开始
        const academicYear = currentMonth >= 9 ? currentYear : currentYear - 1;
        const yearsInSchool = academicYear - enrollmentYear + 1;

        if (educationStage === 'primary') {
            return yearsInSchool;
        } else if (educationStage === 'junior_high') {
            // 初中: 1年级=7, ...
            return yearsInSchool + 6;
        } else if (educationStage === 'senior_high') {
            // 高中: 1年级=10, ...
            return yearsInSchool + 9;
        }
        return 0;
    }, [timeZone]);

    // 根据用户信息生成可用年级列表
    const generateAvailableGrades = useCallback((educationStage?: string, enrollmentYear?: number): string[] => {
        let grades: number[] = [];

        // 默认: 显示所有年级
        if (!educationStage) {
            grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        } else if (educationStage === 'primary') {
            // 小学生: 显示小学全部
            grades = [1, 2, 3, 4, 5, 6];
        } else if (educationStage === 'junior_high') {
            // 初中生: 默认显示初中全部 (7-9)
            grades = [7, 8, 9];

            // 如果有入学年份，且推算年级已达到高中 (>=10)，则追加高中年级
            if (enrollmentYear) {
                const currentGrade = calculateCurrentGrade(educationStage, enrollmentYear);
                if (currentGrade >= 10) {
                    grades.push(10, 11, 12);
                }
            }
        } else if (educationStage === 'senior_high') {
            // 高中生: 仅显示高中全部
            grades = [10, 11, 12];
        } else {
            // 其他情况
            grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        }

        // 可以在这里根据 enrollmentYear 做进一步优化，比如高亮当前年级
        // 但目前先返回该阶段的所有年级

        return grades.flatMap(g => GRADE_TO_SEMESTERS[g] || []);
    }, [calculateCurrentGrade]);

    // 加载用户信息和标签树
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                // 1. 获取用户信息
                const user = await apiClient.get<{ educationStage?: string; enrollmentYear?: number }>('/api/user');

                // 2. 生成可用年级
                const grades = generateAvailableGrades(user.educationStage, user.enrollmentYear);
                setAvailableGrades(grades);

                // 3. 获取标签树 (所有科目)
                const subject = subjectName ? inferSubjectFromName(subjectName) : 'math';
                // 移除仅 math 的限制，尝试获取当前科目的标签
                try {
                    const data = await apiClient.get<{ tags: TagTreeNode[] }>(`/api/tags?subject=${subject}&tagSet=${encodeURIComponent(tagSet)}`);
                    setTagTree(data.tags);
                } catch (e) {
                    frontendLogger.warn('[KnowledgeFilter]', 'Failed to fetch tags for subject', { subject, tagSet, error: e });
                    setTagTree([]);
                }
            } catch (error) {
                frontendLogger.error('[KnowledgeFilter]', 'Failed to load filter data', { error });
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [subjectName, tagSet, generateAvailableGrades]);

    const handleGradeChange = (val: string) => {
        setGradeSemester(val);
        setChapter("");
        setTag("");
        onFilterChange({
            gradeSemester: val === "all" ? undefined : val,
            chapter: undefined,
            tag: undefined
        });
    };

    const handleChapterChange = (val: string) => {
        setChapter(val);
        setTag("");
        onFilterChange({
            gradeSemester: gradeSemester === "all" ? undefined : gradeSemester,
            chapter: val === "all" ? undefined : val,
            tag: undefined
        });
    };

    const handleTagChange = (val: string) => {
        setTag(val);
        onFilterChange({
            gradeSemester: gradeSemester === "all" ? undefined : gradeSemester,
            chapter: chapter === "all" ? undefined : chapter,
            tag: val === "all" ? undefined : val
        });
    };

    // 从标签树中找到当前年级节点
    const currentGradeNode = tagTree.find(node => node.name === gradeSemester);
    const chapters = currentGradeNode?.children || [];

    // 从标签树中找到当前章节节点
    const currentChapterNode = chapters.find(node => node.name === chapter);

    // 递归获取所有叶子标签
    const getLeafTags = (node: TagTreeNode): string[] => {
        if (node.children.length === 0) return [node.name];
        return node.children.flatMap(child => getLeafTags(child));
    };
    // 去重标签，避免 React key 冲突
    const tags = currentChapterNode
        ? [...new Set(getLeafTags(currentChapterNode))]
        : [];

    // 过滤可用年级 (只显示数据库中存在的)
    // 对于非数学科目，如果不按照年级结构存储，这里可能会被清空
    // 我们检查 tagTree 的顶层节点是否包含 gradeSemester
    const filteredGrades = availableGrades.filter(g =>
        tagTree.some(node => node.name === g)
    );

    // 如果过滤后没有年级（可能是因为该科目标签结构不同，比如没有按年级分类），
    // 或者 tagTree 为空，我们至少应该显示 availableGrades 或者不显示
    // 但根据现在的 seed 脚本，所有科目都是按年级分类的，所以应该没问题。

    return (
        <div className={`flex gap-2 ${className}`}>
            <Select value={gradeSemester} onValueChange={handleGradeChange} disabled={loading}>
                <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t.filter?.gradeShort || "Grade"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{t.filter?.allGrades || "All grades"}</SelectItem>
                    {filteredGrades.map(gs => (
                        <SelectItem key={gs} value={gs}>{gs}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select value={chapter} onValueChange={handleChapterChange} disabled={!gradeSemester || gradeSemester === "all"}>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t.filter?.chapter || "Chapter"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{t.filter?.allChapters || "All chapters"}</SelectItem>
                    {chapters.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                            {c.name.replace(/^第\d+章\s*/, '')}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select value={tag} onValueChange={handleTagChange} disabled={!chapter || chapter === "all"}>
                <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder={t.filter?.knowledgePoint || "Tag"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{t.filter?.allKnowledgePoints || "All tags"}</SelectItem>
                    {tags.map(tagName => (
                        <SelectItem key={tagName} value={tagName}>{tagName}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
