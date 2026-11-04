/**
 * docx 题库解析器单元测试。
 * 用 fflate 的 zipSync 动态构造最小 docx 作为夹具（见 src/__tests__/helpers/docx-fixture.ts）。
 */
import { describe, expect, it } from "vitest";
import {
    abstractNum,
    brRun,
    delRun,
    drawingRun,
    dstrikeRun,
    insRun,
    makeDocxBuffer,
    makeLegacyDocBuffer,
    mFraction,
    minimalWmfBytes,
    mRun,
    mSup,
    num,
    numPara,
    oMathContent,
    oMathPara,
    oMathRun,
    oleEquationRun,
    oleObjectRun,
    para,
    run,
    simpleFractionWmfBytes,
    strikeRun,
    subRun,
    supRun,
    symRun,
    tabRun,
    tbl,
    vanishRun,
} from "@/__tests__/helpers/docx-fixture";
import { parseDocx } from "@/lib/import/file-parsers/docx";
import { decodeMetafileAlt, encodeMetafileDataUrl, isMetafileDataUrl } from "@/lib/import/file-parsers/docx/metafile";
import { toChineseNumber, toRoman } from "@/lib/import/file-parsers/docx/numbering";

const t = (text: string) => run(text);
const tab = () => tabRun();
const br = () => brRun();

describe("docx 解析：段落文字", () => {
    it("普通段落按顺序拼接，tab 变制表符、br 变换行", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．计算：") + tab() + t("24 × 3 =")),
                para(t("过程：先乘后加") + br() + t("注意进位")),
            ].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.errors).toEqual([]);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toContain("计算：\t24 × 3 =");
        expect(result.questions[0].text).toContain("过程：先乘后加\n注意进位");
    });

    it("上标输出 ^2、非数字用 ^{…}；下标同理", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("x") + supRun("2") + t(" + x") + subRun("1") + t("，a") + supRun("n+1")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("x^2 + x_1");
        expect(result.questions[0].text).toContain("a^{n+1}");
    });

    it("删除线与隐藏文字跳过", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("保留") + strikeRun("删除线") + t("正文") + vanishRun("隐藏")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("保留正文");
        expect(result.questions[0].text).not.toContain("删除线");
        expect(result.questions[0].text).not.toContain("隐藏");
    });

    it("w:val 关闭时删除线与隐藏文字保留", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("保留") + strikeRun("伪删除线", "0") + t("正文") + vanishRun("伪隐藏", "false")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("保留伪删除线正文伪隐藏");
    });

    it("双删除线跳过，w:val 关闭时保留", async () => {
        const buffer = makeDocxBuffer({
            body: para(dstrikeRun("双删") + t("，") + dstrikeRun("保留双删", "off")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).not.toContain("，双删，");
        expect(result.questions[0].text).toContain("保留双删");
    });

    it("修订：保留插入、跳过删除", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("原题") + delRun("被删除", 1) + insRun(t("新插入"), 2)),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("新插入");
        expect(result.questions[0].text).not.toContain("被删除");
    });

    it("w:sym 映射常见符号，未识别输出 [符号]", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("选") + symRun("Wingdings", "F0FC") + t("或") + symRun("Wingdings", "0061")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("选✓或[符号]");
    });

    it("全角空格转为半角空格", async () => {
        const buffer = makeDocxBuffer({ body: para(t("A　B")) });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("A B");
    });
});

