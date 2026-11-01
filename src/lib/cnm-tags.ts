/**
 * 人教版课标知识点（cn-math-taxonomy）导入
 *
 * 数据来自 https://github.com/xiaoyang111222/cn-math-taxonomy 的 data/topics.json，
 * 作为 tagSet = "cnm" 的系统标签体系，与内置体系并存。
 * 按「年级节点 → 章节 → 知识点」三层导入；已存在的节点跳过，不删除、不修改已有标签与题目关联，可重复执行。
 */
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const CNM_TAG_SET = "cnm";
export const CNM_REPO_URL = "https://github.com/xiaoyang111222/cn-math-taxonomy";
export const CNM_TOPICS_URL = "https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json";
/** 上传文件大小上限（官方文件约 2.6MB） */
export const CNM_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 数据中的学科映射到本项目学科；未列出的学科（如小学科学）跳过 */
const SUBJECT_MAP: Record<string, string> = {
    math: "math",
    chinese: "chinese",
    english: "english",
    physics: "physics",
    history: "history",
    geography: "geography",
    morality: "politics", // 道德与法治
};

const topicSchema = z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1),
    subject: z.string().nullish(),
    grade: z.number().int(),
    semester: z.string().nullish(),
    chapter: z.string().nullish(),
}).passthrough();

export const cnmTopicsSchema = z.array(topicSchema).min(1);
export type CnmTopic = z.infer<typeof topicSchema>;

const PRIMARY_JUNIOR_GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "七年级", "八年级", "九年级"];

function semesterSuffix(semester: string | null | undefined): string {
    return semester === "上" || semester === "下" ? semester : "";
}

/**
 * 年级节点名称，与内置体系保持同一命名，学段筛选才能识别（见 notebook-scope 的 STAGE_GRADE_PATTERNS）：
 * 1～9 为「七年级上」等；高中数据的 grade 表示教材册次，用册名命名为「高中 选必二」，
 * 数学的高一、高二册直接用「高一」「高二」。
 */
export function cnmGradeNodeName(topic: Pick<CnmTopic, "grade" | "semester" | "chapter">): string | null {
    if (topic.grade >= 1 && topic.grade <= 9) {
        return `${PRIMARY_JUNIOR_GRADES[topic.grade - 1]}${semesterSuffix(topic.semester)}`;
    }
    if (topic.grade >= 10) {
        const volume = (topic.chapter || "").trim().split(/\s+/)[0];
        if (!volume) return null;
        return /^高[一二三]$/.test(volume) ? volume : `高中 ${volume}`;
    }
    return null;
}

/** 旧版导入脚本使用的年级节点名称，重新导入时改为新名称 */
function legacyGradeNodeName(topic: Pick<CnmTopic, "grade" | "semester">): string {
    const names = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"];
    if (topic.grade < 1 || topic.grade > 12) return `未知${topic.grade}`;
    return `${names[topic.grade - 1]}${topic.semester === "下" ? "下" : "上"}`;
}

/** 年级节点排序：按年级与学期，高中按册次 */
function gradeNodeOrder(topic: Pick<CnmTopic, "grade" | "semester">): number {
    const semesterOrder = topic.semester === "下" ? 2 : topic.semester === "上" ? 1 : 0;
    return topic.grade * 10 + semesterOrder;
}

export interface CnmImportResult {
    total: number;
    created: number;
    skipped: number;
    ignored: number;
}

export interface CnmStatus {
    tagSet: string;
    knowledgePoints: number;
    subjects: Record<string, number>;
}

type TagClient = Pick<PrismaClient, "knowledgeTag">;

interface Group {
    subject: string;
    gradeName: string;
    legacyGradeName: string;
    gradeOrder: number;
    chapter: string;
    chapterOrder: number;
    topics: CnmTopic[];
}

