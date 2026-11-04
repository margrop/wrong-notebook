/**
 * Docker 镜像与安装包构建时用 `tsc <脚本>` 单独编译种子脚本（不读取 tsconfig 的路径别名），
 * 并在启动时以普通 node 运行。因此这两个脚本的整条导入链只能使用相对路径，且不能导入带 server-only 的模块。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const ENTRIES = ['scripts/seed-chinese-primary.ts', 'scripts/rebuild-system-tags.ts'];
const IMPORT_PATTERN = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;

function resolveRelative(from: string, spec: string): string | null {
    const base = join(dirname(from), spec);
    return [`${base}.ts`, join(base, 'index.ts'), `${base}.json`].find((candidate) => existsSync(candidate)) ?? null;
}

function collectImportChain(entry: string) {
    const files = new Set<string>();
    const aliasImports: string[] = [];
    const stack = [join(ROOT, entry)];
    while (stack.length) {
        const file = stack.pop()!;
        if (files.has(file)) continue;
        files.add(file);
        const source = readFileSync(file, 'utf8');
        for (const match of source.matchAll(IMPORT_PATTERN)) {
            const spec = match[1];
            if (spec.startsWith('@/')) aliasImports.push(`${file.replace(ROOT + '/', '')} -> ${spec}`);
            if (spec.startsWith('.')) {
                const next = resolveRelative(file, spec);
                if (next) stack.push(next);
            }
        }
    }
    return { files: [...files].map((file) => readFileSync(file, 'utf8')), aliasImports };
}

describe('Docker 与安装包启动时运行的种子脚本', () => {
    it.each(ENTRIES)('%s 的导入链只使用相对路径', (entry) => {
        expect(collectImportChain(entry).aliasImports).toEqual([]);
    });

    it.each(ENTRIES)('%s 的导入链不包含 server-only 模块', (entry) => {
        const { files } = collectImportChain(entry);
        expect(files.some((source) => /^import\s+["']server-only["']/m.test(source))).toBe(false);
    });
});
