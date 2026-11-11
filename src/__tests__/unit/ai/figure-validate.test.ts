import { describe, expect, it } from 'vitest';
import { findSvgXmlError, repairSvgEntities } from '@/lib/ai/figure-validate';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

describe('findSvgXmlError', () => {
    it('合法 SVG 返回 null', () => {
        expect(findSvgXmlError(`<svg ${NS}><text>A&amp;B</text><line x1="0" y1="0" x2="1" y2="1"/></svg>`)).toBeNull();
    });

    it('重复属性、未闭合标签与 HTML 实体都报错', () => {
        expect(findSvgXmlError(`<svg ${NS}><line x1="0" x1="1"/></svg>`)).toContain('duplicate attribute');
        expect(findSvgXmlError(`<svg ${NS}><g><rect width="1" height="1"/></svg>`)).not.toBeNull();
        expect(findSvgXmlError(`<svg ${NS}><text>&nbsp;</text></svg>`)).not.toBeNull();
    });

    it('未声明的命名空间前缀报错（浏览器同样拒绝加载）', () => {
        expect(findSvgXmlError(`<svg ${NS}><use xlink:href="#a"/></svg>`)).not.toBeNull();
        expect(findSvgXmlError(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>`)).toBeNull();
    });
});

describe('repairSvgEntities', () => {
    it('转义裸 &，HTML 实体改为数字字符引用，合法实体保持不变', () => {
        expect(repairSvgEntities('<text>A & B</text>')).toBe('<text>A &amp; B</text>');
        expect(repairSvgEntities('<text>1&nbsp;cm&times;2</text>')).toBe('<text>1&#160;cm&#215;2</text>');
        expect(repairSvgEntities('<text>&lt;&amp;&#176;&#xB0;</text>')).toBe('<text>&lt;&amp;&#176;&#xB0;</text>');
        expect(repairSvgEntities('<text>&unknown;</text>')).toBe('<text>&amp;unknown;</text>');
        expect(findSvgXmlError(`<svg ${NS}>${repairSvgEntities('<text>a & b&nbsp;</text>')}</svg>`)).toBeNull();
    });
});
