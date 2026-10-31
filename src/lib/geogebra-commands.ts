import { getErrorMessage } from './error-message';

/** 提示词与执行器共用的 GeoGebra 命令范围。 */
export const GEOGEBRA_DRAWING_COMMANDS = [
    'Line', 'Segment', 'Ray', 'Point', 'Circle', 'Ellipse', 'Hyperbola', 'Parabola',
    'Polygon', 'Intersect', 'Midpoint', 'PerpendicularLine', 'Angle', 'Text', 'Slider',
    'Locus', 'Reflect', 'Translate', 'Rotate', 'Vector', 'UnitVector', 'OrthogonalVector',
    'Distance', 'Length', 'Area', 'Tangent', 'Arc', 'CircularArc', 'Semicircle',
    'Sequence', 'Element', 'If', 'Sum', 'Integral', 'Derivative', 'Root', 'Extremum',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sqrt', 'abs', 'exp', 'ln', 'log',
    'floor', 'ceil', 'round', 'min', 'max',
] as const;

export const GEOGEBRA_API_METHODS = [
    'setCoordSystem', 'setAxesVisible', 'setGridVisible', 'setColor', 'setLineThickness',
    'setLineStyle', 'setPointSize', 'setPointStyle', 'setLabelVisible', 'setCaption',
    'setVisible', 'setFilling', 'setValue', 'setFixed', 'setBackgroundColor',
] as const;

export interface GeogebraCommandApi {
    evalCommand(command: string): boolean;
    [method: string]: unknown;
}

export interface GeogebraCommandError {
    command: string;
    message: string;
}

type ApiValue = string | number | boolean | ApiValue[];
const API_METHODS = new Map(GEOGEBRA_API_METHODS.map(method => [method.toLowerCase(), method]));
const DRAWING_COMMANDS = new Set<string>(GEOGEBRA_DRAWING_COMMANDS.map(name => name.toLowerCase()));
const UNSAFE_CONTENT = /(?:java|vb)script\s*:|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i;

function hasUnsafeContent(command: string): boolean {
    if (UNSAFE_CONTENT.test(command) || /<\s*\/?\s*(?:script|iframe|img|svg|object|embed|html)\b/i.test(command)) return true;
    for (const match of command.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)) {
        try {
            const value = parseValue(match[0]);
            if (typeof value === 'string' && (/<\s*\/?\s*[a-z!][^>]*>/i.test(value) || UNSAFE_CONTENT.test(value))) return true;
            // 检查 JSON Unicode 转义后的标记，避免编码绕过；不改动实际标签正文。
            if (match[0].startsWith('"')) {
                try {
                    const decoded: unknown = JSON.parse(match[0]);
                    if (typeof decoded === 'string' && (/<\s*\/?\s*[a-z!][^>]*>/i.test(decoded) || /(?:java|vb)script\s*:/i.test(decoded))) return true;
                } catch { /* 旧 LaTeX 写法不是 JSON 字符串，按上面的字面值解析 */ }
            }
        } catch { return true; }
    }
    return false;
}

export function parseCommands(raw: string): string[] {
    if (!raw?.trim()) return [];
    const text = raw.trim();
    if (text.startsWith('[')) {
        try {
            const value: unknown = JSON.parse(text);
            if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
        } catch { /* 兼容按行保存的旧命令 */ }
    }
    return text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));
}

/** 在引号、转义及嵌套数组之外拆分参数，避免把带逗号的文字拆开。 */
function splitArguments(source: string): string[] {
    if (!source.trim()) return [];
    const result: string[] = [];
    let quote = '';
    let escaped = false;
    let depth = 0;
    let start = 0;
    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '[') depth++;
        else if (char === ']') {
            if (--depth < 0) throw new Error('参数括号不匹配');
        } else if (char === ',' && depth === 0) {
            result.push(source.slice(start, index).trim());
            start = index + 1;
        }
    }
    if (quote || depth || escaped) throw new Error('参数未闭合');
    result.push(source.slice(start).trim());
    return result;
}

