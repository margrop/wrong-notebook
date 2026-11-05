/**
 * 使用协议正文：打进构建的静态模块与 doc/EULA*.md 文档副本一致，并写明当前版本
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EULA_VERSION } from '@/lib/eula';
import { EULA_TEXT } from '@/lib/eula/text';

describe('使用协议正文', () => {
    it('与文档副本逐字一致', () => {
        expect(EULA_TEXT.zh).toBe(readFileSync(resolve('doc/EULA.md'), 'utf8'));
        expect(EULA_TEXT.en).toBe(readFileSync(resolve('doc/EULA.en.md'), 'utf8'));
    });

    it('中英文都标明当前版本与非法律意见声明', () => {
        expect(EULA_TEXT.zh).toContain(`版本：${EULA_VERSION}`);
        expect(EULA_TEXT.en).toContain(`Version: ${EULA_VERSION}`);
        expect(EULA_TEXT.zh).toContain('不构成法律意见');
        expect(EULA_TEXT.en).toContain('not legal advice');
    });
});
