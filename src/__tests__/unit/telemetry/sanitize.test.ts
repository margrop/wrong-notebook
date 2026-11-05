/**
 * 错误回报脱敏与指纹稳定性
 */
import { describe, expect, it } from 'vitest';
import { normalizedTopFrame, normalizePath, sanitizeMessage, sanitizeStack, summarizeUserAgent } from '@/lib/telemetry/sanitize';
import { errorFingerprint } from '@/lib/telemetry/server';

describe('脱敏', () => {
    it('path 只留 pathname，ID 片段替换为 :id', () => {
        expect(normalizePath('https://host:3000/error-items/clxabc123def456ghi789jkl?x=1#a')).toBe('/error-items/:id');
        expect(normalizePath('/exams/123456/print')).toBe('/exams/:id/print');
        expect(normalizePath('/notebooks/0f3a9c1b2d/add')).toBe('/notebooks/:id/add');
        expect(normalizePath('/practice')).toBe('/practice');
        expect(normalizePath(undefined)).toBeNull();
    });

    it('message 替换邮箱、长数字并去掉 URL 查询串，截断到 500 字符', () => {
        expect(sanitizeMessage('user a.b@example.com failed at https://x.com/api?token=abc for 13800138000'))
            .toBe('user <email> failed at https://x.com/api for <num>');
        expect(sanitizeMessage('x'.repeat(600))).toHaveLength(500);
    });

    it('stack 只保留调用帧，帧里只留 pathname', () => {
        const stack = 'TypeError: secret text\n    at render (http://example.com:3000/_next/static/chunks/page-3f2a9c1b.js?v=1:10:20)\n    at x (webpack-internal:///./src/a.ts:1:2)\nnoise';
        expect(sanitizeStack(stack)).toBe('at render (/_next/static/chunks/page-3f2a9c1b.js:10:20)\nat x (/src/a.ts:1:2)');
        expect(sanitizeStack('no frames')).toBeNull();
    });

    it('UA 只保留浏览器大类、主版本与系统大类', () => {
        expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.1.2 Mobile Safari/537.36')).toBe('Chrome 140 / Android');
        expect(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari 18 / iOS');
        expect(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge 130 / Windows');
    });
});

describe('指纹', () => {
    it('不同构建（chunk 哈希、主机、行列号不同）下保持一致', () => {
        const a = 'Error: x\n    at f (http://a:3000/_next/static/chunks/page-3f2a9c1b.js:10:20)';
        const b = 'Error: y\n    at f (https://b.example.com/_next/static/chunks/page-9e8d7c6b.js:11:5)';
        expect(normalizedTopFrame(a)).toBe(normalizedTopFrame(b));
        const fp = errorFingerprint({ kind: 'client', scope: '[GlobalError]', name: 'Error', stack: a });
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
        expect(errorFingerprint({ kind: 'client', scope: '[GlobalError]', name: 'Error', stack: b })).toBe(fp);
        expect(errorFingerprint({ kind: 'client', scope: '[GlobalError]', name: 'TypeError', stack: b })).not.toBe(fp);
    });
});