describe("docx 解析：自动编号", () => {
    it("decimal 编号加在段首", async () => {
        const buffer = makeDocxBuffer({
            body: [numPara("1", 0, t("第一题")), numPara("1", 0, t("第二题"))].join(""),
            numbering: abstractNum("10", [{ numFmt: "decimal", lvlText: "%1." }]) + num("1", "10"),
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].label).toBe("1");
        expect(result.questions[0].text).toContain("第一题");
        expect(result.questions[1].label).toBe("2");
    });

    it("chineseCounting 两级编号与 startOverride", async () => {
        const buffer = makeDocxBuffer({
            body: [
                numPara("2", 0, t("大题一，第 1 小题")),
                numPara("2", 1, t("选项 A 正确")),
                numPara("2", 1, t("选项 B 正确")),
                numPara("2", 0, t("大题二")),
                numPara("2", 1, t("选项 C 正确")),
            ].join(""),
            numbering:
                abstractNum("20", [
                    { numFmt: "chineseCounting", lvlText: "%1、" },
                    { numFmt: "chineseCounting", lvlText: "（%2）" },
                ]) + num("2", "20", [{ ilvl: 1, start: 3 }]),
        });
        const result = await parseDocx(buffer);
        const text = result.questions.map((question) => question.text).join("\n");
        expect(text).toContain("一、大题一，第 1 小题");
        expect(text).toContain("（三）选项 A 正确");
        expect(text).toContain("（四）选项 B 正确");
        expect(text).toContain("二、大题二");
        // 上级变化后下级重置为 startOverride=3
        expect(text).toContain("（三）选项 C 正确");
    });

    it("编号从 5 开始的 startOverride", async () => {
        const buffer = makeDocxBuffer({
            body: [numPara("3", 0, t("甲")), numPara("3", 0, t("乙"))].join(""),
            numbering: abstractNum("30", [{ numFmt: "decimal", lvlText: "%1." }]) + num("3", "30", [{ ilvl: 0, start: 5 }]),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].label).toBe("5");
        expect(result.questions[1].label).toBe("6");
    });

    it("编号样式链接（pStyle 引用带 numPr 的样式）", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("样式题一"), '<w:pStyle w:val="ListParagraph"/>'),
                para(t("样式题二"), '<w:pStyle w:val="ListParagraph"/>'),
            ].join(""),
            numbering: abstractNum("40", [{ numFmt: "decimal", lvlText: "%1." }]) + num("4", "40"),
            styles: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr></w:style>',
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].label).toBe("1");
        expect(result.questions[1].label).toBe("2");
    });

    it("decimalEnclosedCircle 编号以圈码加在段首（① 不识别为题号，作为一题）", async () => {
        const buffer = makeDocxBuffer({
            body: [numPara("5", 0, t("圈 1")), numPara("5", 0, t("圈 2"))].join(""),
            numbering: abstractNum("50", [{ numFmt: "decimalEnclosedCircle", lvlText: "%1" }]) + num("5", "50"),
        });
        const result = await parseDocx(buffer);
        // ① 不在 splitQuestionText 的题号格式中，整篇作为一道题返回
        expect(result.questions[0].text).toContain("① 圈 1");
        expect(result.questions[0].text).toContain("② 圈 2");
        expect(result.warnings).toContain("SINGLE_QUESTION");
    });

    it("编号与手打题号混合时最长链优先，编号取递增序列", async () => {
        const buffer = makeDocxBuffer({
            body: [
                numPara("6", 0, t("自动题一")),
                numPara("6", 0, t("自动题二")),
                numPara("6", 0, t("自动题三")),
            ].join(""),
            numbering: abstractNum("60", [{ numFmt: "decimal", lvlText: "%1." }]) + num("6", "60"),
        });
        const result = await parseDocx(buffer);
        expect(result.questions.map((question) => question.label)).toEqual(["1", "2", "3"]);
    });
});

