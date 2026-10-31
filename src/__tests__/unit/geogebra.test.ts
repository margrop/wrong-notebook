import { describe, expect, it, vi } from 'vitest';
import { generateGeogebraPrompt } from '@/lib/ai/prompts';
import { isApiCall, isSafeDrawingCommand, parseApiArgs, parseCommands, runCommands } from '@/lib/geogebra-commands';

describe('GeoGebra 命令解析与执行', () => {
    it('兼容 JSON 数组及按行保存的历史命令', () => {
        expect(parseCommands('["A=(1,2)",123,null," "]')).toEqual(['A=(1,2)']);
        expect(parseCommands('A=(1,2)\n// 注释\n\nf(x)=x^2')).toEqual(['A=(1,2)', 'f(x)=x^2']);
    });

    it('保留文字参数中的逗号、引号及两个独立字符串', () => {
        expect(parseApiArgs('setCaption("A", "顶点 A,B")')).toEqual({ m: 'setCaption', a: ['A', '顶点 A,B'] });
        expect(parseApiArgs('setCaption("A", "他说\\\"你好\\\"")')).toEqual({ m: 'setCaption', a: ['A', '他说"你好"'] });
        expect(parseApiArgs("setCaption('A', '顶点 A,B')")).toEqual({ m: 'setCaption', a: ['A', '顶点 A,B'] });
    });

    it('兼容旧 LaTeX 标签的单反斜杠，也解析已经转义的反斜杠', () => {
        const command = String.raw`setCaption("A", "$\frac{1}{2}+\nu+\text{面积}$")`;
        const caption = String.raw`$\frac{1}{2}+\nu+\text{面积}$`;
        const api = { evalCommand: vi.fn(() => true), setCaption: vi.fn() };
        expect(runCommands(api, [command])).toEqual([]);
        expect(api.setCaption).toHaveBeenCalledWith('A', caption);
        expect(parseApiArgs(String.raw`setCaption("A", "$\\frac{1}{2}$")`)?.a[1]).toBe(String.raw`$\frac{1}{2}$`);
    });

    it('规范 API 名称，支持数字、布尔值和数组字面值', () => {
        expect(isApiCall('SETCOORDSYSTEM(-10,10,-10,10)')).toBe(true);
        expect(parseApiArgs('SETCOORDSYSTEM(-10,10,-10,10)')).toEqual({ m: 'setCoordSystem', a: [-10, 10, -10, 10] });
        expect(parseApiArgs('setAxesVisible(true,false)')).toEqual({ m: 'setAxesVisible', a: [true, false] });
        expect(parseApiArgs('setValue("a", [1,2])')).toEqual({ m: 'setValue', a: ['a', [1, 2]] });
        expect(isApiCall('Line(A,B)')).toBe(false);
    });

    it('实际执行文字、不等式、已有函数及字幕 API', () => {
        const api = { evalCommand: vi.fn(() => true), setCaption: vi.fn(), setCoordSystem: vi.fn() };
        const commands = ['SETCOORDSYSTEM(-10,10,-10,10)', 'A=(1,2)', 'f(x)=x^2', 'f(2)', 'Text("说明文字,含逗号", (1,2))', 'x > 0', 'x < y && y > 0', 'setCaption("A", "顶点A")'];
        expect(runCommands(api, commands)).toEqual([]);
        expect(api.setCoordSystem).toHaveBeenCalledWith(-10, 10, -10, 10);
        expect(api.setCaption).toHaveBeenCalledWith('A', '顶点A');
        for (const command of commands.slice(1, -1)) expect(api.evalCommand).toHaveBeenCalledWith(command);
    });

    it.each(['Execute({"JavaScript(1)"})', 'RunClickScript(A)', 'JavaScript("alert(1)")', 'Text("<script>alert(1)</script>", (0,0))', 'Text("<p>HTML</p>", (0,0))', String.raw`Text("\u003cscript\u003e", (0,0))`, 'unknownFunction(1)', 'Execute(x)=x', 'A=(1,2); Delete(A)'])('拒绝脚本、标记及不在允许范围内的命令：%s', command => {
        const api = { evalCommand: vi.fn(() => true) };
        expect(isSafeDrawingCommand(command)).toBe(false);
        expect(runCommands(api, [command])).toHaveLength(1);
        expect(api.evalCommand).not.toHaveBeenCalled();
    });

    it('API 参数拒绝表达式和对象，不使用 eval', () => {
        const api = { evalCommand: vi.fn(() => true), setCaption: vi.fn() };
        for (const command of ['setCaption("A", alert(1))', 'setCaption("A", {"__proto__":1})', 'setCaption("A", "文本"); alert(1)', 'setCaption("A", "<p>HTML</p>")']) {
            expect(runCommands(api, [command])).toHaveLength(1);
        }
        expect(api.setCaption).not.toHaveBeenCalled();
        expect(api.evalCommand).not.toHaveBeenCalled();
    });

    it('向调用方返回失败命令及实际错误，继续处理后续命令', () => {
        const api = { evalCommand: vi.fn().mockReturnValueOnce(false).mockReturnValue(true) };
        expect(runCommands(api, ['A=(1,2)', 'B=(3,4)'])).toEqual([{ command: 'A=(1,2)', message: 'GeoGebra 未能执行该命令' }]);
        expect(api.evalCommand).toHaveBeenCalledWith('B=(3,4)');
    });
    it('GeoGebra 插值不解释数学材料中的特殊美元符号序列', () => {
        const question = '计算 $$1+1$$；$&；$`；$\'；{{answer_text}}';
        const answer = '$$2$$';
        const analysis = '保持 $& 和 $$。';
        const prompt = generateGeogebraPrompt(question, answer, analysis, '$& 错误');
        expect(prompt).toContain('【题目内容 (QUESTION)】\n' + question);
        expect(prompt).toContain('【答案内容 (ANSWER)】\n' + answer);
        expect(prompt).toContain('【解析内容 (ANALYSIS)】\n' + analysis);
        expect(prompt).toContain('$& 错误');
        expect(prompt).not.toContain('{{question_text}}');
        expect(prompt).toContain('{{answer_text}}');
        expect(prompt).not.toContain('ParallelLine');
    });

});