function parseValue(source: string): ApiValue {
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(source)) {
        const value = Number(source);
        if (Number.isFinite(value)) return value;
    }
    if (source === 'true' || source === 'false') return source === 'true';
    if (source.startsWith('[') && source.endsWith(']')) return splitArguments(source.slice(1, -1)).map(parseValue);
    // 引号与反斜杠可转义；其余反斜杠保持原样，兼容已有 LaTeX 标签。
    const quote = source[0];
    if ((quote === '"' || quote === "'") && source.endsWith(quote)) {
        const inner = source.slice(1, -1);
        let value = '';
        for (let index = 0; index < inner.length; index++) {
            if (inner[index] === quote) throw new Error('字符串包含未转义引号');
            if (inner[index] !== '\\') value += inner[index];
            else {
                const next = inner[++index];
                if (next === undefined) throw new Error('字符串转义未闭合');
                value += next === '\\' || next === quote ? next : '\\' + next;
            }
        }
        return value;
    }
    if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(source)) return source;
    throw new Error('API 参数必须是字面值');
}

export function parseApiArgs(command: string): { m: string; a: ApiValue[] } | null {
    const match = command.trim().match(/^(\w+)\s*\(([\s\S]*)\)$/);
    if (!match) return null;
    const method = API_METHODS.get(match[1].toLowerCase());
    if (!method) return null;
    try {
        const args = splitArguments(match[2]).map(parseValue);
        return { m: method, a: args };
    } catch { return null; }
}

export function isApiCall(command: string): boolean {
    const name = command.trim().match(/^(\w+)\s*\(/)?.[1].toLowerCase();
    return !!name && API_METHODS.has(name);
}

/** 白名单控制可调用指令，允许文字引号和数学比较符，不放开脚本或外部资源。 */
export function isSafeDrawingCommand(command: string, definedFunctions: ReadonlySet<string> = new Set()): boolean {
    if (!command.trim() || hasUnsafeContent(command) || /[;`\r\n]/.test(command)) return false;
    // 去掉文字常量后再检查指令，文字内容不会被当成函数调用。
    const withoutStrings = command.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
    if (/["']/.test(withoutStrings) || /(?:https?:|\b(?:ggbApplet|window|document)\b)/i.test(withoutStrings)) return false;
    if (/\b(?:Execute|RunClickScript|RunUpdateScript|JavaScript|eval|Function|Open|PlaySound|ReadText)\b/i.test(withoutStrings)) return false;
    const functionDefinition = withoutStrings.match(/^\s*([\p{L}_][\p{L}\p{N}_]*)\s*\([^)]*\)\s*=/u)?.[1];
    for (const match of withoutStrings.matchAll(/([\p{L}_][\p{L}\p{N}_]*)\s*[(\[]/gu)) {
        const name = match[1];
        if (!DRAWING_COMMANDS.has(name.toLowerCase()) && name !== functionDefinition && !definedFunctions.has(name)) return false;
    }
    return true;
}

/** 返回失败命令以供日志或重新生成反馈使用，不通过 eval 执行任意代码。 */
export function runCommands(api: GeogebraCommandApi, commands: string[]): GeogebraCommandError[] {
    const errors: GeogebraCommandError[] = [];
    const definedFunctions = new Set<string>();
    for (const command of commands) {
        try {
            if (hasUnsafeContent(command)) throw new Error('命令包含不允许的脚本或标记');
            if (isApiCall(command)) {
                const parsed = parseApiArgs(command);
                const method = parsed ? api[parsed.m] : undefined;
                if (!parsed || typeof method !== 'function') throw new Error('API 方法或参数无效');
                method.apply(api, parsed.a);
            } else {
                if (!isSafeDrawingCommand(command, definedFunctions)) throw new Error('指令不在允许范围内');
                if (!api.evalCommand(command.trim())) throw new Error('GeoGebra 未能执行该命令');
                const name = command.match(/^\s*([\p{L}_][\p{L}\p{N}_]*)\s*\([^)]*\)\s*=/u)?.[1];
                if (name) definedFunctions.add(name);
            }
        } catch (error) {
            errors.push({ command, message: getErrorMessage(error) });
        }
    }
    return errors;
}