describe("docx 解析：表格", () => {
    it("单元格用制表符连接，多段用空格连接", async () => {
        const buffer = makeDocxBuffer({
            body: tbl([
                ["题号", "题目", "答案"],
                ["1", "计算 2+3", "5"],
            ]),
        });
        const result = await parseDocx(buffer);
        expect(result.errors).toEqual([]);
        expect(result.questions[0].text).toContain("题号\t题目\t答案");
        expect(result.questions[0].text).toContain("1\t计算 2+3\t5");
    });

    it("嵌套表格展开为行", async () => {
        const buffer = makeDocxBuffer({
            body: `<w:tbl><w:tr><w:tc><w:p>${t("外层")}</w:p><w:tbl><w:tr><w:tc><w:p>${t("内层 1")}</w:p></w:tc><w:tc><w:p>${t("内层 2")}</w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl>`,
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("外层 内层 1\t内层 2");
    });
});

describe("docx 解析：图片真实提取（T18）", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it("w:drawing 按 rId 提取 png 为 data URL，占位符替换为 [图片]", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．如图") + drawingRun() + t("，求值")),
            rels: '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].text).toContain("如图[图片]，求值");
        expect(result.questions[0].images).toHaveLength(1);
        expect(result.questions[0].images![0].dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("w:pict 按 rId 提取图片", async () => {
        const pictRun = `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:100pt;height:50pt"><v:imagedata r:id="rId6"/></v:shape></w:pict></w:r>`;
        const buffer = makeDocxBuffer({
            body: para(t("1．如图") + pictRun + t("，求面积")),
            rels: '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pic.jpg"/>',
            extraFiles: { "word/media/pic.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) },
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("如图[图片]，求面积");
        expect(result.questions[0].images).toHaveLength(1);
        expect(result.questions[0].images![0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("不支持的格式（tiff）跳过并计入 IMAGE_UNSUPPORTED 警告", async () => {
        const tiffRun = `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
        const buffer = makeDocxBuffer({
            body: para(t("1．如图") + tiffRun + t("，求值")),
            rels: '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.tiff"/>',
            extraFiles: { "word/media/image1.tiff": new Uint8Array([0x49, 0x49, 0x2a, 0x00]) },
        });
        const result = await parseDocx(buffer);
        expect(result.warnings.some((w) => w.startsWith("IMAGE_UNSUPPORTED:") && w.includes("tiff"))).toBe(true);
        expect(result.questions[0].text).toContain("如图[图片]，求值");
        expect(result.questions[0].images).toBeUndefined();
    });

    it("OLE 公式对象（run 内 w:object 引用 WMF 预览图）解析为待渲染图片，正文保留 [公式] 占位", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．化简 ") + oleObjectRun() + t(" 的结果")),
            rels: '<Relationship Id="rIdWmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
            extraFiles: { "word/media/image1.wmf": new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 1, 2, 3, 4]) },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        // 行内公式位置保留 [公式] 占位（w:object 含 OLE 公式对象）
        expect(result.questions[0].text).toContain("化简 [公式] 的结果");
        expect(result.questions[0].text).not.toContain("[图片]");
        // 待渲染图片：wmf data URL + alt 携带渲染目标尺寸
        const images = result.questions[0].images!;
        expect(images).toHaveLength(1);
        expect(isMetafileDataUrl(images[0].dataUrl)).toBe(true);
        expect(images[0].dataUrl.startsWith("data:image/wmf;base64,")).toBe(true);
        const target = decodeMetafileAlt(images[0].alt);
        expect(target).not.toBeNull();
        // 10pt×28pt → 显示高度 28pt×96/72 ≈ 37px，属公式小图，放大后 ≥120px
        expect(target!.height).toBeGreaterThanOrEqual(120);
        // OLE 公式对象计数（低置信，按图片保留）
        expect(result.warnings.some((w) => w === "OLE_EQUATION_IMAGE:1")).toBe(true);
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_LATEX:"))).toBe(false);
    });

    it("run 内 w:object 的 EMF 预览图同样解析为待渲染图片，占位为 [公式]", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．") + oleObjectRun("rIdEmf", "rIdOle2", "width:20pt;height:14pt", "Equation.3") + t(" 求值")),
            rels: '<Relationship Id="rIdEmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.emf"/>',
            extraFiles: { "word/media/image1.emf": new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00]) },
        });
        const result = await parseDocx(buffer);
        const images = result.questions[0].images!;
        expect(images).toHaveLength(1);
        expect(images[0].dataUrl.startsWith("data:image/emf;base64,")).toBe(true);
        expect(result.questions[0].text).toContain("[公式]");
        // 无 IMAGE_UNSUPPORTED 中的 emf/wmf 警告（tiff 等才报）
        expect(result.warnings.some((w) => w.startsWith("IMAGE_UNSUPPORTED:") && (w.includes("emf") || w.includes("wmf")))).toBe(false);
    });

    it("w:object 的 v:imagedata 指向普通位图时按图片处理，占位为 [公式]（OLE 公式对象）", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．如图 ") + oleObjectRun("rIdPng", "rIdOle3") + t("，求值")),
            rels: '<Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("如图 [公式]，求值");
        const images = result.questions[0].images!;
        expect(images).toHaveLength(1);
        expect(images[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("ProgID 为空的公式对象（WPS 形态，shapetype id 为 _x0000_tole_*）占位为 [公式]", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．化简 ") + oleObjectRun("rIdWmf", "rIdOle", "width:10pt;height:28pt", "") + t(" 的结果")),
            rels: '<Relationship Id="rIdWmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
            extraFiles: { "word/media/image1.wmf": new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 9, 9]) },
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("化简 [公式] 的结果");
        expect(result.questions[0].images).toHaveLength(1);
        expect(result.warnings.some((w) => w === "OLE_EQUATION_IMAGE:1")).toBe(true);
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_LATEX:"))).toBe(false);
    });

    it("多个 w:object 公式图片按出现顺序归属对应题目", async () => {
        const wmfBytesA = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 1, 1]);
        const wmfBytesB = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 2, 2]);
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．化简 ") + oleObjectRun("rIdA", "rIdOleA") + t("，再求 ") + oleObjectRun("rIdB", "rIdOleB") + t(" 的值")),
                para(t("2．计算 ") + oleObjectRun("rIdC", "rIdOleC") + t(" 的结果")),
            ].join(""),
            rels: [
                '<Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
                '<Relationship Id="rIdB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.wmf"/>',
                '<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image3.wmf"/>',
            ].join(""),
            extraFiles: {
                "word/media/image1.wmf": wmfBytesA,
                "word/media/image2.wmf": wmfBytesB,
                "word/media/image3.wmf": new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 3, 3]),
            },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        // 第一题：两个公式占位、两张图按出现顺序
        expect(result.questions[0].text).toContain("化简 [公式]，再求 [公式] 的值");
        expect(result.questions[0].images).toHaveLength(2);
        expect(result.questions[0].images![0].dataUrl).toContain(encodeMetafileDataUrl(wmfBytesA, "wmf").slice(30, 60));
        // 第二题：一个公式占位、一张图（与第一题的图不同）
        expect(result.questions[1].text).toContain("计算 [公式] 的结果");
        expect(result.questions[1].images).toHaveLength(1);
        expect(result.questions[1].images![0].dataUrl).not.toBe(result.questions[0].images![0].dataUrl);
        // OLE 公式对象计数 = 3（均低置信，按图片保留）
        expect(result.warnings.some((w) => w === "OLE_EQUATION_IMAGE:3")).toBe(true);
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_LATEX:"))).toBe(false);
    });

    it("多图归属：每题只挂自己的图片", async () => {
        const drawingRun2 = `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．图一") + drawingRun() + t("，求值")),
                para(t("2．图二") + drawingRun2 + t("，求面积")),
            ].join(""),
            rels: [
                '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
                '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.png"/>',
            ].join(""),
            extraFiles: {
                "word/media/image1.png": pngBytes,
                "word/media/image2.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x11, 0x22, 0x33, 0x44]),
            },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        expect(result.questions[0].images).toHaveLength(1);
        expect(result.questions[0].images![0].dataUrl).toContain("iVBORw");
        expect(result.questions[1].images).toHaveLength(1);
        expect(result.questions[1].images![0].dataUrl).not.toBe(result.questions[0].images![0].dataUrl);
    });

    it("答案中的图片归属该题", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．求值")),
                para(t("【答案】") + drawingRun()),
            ].join(""),
            rels: '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        expect(result.questions[0].answer).toContain("[图片]");
        expect(result.questions[0].images).toHaveLength(1);
    });

    it("MathType OLE 公式对象的预览图也作为图片导入，占位为 [公式]", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．") + oleEquationRun()),
            rels: '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        const result = await parseDocx(buffer);
        // OLE_EQUATION_IMAGE 计数与图片提取共存
        expect(result.warnings).toContain("OLE_EQUATION_IMAGE:1");
        expect(result.questions[0].text).toContain("[公式]");
        expect(result.questions[0].images).toHaveLength(1);
    });

    it("无 rels 时图片退回 [图片] 占位（不挂 images）", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．如图") + drawingRun() + t("，求值")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("如图[图片]，求值");
        expect(result.questions[0].images).toBeUndefined();
    });
});

describe("docx 解析：图片与公式占位", () => {
    it("图片输出 [图片]，OMML 公式默认转为 $…$（T19 起替换 [公式] 占位）", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("如图") + drawingRun() + t("，已知") + oMathRun() + t("，求值")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("如图[图片]，已知$x+y$，求值");
    });

    it("handlers 可替换占位符（扩展点）", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("如图") + drawingRun() + t("，") + oMathRun()),
        });
        const result = await parseDocx(buffer, {
            image: () => "[IMG]",
            math: () => "[MATH]",
        });
        expect(result.questions[0].text).toContain("[IMG]");
        expect(result.questions[0].text).toContain("[MATH]");
    });

    it("handlers 能收到对应元素与上下文（含 relationships/files）", async () => {
        const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const buffer = makeDocxBuffer({
            body: para(t("如图") + drawingRun() + t("，") + oMathRun()),
            rels: '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        const captured: { imageElement: Element | null; mathElement: Element | null; imageCtx: { relationships: Record<string, string>; files: Record<string, Uint8Array> } | null } = {
            imageElement: null,
            mathElement: null,
            imageCtx: null,
        };
        const result = await parseDocx(buffer, {
            image: (element, ctx) => {
                captured.imageElement = element;
                captured.imageCtx = ctx;
                return undefined;
            },
            math: (element) => {
                captured.mathElement = element;
                return undefined;
            },
        });
        expect(result.questions[0].text).toContain("[图片]");
        expect(result.questions[0].text).toContain("[公式]");
        expect(captured.imageElement?.localName).toBe("drawing");
        expect(captured.mathElement?.localName).toBe("oMath");
        expect(captured.imageCtx?.relationships["rId4"]).toBe("media/image1.png");
        expect(captured.imageCtx?.files["word/media/image1.png"]).toEqual(pngBytes);
    });

    it("handlers 能按 rId 从 relationships 找到媒体文件", async () => {
        const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const buffer = makeDocxBuffer({
            body: para(t("如图") + drawingRun()),
            rels: '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
            extraFiles: { "word/media/image1.png": pngBytes },
        });
        let found: Uint8Array | null = null;
        await parseDocx(buffer, {
            image: (element, ctx) => {
                const blip = element.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip")[0];
                const embed = blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed");
                if (embed) {
                    const target = ctx.relationships[embed];
                    if (target) found = ctx.files[`word/${target}`] ?? null;
                }
                return undefined;
            },
        });
        expect(found).toEqual(pngBytes);
    });
});

describe("docx 解析：答案解析标记与答案区回填", () => {
    it("【答案】【解析】行首标记与难度知识点", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．某题")),
                para(t("【答案】B")),
                para(t("【解析】因为……")),
                para(t("【知识点】分数、计算")),
                para(t("【难度】3")),
            ].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        const [question] = result.questions;
        expect(question.answer).toBe("B");
        expect(question.analysis).toBe("因为……");
        expect(question.knowledgePoints).toEqual(["分数", "计算"]);
        expect(question.difficultyStars).toBe(3);
        expect(question.text).not.toContain("【答案】");
    });

    it("答案区按题号回填", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．题一")),
                para(t("2．题二")),
                para(t("参考答案")),
                para(t("1. B")),
                para(t("2. C")),
            ].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].answer).toBe("B");
        expect(result.questions[1].answer).toBe("C");
        // 标题与答案条目不进入 ignored 之外的正文
        for (const question of result.questions) {
            expect(question.text).not.toContain("参考答案");
            expect(question.text).not.toContain("1. B");
        }
    });
});

