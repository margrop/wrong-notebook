import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashSync } from 'bcryptjs';
import type { Prisma, Subject, User } from '@prisma/client';
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { MockState } from './mock-ai.mjs';
import { parseLoopbackOrigin } from './local-origin';

export { expect };
export type { Page } from '@playwright/test';

interface RunState {
    directory: string; app: string; configDir: string; reportDir: string; url: string; origin: string; mockOrigin: string;
    baseline: Record<string, unknown>;
}
const runFile = process.env.E2E_RUN_FILE;
if (!runFile) throw new Error('请通过 npm run test:e2e 启动隔离测试环境');
export const runState = JSON.parse(readFileSync(runFile, 'utf8')) as RunState;
const mockOrigin = parseLoopbackOrigin(runState.mockOrigin);
const { PrismaClient } = createRequire(join(runState.app, 'package.json'))('@prisma/client') as typeof import('@prisma/client');
const studentPassword = 'e2e-student-pass';
const passwordHash = hashSync(studentPassword, 10);
const adminHash = hashSync('e2e-admin-pass', 10);
const defaultHash = hashSync('123456', 10);

export class Scenario {
    readonly id = randomUUID().replaceAll('-', '').slice(0, 20);
    readonly db = new PrismaClient({ datasources: { db: { url: runState.url } } });
    readonly marker = `E2E_${this.id}_A`;
    readonly mockBaseURL = `${mockOrigin}/cases/${this.id}/v1`;
    readonly violations: string[] = [];
    readonly pages = new Set<Page>();
    user!: User;
    otherUser!: User;
    book!: Subject;
    groups!: { a: string; b: string; other: string };
    private beforeUsers: string[] = [];
    private beforeSubjects: string[] = [];
    private beforeGroups: string[] = [];
    private beforeTags: string[] = [];
    private beforePapers: string[] = [];
    private beforeRecords: string[] = [];

    async control(patch: Record<string, unknown> = {}): Promise<MockState> {
        const response = await fetch(`${mockOrigin}/control/${this.id}`, { method: 'POST', body: JSON.stringify(patch) });
        if (!response.ok) throw new Error('无法设置本地模型场景');
        return response.json() as Promise<MockState>;
    }

    async model(): Promise<MockState> {
        return (await fetch(`${mockOrigin}/control/${this.id}`)).json() as Promise<MockState>;
    }

