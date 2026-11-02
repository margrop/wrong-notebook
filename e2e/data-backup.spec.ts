import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, runState } from './support/fixtures';
import { openSettings } from './support/flows';
import { FIGURE } from './support/mock-ai.mjs';
import { acceptConfirmDialog } from './helpers';

test('[E2E-M07] 拒绝跨邮箱导入并在同邮箱空账号恢复备份', async ({ page, browser, scenario }) => {
    const secondBook = await scenario.db.subject.create({ data: { name: '第二套体系', userId: scenario.user.id, stage: 'junior_high', subjectKey: 'math', tagSet: 'e2e-secondary' } });
    const leafIds: string[] = [];
    for (const [index, tagSet] of ['default', 'e2e-secondary'].entries()) {
        const parent = await scenario.db.knowledgeTag.create({ data: { name: ['章节甲', '章节乙'][index], subject: 'math', userId: scenario.user.id, tagSet } });
        const child = await scenario.db.knowledgeTag.create({ data: { name: '同名知识点', subject: 'math', userId: scenario.user.id, tagSet, parentId: parent.id } });
        leafIds.push(child.id);
    }
    const a = await scenario.item('A', { figureSvg: FIGURE, hasFigure: true, figureScale: 50, figureAlign: 'left', userNotes: '备份中的笔记', masteryProbability: 0.7, masteryEvaluatedAt: new Date() });
    const b = await scenario.item('B', { subjectId: secondBook.id, questionText: `请根据材料解释钟摆运动的原因，并写出完整论证。E2E_${scenario.id}_B`, masteryProbability: 0.7, masteryEvaluatedAt: new Date() });
    await scenario.db.errorItem.update({ where: { id: a.id }, data: { tags: { connect: [{ id: leafIds[0] }, { id: 'e2e-leaf-default' }] } } });
    await scenario.db.errorItem.update({ where: { id: b.id }, data: { tags: { connect: [{ id: leafIds[1] }, { id: 'e2e-leaf-e2e-secondary' }] } } });
    await scenario.db.practiceRecord.create({ data: { userId: scenario.user.id, errorItemId: a.id, result: 'correct', source: 'practice', questionText: '备份中的练习题' } });
    await scenario.db.examPaper.create({ data: { userId: scenario.user.id, title: '备份中的试卷', status: 'ready', scope: 'all', difficulty: 'medium', requestedCount: 1,
        subjectIds: JSON.stringify([scenario.book.id]), questions: { create: { order: 1, errorItemId: a.id, sourceShortId: a.shortId!, status: 'ready', questionText: '备份中的试卷新题',
            answerText: '答案', analysis: '解析', figureSvg: FIGURE, figureScale: 75, figureAlign: 'right' } } } });
    await scenario.login(page);
    await page.goto('/');
    const dialog = await openSettings(page, '危险');
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出数据', exact: true }).click();
    const download = await downloadPromise;
    const file = join(runState.reportDir, `${scenario.id}-backup.json`);
    await download.saveAs(file);
    const contents = readFileSync(file, 'utf8');
    const backup = JSON.parse(contents) as { version: number; user: Record<string, unknown>; errorItems: unknown[] };
    expect(backup.version).toBe(4);
    expect(backup.errorItems).toHaveLength(2);
    expect(backup.user).not.toHaveProperty('password');
    expect(contents).not.toContain('e2e-dummy-key');

    const foreign = await browser.newPage({ baseURL: runState.origin });
    try {
        await scenario.guardPage(foreign);
        await scenario.login(foreign, true);
        await foreign.goto('/');
        const settings = await openSettings(foreign, '危险');
        // 新账号可自动初始化默认空本和默认卷别，核对导入前后集合完全相同。
        expect((await foreign.request.get('/api/notebooks')).ok()).toBeTruthy();
        expect((await foreign.request.get('/api/paper-groups')).ok()).toBeTruthy();
        const booksBefore = await scenario.db.subject.findMany({ where: { userId: scenario.otherUser.id }, orderBy: { id: 'asc' } });
        const groupsBefore = await scenario.db.paperGroup.findMany({ where: { userId: scenario.otherUser.id }, orderBy: { id: 'asc' } });
        await settings.locator('input[type="file"]').setInputFiles(file);
        await settings.getByRole('button', { name: '导入数据', exact: true }).click();
        const rejected = foreign.waitForResponse((response) => response.url().endsWith('/api/import') && response.request().method() === 'POST');
        await acceptConfirmDialog(foreign);
        expect((await rejected).status()).toBe(400);
        expect(await scenario.db.errorItem.count({ where: { userId: scenario.otherUser.id } })).toBe(0);
        expect(await scenario.db.subject.findMany({ where: { userId: scenario.otherUser.id }, orderBy: { id: 'asc' } })).toEqual(booksBefore);
        expect(await scenario.db.practiceRecord.count({ where: { userId: scenario.otherUser.id } })).toBe(0);
        expect(await scenario.db.paperGroup.findMany({ where: { userId: scenario.otherUser.id }, orderBy: { id: 'asc' } })).toEqual(groupsBefore);
        expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
    } finally { await foreign.close(); }
    // 仅在本次临时库重建同邮箱账号，模拟新设备上的空账号，保留身份校验。
    await scenario.resetCurrentAccount();
    await scenario.login(page);
    const receiver = page;
    await receiver.goto('/');
    const settings = await openSettings(receiver, '危险');
    await settings.locator('input[type="file"]').setInputFiles(file);
    await settings.getByRole('button', { name: '导入数据', exact: true }).click();
    const imported = receiver.waitForResponse((response) => response.url().endsWith('/api/import') && response.request().method() === 'POST');
    // 导入成功后页面会自动刷新，等待本次刷新完成再进行后续导航。
    const reloaded = receiver.waitForEvent('load');
    await acceptConfirmDialog(receiver);
    expect((await imported).ok()).toBeTruthy();
    await reloaded;
        await expect.poll(() => scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
        const restored = await scenario.db.errorItem.findMany({ where: { userId: scenario.user.id }, include: { tags: { include: { parent: true } }, subject: true } });
        const restoredA = restored.find((item) => item.questionText === a.questionText)!;
        const restoredB = restored.find((item) => item.questionText === b.questionText)!;
        expect(restoredA).toMatchObject({ figureScale: 50, figureAlign: 'left', userNotes: '备份中的笔记' });
        expect(restoredA.tags.find((tag) => tag.name === '同名知识点')).toMatchObject({ userId: scenario.user.id, tagSet: 'default', parent: { name: '章节甲' } });
        expect(restoredB.tags.find((tag) => tag.name === '同名知识点')).toMatchObject({ userId: scenario.user.id, tagSet: 'e2e-secondary', parent: { name: '章节乙' } });
        expect(restoredB.subject?.tagSet).toBe('e2e-secondary');
        expect(await scenario.db.practiceRecord.count({ where: { userId: scenario.user.id, errorItemId: restoredA.id } })).toBe(1);
        const paper = await scenario.db.examPaper.findFirstOrThrow({ where: { userId: scenario.user.id }, include: { questions: true } });
        expect(paper.questions[0]).toMatchObject({ errorItemId: restoredA.id, figureScale: 75, figureAlign: 'right' });
        await receiver.goto('/notebooks');
        await receiver.getByText(restoredA.subject!.name, { exact: true }).first().click();
        await receiver.waitForURL(`**/notebooks/${restoredA.subjectId}`);
        await expect(receiver.getByText(a.questionText!, { exact: false })).toBeVisible();
        await receiver.locator(`a[href="/error-items/${restoredA.id}"]`).first().click();
        await expect(receiver.getByText('同名知识点', { exact: true })).toBeVisible();
        await expect(receiver.getByRole('spinbutton', { name: '配图显示比例', exact: true })).toHaveValue('50');
        await expect(receiver.getByText('备份中的笔记', { exact: false })).toBeVisible();
        await receiver.goto(`/exams/${paper.id}`);
        await expect(receiver.getByText('备份中的试卷新题', { exact: false })).toBeVisible();
        expect(await scenario.db.errorItem.count({ where: { userId: scenario.user.id } })).toBe(2);
});