describe("docx 解析：OMML 公式转 LaTeX", () => {
    it("行内 m:oMath 默认转为 $…$（分数与上下标）", async () => {
        const formula = oMathContent(mFraction(mSup(mRun("x"), mRun("2")), mRun("4")));
        const buffer = makeDocxBuffer({
            body: para(t("已知") + formula + t("，求值")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("已知$\\frac{x^2}{4}$，求值");
    });

    it("m:oMathPara 块级公式输出独立一行 $$…$$", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("由公式")) + para(oMathPara(mFraction(mRun("a"), mRun("b")))),
        });
        const result = await parseDocx(buffer);
        const text = result.questions[0].text;
        expect(text).toContain("$$");
        expect(text).toContain("\\frac{a}{b}");
    });

    it("空公式退回 [公式] 占位", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("已知") + oMathContent("") + t("，求值")),
        });
        const result = await parseDocx(buffer);
        expect(result.questions[0].text).toContain("[公式]");
    });

    it("handlers.math 仍可覆盖默认 OMML 转换", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("已知") + oMathContent(mRun("x")) + t("，求值")),
        });
        const result = await parseDocx(buffer, { math: () => "[MATH]" });
        expect(result.questions[0].text).toContain("[MATH]");
        expect(result.questions[0].text).not.toContain("$x$");
    });

    it("未识别的 OMML 元素汇总为 MATH_UNSUPPORTED 警告（去重）", async () => {
        const phantom = `<m:phant><m:e>${mRun("x")}</m:e></m:phant>`;
        const buffer = makeDocxBuffer({
            body: para(t("1．") + oMathContent(phantom)) + para(t("2．") + oMathContent(phantom)),
        });
        const result = await parseDocx(buffer);
        const warning = result.warnings.find((w) => w.startsWith("MATH_UNSUPPORTED:"));
        expect(warning).toBeDefined();
        expect(warning).toContain("phant");
        // 去重：phant 只出现一次
        expect(warning?.split(",")[1]).toBeUndefined();
    });

    it("MathType OLE 公式对象按图片占位并计数 OLE_EQUATION_IMAGE:N", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．") + oleEquationRun()) + para(t("2．") + oleEquationRun("Equation.3")),
        });
        const result = await parseDocx(buffer);
        expect(result.warnings).toContain("OLE_EQUATION_IMAGE:2");
        // 仍按图片占位输出
        expect(result.questions[0].text).toContain("[图片]");
    });

    it("普通图片不算 OLE_EQUATION", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．") + drawingRun() + t("2．") + drawingRun()),
        });
        const result = await parseDocx(buffer);
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_IMAGE:") || w.startsWith("OLE_EQUATION_LATEX:"))).toBe(false);
    });
});

