// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseLoopbackOrigin } from '../../../e2e/support/local-origin';

describe('E2E 服务地址边界', () => {
    it('只用数字端口重建固定回环地址', () => {
        expect(parseLoopbackOrigin('http://127.0.0.1:8123/')).toBe('http://127.0.0.1:8123');
    });

    it.each([
        'https://example.test:8123', 'http://127.0.0.1.example.test:8123',
        'http://user:password@127.0.0.1:8123', 'https://127.0.0.1:8123',
        'http://127.0.0.1:8123/private-file', 'http://127.0.0.1:8123?file=secret',
        'http://127.0.0.1:8123#secret', 'http://127.0.0.1', 'http://127.0.0.1:0',
        'http://127.0.0.1:65536', undefined,
    ])('拒绝远端主机、凭据、文件数据和无效端口：%s', (value) => {
        expect(() => parseLoopbackOrigin(value)).toThrow();
    });
});
