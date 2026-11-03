import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { test } from './support/fixtures';
import type { Scenario } from './support/fixtures';

const fixture = (name: string) => resolve('e2e/fixtures', name);

/** 生成灰度 PNG（每行一种灰度），用于构造「文件很小但像素很多」的图片 */
function grayPng(width: number, height: number): Buffer {
    const chunk = (type: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 0;
    const rows = Buffer.alloc((width + 1) * height);
    for (let y = 0; y < height; y++) rows.fill(y % 40 < 2 ? 0 : 255, y * (width + 1) + 1, (y + 1) * (width + 1));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** 选择图片后确认整图裁剪，返回落库的识别任务 */
async function uploadWhole(page: Page, scenario: Scenario, files: Parameters<Page['setInputFiles']>[1]) {
    await page.locator('input[type="file"]').first().setInputFiles(files);
    await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /确认|Confirm/ }).click();
    await expect.poll(() => scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBeGreaterThan(0);
    return scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id }, orderBy: { createdAt: 'desc' } });
}

/** 在浏览器中解码上传的 JPEG，读取尺寸与指定位置的像素颜色 */
async function inspectJpeg(page: Page, dataUrl: string, points: Array<[number, number]>) {
    return page.evaluate(async ({ url, points: samples }) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        return {
            width: bitmap.width,
            height: bitmap.height,
            colors: samples.map(([x, y]) => Array.from(context.getImageData(Math.round(x * bitmap.width), Math.round(y * bitmap.height), 1, 1).data.slice(0, 3))),
        };
    }, { url: dataUrl, points });
}

const isRed = ([r, g, b]: number[]) => r > 200 && g < 80 && b < 80;
const isWhite = ([r, g, b]: number[]) => r > 220 && g > 220 && b > 220;

async function snap(page: Page, testInfo: TestInfo, name: string) {
    await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

test.describe('照片格式与尺寸', () => {
    test.beforeEach(async ({ page, scenario }) => {
        await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
        await scenario.login(page);
        await page.goto('/');
    });

    test('[E2E-I01] 真实 HEIC 照片在浏览器无法直接解码时按需加载解码库，转为真正的 JPEG 后进入裁剪', async ({ page, scenario }, testInfo) => {
        const largeScripts = () => page.evaluate(() => performance.getEntriesByType('resource')
            .filter((entry) => entry.name.endsWith('.js') && (entry as PerformanceResourceTiming).decodedBodySize > 1_000_000).length);
        expect(await largeScripts()).toBe(0);
        await page.locator('input[type="file"]').first().setInputFiles(fixture('math_test.heic'));
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
        // 解码库只在需要时加载
        expect(await largeScripts()).toBeGreaterThan(0);
        await snap(page, testInfo, 'heic-cropper');
        await page.getByRole('button', { name: /确认|Confirm/ }).click();
        await expect.poll(() => scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(1);
        const task = await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } });
        expect(task.imageData).toMatch(/^data:image\/jpeg;base64,\/9j\//);
        const info = JSON.parse(task.imageInfo!);
        expect(info).toMatchObject({ decoder: 'heic', sourceWidth: 1024, sourceHeight: 1024, outputWidth: 1024, outputHeight: 1024 });
        const timings = JSON.parse(task.timings!);
        expect(Object.keys(timings.client).sort()).toEqual(['compress', 'convert', 'crop', 'read']);
        const decoded = await inspectJpeg(page, task.imageData, [[0.5, 0.5]]);
        expect(decoded).toMatchObject({ width: 1024, height: 1024 });
    });

    test('[E2E-I02] 方向：HEIC 的旋转信息与 JPEG 的 EXIF 方向都在裁剪前校正', async ({ page, scenario }) => {
        for (const name of ['orientation-6.heic', 'orientation-6.jpg']) {
            const task = await uploadWhole(page, scenario, fixture(name));
            const info = JSON.parse(task.imageInfo!);
            // 存储为 600×300，按方向 6（顺时针 90°）显示为 300×600
            expect(info).toMatchObject({ sourceWidth: 300, sourceHeight: 600, outputWidth: 300, outputHeight: 600 });
            const { colors } = await inspectJpeg(page, task.imageData, [[0.9, 0.05], [0.1, 0.05], [0.1, 0.95]]);
            // 存储方向左上角的红块旋转后位于右上角
            expect(isRed(colors[0]), `${name} 右上角应为红色：${colors[0]}`).toBe(true);
            expect(isWhite(colors[1]), `${name} 左上角应为白色：${colors[1]}`).toBe(true);
            expect(isWhite(colors[2]), `${name} 左下角应为白色：${colors[2]}`).toBe(true);
            await scenario.db.importTask.deleteMany({ where: { userId: scenario.user.id } });
            await page.goto('/');
        }
    });

    test('[E2E-I03] 扩展名为 .jpg 的 HEIC 按真实格式解码', async ({ page, scenario }) => {
        const task = await uploadWhole(page, scenario, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(await (await import('node:fs/promises')).readFile(fixture('heic-named-as.jpg'))) });
        expect(JSON.parse(task.imageInfo!)).toMatchObject({ sourceType: 'image/jpeg', decoder: 'heic', sourceWidth: 1024 });
    });

    test('[E2E-I04] 无法解码的 HEIC 给出明确提示，不进入裁剪', async ({ page, scenario }, testInfo) => {
        await page.locator('input[type="file"]').first().setInputFiles(fixture('corrupt.heic'));
        await expect(page.getByText('无法解码这张 HEIC/HEIF 照片', { exact: false })).toBeVisible({ timeout: 30000 });
        await snap(page, testInfo, 'heic-decode-error');
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toHaveCount(0);
        expect(await scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(0);
    });

    test('[E2E-I05] 800×8000 的小体积长图同样受像素与最长边限制，不因文件小而原样上传', async ({ page, scenario }) => {
        const png = grayPng(800, 8000);
        expect(png.length).toBeLessThan(1024 * 1024);
        const task = await uploadWhole(page, scenario, { name: 'tall.png', mimeType: 'image/png', buffer: png });
        const info = JSON.parse(task.imageInfo!);
        expect(info).toMatchObject({ sourceWidth: 800, sourceHeight: 8000, outputWidth: 409, outputHeight: 4096 });
        expect(info.outputWidth * info.outputHeight).toBeLessThanOrEqual(2560 * 1920);
        expect(task.imageData).toMatch(/^data:image\/jpeg;/);
    });
});