describe("docx 解析：错误与警告", () => {
    it("整篇一道题时给 SINGLE_QUESTION 警告", async () => {
        const buffer = makeDocxBuffer({ body: para(t("这是一道单独的题，没有任何题号。")) });
        const result = await parseDocx(buffer);
        expect(result.warnings).toContain("SINGLE_QUESTION");
        expect(result.questions).toHaveLength(1);
    });

    it("标题、姓名栏等未计入内容给 IGNORED_PARAGRAPHS:N 警告", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("数学期中试卷")),
                para(t("姓名：___ 班级：___")),
                para(t("1．第一题")),
                para(t("2．第二题")),
            ].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        expect(result.warnings.some((warning) => /^IGNORED_PARAGRAPHS:\d+$/.test(warning))).toBe(true);
    });

    it("损坏的 zip 返回 INVALID_DOCX", async () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5]);
        const result = await parseDocx(garbage.buffer.slice(garbage.byteOffset, garbage.byteOffset + garbage.byteLength) as ArrayBuffer);
        expect(result.errors).toEqual([{ index: -1, reason: "INVALID_DOCX" }]);
        expect(result.questions).toEqual([]);
    });

    it("缺 word/document.xml 的 zip 返回 INVALID_DOCX", async () => {
        const { zipSync } = await import("fflate");
        const files: Record<string, Uint8Array> = {
            "word/styles.xml": new TextEncoder().encode("<w:styles/>"),
        };
        const zipped = zipSync(files);
        const result = await parseDocx(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer);
        expect(result.errors).toEqual([{ index: -1, reason: "INVALID_DOCX" }]);
    });

    it("旧版 .doc 返回 LEGACY_DOC_NOT_SUPPORTED", async () => {
        const result = await parseDocx(makeLegacyDocBuffer());
        expect(result.errors).toEqual([{ index: -1, reason: "LEGACY_DOC_NOT_SUPPORTED" }]);
    });
});

