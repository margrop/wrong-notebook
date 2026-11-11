// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { KnowledgeTag } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    prisma: undefined as PrismaClient | undefined,
    scheduleMasteryEvaluation: vi.fn(),
    session: { user: { id: 'user-1', email: 'backup-test@example.com', role: 'user' }, expires: '2099-01-01' },
}));

vi.mock('@/lib/prisma', () => ({ get prisma() { return mocks.prisma; } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => mocks.session) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/mastery', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/mastery')>()),
    scheduleMasteryEvaluation: mocks.scheduleMasteryEvaluation,
}));

import { GET as EXPORT } from '@/app/api/export/route';
import { POST as IMPORT } from '@/app/api/import/route';
import { GET as LIST_BANKS, POST as IMPORT_BANK } from '@/app/api/question-banks/route';
import { selectBankQuestion } from '@/lib/question-bank/selection';
import { POST as GENERATE_PRACTICE } from '@/app/api/practice/generate/route';
import { sanitizeFigureSvg } from '@/lib/figure-svg';
import { embedNarration, sanitizeSvgAnimation } from '@/lib/svg-animation';
import { encodeMp3 } from '@/lib/tts/mp3';
import { seedChineseTags } from '@/lib/tags/seed';
import { BACKUP_EXTENSIONS } from '@/lib/backup-extensions';
import { MAX_BACKUP_IMPORT_BYTES } from '@/lib/backup/limits';
import type { BackupExtension } from '@/lib/backup-extensions';

let database: PrismaClient;
let directory: string;
const figure = sanitizeFigureSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')!;
const animation = (text: string) => sanitizeSvgAnimation(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="5">${text}<animate attributeName="opacity" from="0" to="1" dur="1s"/></text></svg>`)!;
const lastPractice = JSON.stringify({ questionText: '新题', answerText: '答案', analysis: '解析', figureSvg: figure, difficulty: 'medium', generatedAt: '2026-10-20T00:00:00.000Z' });

async function exportBackup() {
    const response = await EXPORT(new Request('http://localhost/api/export'));
    expect(response.status).toBe(200);
    return response.json();
}

async function importBackup(body: object, query = '') {
    const response = await IMPORT(new Request(`http://localhost/api/import${query}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    return response.json();
}

/** 清空当前用户的学习数据（保留账户），模拟换机后导入 */
async function clearUserData() {
    await database.examPaper.deleteMany({ where: { userId: 'user-1' } });
    await database.bankQuestion.deleteMany();
    await database.questionBank.deleteMany();
    await database.errorItem.deleteMany({ where: { userId: 'user-1' } });
    await database.subject.deleteMany({ where: { userId: 'user-1' } });
    await database.knowledgeTag.deleteMany({ where: { userId: 'user-1' } });
    await database.knowledgeTag.deleteMany({ where: { isSystem: true } });
    await database.practiceRecord.deleteMany({ where: { userId: 'user-1' } });
    await database.importTask.deleteMany({ where: { userId: 'user-1' } });
    await database.importBatch.deleteMany({ where: { userId: 'user-1' } });
    await database.reviewSchedule.deleteMany();
    await database.paperGroup.deleteMany({ where: { userId: 'user-1' } });
}

beforeAll(() => {
    // 所有真实读写和迁移均使用系统临时数据库，不接触开发或生产数据。
    directory = mkdtempSync(join(tmpdir(), 'wrong-notebook-backup-test-'));
    // 云端语音缓存同样写到临时目录
    process.env.CONFIG_DIR = join(directory, 'config');
    const url = `file:${join(directory, 'test.db')}`;
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
    });
    database = new PrismaClient({ datasources: { db: { url } } });
    mocks.prisma = database;
// 迁移通过子进程执行 Prisma CLI，CI 中与其他测试文件并行时较慢，留足时间
}, 120000);

