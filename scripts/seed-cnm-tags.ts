/**
 * cn-math-taxonomy 知识点导入脚本
 * 将 https://github.com/xiaoyang111222/cn-math-taxonomy 的 topics.json 导入到 KnowledgeTag 表
 * 作为 tagSet = "cnm" 的备选标签体系，与现有 default 体系并存。
 *
 * 增量导入策略：已存在的节点跳过，只创建新增的；不删除已有数据，不影响已有错题的标签关联。
 * 可安全重复执行。
 *
 * 使用方法：
 *   1. 下载数据文件（约 2.6MB）：
 *      mkdir -p scripts/data
 *      gh api repos/xiaoyang111222/cn-math-taxonomy/contents/data/topics.json \
 *        -H "Accept: application/vnd.github.raw+json" > scripts/data/cn-math-taxonomy-topics.json
 *      # 或直接使用 curl：
 *      # curl -L -o scripts/data/cn-math-taxonomy-topics.json \
 *      #   https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json
 *
 *   2. 执行导入：
 *      DATABASE_URL="file:./dev.db" npx tsx scripts/seed-cnm-tags.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const TAG_SET = 'cnm';

// cn-math-taxonomy 的 subject 字段值映射到本项目学科 key
const SUBJECT_MAP: Record<string, string> = {
    math: 'math',
    chinese: 'chinese',
    english: 'english',
    physics: 'physics',
    science: 'biology',    // 科学并入生物（最接近的学科）
    history: 'history',
    geography: 'geography',
};

// 本项目不支持的学科（跳过）
const SKIP_SUBJECTS = new Set(['politics']);

// grade 数字 + semester 映射到中文年级学期名称
function gradeSemesterToChinese(grade: number, semester: string): string {
    const gradeNames = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
        '初一', '初二', '初三', '高一', '高二', '高三'];
    if (grade < 1 || grade > 12) return `未知${grade}`;
    const sem = semester === '下' ? '下' : '上';
    return `${gradeNames[grade - 1]}${sem}`;
}

interface CnmTopic {
    id: string;
    name: string;
    domain?: string;
    grade?: number;
    semester?: string;
    chapter?: string;
    description?: string;
    subject?: string;
    type?: string;
    [key: string]: unknown;
}

async function main() {
    const filePath = path.join(__dirname, 'data', 'cn-math-taxonomy-topics.json');
    if (!fs.existsSync(filePath)) {
        console.error(`❌ 找不到文件: ${filePath}`);
        console.error('请先从 GitHub 下载 topics.json：');
        console.error('  curl -L -o scripts/data/cn-math-taxonomy-topics.json \\');
        console.error('    https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json');
        process.exit(1);
    }

    console.log('📖 读取 topics.json...');
    const topics: CnmTopic[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`  共 ${topics.length} 个知识点`);

    // 按学科 + 年级学期 + 章节 分组
    const groups = new Map<string, CnmTopic[]>();
    for (const topic of topics) {
        const subject = SUBJECT_MAP[topic.subject || 'math'] || 'math';
        if (SKIP_SUBJECTS.has(subject)) continue;
        const gradeSemester = gradeSemesterToChinese(topic.grade || 0, topic.semester || '上');
        const chapter = topic.chapter || '未分章';
        const key = `${subject}||${gradeSemester}||${chapter}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(topic);
    }

    let totalCreated = 0;
    let totalSkipped = 0;
    let gradeNodes = 0;
    let chapterNodes = 0;

    // 按学科 + 年级学期排序处理
    const sortedKeys = Array.from(groups.keys()).sort();
    const gradeNodeCache = new Map<string, string>(); // subject||gradeSemester -> id
    const chapterNodeCache = new Map<string, string>(); // subject||gradeSemester||chapter -> id

    for (const key of sortedKeys) {
        const topics2 = groups.get(key)!;
        const [subject, gradeSemester, chapter] = key.split('||');

        // 创建或复用年级节点
        const gradeKey = `${subject}||${gradeSemester}`;
        let gradeNodeId = gradeNodeCache.get(gradeKey);
        if (!gradeNodeId) {
            const existing = await prisma.knowledgeTag.findFirst({
                where: { subject, tagSet: TAG_SET, name: gradeSemester, parentId: null, isSystem: true }
            });
            if (existing) {
                gradeNodeId = existing.id;
            } else {
                const gradeNode = await prisma.knowledgeTag.create({
                    data: {
                        name: gradeSemester,
                        subject,
                        parentId: null,
                        isSystem: true,
                        tagSet: TAG_SET,
                        order: gradeNodes + 1,
                    },
                });
                gradeNodeId = gradeNode.id;
                gradeNodes++;
            }
            gradeNodeCache.set(gradeKey, gradeNodeId);
        }

        // 创建或复用章节节点
        const chapterKey = `${subject}||${gradeSemester}||${chapter}`;
        let chapterNodeId = chapterNodeCache.get(chapterKey);
        if (!chapterNodeId) {
            const existingChapter = await prisma.knowledgeTag.findFirst({
                where: { subject, tagSet: TAG_SET, name: chapter, parentId: gradeNodeId, isSystem: true }
            });
            if (existingChapter) {
                chapterNodeId = existingChapter.id;
            } else {
                const chapterNode = await prisma.knowledgeTag.create({
                    data: {
                        name: chapter,
                        subject,
                        parentId: gradeNodeId,
                        isSystem: true,
                        tagSet: TAG_SET,
                        order: chapterNodes + 1,
                    },
                });
                chapterNodeId = chapterNode.id;
                chapterNodes++;
            }
            chapterNodeCache.set(chapterKey, chapterNodeId);
        }

        // 创建知识点（已存在的跳过）
        for (let i = 0; i < topics2.length; i++) {
            const topic = topics2[i];
            const existing = await prisma.knowledgeTag.findFirst({
                where: {
                    subject,
                    tagSet: TAG_SET,
                    name: topic.name,
                    parentId: chapterNodeId,
                    isSystem: true,
                }
            });
            if (existing) {
                totalSkipped++;
                continue;
            }
            await prisma.knowledgeTag.create({
                data: {
                    name: topic.name,
                    subject,
                    parentId: chapterNodeId,
                    isSystem: true,
                    tagSet: TAG_SET,
                    order: i + 1,
                    code: topic.id,
                },
            });
            totalCreated++;
        }
    }

    console.log(`\n✅ 导入完成!`);
    console.log(`  年级节点: ${gradeNodes} (新建)`);
    console.log(`  章节节点: ${chapterNodes} (新建)`);
    console.log(`  知识点: ${totalCreated} 新建, ${totalSkipped} 已存在跳过`);
    console.log(`  标签体系: ${TAG_SET}`);
}

main()
    .catch((e) => {
        console.error('❌ 导入失败:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