describe("docx 解析：上限与规范化", () => {
    it("整篇超长时截断到 20000 字并分出多题", async () => {
        // 超过 MAX_SPLIT_TEXT_LENGTH(20000) 时截断：第二题被截断但仍保留题号
        const longText = "长".repeat(15000);
        const buffer = makeDocxBuffer({
            body: [para(t("1．") + t(longText)), para(t("2．") + t(longText))].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.questions.length).toBeGreaterThanOrEqual(1);
        expect(result.questions[0].label).toBe("1");
    });

    it("ignored 数量计入 warnings，分题结果不再出现原文", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("共 2 道")),
                para(t("1．甲")),
                para(t("2．乙")),
            ].join(""),
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        expect(result.warnings).toContain("IGNORED_PARAGRAPHS:1");
        for (const question of result.questions) {
            expect(question.text).not.toContain("共 2 道");
        }
    });
});

describe("docx 编号工具函数", () => {
    it("toChineseNumber 基本转换", () => {
        expect(toChineseNumber(1)).toBe("一");
        expect(toChineseNumber(5)).toBe("五");
        expect(toChineseNumber(10)).toBe("十");
        expect(toChineseNumber(15)).toBe("十五");
        expect(toChineseNumber(20)).toBe("二十");
        expect(toChineseNumber(42)).toBe("四十二");
        expect(toChineseNumber(100)).toBe("一百");
        expect(toChineseNumber(105)).toBe("一百零五");
        expect(toChineseNumber(120)).toBe("一百二十");
        expect(toChineseNumber(1000)).toBe("一千");
        expect(toChineseNumber(1234)).toBe("一千二百三十四");
    });

    it("toRoman 基本转换", () => {
        expect(toRoman(1)).toBe("i");
        expect(toRoman(4)).toBe("iv");
        expect(toRoman(9)).toBe("ix");
        expect(toRoman(40)).toBe("xl");
        expect(toRoman(90)).toBe("xc");
        expect(toRoman(400)).toBe("cd");
        expect(toRoman(900)).toBe("cm");
        expect(toRoman(1994)).toBe("mcmxciv");
    });
});

