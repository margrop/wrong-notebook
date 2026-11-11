/**
 * 群晖套件结构测试
 * DSM 7 对套件有硬性要求（非 root 运行、由资源 worker 管理容器），写错时套件中心直接拒绝安装
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '../../../packaging/synology');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

function parseInfo(): Record<string, string> {
    const entries = read('INFO')
        .split('\n')
        .map((line) => /^(\w+)="(.*)"$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => [match[1], match[2]] as const);
    return Object.fromEntries(entries);
}

describe('synology package', () => {
    it('套件脚本以套件用户运行', () => {
        // DSM 7 拒绝安装 run-as 为 root 的第三方套件
        expect(JSON.parse(read('conf/privilege'))).toEqual({ defaults: { 'run-as': 'package' } });
    });

    it('容器由 docker-project 资源按 compose 目录创建', () => {
        const resource = JSON.parse(read('conf/resource')) as {
            'docker-project': { projects: { name: string; path: string }[] };
        };
        expect(resource['docker-project'].projects).toEqual([{ name: 'wrong-notebook', path: 'compose' }]);
        expect(fs.existsSync(path.join(root, 'package/compose/compose.yaml'))).toBe(true);
    });

    it('compose 不依赖安装脚本生成的变量，数据放在套件数据目录', () => {
        const compose = read('package/compose/compose.yaml').replace(/^\s*#.*$/gm, '');
        // docker-project 在 postinst 脚本之前创建容器，此时变量还没有值
        expect(compose).not.toContain('${');
        expect(compose).toContain('image: ghcr.io/margrop/wrong-notebook:__IMAGE_TAG__');
        expect(compose).toContain('- /var/packages/wrongnotebook/var:/app/data');
        expect(compose).toContain('CONFIG_DIR: /app/data/config');
        expect(compose).toContain('"39300:3000"');
    });

    it('INFO 依赖 Container Manager，且不声明 adminport', () => {
        const info = parseInfo();
        expect(info.package).toBe('wrongnotebook');
        expect(info.os_min_ver).toBe('7.2.1-69057');
        expect(info.install_dep_packages).toBe('ContainerManager>=20.10.23-1432');
        // 容器端口已由 Container Manager 登记，再声明 adminport 会在重装时报端口冲突
        expect(info.adminport).toBeUndefined();
        expect(info.dsmuidir).toBe('ui');
    });

    it('主菜单入口指向服务端口，图标齐全', () => {
        const config = JSON.parse(read('package/ui/config')) as {
            '.url': Record<string, { type: string; protocol: string; port: string; url: string }>;
        };
        const app = config['.url'][parseInfo().dsmappname];
        expect(app).toMatchObject({ type: 'url', protocol: 'http', port: '39300', url: '/' });
        for (const size of [16, 24, 32, 48, 64, 72, 256]) {
            expect(fs.existsSync(path.join(root, `package/ui/images/icon_${size}.png`))).toBe(true);
        }
    });
});