beforeEach(async () => {
    mocks.scheduleMasteryEvaluation.mockClear();
    // 清理所有可能残留的数据（包括系统标签），确保每个测试从干净状态开始
    await database.reviewSchedule.deleteMany();
    await database.practiceRecord.deleteMany();
    await database.examPaper.deleteMany();
    await database.questionBank.deleteMany();
    await database.errorItem.deleteMany();
    await database.knowledgeTag.deleteMany();
    await database.subject.deleteMany();
    await database.user.deleteMany();
    await database.user.create({ data: { id: 'user-1', email: mocks.session.user.email, password: 'test-only' } });
    await database.subject.create({ data: { id: 'math', name: '数学', stage: 'junior_high', subjectKey: 'math', userId: 'user-1' } });
    await database.subject.create({ data: { id: 'math-cnm', name: '数学（课标）', stage: 'junior_high', subjectKey: 'math', tagSet: 'cn-math-taxonomy', userId: 'user-1' } });
    await database.knowledgeTag.create({ data: { id: 'tag-1', name: '自定义标签', subject: 'math', userId: 'user-1' } });
    await database.knowledgeTag.create({ data: { id: 'tag-2', name: '课标自定义', subject: 'math', tagSet: 'cn-math-taxonomy', userId: 'user-1' } });
    // 系统标签：default 和 cn-math-taxonomy 各一条同名，验证按 tagSet 区分
    await database.knowledgeTag.create({ data: { id: 'sys-default', name: '方程', subject: 'math', isSystem: true, tagSet: 'default' } });
    await database.knowledgeTag.create({ data: { id: 'sys-cnm', name: '方程', subject: 'math', isSystem: true, tagSet: 'cn-math-taxonomy' } });
    // 创建默认卷别分组，模拟真实数据结构
    await database.paperGroup.create({ data: { id: 'group-b', userId: 'user-1', key: 'b', name: 'B卷', order: 1 } });
    await database.errorItem.create({
        data: {
            id: 'item-1', shortId: 'AbC234', userId: 'user-1', subjectId: 'math', originalImageUrl: 'data:image/png;base64,dGVzdA==',
            questionText: '求解 x + 2 = 5', answerText: 'x = 3', analysis: '移项', wrongAnswerText: 'x = 7', mistakeAnalysis: '符号错误',
            mistakeStatus: 'wrong_attempt', source: '期中考试', errorType: '计算', userNotes: '注意符号', gradeSemester: '初二上',
            paperLevel: 'group-b', difficultyStars: 3, hasFigure: true, figureSvg: figure, figureScale: 65, figureAlign: 'left', answerSpacePx: 240,
            geogebraCommands: 'A=(0,0)\nB=(1,1)', svgAnimation: animation('中文'), svgAnimationEn: animation('English'), lastPractice,
            masteryLevel: 2, masteryProbability: 0.8, masteryReason: '连续答对', masterySource: 'ai', masteryEvaluatedAt: new Date('2026-10-21T00:00:00Z'),
            createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-21T00:00:00Z'),
            tags: { connect: [{ id: 'tag-1' }, { id: 'sys-default' }] },
        },
    });
    await database.errorItem.create({
        data: {
            id: 'item-2', shortId: 'XyZ789', userId: 'user-1', subjectId: 'math-cnm', originalImageUrl: 'data:image/png;base64,dGVzdA==',
            questionText: '求解 x + 3 = 7', answerText: 'x = 4', analysis: '移项',
            masteryLevel: 1,
            masteryProbability: 0.5, masteryEvaluatedAt: new Date('2026-10-22T00:00:00Z'),
            createdAt: new Date('2026-10-05T00:00:00Z'), updatedAt: new Date('2026-10-22T00:00:00Z'),
            tags: { connect: [{ id: 'tag-2' }, { id: 'sys-cnm' }] },
        },
    });
    await database.reviewSchedule.create({ data: { errorItemId: 'item-1', scheduledFor: new Date('2026-11-01T00:00:00Z') } });
    await database.practiceRecord.create({
        data: {
            userId: 'user-1', errorItemId: 'item-1', subject: 'math', difficulty: 'medium', isCorrect: true, result: 'correct',
            questionText: '变式题', answerText: 'x = 4', analysis: '同理', figureSvg: figure, source: 'practice',
            createdAt: new Date('2026-10-20T00:00:00Z'),
        },
    });
});