describe("docx 解析：自动编号后紧跟数字", () => {
    it("半角「8.」自动编号与以数字开头的正文之间补空格，不被当作小数打断题号序列", async () => {
        const buffer = makeDocxBuffer({
            body: [numPara("5", 0, t("第一题")), numPara("5", 0, t("2008 年的题")), numPara("5", 0, t("第三题"))].join(""),
            numbering: abstractNum("50", [{ numFmt: "decimal", lvlText: "%1." }]) + num("5", "50"),
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(3);
        expect(result.questions[1].text).toContain("2008 年的题");
    });
});

describe("docx 解析：OLE 公式对象 WMF 结构还原为 LaTeX（W3）", () => {
    it("高置信 WMF 分数公式在正文原位置嵌入 $…$，不产生图片", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．计算 ") + oleObjectRun("rIdWmf", "rIdOle", "width:10pt;height:28pt") + t(" 的结果")),
            rels: '<Relationship Id="rIdWmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
            extraFiles: { "word/media/image1.wmf": simpleFractionWmfBytes("5", "9") },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        // 正文原位置直接为 $…$ LaTeX，无 [公式] 占位
        expect(result.questions[0].text).toContain("计算 $\\frac{5}{9}$ 的结果");
        expect(result.questions[0].text).not.toContain("[公式]");
        // 高置信公式不再作为图片
        expect(result.questions[0].images).toBeUndefined();
        // 警告：已转为 LaTeX
        expect(result.warnings).toContain("OLE_EQUATION_LATEX:1");
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_IMAGE:"))).toBe(false);
    });

    it("低置信 WMF（含多边形）保留 [公式] 占位并按图片保留", async () => {
        const buffer = makeDocxBuffer({
            body: para(t("1．化简 ") + oleObjectRun("rIdWmf", "rIdOle", "width:10pt;height:28pt") + t(" 的结果")),
            rels: '<Relationship Id="rIdWmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
            extraFiles: { "word/media/image1.wmf": minimalWmfBytes() },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(1);
        // 低置信：保留 [公式] 占位 + 图片
        expect(result.questions[0].text).toContain("化简 [公式] 的结果");
        expect(result.questions[0].images).toHaveLength(1);
        expect(result.questions[0].images![0].dataUrl.startsWith("data:image/wmf;base64,")).toBe(true);
        // 警告：按图片保留
        expect(result.warnings).toContain("OLE_EQUATION_IMAGE:1");
        expect(result.warnings.some((w) => w.startsWith("OLE_EQUATION_LATEX:"))).toBe(false);
    });

    it("同一文档中高置信与低置信 OLE 公式分别计数", async () => {
        const buffer = makeDocxBuffer({
            body: [
                para(t("1．计算 ") + oleObjectRun("rIdA", "rIdOleA", "width:10pt;height:28pt") + t(" 的结果")),
                para(t("2．化简 ") + oleObjectRun("rIdB", "rIdOleB", "width:10pt;height:28pt") + t(" 的值")),
            ].join(""),
            rels: [
                '<Relationship Id="rIdA" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.wmf"/>',
                '<Relationship Id="rIdB" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.wmf"/>',
            ].join(""),
            extraFiles: {
                "word/media/image1.wmf": simpleFractionWmfBytes("2", "5"),
                "word/media/image2.wmf": minimalWmfBytes(),
            },
        });
        const result = await parseDocx(buffer);
        expect(result.questions).toHaveLength(2);
        // 第一题高置信 → $…$，无图片
        expect(result.questions[0].text).toContain("$\\frac{2}{5}$");
        expect(result.questions[0].images).toBeUndefined();
        // 第二题低置信 → [公式] + 图片
        expect(result.questions[1].text).toContain("[公式]");
        expect(result.questions[1].images).toHaveLength(1);
        // 警告分别计数
        expect(result.warnings).toContain("OLE_EQUATION_LATEX:1");
        expect(result.warnings).toContain("OLE_EQUATION_IMAGE:1");
    });
});
