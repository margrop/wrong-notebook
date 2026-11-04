// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ directory: '', databaseUrl: '' }));

vi.mock('@/lib/prisma', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    state.directory = mkdtempSync(join(tmpdir(), 'question-type-filter-'));
    state.databaseUrl = `file:${join(state.directory, 'test.db')}`;
    return { prisma: new PrismaClient({ datasources: { db: { url: state.databaseUrl } } }) };
});
vi.mock('next-auth', () => ({
    getServerSession: vi.fn(async () => ({ user: { email: 'qtype@example.com' }, expires: '2099-01-01' })),
}));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/ai-quota', () => ({ consumeAiQuota: vi.fn(async () => null) }));
vi.mock('@/lib/config', () => ({ getAppTimeZone: vi.fn(() => 'Asia/Shanghai') }));
vi.mock('@/lib/mastery', () => ({ getMasteryThreshold: vi.fn(async () => 50) }));

import { GET as LIST } from '@/app/api/error-items/list/route';
import { POST as CREATE_EXAM } from '@/app/api/exams/route';
import { prisma } from '@/lib/prisma';

const list = (query = '') => LIST(new Request(`http://localhost/api/error-items/list?${query}`));
const createExam = (body: object) => new Request('http://localhost/api/exams', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
});

describe('错题列表与组卷按题型筛选（真实 SQLite）', () => {
    beforeAll(async () => {
        execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
            env: { ...process.env, DATABASE_URL: state.databaseUrl },
            stdio: 'pipe',
        });
        const items = [
            { id: 'q-choice', questionType: 'single_choice', questionText: '单选题', answerText: 'A', analysis: '解析A' },
            { id: 'q-fill', questionType: 'fill_blank', questionText: '填空题', answerText: '2', analysis: '解析2' },
            { id: 'q-solution', questionType: 'solution', questionText: '解答题', answerText: '过程', analysis: '解析S' },
            { id: 'q-none', questionType: null, questionText: '未设置题型', answerText: null, analysis: null },
        ];
        await prisma.$transaction([
            prisma.user.create({ data: { id: 'user-qt', email: 'qtype@example.com', password: 'unused-test-hash' } }),
            prisma.subject.create({ data: { id: 'subj', name: '数学', userId: 'user-qt' } }),
            prisma.errorItem.createMany({
                data: items.map((item, index) => ({
                    id: item.id,
                    userId: 'user-qt',
                    subjectId: 'subj',
                    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)),
                    shortId: `QT${String(index + 1).padStart(4, '0')}`,
                    questionText: item.questionText,
                    questionType: item.questionType,
                    answerText: item.answerText,
                    analysis: item.analysis,
                    originalImageUrl: '',
                })),
            }),
        ]);
    }, 30_000);

    afterAll(async () => {
        await prisma.$disconnect();
        await rm(state.directory, { recursive: true, force: true });
    });

    describe('错题列表 questionTypes 筛选', () => {
        it('只选出指定题型的题', async () => {
            const data = await (await list('questionTypes=single_choice')).json();
            expect(data.total).toBe(1);
            expect(data.items[0].id).toBe('q-choice');
        });

        it('none 选出未设置题型的题', async () => {
            const data = await (await list('questionTypes=none')).json();
            expect(data.total).toBe(1);
            expect(data.items[0].id).toBe('q-none');
        });

        it('题型与 none 混合时 OR 合并', async () => {
            const data = await (await list('questionTypes=fill_blank,none')).json();
            expect(data.total).toBe(2);
            expect(data.items.map((item: { id: string }) => item.id).sort()).toEqual(['q-fill', 'q-none']);
        });

        it('非法题型值忽略，不报错', async () => {
            const data = await (await list('questionTypes=unknown_type')).json();
            expect(data.total).toBe(4);
        });

        it('不传 questionTypes 返回全部', async () => {
            const data = await (await list()).json();
            expect(data.total).toBe(4);
        });
    });

    describe('组卷 questionTypes 筛选', () => {
        it('只选出指定题型的题（原题直出）', async () => {
            const response = await CREATE_EXAM(createExam({
                subjectIds: ['subj'], scope: 'all', count: 10, mode: 'original',
                questionTypes: ['solution'],
            }));
            expect(response.status).toBe(201);
            const body = await response.json();
            expect(body.questionCount).toBe(1);

            const paper = await prisma.examPaper.findUnique({
                where: { id: body.id },
                select: { questions: { select: { errorItemId: true } } },
            });
            expect(paper?.questions.map((q) => q.errorItemId)).toEqual(['q-solution']);
        });

        it('none 选出未设置题型的题（原题直出）', async () => {
            const response = await CREATE_EXAM(createExam({
                subjectIds: ['subj'], scope: 'all', count: 10, mode: 'original',
                questionTypes: ['none'],
            }));
            expect(response.status).toBe(201);
            const body = await response.json();
            expect(body.questionCount).toBe(1);

            const paper = await prisma.examPaper.findUnique({
                where: { id: body.id },
                select: { questions: { select: { errorItemId: true } } },
            });
            expect(paper?.questions.map((q) => q.errorItemId)).toEqual(['q-none']);
        });

        it('不传 questionTypes 时不过滤题型', async () => {
            const response = await CREATE_EXAM(createExam({
                subjectIds: ['subj'], scope: 'all', count: 10, mode: 'original',
            }));
            expect(response.status).toBe(201);
            const body = await response.json();
            expect(body.questionCount).toBe(4);
        });

        it('questionTypes 数组元素为字符串，未知值由 buildSourceWhere 忽略', async () => {
            const response = await CREATE_EXAM(createExam({
                subjectIds: ['subj'], scope: 'all', count: 10, mode: 'original',
                questionTypes: ['unknown_type'],
            }));
            expect(response.status).toBe(201);
            const body = await response.json();
            // unknown_type 被忽略，相当于不加题型过滤
            expect(body.questionCount).toBe(4);
        });    });
});
