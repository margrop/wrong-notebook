import { resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { test } from './support/fixtures';
import type { Scenario } from './support/fixtures';

const fixture = (name: string) => resolve('src/__tests__/fixtures/images', name);

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
    await page.locator('[data-testid="file-input"]').setInputFiles(files);
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
        await page.locator('[data-testid="file-input"]').setInputFiles(fixture('math_test.heic'));
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
        await page.locator('[data-testid="file-input"]').setInputFiles(fixture('corrupt.heic'));
        await expect(page.getByText('无法解码这张 HEIC/HEIF 照片', { exact: false })).toBeVisible({ timeout: 30000 });
        await snap(page, testInfo, 'heic-decode-error');
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toHaveCount(0);
        await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
        await expect(page.getByText('所选文件不是可识别的图片', { exact: false })).toBeVisible();
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

test.describe('手机拍照、相册与文件入口', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('[E2E-I06] 三个独立入口分别使用 capture 相机、仅图片的相册和不限类型的文件选择', async ({ page, scenario }, testInfo) => {
        // 无头浏览器没有摄像头：模拟一台有后置摄像头的手机（未授权时设备名为空）
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: '', groupId: '', label: '' }] } });
        });
        await scenario.login(page);
        await page.goto('/');
        const sources = page.getByTestId('image-sources');
        await expect(sources).toBeVisible();
        // 整页截图会临时改变触屏模拟，这里只截可视区域
        await testInfo.attach('mobile-image-sources', { body: await page.screenshot(), contentType: 'image/png' });

        const pick = async (label: string) => {
            const [chooser] = await Promise.all([page.waitForEvent('filechooser'), sources.getByRole('button', { name: label }).click()]);
            return chooser;
        };
        const camera = await pick('拍照');
        expect(await camera.element().getAttribute('capture')).toBe('environment');
        expect(await camera.element().getAttribute('accept')).toBe('image/*');
        // 相机返回照片（带 EXIF 方向）后进入裁剪
        await camera.setFiles(fixture('orientation-6.jpg'));
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible();
        await page.getByRole('button', { name: /取消|Cancel/ }).click();

        const album = await pick('相册');
        expect(await album.element().getAttribute('capture')).toBeNull();
        expect(await album.element().getAttribute('accept')).toBe('image/*');
        // 取消选择不报错
        await album.setFiles([]);

        const file = await pick('从文件选择');
        expect(await file.element().getAttribute('accept')).toBeNull();
        await file.setFiles(fixture('math_test.heic'));
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
    });

    test('[E2E-I07] 设备没有摄像头时提示改用相册或文件', async ({ page, scenario }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [] } });
        });
        await scenario.login(page);
        await page.goto('/');
        let opened = false;
        page.on('filechooser', () => { opened = true; });
        await page.getByTestId('image-sources').getByRole('button', { name: '拍照' }).click();
        await expect(page.getByText('未检测到可用的相机', { exact: false })).toBeVisible();
        expect(opened).toBe(false);
    });

    test('[E2E-I08] 安卓 App 中设备枚举为空也不拦截拍照，交给原生相机', async ({ page, scenario }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: async () => [] } });
            // 模拟安卓 App 注入的接口
            Object.defineProperty(window, 'WrongNotebookAndroid', { configurable: true, value: {
                changeServer: () => undefined, getServerUrl: () => location.origin, getDeviceType: () => 'phone', isStandalone: () => false,
            } });
        });
        await scenario.login(page);
        await page.goto('/');
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByTestId('image-sources').getByRole('button', { name: '拍照' }).click(),
        ]);
        expect(await chooser.element().getAttribute('capture')).toBe('environment');
        await expect(page.getByText('未检测到可用的相机', { exact: false })).toHaveCount(0);
        await chooser.setFiles(fixture('orientation-6.jpg'));
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible();
    });

    test('[E2E-I10] 手机上裁剪框居中且不依赖 CSS translate，确认与取消按钮都在屏幕内', async ({ page, scenario }) => {
        await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
        await scenario.login(page);
        await page.goto('/');
        await page.locator('[data-testid="file-input"]').setInputFiles(fixture('math_test.png'));
        const cropper = page.getByRole('dialog');
        await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
        // 等进入动画结束再量位置
        await expect.poll(() => cropper.evaluate((el) => el.getAnimations().length)).toBe(0);
        // 旧版安卓 WebView 不支持 translate 属性，居中不能靠它
        expect(await cropper.evaluate((el) => getComputedStyle(el).translate)).toBe('none');
        const viewport = page.viewportSize()!;
        const box = (await cropper.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
        for (const name of ['取消', '确认']) {
            await expect(cropper.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
        }
    });
});

