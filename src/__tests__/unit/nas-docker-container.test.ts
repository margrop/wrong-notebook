/**
 * NAS 套件容器控制脚本（packaging/docker/docker-container.sh）的镜像准备逻辑测试
 * 用假的 docker 命令记录调用，覆盖本地已有、内置归档、联网拉取和断网几种情况
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(__dirname, '../../../packaging/docker/docker-container.sh');
const IMAGE = 'ghcr.io/margrop/wrong-notebook';

// 镜像列表保存在 $STUB/images，每次调用追加到 $STUB/calls；退出码取各分支最后一条命令
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$STUB/calls"
case "$1 $2" in
  "image inspect") grep -qx "$3" "$STUB/images" ;;
  "load -i") [ -n "\${STUB_LOAD_FAIL:-}" ] && exit 1; cat "$3" >> "$STUB/images" ;;
  "pull --quiet") [ -n "\${STUB_PULL_FAIL:-}" ] && exit 1; echo "$3" >> "$STUB/images" ;;
  "images --format") cat "$STUB/images" ;;
  "rmi "*) grep -vx "$2" "$STUB/images" > "$STUB/next"; mv "$STUB/next" "$STUB/images" ;;
  *) : ;;
esac
`;

const RUNNER = `set -eu
WN_IMAGE_TAG=2.0
WN_DATA_DIR="$STUB/data"
WN_CONFIG_DIR="$STUB/config"
WN_IMAGE_ARCHIVE="$STUB/image.tar.gz"
. "$1"
wn_wait_health() { :; }
wn_start_container
`;

let dir: string;

function start(options: { images?: string[]; archive?: string; env?: Record<string, string> }) {
    fs.writeFileSync(path.join(dir, 'images'), (options.images ?? []).map((name) => `${name}\n`).join(''));
    if (options.archive !== undefined) fs.writeFileSync(path.join(dir, 'image.tar.gz'), options.archive);
    const result = spawnSync('sh', [path.join(dir, 'run.sh'), SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, ...options.env, STUB: dir, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}` },
    });
    const calls = fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8') : '';
    return {
        status: result.status,
        // 只看改变镜像或容器的调用
        actions: calls.split('\n').map((line) => line.split(' ')[0]).filter((name) => ['load', 'pull', 'run', 'rmi'].includes(name)),
        images: fs.readFileSync(path.join(dir, 'images'), 'utf8').split('\n').filter(Boolean),
    };
}

describe('nas docker-container.sh', () => {
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-nas-docker-'));
        fs.mkdirSync(path.join(dir, 'bin'));
        fs.writeFileSync(path.join(dir, 'bin', 'docker'), FAKE_DOCKER, { mode: 0o755 });
        fs.writeFileSync(path.join(dir, 'run.sh'), RUNNER);
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('本地已有该版本镜像时不联网，断网也能启动', () => {
        const result = start({ images: [`${IMAGE}:2.0`], env: { STUB_PULL_FAIL: '1' } });
        expect(result.status).toBe(0);
        expect(result.actions).toEqual(['run']);
    });

    it('加载套件内置的归档，并清理旧版本镜像', () => {
        const result = start({ images: [`${IMAGE}:1.0`], archive: `${IMAGE}:2.0\n`, env: { STUB_PULL_FAIL: '1' } });
        expect(result.status).toBe(0);
        expect(result.actions).toEqual(['load', 'run', 'rmi']);
        expect(result.images).toEqual([`${IMAGE}:2.0`]);
    });

    it('没有内置归档时联网拉取', () => {
        const result = start({});
        expect(result.status).toBe(0);
        expect(result.actions).toEqual(['pull', 'run']);
    });

    it('归档加载失败时回退到联网拉取', () => {
        const result = start({ archive: 'broken', env: { STUB_LOAD_FAIL: '1' } });
        expect(result.status).toBe(0);
        expect(result.actions).toEqual(['load', 'pull', 'run']);
    });

    it('既没有镜像也拉取不到时启动失败，不创建容器', () => {
        const result = start({ env: { STUB_PULL_FAIL: '1' } });
        expect(result.status).not.toBe(0);
        expect(result.actions).toEqual(['pull']);
    });
});
