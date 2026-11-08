import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidAppSetting } from '@/components/settings/android-app-setting';
import { LanguageProvider } from '@/contexts/LanguageContext';
import {
    androidLibraryName,
    compareDebianVersions,
    extractDebData,
    parseTermuxPackages,
    resolveTermuxDependencies,
} from '../../../scripts/package/android-runtime.mjs';
import { androidVersionCode } from '../../../scripts/package/android-version.mjs';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
});

const render = () => act(async () => root.render(<LanguageProvider><AndroidAppSetting /></LanguageProvider>));

describe('AndroidAppSetting', () => {
    it('普通浏览器中不显示', async () => {
        await render();
        expect(container.querySelector('button')).toBeNull();
    });

    it('安卓客户端中显示服务器地址，点击按钮调用原生更换服务器', async () => {
        const changeServer = vi.fn();
        vi.stubGlobal('WrongNotebookAndroid', {
            changeServer,
            getServerUrl: () => 'http://192.168.1.10:3000',
            getDeviceType: () => 'tablet',
        });
        await render();
        expect(container.textContent).toContain('http://192.168.1.10:3000');
        await act(async () => container.querySelector('button')?.click());
        expect(changeServer).toHaveBeenCalledTimes(1);
    });

    it('单机版说明数据保存在本机，不显示更换服务器', async () => {
        vi.stubGlobal('WrongNotebookAndroid', {
            changeServer: vi.fn(),
            getServerUrl: () => 'http://127.0.0.1:38017',
            getDeviceType: () => 'phone',
            isStandalone: () => true,
        });
        await render();
        expect(container.querySelector('button')).toBeNull();
        expect(container.textContent).not.toContain('127.0.0.1');
        expect(container.textContent).toMatch(/本机|this device/);
    });
});

describe('安卓单机版运行时', () => {
    const index = parseTermuxPackages([
        'Package: nodejs-lts',
        'Version: 24.18.0-2',
        'Depends: libc++, openssl (>= 3.0), zlib | zlib-ng',
        'Filename: pool/main/n/nodejs-lts/nodejs-lts_24.18.0-2_aarch64.deb',
        'SHA256: abc',
        'Description: Node.js',
        ' second line',
        '',
        'Package: openssl',
        'Version: 1:3.6.5',
        'Depends: ca-certificates, zlib',
        '',
        'Package: libc++',
        'Version: 30',
        '',
        'Package: zlib',
        'Version: 1.3.2',
        '',
        'Package: ca-certificates',
        'Version: 1:2026.10.20-1',
    ].join('\n'));

    it('解析软件源索引并递归收集依赖，忽略版本约束和备选依赖', () => {
        expect(index.get('nodejs-lts')?.SHA256).toBe('abc');
        expect(index.get('nodejs-lts')?.Description).toBe('Node.js\nsecond line');
        expect(resolveTermuxDependencies(index, 'nodejs-lts').map((p) => p.Package))
            .toEqual(['ca-certificates', 'libc++', 'nodejs-lts', 'openssl', 'zlib']);
        expect(() => resolveTermuxDependencies(index, 'missing')).toThrow();
    });

    it('同一包列出基础版本与修订版本时取最新（nodejs 26.13.0-1 而非 26.13.0）', () => {
        expect(compareDebianVersions('26.13.0-1', '26.13.0')).toBeGreaterThan(0);
        expect(compareDebianVersions('1:2026.11.05', '2026.10.20')).toBeGreaterThan(0);
        const duplicate = parseTermuxPackages([
            'Package: nodejs',
            'Version: 26.13.0',
            'Filename: pool/main/n/nodejs/nodejs_26.13.0_aarch64.deb',
            '',
            'Package: nodejs',
            'Version: 26.13.0-1',
            'Filename: pool/main/n/nodejs/nodejs_26.13.0-1_aarch64.deb',
        ].join('\n'));
        expect(duplicate.get('nodejs')?.Version).toBe('26.13.0-1');
        expect(duplicate.get('nodejs')?.Filename).toContain('nodejs_26.13.0-1');
    });

    it('带版本后缀的库改名为 jniLibs 可打包的 lib*.so', () => {
        expect(androidLibraryName('libc++_shared.so')).toBe('libc++_shared.so');
        expect(androidLibraryName('libz.so.1')).toBe('libz1.so');
        expect(androidLibraryName('libicuuc.so.78')).toBe('libicuuc78.so');
        expect(androidLibraryName('libsqlite3.so.0.8')).toBe('libsqlite30_8.so');
        expect(() => androidLibraryName('node')).toThrow();
    });

    it('从 deb 中取出 data.tar', () => {
        const member = (name: string, body: string) => {
            const header = Buffer.alloc(60, ' ');
            header.write(`${name}/`, 0, 'latin1');
            header.write(String(body.length), 48, 'latin1');
            header.write('`\n', 58, 'latin1');
            return Buffer.concat([header, Buffer.from(body, 'latin1'), Buffer.from(body.length % 2 ? '\n' : '')]);
        };
        const deb = Buffer.concat([
            Buffer.from('!<arch>\n', 'latin1'),
            member('debian-binary', '2.0\n'),
            member('control.tar.xz', 'ctl'),
            member('data.tar.xz', 'payload'),
        ]);
        const { name, data } = extractDebData(deb);
        expect(name).toBe('data.tar.xz');
        expect(data.toString('latin1')).toBe('payload');
        expect(() => extractDebData(Buffer.from('not a deb'))).toThrow();
    });
});

describe('androidVersionCode', () => {
    it('预览版按当天序号计算，正式版排在当天预览版之后', () => {
        expect(androidVersionCode('2026.10.22-1')).toBe(2026102201);
        expect(androidVersionCode('2026.10.22-12')).toBe(2026102212);
        expect(androidVersionCode('2026.10.22')).toBe(2026102299);
        expect(androidVersionCode('2026.10.22')).toBeLessThan(androidVersionCode('2026.10.23-1'));
        expect(androidVersionCode('2026.9.30')).toBeLessThan(androidVersionCode('2026.10.1-1'));
    });

    it('兼容 v 前缀和 git describe 形式', () => {
        expect(androidVersionCode('v2026.1.5-2')).toBe(2026010502);
        expect(androidVersionCode('2026.10.22-3-gabc1234')).toBe(2026102203);
    });

    it('无法识别的版本号或越界序号报错', () => {
        expect(() => androidVersionCode('1.0.0')).toThrow();
        expect(() => androidVersionCode('2026.10.22-99')).toThrow();
    });
});
