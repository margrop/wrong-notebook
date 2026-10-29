import { describe, expect, it } from 'vitest';
import { MAX_SVG_ANIMATION_LENGTH, sanitizeSvgAnimation } from '@/lib/svg-animation';
import { generateSvgAnimationPrompt } from '@/lib/ai/prompts';

const animation = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">'
    + '<rect width="800" height="500" fill="#fff"/>'
    + '<line x1="0" y1="0" x2="100" y2="100" stroke="#000"><animate attributeName="x2" from="0" to="100" dur="2s" fill="freeze"/></line>'
    + '<text x="20" y="480" opacity="0">第一步<set attributeName="opacity" to="1" begin="2s" fill="freeze"/></text>'
    + '<g><animateTransform attributeName="transform" type="rotate" from="0" to="90" dur="3s" fill="freeze"/></g>'
    + '</svg>';

describe('sanitizeSvgAnimation', () => {
    it('保留 SMIL 动画元素', () => {
        expect(sanitizeSvgAnimation(animation)).toBe(animation);
    });

    it('去掉脚本、事件属性和改写链接的动画', () => {
        const dirty = animation.replace('</svg>', ''
            + '<script>alert(1)</script>'
            + '<a><animate attributeName="href" to="https://evil.example" begin="1s"/><circle r="3" onclick="x()"/></a>'
            + '<set attributeName="xlink:href" to="#other"/>'
            + '</svg>');
        const clean = sanitizeSvgAnimation(dirty)!;

        expect(clean).not.toMatch(/script|onclick|evil\.example|attributeName="(xlink:)?href"/);
        expect(clean).toContain('<circle r="3"/>');
        expect(clean).toContain('<animate attributeName="x2"');
    });

    it('没有有效 SVG 或超长时返回 null', () => {
        expect(sanitizeSvgAnimation('无法生成')).toBeNull();
        expect(sanitizeSvgAnimation(null)).toBeNull();
        const long = animation.replace('</svg>', `<text>${'x'.repeat(MAX_SVG_ANIMATION_LENGTH)}</text></svg>`);
        expect(sanitizeSvgAnimation(long)).toBeNull();
    });

    it('长度在配图上限以上、动画上限以内时仍可保存', () => {
        const svg = animation.replace('</svg>', `<text>${'x'.repeat(150_000)}</text></svg>`);
        expect(sanitizeSvgAnimation(svg)).not.toBeNull();
    });
});

describe('generateSvgAnimationPrompt', () => {
    it('填入题目、答案、解析和配图，空字段显示占位', () => {
        const prompt = generateSvgAnimationPrompt('求面积', '', '底乘高', '<svg><rect/></svg>');
        expect(prompt).toContain('求面积');
        expect(prompt).toContain('底乘高');
        expect(prompt).toContain('（无）');
        expect(prompt).toContain('<svg><rect/></svg>');
        expect(prompt).toContain('<svg_animation>');
        expect(prompt).not.toMatch(/\{\{\w+\}\}/);
    });

    it('没有配图时不输出配图段落', () => {
        expect(generateSvgAnimationPrompt('求面积', '6', '解析')).not.toContain('题目配图');
    });

    it('默认要求动画文字使用简体中文', () => {
        const prompt = generateSvgAnimationPrompt('求面积', '6', '解析');
        expect(prompt).toContain('简体中文，每行不超过 24 个字');
        expect(prompt).not.toContain('must be in English');
        expect(prompt).not.toContain('{{');
    });

    it('language=en 时要求动画中全部文字使用英文', () => {
        const prompt = generateSvgAnimationPrompt('求面积', '6', '解析', null, 'en');
        expect(prompt).toContain('All text in the animation');
        expect(prompt).toContain('must be in English');
        expect(prompt).toContain('英文，每行不超过 48 个字符');
        expect(prompt).not.toContain('简体中文，每行不超过 24 个字');
        expect(prompt).not.toContain('{{');
    });
});

import { buildSvgAnimationDocument, getSvgAnimationDuration, getSvgAspectRatio, parseClockValue } from '@/lib/svg-animation';

describe('SVG 动画时长与画面', () => {
    it('解析 SMIL 时钟值', () => {
        expect(parseClockValue('2s')).toBe(2);
        expect(parseClockValue('500ms')).toBe(0.5);
        expect(parseClockValue('1.5')).toBe(1.5);
        expect(parseClockValue('1min')).toBe(60);
        expect(parseClockValue('0:05')).toBe(5);
        expect(parseClockValue('a.end')).toBeNull();
        expect(parseClockValue(null)).toBeNull();
    });

    it('总时长取 begin + dur × repeatCount 的最大值，跳过无限循环和引用其他元素的动画', () => {
        const svg = '<svg viewBox="0 0 800 500">'
            + '<animate attributeName="x" dur="2s"/>'
            + '<set attributeName="opacity" to="1" begin="10s"/>'
            + "<animate attributeName='r' begin='4s;a.end' dur='3s' repeatCount='2'/>"
            + '<animate attributeName="y" dur="1s" repeatCount="indefinite"/>'
            + '<animate attributeName="z" begin="a.end" dur="100s"/>'
            + '</svg>';
        expect(getSvgAnimationDuration(svg)).toBe(10);
        expect(getSvgAnimationDuration(animation)).toBe(3);
        expect(getSvgAnimationDuration('<svg><rect/></svg>')).toBe(0);
    });

    it('宽高比取 viewBox，其次 width/height，缺省 8:5', () => {
        expect(getSvgAspectRatio('<svg viewBox="0 0 800 400">')).toBe(2);
        expect(getSvgAspectRatio('<svg width="300" height="300">')).toBe(1);
        expect(getSvgAspectRatio('<svg>')).toBe(1.6);
    });

    it('iframe 文档禁止加载外部资源', () => {
        const doc = buildSvgAnimationDocument(animation);
        expect(doc).toContain("default-src 'none'");
        expect(doc).toContain(animation);
    });
});