test.describe('旧版安卓系统 WebView', () => {
    test.use({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 13; RMX3031 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 WrongNotebookAndroid/2026.11.4 (phone)',
    });

    test('[E2E-I11] 内核低于 111 时提示升级 WebView，可关闭；页面带有 translate 属性的 transform 回退', async ({ page, scenario }) => {
        await scenario.login(page);
        await page.goto('/');
        const notice = page.getByTestId('outdated-browser-notice');
        await expect(notice).toContainText('系统 WebView 版本过旧（103）');
        await expect(notice).toContainText('Android System WebView');
        // 不支持 translate 属性的内核改用 transform：确认这条规则经过构建后仍在样式表中
        const hasFallback = await page.evaluate(() => [...document.styleSheets].some((sheet) => {
            try {
                return [...sheet.cssRules].some((rule) => rule instanceof CSSSupportsRule && rule.conditionText.includes('not (translate'));
            } catch {
                return false;
            }
        }));
        expect(hasFallback).toBe(true);
        await notice.getByRole('button', { name: '关闭' }).click();
        await expect(notice).toHaveCount(0);
    });
});

test('[E2E-I09] 一道题分在两张纸上：第一段暂存后选第二张，两段缩放到同宽后上下拼成一张图识别', async ({ page, scenario }, testInfo) => {
    await scenario.db.user.update({ where: { id: scenario.user.id }, data: { confirmBeforeImport: true } });
    await scenario.login(page);
    await page.goto('/');
    const cropper = page.getByRole('dialog');

    await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'part-1.png', mimeType: 'image/png', buffer: grayPng(600, 400) });
    await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
    await cropper.getByRole('button', { name: '下一段在另一张' }).click();
    await expect(page.getByTestId('question-parts')).toContainText('这道题已暂存 1 段');
    expect(await scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(0);
    await snap(page, testInfo, 'parts-bar');
    // 等裁剪框关闭动画结束（真实操作中，打开相机或相册选图本身就有间隔）
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'part-2.png', mimeType: 'image/png', buffer: grayPng(300, 200) });
    await expect(page.getByRole('heading', { name: /裁剪|Crop/ })).toBeVisible({ timeout: 30000 });
    // 已有暂存的段时只保留单题裁剪，提示这是第 2 段
    await expect(cropper.getByRole('button', { name: '自动分题' })).toHaveCount(0);
    await expect(cropper.getByRole('button', { name: '手工框选' })).toHaveCount(0);
    await expect(cropper.getByText('第 2 段：框选这一段', { exact: false })).toBeVisible();
    await cropper.getByRole('button', { name: '拼成一题并识别（2 段）' }).click();

    await expect.poll(() => scenario.db.importTask.count({ where: { userId: scenario.user.id } })).toBe(1);
    const task = await scenario.db.importTask.findFirstOrThrow({ where: { userId: scenario.user.id } });
    // 第二段 300×200 放大到 600 宽，两段之间留 16 像素白边
    expect(JSON.parse(task.imageInfo!)).toMatchObject({ sourceType: 'stacked-2', outputWidth: 600, outputHeight: 816 });
    const decoded = await inspectJpeg(page, task.imageData!, [[0.5, 408 / 816]]);
    expect(decoded).toMatchObject({ width: 600, height: 816 });
    expect(isWhite(decoded.colors[0])).toBe(true);
    await expect(page.getByTestId('question-parts')).toHaveCount(0);
});
