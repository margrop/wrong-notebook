import { describe, expect, it } from 'vitest';
import { figureSvgToDataUri, MAX_FIGURE_SVG_LENGTH, repairDuplicateSvgAttributes, sanitizeFigureSvg } from '@/lib/figure-svg';
import { parseFigure } from '@/lib/ai/schema';

const triangle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><polygon points="10,190 190,190 100,10" fill="none" stroke="#000"/><text x="5" y="198">A</text></svg>';

describe('sanitizeFigureSvg', () => {
    it('保留正常的几何图形', () => {
        expect(sanitizeFigureSvg(triangle)).toBe(triangle);
    });

    it('从 Markdown 代码块和前后说明文字中取出 SVG', () => {
        expect(sanitizeFigureSvg('这是配图：\n```svg\n' + triangle + '\n```\n画完了')).toBe(triangle);
    });

    it('去掉脚本、外部内容、事件属性和外部链接', () => {
        const dirty = '<svg viewBox="0 0 10 10" onload="alert(1)">'
            + '<script>alert(1)</script>'
            + '<foreignObject><div>x</div></foreignObject>'
            + '<image href="https://evil.example/a.png"/>'
            + '<a href="javascript:alert(1)"><circle cx="5" cy="5" r="4" onclick="steal()"/></a>'
            + '<use href="#p"/><path id="p" d="M0 0L1 1" style="fill:url(https://evil.example/x)"/>'
            + '<style>@import url("https://evil.example/x.css"); line { stroke: #000 }</style>'
            + '</svg>';
        const clean = sanitizeFigureSvg(dirty)!;

        expect(clean).not.toMatch(/script|foreignObject|<image|onload|onclick|javascript:|evil\.example|@import/i);
        expect(clean).toContain('<circle');
        expect(clean).toContain('<use href="#p"/>'); // 指向文档内部的引用保留
        expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"'); // 缺少命名空间时补上，<img> 才能加载
    });

    it('嵌套拼接的脚本、事件属性和伪协议不会在净化后重新出现', () => {
        const svg = sanitizeFigureSvg(
            '<svg viewBox="0 0 10 10"><scr<script></script>ipt>alert(1)</script>'
            + '<rect x="1" oonnload="1" onclick="x()" width="5" height="5"/>'
            + '<text style="background:url(javajavascript:script:x)">a</text>'
            + '<a href="vbscript:x"><circle r="1" fill="data:x"/></a></svg>'
        );
        expect(svg).not.toBeNull();
        expect(svg).not.toMatch(/<script/i);
        expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
        expect(svg).not.toMatch(/javascript:|vbscript:|data:/i);
        expect(svg).toContain('<rect');
    });

    it('没有图形元素、不是 SVG、超长或不是字符串时返回 null', () => {
        expect(sanitizeFigureSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
        expect(sanitizeFigureSvg('<svg><script>alert(1)</script></svg>')).toBeNull();
        expect(sanitizeFigureSvg('没有配图')).toBeNull();
        expect(sanitizeFigureSvg('')).toBeNull();
        expect(sanitizeFigureSvg(null)).toBeNull();
        expect(sanitizeFigureSvg(42)).toBeNull();
        expect(sanitizeFigureSvg('<svg><text>' + 'x'.repeat(MAX_FIGURE_SVG_LENGTH) + '</text></svg>')).toBeNull();
    });

    it('生成可用于 <img> 的 data URI', () => {
        const uri = figureSvgToDataUri(triangle);
        expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
        expect(decodeURIComponent(uri.split(',').slice(1).join(','))).toBe(triangle);
    });
});

describe('parseFigure', () => {
    it('有效配图视为有配图；只标记有配图但没画出时保留标记', () => {
        expect(parseFigure('true', triangle)).toEqual({ hasFigure: true, figureSvg: triangle });
        expect(parseFigure('false', triangle)).toEqual({ hasFigure: true, figureSvg: triangle });
        expect(parseFigure(' TRUE ', '')).toEqual({ hasFigure: true, figureSvg: null });
        expect(parseFigure('false', null)).toEqual({ hasFigure: false, figureSvg: null });
        expect(parseFigure(null, null)).toEqual({ hasFigure: false, figureSvg: null });
    });
});

describe('repairDuplicateSvgAttributes', () => {
    const isValidXml = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror').length === 0;

    it('把重复写了 x2/y2 的 <line> 改成折线，箭头与描边属性保留', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 350"><g fill="none" stroke="#000">'
            + '<line x1="95" y1="95" x2="95" y2="60" x2="270" y2="60"/>'
            + '<line x1="430" y1="176" x2="430" y2="202" x2="225" y2="202" marker-end="url(#arrowhead)"/>'
            + '<line x1="0" y1="0" x2="10" y2="10"/></g></svg>';
        expect(isValidXml(svg)).toBe(false);

        const repaired = repairDuplicateSvgAttributes(svg);
        expect(isValidXml(repaired)).toBe(true);
        expect(repaired).toContain('<polyline points="95,95 95,60 270,60" fill="none"/>');
        expect(repaired).toContain('<polyline points="430,176 430,202 225,202" fill="none" marker-end="url(#arrowhead)"/>');
        expect(repaired).toContain('<line x1="0" y1="0" x2="10" y2="10"/>');
    });

    it('其他元素的重复属性只保留第一个，正常 SVG 原样返回', () => {
        expect(repairDuplicateSvgAttributes('<rect x="1" width="5" x="2" height="5">')).toBe('<rect x="1" width="5" height="5">');
        expect(repairDuplicateSvgAttributes(triangle)).toBe(triangle);
    });

    it('净化与显示时都会修复，已保存的旧配图也能显示', () => {
        const broken = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="0" y1="0" x2="5" y2="0" x2="5" y2="5" stroke="#000"/></svg>';
        expect(sanitizeFigureSvg(broken)).toContain('<polyline points="0,0 5,0 5,5" fill="none" stroke="#000"/>');
        expect(decodeURIComponent(figureSvgToDataUri(broken))).toContain('<polyline points="0,0 5,0 5,5"');
    });
});
