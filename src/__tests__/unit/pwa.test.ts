import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/lib/logger', () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}));

import manifest from '@/app/manifest';
import { config } from '@/proxy';

const publicDir = path.resolve(__dirname, '../../../public');

describe('PWA', () => {
    it('manifest 提供 192/512 图标和 maskable 图标，且文件存在', () => {
        const icons = manifest().icons ?? [];
        expect(icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
        expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
        for (const icon of icons) {
            expect(fs.existsSync(path.join(publicDir, icon.src))).toBe(true);
        }
    });

    it('manifest 不锁定屏幕方向，平板可横屏使用', () => {
        expect(manifest().orientation).toBe('any');
        expect(manifest().display).toBe('standalone');
    });

    it('Service Worker 与离线页不经过登录拦截', () => {
        const matcher = new RegExp(`^${config.matcher[0]}$`);
        expect(matcher.test('/sw.js')).toBe(false);
        expect(matcher.test('/offline.html')).toBe(false);
        expect(matcher.test('/notebooks')).toBe(true);
    });

    it('Service Worker 预缓存的离线页存在，且不缓存 API', () => {
        const sw = fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8');
        expect(sw).toContain("'/offline.html'");
        expect(fs.existsSync(path.join(publicDir, 'offline.html'))).toBe(true);
        expect(sw).not.toMatch(/['"]\/api\//);
    });
});