import { embedNarration, extractSubtitleNarration, getEmbeddedNarration, parseNarration, MAX_NARRATION_SEGMENTS } from '@/lib/svg-animation';

describe('语音讲解稿', () => {
    it('解析讲解稿：排序、合并同一时间的段、跳过无效项', () => {
        expect(parseNarration('前缀 [{"begin":5,"text":"第二步"},{"begin":"0s","text":" 第一步 "},{"begin":5,"text":"补充"},{"begin":-1,"text":"x"},{"begin":2,"text":""},{"text":"无时间"}] 后缀')).toEqual([
            { begin: 0, text: '第一步' },
            { begin: 5, text: '第二步 补充' },
        ]);
        expect(parseNarration('不是 JSON')).toBeNull();
        expect(parseNarration('[]')).toBeNull();
        expect(parseNarration({})).toBeNull();
        const many = Array.from({ length: 30 }, (_, i) => ({ begin: i, text: `第${i}步` }));
        expect(parseNarration(many)).toHaveLength(MAX_NARRATION_SEGMENTS);
    });

    it('写入 SVG 时转义特殊字符，读取后还原；再次写入替换旧讲解稿', () => {
        const narration = [{ begin: 0, text: '当 x<3 且 y>1 时 A&B' }];
        const svg = embedNarration(animation, narration);

        expect(svg).toMatch(/^<svg[^>]*><metadata id="narration">/);
        expect(svg).toContain('x&lt;3');
        expect(svg).not.toContain('x<3');
        expect(getEmbeddedNarration(svg)).toEqual(narration);

        const replaced = embedNarration(svg, [{ begin: 1, text: '新的' }]);
        expect(replaced.match(/<metadata/g)).toHaveLength(1);
        expect(getEmbeddedNarration(replaced)).toEqual([{ begin: 1, text: '新的' }]);
        expect(embedNarration(svg, null)).toBe(animation);
        expect(getEmbeddedNarration(animation)).toBeNull();
    });

    it('净化动画时规范化 AI 输出的讲解稿，无效的讲解稿被删除', () => {
        const raw = animation.replace('<rect', '<metadata id="narration">[{"begin":2,"text":"a<b"}]</metadata><rect');
        const clean = sanitizeSvgAnimation(raw)!;
        expect(clean).toContain('a&lt;b');
        expect(getEmbeddedNarration(clean)).toEqual([{ begin: 2, text: 'a<b' }]);

        const invalid = animation.replace('<rect', '<metadata id="narration">无效</metadata><rect');
        expect(sanitizeSvgAnimation(invalid)).toBe(animation);
    });

    it('旧动画从字幕区提取朗读内容，按出现时间分段，忽略标题和图中文字', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">'
            + '<text x="20" y="40">标题</text>'
            + '<text x="100" y="200">A</text>'
            + '<g opacity="0"><set attributeName="opacity" to="1" begin="5s" fill="freeze"/>'
            + '<text x="20" y="470">第二步第二行</text><text x="20" y="445">第二步</text></g>'
            + '<text x="20" y="450" opacity="0"><tspan>第一</tspan><tspan>步</tspan>'
            + '<animate attributeName="opacity" from="0" to="1" begin="0.5s" dur="1s" fill="freeze"/>'
            + '<set attributeName="opacity" to="0" begin="5s"/></text>'
            + '<text x="20" y="480" opacity="0"><set attributeName="opacity" to="1" begin="a.end"/>无法确定时间</text>'
            + '</svg>';
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;

        expect(extractSubtitleNarration(root)).toEqual([
            { begin: 0.5, text: '第一 步' },
            { begin: 5, text: '第二步 第二步第二行' },
        ]);
    });

    it('没有字幕区文字时返回 null', () => {
        const root = new DOMParser().parseFromString(animation.replace('y="480"', 'y="100"'), 'image/svg+xml').documentElement;
        expect(extractSubtitleNarration(root)).toBeNull();
    });

    it('生成提示词要求输出讲解稿，语言跟随动画', () => {
        expect(generateSvgAnimationPrompt('求面积', '6', '解析')).toContain('<metadata id="narration">');
        expect(generateSvgAnimationPrompt('求面积', '6', '解析')).toContain('讲解使用简体中文');
        expect(generateSvgAnimationPrompt('求面积', '6', '解析', null, 'en')).toContain('Write the narration in English');
    });
});