    async guardPage(page: Page) {
        this.pages.add(page);
        await page.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (['data:', 'blob:', 'about:'].includes(url.protocol) || [runState.origin, mockOrigin].includes(url.origin)) return route.continue();
            this.violations.push(url.origin + url.pathname);
            await route.abort('blockedbyclient');
        });
    }

    async prepare() {
        this.beforeUsers = (await this.db.user.findMany({ select: { id: true } })).map((item) => item.id);
        this.beforeSubjects = (await this.db.subject.findMany({ select: { id: true } })).map((item) => item.id);
        this.beforeGroups = (await this.db.paperGroup.findMany({ select: { id: true } })).map((item) => item.id);
        this.beforeTags = (await this.db.knowledgeTag.findMany({ where: { userId: { not: null } }, select: { id: true } })).map((item) => item.id);
        this.beforePapers = (await this.db.examPaper.findMany({ select: { id: true } })).map((item) => item.id);
        this.beforeRecords = (await this.db.practiceRecord.findMany({ select: { id: true } })).map((item) => item.id);
        await this.control();
        const provider = { instances: [{ id: 'e2e', name: 'E2E 本地模型', apiKey: 'e2e-dummy-key', baseUrl: this.mockBaseURL, model: 'e2e-mock-model' }], activeInstanceId: 'e2e' };
        writeFileSync(join(runState.configDir, 'app-config.json'), JSON.stringify({ ...runState.baseline, openai: provider }));
        await this.db.user.updateMany({ where: { email: 'admin@localhost' }, data: { password: adminHash, aiDataConsentAt: new Date(), confirmBeforeImport: false, gradeRecognitionMode: 'fixed', fixedGradeSemester: null, enableSvgAnimation: false } });
        await this.db.user.updateMany({ where: { email: 'setup-admin@localhost' }, data: { password: defaultHash, aiDataConsentAt: new Date() } });
        this.user = await this.db.user.create({ data: { email: `a-${this.id}@example.test`, password: passwordHash, name: 'E2E 学生 A',
            educationStage: 'junior_high', enrollmentYear: 2025, fixedGradeSemester: '初二上', enableSvgAnimation: false, aiDataConsentAt: new Date() } });
        this.otherUser = await this.db.user.create({ data: { email: `b-${this.id}@example.test`, password: passwordHash, name: 'E2E 学生 B',
            educationStage: 'junior_high', enrollmentYear: 2025, fixedGradeSemester: '初二上', enableSvgAnimation: false, aiDataConsentAt: new Date() } });
        this.book = await this.db.subject.create({ data: { name: '数学', stage: 'junior_high', subjectKey: 'math', userId: this.user.id } });
        const entries = await Promise.all(['a', 'b', 'other'].map((key, order) => this.db.paperGroup.create({ data: {
            userId: this.user.id, key, name: ['A卷', 'B卷', '其他'][order], order,
        } })));
        this.groups = { a: entries[0].id, b: entries[1].id, other: entries[2].id };
        for (const tagSet of ['default', 'e2e-secondary']) {
            await this.db.knowledgeTag.upsert({ where: { id: `e2e-root-${tagSet}` }, update: {}, create: { id: `e2e-root-${tagSet}`, name: '八年级上', subject: 'math', isSystem: true, tagSet } });
            await this.db.knowledgeTag.upsert({ where: { id: `e2e-leaf-${tagSet}` }, update: {}, create: { id: `e2e-leaf-${tagSet}`, name: '一元一次方程', subject: 'math', isSystem: true, tagSet, parentId: `e2e-root-${tagSet}` } });
        }
    }

    async login(page: Page, other = false) {
        const { csrfToken } = await (await page.request.get('/api/auth/csrf')).json();
        const response = await page.request.post('/api/auth/callback/credentials', { form: {
            csrfToken, email: (other ? this.otherUser : this.user).email, password: studentPassword, json: 'true',
        } });
        expect(response.ok()).toBeTruthy();
        const session = await (await page.request.get('/api/auth/session')).json();
        expect(session.user.id).toBe((other ? this.otherUser : this.user).id);
    }

    async item(label = 'A', data: Partial<Prisma.ErrorItemUncheckedCreateInput> = {}) {
        return this.db.errorItem.create({ data: { id: `item-${this.id}-${label}`, shortId: this.id.replaceAll('0', 'Z').slice(0, 4) + label + 'X', userId: this.user.id,
            subjectId: this.book.id, originalImageUrl: '', questionText: `求矩形面积，长为 ${label === 'A' ? '七' : '二十'} 厘米，宽为 ${label === 'A' ? '五' : '十一'} 厘米。E2E_${this.id}_${label}`,
            answerText: '35 平方厘米', analysis: '面积等于长乘宽。', gradeSemester: '初二上', paperLevel: this.groups.a,
            ...data } });
    }

    async resetCurrentAccount() {
        const email = this.user.email;
        await this.db.user.delete({ where: { id: this.user.id } });
        this.user = await this.db.user.create({ data: { email, password: passwordHash, name: 'E2E 恢复账号',
            educationStage: 'junior_high', enrollmentYear: 2025, fixedGradeSemester: '初二上', enableSvgAnimation: false, aiDataConsentAt: new Date() } });
    }

    async records() { return this.db.practiceRecord.findMany({ where: { userId: this.user.id }, orderBy: { createdAt: 'asc' } }); }

    async dispose() {
        try {
            await this.control({ hold: false });
            // 等到真实后台评估结束，再切换全局模型配置。
            await expect.poll(async () => {
                const records = await this.db.practiceRecord.findMany({ where: { errorItemId: { not: null } }, select: { errorItemId: true } });
                const ids = records.flatMap((item) => item.errorItemId ? [item.errorItemId] : []);
                return this.db.errorItem.count({ where: { id: { in: ids }, masteryEvaluatedAt: null } });
            }, { timeout: 15000 }).toBe(0);
            await expect.poll(async () => (await this.model()).inflight, { timeout: 15000 }).toBe(0);
        } finally {
            try {
                await this.db.examPaper.deleteMany({ where: { id: { notIn: this.beforePapers } } });
                await this.db.subject.deleteMany({ where: { id: { notIn: this.beforeSubjects } } });
                await this.db.practiceRecord.deleteMany({ where: { id: { notIn: this.beforeRecords } } });
                await this.db.knowledgeTag.deleteMany({ where: { userId: { not: null }, id: { notIn: this.beforeTags } } });
                await this.db.paperGroup.deleteMany({ where: { id: { notIn: this.beforeGroups } } });
                await this.db.user.deleteMany({ where: { id: { notIn: this.beforeUsers } } });
            } finally {
                writeFileSync(join(runState.configDir, 'app-config.json'), JSON.stringify(runState.baseline));
                await this.db.$disconnect();
            }
        }
    }

}

export const test = base.extend<{ scenario: Scenario }>({
    scenario: [async ({ page }, provide, testInfo) => {
        const scenario = new Scenario();
        await scenario.prepare();
        await scenario.control({ title: testInfo.titlePath.join(' › '), retry: testInfo.retry });
        await scenario.guardPage(page);
        try { await provide(scenario); }
        finally {
            await scenario.control({ hold: false });
            try {
                if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
                    await testInfo.attach('failure-page', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
                }
            } finally {
                for (const ownedPage of scenario.pages) { if (!ownedPage.isClosed()) await ownedPage.close(); }
                try {
                    await testInfo.attach('model-calls', { body: JSON.stringify(await scenario.model(), null, 2), contentType: 'application/json' });
                } finally { await scenario.dispose(); }
            }
            expect(scenario.violations, '浏览器不能访问未声明的外部地址').toEqual([]);
        }

    }, { auto: true }],
});