function groupTopics(topics: CnmTopic[]): { groups: Group[]; ignored: number } {
    const groups = new Map<string, Group>();
    let ignored = 0;
    for (const topic of topics) {
        const subject = SUBJECT_MAP[topic.subject || "math"];
        const gradeName = cnmGradeNodeName(topic);
        if (!subject || !gradeName) {
            ignored++;
            continue;
        }
        const chapter = topic.chapter?.trim() || "未分章";
        const key = `${subject}||${gradeName}||${chapter}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                subject,
                gradeName,
                legacyGradeName: legacyGradeNodeName(topic),
                gradeOrder: gradeNodeOrder(topic),
                chapter,
                chapterOrder: groups.size + 1,
                topics: [],
            };
            groups.set(key, group);
        }
        group.topics.push(topic);
    }
    return { groups: Array.from(groups.values()), ignored };
}

/** 导入课标知识点，返回新建与跳过的知识点数量 */
export async function importCnmTopics(client: TagClient, topics: CnmTopic[]): Promise<CnmImportResult> {
    const { groups, ignored } = groupTopics(topics);

    // 预先读出已有节点，避免逐条查询
    const existing = await client.knowledgeTag.findMany({
        where: { tagSet: CNM_TAG_SET, isSystem: true },
        select: { id: true, name: true, subject: true, parentId: true },
    });
    const nodeKey = (subject: string, parentId: string | null, name: string) => `${subject}|${parentId ?? ""}|${name}`;
    const nodes = new Map(existing.map((tag) => [nodeKey(tag.subject, tag.parentId, tag.name), tag.id]));

    const ensureNode = async (subject: string, parentId: string | null, name: string, order: number, legacyName?: string) => {
        const id = nodes.get(nodeKey(subject, parentId, name));
        if (id) return id;
        const legacyId = legacyName && legacyName !== name ? nodes.get(nodeKey(subject, parentId, legacyName)) : undefined;
        if (legacyId) {
            await client.knowledgeTag.update({ where: { id: legacyId }, data: { name, order } });
            nodes.delete(nodeKey(subject, parentId, legacyName!));
            nodes.set(nodeKey(subject, parentId, name), legacyId);
            return legacyId;
        }
        const created = await client.knowledgeTag.create({
            data: { name, subject, parentId, isSystem: true, tagSet: CNM_TAG_SET, order },
            select: { id: true },
        });
        nodes.set(nodeKey(subject, parentId, name), created.id);
        return created.id;
    };

    let created = 0;
    let skipped = 0;
    for (const group of groups) {
        const gradeId = await ensureNode(group.subject, null, group.gradeName, group.gradeOrder, group.legacyGradeName);
        const chapterId = await ensureNode(group.subject, gradeId, group.chapter, group.chapterOrder);

        const seen = new Set<string>();
        const data = [];
        for (const [index, topic] of group.topics.entries()) {
            if (seen.has(topic.name) || nodes.has(nodeKey(group.subject, chapterId, topic.name))) {
                skipped++;
                continue;
            }
            seen.add(topic.name);
            data.push({
                name: topic.name,
                subject: group.subject,
                parentId: chapterId,
                isSystem: true,
                tagSet: CNM_TAG_SET,
                order: index + 1,
                code: topic.id ?? null,
            });
        }
        if (data.length > 0) {
            await client.knowledgeTag.createMany({ data });
            created += data.length;
        }
    }

    return { total: topics.length, created, skipped, ignored };
}

/** 已导入的课标知识点数量（只统计叶子知识点，按学科分组） */
export async function getCnmStatus(client: TagClient): Promise<CnmStatus> {
    const rows = await client.knowledgeTag.groupBy({
        by: ["subject"],
        where: { tagSet: CNM_TAG_SET, isSystem: true, code: { not: null } },
        _count: { _all: true },
    });
    const subjects = Object.fromEntries(rows.map((row) => [row.subject, row._count._all]));
    const knowledgePoints = rows.reduce((sum, row) => sum + row._count._all, 0);
    return { tagSet: CNM_TAG_SET, knowledgePoints, subjects };
}