afterAll(async () => {
    delete process.env.CONFIG_DIR;
    await database?.$disconnect();
    if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('数据导出后再导入（真实 SQLite）', () => {
    it('完整语文课程备份往返保留同名章节的层级及题目关联，兼容乱序与重复导入', async () => {
        await seedChineseTags(database);
        const scope = { subject: 'chinese', isSystem: true, tagSet: 'default' };
        const before = await database.knowledgeTag.findMany({ where: scope });
        function hierarchy(tags: KnowledgeTag[]) {
            const byId = new Map(tags.map((tag) => [tag.id, tag]));
            const path = (tag: KnowledgeTag): string => {
                const parent = tag.parentId ? byId.get(tag.parentId) : undefined;
                return parent ? `${path(parent)}/${tag.name}` : tag.name;
            };
            return tags.map((tag) => `${tag.tagSet}:${tag.subject}:${path(tag)}:${tag.order}:${tag.code}`).sort();
        }
        const grade = before.find((tag) => tag.name === '四年级' && tag.parentId === null)!;
        const chapter = before.find((tag) => tag.name === '句子' && tag.parentId === grade.id)!;
        const leaf = before.find((tag) => tag.name === '修改病句' && tag.parentId === chapter.id)!;
        await database.subject.create({ data: { id: 'chinese', name: '小学语文', stage: 'primary', subjectKey: 'chinese', userId: 'user-1' } });
        await database.knowledgeTag.create({ data: { id: 'custom-chinese', name: '我的句式笔记', subject: 'chinese', parentId: chapter.id, userId: 'user-1' } });
        await database.errorItem.update({
            where: { id: 'item-1' },
            data: { subjectId: 'chinese', tags: { set: [{ id: leaf.id }, { id: 'custom-chinese' }] } },
        });
        const backup = await exportBackup();
        // 旧版或外部整理过的备份可能先列出子节点。
        backup.systemTags.reverse();
        await clearUserData();
        await importBackup(backup);

        const restored = await database.knowledgeTag.findMany({ where: scope });
        expect(hierarchy(restored)).toEqual(hierarchy(before));
        const newGrade = restored.find((tag) => tag.name === '四年级' && tag.parentId === null)!;
        const newChapter = restored.find((tag) => tag.name === '句子' && tag.parentId === newGrade.id)!;
        const newLeaf = restored.find((tag) => tag.name === '修改病句' && tag.parentId === newChapter.id)!;
        expect(await database.knowledgeTag.findFirstOrThrow({ where: { name: '我的句式笔记' } })).toMatchObject({ parentId: newChapter.id });
        const item = await database.errorItem.findFirstOrThrow({ where: { shortId: 'AbC234' }, include: { tags: true, subject: true } });
        expect(item.subject).toMatchObject({ stage: 'primary', subjectKey: 'chinese' });
        expect(item.tags.find((tag) => tag.isSystem)?.id).toBe(newLeaf.id);
        expect(item.tags.map((tag) => tag.name).sort()).toEqual(['修改病句', '我的句式笔记']);

        await importBackup(backup);
        expect(hierarchy(await database.knowledgeTag.findMany({ where: scope }))).toEqual(hierarchy(before));
        expect(await database.knowledgeTag.count({ where: { name: '我的句式笔记' } })).toBe(1);
    });

    it('导出文件使用第 15 版格式，包含 tagSet 字段、空的 extensions 与试卷 mode', async () => {
        const backup = await exportBackup();
        expect(backup.version).toBe(15);
        expect(backup.extensions).toEqual({});
        expect(backup.paperGroups).toContainEqual(expect.objectContaining({ id: 'group-b', key: 'b', name: 'B卷' }));
        expect(backup.systemTags).toBeDefined();
        expect(backup.subjects).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'math', tagSet: 'default' }),
                expect.objectContaining({ id: 'math-cnm', tagSet: 'cn-math-taxonomy' }),
            ])
        );
        expect(backup.systemTags).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'sys-default', tagSet: 'default' }),
                expect.objectContaining({ id: 'sys-cnm', tagSet: 'cn-math-taxonomy' }),
            ])
        );
        expect(backup.customTags).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'tag-1', tagSet: 'default' }),
                expect.objectContaining({ id: 'tag-2', tagSet: 'cn-math-taxonomy' }),
            ])
        );
    });

    it('真题库与题目随备份往返，按 ID 去重且不影响错题', async () => {
        await database.questionBank.create({
            data: {
                id: 'bank-1', userId: 'user-1', name: '小学数学题库', stage: 'primary', subjectKey: 'math',
                gradeRange: '[1,2,3,4,5,6]', source: 'cn-math-taxonomy', license: 'CC BY-NC 4.0', questionCount: 2,
                createdAt: new Date('2026-11-01T00:00:00Z'),
                questions: {
                    create: [
                        {
                            id: 'bank-q-1', externalId: 'q1', stage: 'primary', subjectKey: 'math', grade: 1, semester: '上',
                            questionType: 'fill_blank', difficultyStars: 2, text: '3 的后面一个数是几？',
                            answer: '4', analysis: '从 1 往后数。', knowledgePoints: '["1到5各数的认识"]',
                            source: '一年级上册 第1单元',
                        },
                        {
                            id: 'bank-q-2', externalId: 'q2', stage: 'primary', subjectKey: 'math', grade: 2, semester: '下',
                            questionType: 'single_choice', difficultyStars: 3, text: '下列算式中正确的是？',
                            optionsJson: '{"A":"1+1=3","B":"2+2=4"}', answer: 'B', analysis: '2+2=4。',
                            knowledgePoints: '["加法"]',
                        },
                    ],
                },
            },
        });
        const backup = await exportBackup();
        expect(backup.questionBanks).toContainEqual(expect.objectContaining({
            id: 'bank-1', name: '小学数学题库', questionCount: 2,
            questions: expect.arrayContaining([expect.objectContaining({ id: 'bank-q-1', text: '3 的后面一个数是几？' })]),
        }));

        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats).toMatchObject({ questionBanksCreated: 1, bankQuestionsCreated: 2, errorItemsCreated: 2 });

        const restored = await database.questionBank.findFirstOrThrow({ where: { id: 'bank-1' }, include: { questions: true } });
        expect(restored).toMatchObject({
            name: '小学数学题库', stage: 'primary', subjectKey: 'math', source: 'cn-math-taxonomy',
            license: 'CC BY-NC 4.0', questionCount: 2, createdAt: new Date('2026-11-01T00:00:00Z'),
        });
        expect(restored.questions.map((question) => question.id).sort()).toEqual(['bank-q-1', 'bank-q-2']);
        expect(restored.questions.find((question) => question.id === 'bank-q-2')?.optionsJson).toBe('{"A":"1+1=3","B":"2+2=4"}');

        // 重复导入按原 ID 跳过，不产生重复题库或题目
        await importBackup(backup);
        expect(await database.questionBank.count({ where: { userId: 'user-1' } })).toBe(1);
        expect(await database.bankQuestion.count()).toBe(2);
    });

    it('真题库导入默认不进错题，可选写入；按知识点从题库选题', async () => {
        const file = {
            format: 'wrong-notebook-question-bank',
            version: 1,
            meta: {
                id: 'primary-math', title: '小学数学题库', stage: 'primary', subject: 'math', grades: [1, 2],
                count: 2, tagged: true, source: 'test-source', license: 'MIT',
            },
            questions: [
                { id: 'q1', grade: 1, semester: '上', questionType: 'fill_blank', difficultyStars: 2,
                    text: '3 的后面一个数是几？', answer: '4', analysis: '从 1 往后数。', knowledgePoints: ['数的认识'] },
                { id: 'q2', grade: 2, semester: '下', questionType: 'single_choice', difficultyStars: 3,
                    text: '下列算式中正确的是？', options: { A: '1+1=3', B: '2+2=4' }, answer: 'B',
                    analysis: '2+2=4。', knowledgePoints: ['加法'] },
            ],
        };
        const post = (body: object) => IMPORT_BANK(new Request('http://localhost/api/question-banks', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        }));

        const itemsBefore = await database.errorItem.count({ where: { userId: 'user-1' } });
        const first = await post({ file });
        expect(first.status).toBe(201);
        expect(await database.questionBank.count({ where: { userId: 'user-1' } })).toBe(1);
        expect(await database.bankQuestion.count()).toBe(2);
        // 默认只进入真题库，不产生错题
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBe(itemsBefore);

        const list = await LIST_BANKS(new Request('http://localhost/api/question-banks'));
        expect(list.status).toBe(200);
        expect((await list.json()).banks).toContainEqual(expect.objectContaining({ name: '小学数学题库', questionCount: 2 }));

        const selected = await selectBankQuestion({
            userId: 'user-1',
            errorItem: {
                id: 'item-1',
                questionText: '求解 x + 2 = 5',
                subject: { name: '数学', stage: 'primary', subjectKey: 'math' },
            },
            tagNames: ['数的认识'],
            difficulty: 'medium',
        });
        expect(selected?.question.questionText).toContain('3 的后面一个数是几？');
        expect(selected?.bankName).toBe('小学数学题库');

        await database.subject.create({ data: { id: 'primary-math', name: '小学数学', stage: 'primary', subjectKey: 'math', userId: 'user-1' } });
        const second = await post({ file, name: '小学数学题库（含错题）', addToErrorItems: true, notebookId: 'primary-math' });
        expect(second.status).toBe(201);
        const result = await second.json();
        expect(result.errorItemsCreated).toBe(2);
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBe(itemsBefore + 2);

        const duplicateName = await post({ file });

        // 真题库选题走完整路由：不调用 AI，返回 bank 来源与题库题目
        const addedItem = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1', subjectId: 'primary-math' } });
        const practice = await GENERATE_PRACTICE(new Request('http://localhost/api/practice/generate', {
            method: 'POST',
            body: JSON.stringify({ errorItemId: addedItem.id, source: 'bank', difficulty: 'medium' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(practice.status).toBe(200);
        const practiceBody = await practice.json();
        expect(practiceBody.source).toBe('bank');
        expect(practiceBody.questionText).toBeTruthy();
        expect(duplicateName.status).toBe(409);
    });

    it('遥测记录与协议、遥测设置属于实例数据，不进入备份', async () => {
        await database.telemetryEvent.create({ data: { name: 'app_opened', payload: '{"client":"browser"}', version: 'test', local: true } });
        await database.telemetryError.create({ data: { kind: 'client', scope: 'x', name: 'Error', fingerprint: '0123456789abcdef', version: 'test', local: true } });
        try {
            const text = JSON.stringify(await exportBackup());
            expect(text).not.toMatch(/telemetry|0123456789abcdef|app_opened|eula/i);
        } finally {
            await database.telemetryEvent.deleteMany();
            await database.telemetryError.deleteMany();
        }
    });

    it('错题与举一反三记录的全部字段完整保留，tagSet 正确还原', async () => {
        const backup = await exportBackup();
        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats).toMatchObject({ errorItemsCreated: 2, practiceRecordsCreated: 1, reviewSchedulesCreated: 1, tagsLinked: 4 });

        const item = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1', shortId: 'AbC234' }, include: { tags: true, subject: true, paperGroup: true } });
        expect(item).toMatchObject({
            shortId: 'AbC234', questionText: '求解 x + 2 = 5', difficultyStars: 3, hasFigure: true, figureSvg: figure, figureScale: 65, figureAlign: 'left', answerSpacePx: 240,
            geogebraCommands: 'A=(0,0)\nB=(1,1)', svgAnimation: animation('中文'), svgAnimationEn: animation('English'), lastPractice,
            masteryProbability: 0.8, masteryReason: '连续答对', masterySource: 'ai', masteryEvaluatedAt: new Date('2026-10-21T00:00:00Z'),
            createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-21T00:00:00Z'),
        });
        expect(item.subject).toMatchObject({ name: '数学', stage: 'junior_high', subjectKey: 'math', tagSet: 'default' });
        expect(item.paperGroup).toMatchObject({ userId: 'user-1', key: 'b', name: 'B卷', order: 1, isActive: true });
        expect(item.tags.map((tag) => tag.name)).toEqual(['方程', '自定义标签']);

        // 课标体系的错题：tagSet 保留，系统标签按 tagSet 匹配
        const itemCnm = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1', shortId: 'XyZ789' }, include: { tags: true, subject: true } });
        expect(itemCnm.subject).toMatchObject({ name: '数学（课标）', tagSet: 'cn-math-taxonomy' });
        // 课标错题只应关联 cn-math-taxonomy 体系的"方程"标签，而非 default 体系的
        const cnmTag = itemCnm.tags.find((t) => t.name === '方程');
        expect(cnmTag?.tagSet).toBe('cn-math-taxonomy');
        expect(cnmTag?.id).not.toBe('sys-default');

        const record = await database.practiceRecord.findFirstOrThrow({ where: { errorItemId: item.id } });
        expect(record).toMatchObject({ result: 'correct', questionText: '变式题', figureSvg: figure, source: 'practice' });
        // 已带掌握概率导入，不重复评估
        expect(mocks.scheduleMasteryEvaluation).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 0, 201, 50.5, '65'])('旧备份或非法配图比例 %s 回退为 100%%，非法配图位置回退为居中', async (figureScale) => {
        const backup = await exportBackup();
        backup.errorItems[0].figureScale = figureScale;
        backup.errorItems[0].figureAlign = 'invalid-align';
        await clearUserData();
        await importBackup(backup);
        const item = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
        expect(item.figureScale).toBe(100);
        expect(item.figureAlign).toBe('center');
        expect(item.figureSvg).toBe(figure);
    });

    it('题型字段随备份往返，旧版文件没有该字段时导入为 null', async () => {
        await database.errorItem.update({ where: { id: 'item-1' }, data: { questionType: 'fill_blank' } });
        const backup = await exportBackup();
        const backupItem = backup.errorItems.find((item: { id: string }) => item.id === 'item-1');
        expect(backupItem.questionType).toBe('fill_blank');
        expect(backup.errorItems.find((item: { id: string }) => item.id === 'item-2').questionType ?? null).toBeNull();

        await clearUserData();
        await importBackup(backup);
        const restored = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1', shortId: 'AbC234' } });
        expect(restored.questionType).toBe('fill_blank');

        // 模拟旧版备份：去掉 questionType 字段
        const legacyBackup = await exportBackup();
        legacyBackup.version = 8;
        for (const item of legacyBackup.errorItems) {
            delete item.questionType;
        }
        await clearUserData();
        await importBackup(legacyBackup);
        const legacyItem = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1', shortId: 'AbC234' } });
        expect(legacyItem.questionType).toBeNull();
    });

    it.each([undefined, null, -1, 601, 50.5, '120'])('旧备份或非法单题留白 %s 导入为空，按全局留白档位', async (answerSpacePx) => {
        const backup = await exportBackup();
        expect(backup.errorItems.find((item: { id: string }) => item.id === 'item-1').answerSpacePx).toBe(240);
        backup.errorItems[0].answerSpacePx = answerSpacePx;
        backup.errorItems[1].answerSpacePx = answerSpacePx;
        await clearUserData();
        await importBackup(backup);
        const items = await database.errorItem.findMany({ where: { userId: 'user-1' } });
        expect(items.map((item) => item.answerSpacePx)).toEqual([null, null]);
    });

    it('流水号随备份往返：空闲时保留原编号，已被占用或旧版文件没有时按计数器分配新编号', async () => {
        await database.errorItem.update({ where: { id: 'item-1' }, data: { seqNo: 1000 } });
        await database.errorItem.update({ where: { id: 'item-2' }, data: { seqNo: 1001 } });
        await database.user.update({ where: { id: 'user-1' }, data: { errorItemSeq: 1001 } });
        const backup = await exportBackup();
        expect(backup.errorItems.map((item: { seqNo: number }) => item.seqNo).sort()).toEqual([1000, 1001]);

        // 换机还原：编号空闲，原样保留，计数器推进到最大编号
        await clearUserData();
        await database.user.update({ where: { id: 'user-1' }, data: { errorItemSeq: 999 } });
        await importBackup(backup);
        const restored = await database.errorItem.findMany({ where: { userId: 'user-1' }, orderBy: { seqNo: 'asc' } });
        expect(restored.map((item) => [item.shortId, item.seqNo])).toEqual([['AbC234', 1000], ['XyZ789', 1001]]);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).errorItemSeq).toBe(1001);

        // 编号已被其他题占用、旧版文件没有编号：按计数器继续往后编
        await clearUserData();
        await database.user.update({ where: { id: 'user-1' }, data: { errorItemSeq: 1001 } });
        await database.errorItem.create({ data: { id: 'occupied', userId: 'user-1', originalImageUrl: '', questionText: '另一道题', seqNo: 1000 } });
        const mixed = structuredClone(backup);
        delete mixed.errorItems.find((item: { id: string }) => item.id === 'item-2').seqNo;
        await importBackup(mixed);
        const items = await database.errorItem.findMany({ where: { userId: 'user-1', id: { not: 'occupied' } } });
        expect(new Set(items.map((item) => item.seqNo))).toEqual(new Set([1002, 1003]));
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).errorItemSeq).toBe(1003);
    });

    it('旧版备份（version 2，无 tagSet 字段）导入时按 default tagSet 处理', async () => {
        const backup = await exportBackup();
        // 模拟旧版导出：去掉 systemTags 和所有 tagSet 字段，version 降为 2
        const legacyBackup = {
            ...backup,
            version: 2,
            subjects: backup.subjects.map((s: { tagSet?: string }) => { const { tagSet, ...rest } = s; return rest; }),
            customTags: backup.customTags.map((t: { tagSet?: string }) => { const { tagSet, ...rest } = t; return rest; }),
        };
        delete legacyBackup.systemTags;
        await clearUserData();
        await importBackup(legacyBackup);

        // 旧版文件没有 systemTags，不创建系统标签
        const sysTags = await database.knowledgeTag.findMany({ where: { isSystem: true } });
        expect(sysTags.length).toBe(0);

        // 自定义标签按 default tagSet 导入
        const tags = await database.knowledgeTag.findMany({ where: { isSystem: false } });
        expect(tags.map((t) => t.tagSet)).toEqual(['default', 'default']);
    });

    it('没有掌握概率的题目导入后重新评估', async () => {
        await database.errorItem.update({ where: { id: 'item-1' }, data: { masteryProbability: null, masteryEvaluatedAt: null } });
        const backup = await exportBackup();
        await clearUserData();
        await importBackup(backup);
        const item = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
        expect(item.masteryProbability).toBeNull();
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith([item.id]);
    });

    it('试卷、试卷题目及其作答记录完整保留，重复导入不新建试卷', async () => {
        await database.examPaper.create({
            data: {
                id: 'paper-1', userId: 'user-1', title: '周测', status: 'generating', scope: 'unmastered', difficulty: 'hard', requestedCount: 2,
                subjectIds: JSON.stringify(['math']), tagNames: JSON.stringify(['自定义标签']), resultsRecordedAt: new Date('2026-10-22T00:00:00Z'),
                createdAt: new Date('2026-10-21T00:00:00Z'),
                questions: { create: [
                    { id: 'question-1', order: 0, errorItemId: 'item-1', sourceShortId: 'AbC234', status: 'ready', questionText: '试卷新题', answerText: '答', analysis: '析', figureSvg: figure, figureScale: 75, figureAlign: 'right', answerSpacePx: 180, score: 2.5 },
                    { id: 'question-2', order: 1, errorItemId: 'item-1', sourceShortId: 'AbC234', status: 'pending' },
                ] },
            },
        });
        await database.practiceRecord.create({
            data: { userId: 'user-1', errorItemId: 'item-1', examQuestionId: 'question-1', result: 'wrong', isCorrect: false, source: 'exam', questionText: '试卷新题' },
        });
        const backup = await exportBackup();
        expect(backup.examPapers[0].questions[0].figureScale).toBe(75);
        expect(backup.examPapers[0].questions[0].figureAlign).toBe('right');
        expect(backup.examPapers[0].questions[0].answerSpacePx).toBe(180);
        expect(backup.examPapers[0].questions[0].score).toBe(2.5);
        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats.examPapersCreated).toBe(1);

        const item = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
        const subject = await database.subject.findFirstOrThrow({ where: { userId: 'user-1' } });
        const paper = await database.examPaper.findFirstOrThrow({ where: { userId: 'user-1' }, include: { questions: { orderBy: { order: 'asc' } } } });
        expect(paper).toMatchObject({
            title: '周测', status: 'partial', scope: 'unmastered', difficulty: 'hard', mode: 'generate', requestedCount: 2,
            subjectIds: JSON.stringify([subject.id]), tagNames: JSON.stringify(['自定义标签']),
            resultsRecordedAt: new Date('2026-10-22T00:00:00Z'), createdAt: new Date('2026-10-21T00:00:00Z'),
        });
        expect(paper.questions).toMatchObject([
            { order: 0, errorItemId: item.id, sourceShortId: 'AbC234', status: 'ready', questionText: '试卷新题', figureSvg: figure, figureScale: 75, figureAlign: 'right', answerSpacePx: 180, score: 2.5 },
            // 导出时仍在生成的题目按失败导入，缺省配图比例为 100、位置为居中，留白按全局档位，分值未设
            { order: 1, errorItemId: item.id, status: 'failed', figureScale: 100, figureAlign: 'center', answerSpacePx: null, score: null },
        ]);
        expect(await database.practiceRecord.findFirstOrThrow({ where: { source: 'exam' } })).toMatchObject({ examQuestionId: paper.questions[0].id, errorItemId: item.id });

        // 再导入一次：试卷不重复，作答记录关联到已有的试卷题目
        const again = await importBackup(backup);
        expect(again.stats.examPapersCreated).toBe(0);
        expect(await database.examPaper.count({ where: { userId: 'user-1' } })).toBe(1);
        const examRecords = await database.practiceRecord.findMany({ where: { source: 'exam' } });
        expect(examRecords.map((record) => record.examQuestionId)).toEqual([paper.questions[0].id, paper.questions[0].id]);
    });

    it('原题直出试卷的 mode 与 original 难度随备份往返，旧文件缺省 generate', async () => {
        await database.examPaper.create({
            data: {
                id: 'paper-orig', userId: 'user-1', title: '原题卷', status: 'ready', scope: 'all', difficulty: 'original', mode: 'original', requestedCount: 1,
                subjectIds: JSON.stringify(['math']), createdAt: new Date('2026-10-23T00:00:00Z'),
                questions: { create: [
                    { id: 'q-orig', order: 0, errorItemId: 'item-1', sourceShortId: 'AbC234', status: 'ready', questionText: '原题', answerText: '答', analysis: '析' },
                ] },
            },
        });
        const backup = await exportBackup();
        const origPaper = backup.examPapers.find((p: { id: string }) => p.id === 'paper-orig');
        expect(origPaper.mode).toBe('original');
        await clearUserData();
        await importBackup(backup);
        const paper = await database.examPaper.findFirstOrThrow({ where: { userId: 'user-1', title: '原题卷' } });
        expect(paper.mode).toBe('original');
        expect(paper.difficulty).toBe('original');

        // 模拟旧版文件（无 mode 字段）：缺省 generate
        const legacyBackup = await exportBackup();
        delete legacyBackup.examPapers[0].mode;
        legacyBackup.examPapers[0].difficulty = 'hard';
        legacyBackup.version = 7;
        await clearUserData();
        await importBackup(legacyBackup);
        const legacyPaper = await database.examPaper.findFirstOrThrow({ where: { userId: 'user-1' }, include: { questions: { orderBy: { order: 'asc' } } } });
        expect(legacyPaper.mode).toBe('generate');
        expect(legacyPaper.difficulty).toBe('hard');

        // 旧版文件没有 score 字段：导入后分值为空
        expect(legacyPaper.questions[0].score).toBeNull();
    });

    it('试卷题目的 questionType 快照与 groupByType 开关随备份往返，旧版文件缺省 null/false', async () => {
        await database.examPaper.create({
            data: {
                id: 'paper-sec', userId: 'user-1', title: '分大题卷', status: 'ready', scope: 'all', difficulty: 'medium', mode: 'generate',
                requestedCount: 2, groupByType: true, subjectIds: JSON.stringify(['math']),
                createdAt: new Date('2026-10-24T00:00:00Z'),
                questions: { create: [
                    { id: 'q-sec-1', order: 0, errorItemId: 'item-1', sourceShortId: 'AbC234', status: 'ready', questionText: '题1', questionType: 'single_choice', score: 2 },
                    { id: 'q-sec-2', order: 1, errorItemId: 'item-2', sourceShortId: 'XyZ789', status: 'ready', questionText: '题2', questionType: null },
                ] },
            },
        });
        const backup = await exportBackup();
        const paper = backup.examPapers.find((p: { id: string }) => p.id === 'paper-sec');
        expect(paper.groupByType).toBe(true);
        expect(paper.questions[0].questionType).toBe('single_choice');
        expect(paper.questions[1].questionType ?? null).toBeNull();

        await clearUserData();
        await importBackup(backup);
        const restored = await database.examPaper.findFirstOrThrow({ where: { userId: 'user-1', title: '分大题卷' }, include: { questions: { orderBy: { order: 'asc' } } } });
        expect(restored.groupByType).toBe(true);
        expect(restored.questions.map((question) => question.questionType)).toEqual(['single_choice', null]);

        // 模拟旧版备份（version 10，无 groupByType 与 questionType 字段）：缺省 false / null
        const legacyBackup = await exportBackup();
        legacyBackup.version = 10;
        for (const legacyPaper of legacyBackup.examPapers) {
            delete legacyPaper.groupByType;
            for (const question of legacyPaper.questions) {
                delete question.questionType;
            }
        }
        await clearUserData();
        await importBackup(legacyBackup);
        const legacy = await database.examPaper.findFirstOrThrow({ where: { userId: 'user-1', title: '分大题卷' }, include: { questions: { orderBy: { order: 'asc' } } } });
        expect(legacy.groupByType).toBe(false);
        expect(legacy.questions.map((question) => question.questionType)).toEqual([null, null]);
    });

    it('云端语音随备份导入、导出：只导出与动画讲解一致的语音，不合法的跳过，已有的不重复写入', async () => {
        const narrated = embedNarration(animation('画面'), [{ begin: 0, text: '先看条件' }]);
        await database.errorItem.update({ where: { id: 'item-1' }, data: { svgAnimation: narrated } });
        const audio = encodeMp3({ sampleRate: 24000, samples: new Float32Array(2400) }).toString('base64');
        const speech = { provider: 'minimax', model: 'speech-2.8-hd', voice: 'male-qn-jingying', language: 'zh', text: '先看条件', audio };

        const backup = await exportBackup();
        expect(backup.ttsSpeeches).toEqual([]);

        const { stats } = await importBackup({
            ...backup,
            ttsSpeeches: [
                speech,
                { ...speech, text: '与动画无关的话' },
                { ...speech, text: '不是 MP3', audio: Buffer.from('not mp3').toString('base64') },
                { ...speech, provider: 'unknown' },
                { ...speech, text: '' },
            ],
        });
        expect(stats.ttsSpeechesImported).toBe(2);

        const exported = await exportBackup();
        expect(exported.ttsSpeeches).toEqual([speech]);
        expect((await importBackup(exported)).stats.ttsSpeechesImported).toBe(0);
    });

    it('还原本人的偏好设置，不合法的单项跳过', async () => {
        await database.user.update({
            where: { id: 'user-1' },
            data: { confirmBeforeImport: true, questionDuplicateThreshold: 75.5, masteryThreshold: 70, enableGeogebra: true, enableSvgAnimation: false, themePreference: 'dark', gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级上' },
        });
        const backup = await exportBackup();
        expect(backup.user).toMatchObject({ confirmBeforeImport: true, questionDuplicateThreshold: 75.5, masteryThreshold: 70, enableGeogebra: true, enableSvgAnimation: false, themePreference: 'dark', gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级上' });

        await database.user.update({
            where: { id: 'user-1' },
            data: { confirmBeforeImport: false, questionDuplicateThreshold: 90, masteryThreshold: 50, enableGeogebra: false, enableSvgAnimation: true, themePreference: 'system', gradeRecognitionMode: 'fixed', fixedGradeSemester: null },
        });
        backup.user.questionDuplicateThreshold = 500;
        const { stats } = await importBackup(backup);
        expect(stats.preferencesRestored).toBe(true);
        expect(await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).toMatchObject({
            confirmBeforeImport: true, questionDuplicateThreshold: 90, masteryThreshold: 70, enableGeogebra: true, enableSvgAnimation: false, themePreference: 'dark',
            gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级上',
        });
    });

    it('旧版文件没有偏好设置时不改动当前设置', async () => {
        await database.user.update({ where: { id: 'user-1' }, data: { enableGeogebra: true, gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级下' } });
        const { stats } = await importBackup({ version: 1, user: { email: mocks.session.user.email }, errorItems: [] });
        expect(stats.preferencesRestored).toBe(false);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).enableGeogebra).toBe(true);
        expect(await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).toMatchObject({ gradeRecognitionMode: 'ai', fixedGradeSemester: '四年级下' });
    });

    it('无效年级规则不覆盖当前偏好，恢复题目保留原有年级', async () => {
        const backup = await exportBackup();
        backup.user.gradeRecognitionMode = 'invalid';
        backup.user.fixedGradeSemester = '十三年级上';
        await database.user.update({ where: { id: 'user-1' }, data: { gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级下' } });
        await clearUserData();
        await importBackup(backup);
        expect(await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).toMatchObject({ gradeRecognitionMode: 'fixed', fixedGradeSemester: '四年级下' });
        expect((await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } })).gradeSemester).toBe('初二上');
    });

    it('导入时重新净化 SVG，丢弃不合法的暂存练习和掌握概率', async () => {
        const backup = await exportBackup();
        await clearUserData();
        Object.assign(backup.errorItems[0], {
            svgAnimation: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>',
            svgAnimationEn: 'not svg',
            lastPractice: '{"questionText":""}',
            masteryProbability: 3,
        });
        await importBackup(backup);
        const item = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
        expect(item.svgAnimation).not.toContain('script');
        expect(item.svgAnimationEn).toBeNull();
        expect(item.lastPractice).toBeNull();
        expect(item.masteryProbability).toBeNull();
        expect(mocks.scheduleMasteryEvaluation).toHaveBeenCalledWith([item.id]);
    });

    it('旧版备份没有识别任务字段时正常导入', async () => {
        const backup = await exportBackup();
        delete backup.importTasks;
        delete backup.importBatches;
        backup.version = 4;
        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats.importTasksCreated).toBe(0);
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBeGreaterThan(0);
    });

    it('导入不含 extensions 的旧版备份成功，stats.extensionsImported 为空', async () => {
        const backup = await exportBackup();
        delete backup.extensions;
        backup.version = 6;
        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats.extensionsImported).toEqual({});
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBeGreaterThan(0);
    });

    it('导入含未知扩展的备份成功并跳过，stats.extensionsImported 不含未知 key', async () => {
        const backup = await exportBackup();
        backup.extensions = { 'unknown-ext': { version: 1, data: { foo: 'bar' } } };
        await clearUserData();
        const { stats } = await importBackup(backup);
        expect(stats.extensionsImported).toEqual({});
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBeGreaterThan(0);
    });

    describe('备份扩展（BACKUP_EXTENSIONS）', () => {
        const testExt: BackupExtension = {
            key: 'test-bank',
            version: 1,
            export: vi.fn().mockResolvedValue({ bankItems: ['a', 'b'] }),
            import: vi.fn().mockResolvedValue(3),
        };
        const failingExt: BackupExtension = {
            key: 'test-fail',
            version: 1,
            export: vi.fn().mockResolvedValue(null),
            import: vi.fn().mockRejectedValue(new Error('extension boom')),
        };

        afterEach(() => {
            for (const ext of [testExt, failingExt]) {
                const idx = BACKUP_EXTENSIONS.indexOf(ext);
                if (idx >= 0) BACKUP_EXTENSIONS.splice(idx, 1);
            }
        });

        it('导出时 extensions 带上已注册扩展的 version 和 data', async () => {
            BACKUP_EXTENSIONS.push(testExt);
            const backup = await exportBackup();
            expect(backup.extensions['test-bank']).toEqual({ version: 1, data: { bankItems: ['a', 'b'] } });
            expect(testExt.export).toHaveBeenCalledWith({ userIds: ['user-1'] });
        });

        it('导入时扩展收到正确的 ID 映射和 userIdMap', async () => {
            BACKUP_EXTENSIONS.push(testExt);
            const backup = await exportBackup();
            await clearUserData();
            await importBackup(backup);

            expect(testExt.import).toHaveBeenCalledTimes(1);
            const [ctx, payload] = vi.mocked(testExt.import).mock.calls[0];
            expect(payload).toEqual({ version: 1, data: { bankItems: ['a', 'b'] } });
            // errorItemIdMap 把旧 ID 映射到数据库中真实存在的新 ID
            const newItem = await database.errorItem.findFirstOrThrow({ where: { userId: 'user-1' } });
            expect(ctx.errorItemIdMap.get('item-1')).toBe(newItem.id);
            // userIdMap(旧 userId) 返回当前用户
            expect(ctx.userIdMap('user-1')).toBe('user-1');
        });

        it('扩展 import 抛错时整个导入事务回滚', async () => {
            BACKUP_EXTENSIONS.push(failingExt);
            const backup = await exportBackup();
            await clearUserData();
            const itemsAfterClear = await database.errorItem.count({ where: { userId: 'user-1' } });
            expect(itemsAfterClear).toBe(0);

            // 导入应失败（扩展抛错导致事务回滚）
            const response = await IMPORT(new Request('http://localhost/api/import', {
                method: 'POST',
                body: JSON.stringify(backup),
                headers: { 'Content-Type': 'application/json' },
            }));
            expect(response.status).toBe(500);
            // 核心数据回滚到导入前（清空后）的状态
            expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBe(itemsAfterClear);
        });
    });

    it('网页导出的 gzip 备份可按原字节导入', async () => {
        const response = await EXPORT(new Request('http://localhost/api/export?compress=gzip'));
        expect(response.status).toBe(200);
        const compressed = Buffer.from(await response.arrayBuffer());
        expect([compressed[0], compressed[1]]).toEqual([0x1f, 0x8b]);
        expect(JSON.parse(gunzipSync(compressed).toString('utf8')).version).toBe(15);

        await clearUserData();
        const imported = await IMPORT(new Request('http://localhost/api/import', {
            method: 'POST',
            body: new Uint8Array(compressed),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(imported.status).toBe(200);
        expect((await imported.json()).stats).toMatchObject({ errorItemsCreated: 2 });
    });

    it('导入体积上限放宽到 256MB：78MB 备份不再被拒绝，超出上限返回明确提示', async () => {
        const backup = { version: 14, user: { email: mocks.session.user.email }, errorItems: [] };
        const post = (contentLength: number) => IMPORT(new Request('http://localhost/api/import', {
            method: 'POST',
            body: JSON.stringify(backup),
            headers: { 'Content-Type': 'application/json', 'Content-Length': String(contentLength) },
        }));

        // 平板导出的完整备份含题目原图，78MB 属于常见体积，旧上限 50MB 会直接拒绝
        expect((await post(78.5 * 1024 * 1024)).status).toBe(200);

        const tooLarge = await post(MAX_BACKUP_IMPORT_BYTES + 1);
        expect(tooLarge.status).toBe(400);
        expect(await tooLarge.json()).toMatchObject({ message: expect.stringContaining('max 256MB') });
    });
});

describe('跨账号合并导入', () => {
    const originalSession = { user: { id: 'user-1', email: 'backup-test@example.com', role: 'user' }, expires: '2099-01-01' };

    /** 创建另一个账号的备份（含该账号的偏好设置和题目） */
    async function exportOtherAccountBackup() {
        await database.user.create({
            data: { id: 'user-2', email: 'parent@example.com', password: 'test-only', confirmBeforeImport: true },
        });
        await database.subject.create({
            data: { id: 'parent-math', name: '家长数学', stage: 'junior_high', subjectKey: 'math', userId: 'user-2' },
        });
        await database.errorItem.create({
            data: { id: 'parent-item', userId: 'user-2', subjectId: 'parent-math', originalImageUrl: '', questionText: '家长录入的题目', answerText: '答案', analysis: '解析' },
        });
        mocks.session = { user: { id: 'user-2', email: 'parent@example.com', role: 'user' }, expires: '2099-01-01' };
        const backup = await exportBackup();
        mocks.session = originalSession;
        return backup;
    }

    it('merge=true 时把其他账号的备份合并到当前账号，且不还原对方偏好', async () => {
        const backup = await exportOtherAccountBackup();
        expect(backup.user.email).toBe('parent@example.com');
        await clearUserData();

        const { stats } = await importBackup(backup, '?merge=true');

        expect(stats.preferencesRestored).toBe(false);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-1' } })).confirmBeforeImport).toBe(true);
        expect((await database.user.findUniqueOrThrow({ where: { id: 'user-2' } })).confirmBeforeImport).toBe(true);
        const importedItem = await database.errorItem.findFirstOrThrow({ where: { questionText: '家长录入的题目', userId: 'user-1' } });
        expect(importedItem.userId).toBe('user-1');
        const importedNotebook = await database.subject.findUniqueOrThrow({ where: { id: importedItem.subjectId! } });
        expect(importedNotebook.userId).toBe('user-1');
    });

    it('未指定 merge=true 时仍拒绝其他账号的备份', async () => {
        const backup = await exportOtherAccountBackup();
        await clearUserData();
        const response = await IMPORT(new Request('http://localhost/api/import', {
            method: 'POST',
            body: JSON.stringify(backup),
            headers: { 'Content-Type': 'application/json' },
        }));

        expect(response.status).toBe(400);
        expect(await database.errorItem.count({ where: { userId: 'user-1' } })).toBe(0);
    });
});
