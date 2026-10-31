/**
 * 全站安全响应头：防嵌入、防 MIME 嗅探，且不影响上传题目所需的摄像头和屏幕截图
 */
import { describe, it, expect } from 'vitest';
import nextConfig, { securityHeaders } from '../../../next.config';

const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value;

describe('安全响应头', () => {
    it('对所有路径生效', async () => {
        const rules = await nextConfig.headers!();
        expect(rules).toEqual([{ source: '/:path*', headers: securityHeaders }]);
        expect(nextConfig.poweredByHeader).toBe(false);
    });

    it('禁止其他站点嵌入和 MIME 嗅探', () => {
        expect(header('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(header('X-Content-Type-Options')).toBe('nosniff');
        expect(header('Content-Security-Policy')).toContain("frame-ancestors 'self'");
        expect(header('Content-Security-Policy')).toContain("object-src 'none'");
    });

    it('不限制脚本来源，也不强制 HTTPS（局域网 HTTP 与 GeoGebra 需要）', () => {
        expect(header('Content-Security-Policy')).not.toMatch(/script-src|default-src/);
        expect(header('Strict-Transport-Security')).toBeUndefined();
    });

    it('保留摄像头和屏幕截图权限', () => {
        expect(header('Permissions-Policy')).toContain('camera=(self)');
        expect(header('Permissions-Policy')).toContain('display-capture=(self)');
    });
});
