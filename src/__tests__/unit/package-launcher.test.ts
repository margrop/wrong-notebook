/**
 * 安装包启动器单元测试
 * 覆盖命令行参数解析、SQLite 地址转换和会话密钥生成
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const launcher = require('../../../packaging/runtime/launcher.js') as {
    parseArgs: (argv: string[]) => { port?: string; host?: string; dataDir?: string };
    sqliteUrl: (file: string) => string;
    ensureSecret: (dataDir: string) => string;
};

describe('package launcher', () => {
    it('解析长短参数和等号写法', () => {
        expect(launcher.parseArgs(['--port', '8080', '-H', '127.0.0.1', '--data-dir=/srv/data'])).toEqual({
            port: '8080',
            host: '127.0.0.1',
            dataDir: '/srv/data',
        });
        expect(launcher.parseArgs(['-p=3001', '-d', 'data'])).toEqual({ port: '3001', dataDir: 'data' });
    });

    it('忽略未知参数', () => {
        expect(launcher.parseArgs(['--verbose', 'start'])).toEqual({});
    });

    it('SQLite 地址使用正斜杠', () => {
        const file = ['data', 'wrong-notebook.db'].join(path.sep);
        expect(launcher.sqliteUrl(file)).toBe('file:data/wrong-notebook.db');
    });

    it('会话密钥首次生成后保持不变，空文件会被重新生成', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-secret-'));
        try {
            const first = launcher.ensureSecret(dir);
            expect(first).toMatch(/^[A-Za-z0-9+/]{43}=$/);
            expect(launcher.ensureSecret(dir)).toBe(first);

            fs.writeFileSync(path.join(dir, '.nextauth_secret'), '');
            const regenerated = launcher.ensureSecret(dir);
            expect(regenerated).not.toBe('');
            expect(fs.readFileSync(path.join(dir, '.nextauth_secret'), 'utf8')).toBe(regenerated);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('npm 打包文件列表包含启动时同步语文标签所需的 dist-scripts', () => {
        const buildScript = fs.readFileSync(path.resolve(__dirname, '../../../scripts/package/build.mjs'), 'utf8');
        const match = /files:\s*\[([^\]]+)\]/.exec(buildScript);
        expect(match?.[1]).toContain("'dist-scripts'");
    });
});
