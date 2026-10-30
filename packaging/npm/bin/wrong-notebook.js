#!/usr/bin/env node
/**
 * wrong-notebook 命令行入口（npm 全局安装）
 *   wrong-notebook [start] [--port 3000] [--host 0.0.0.0] [--data-dir ~/.wrong-notebook]
 *   wrong-notebook prepare-client   生成本机 Prisma Client（postinstall 自动执行）
 *   wrong-notebook version | help
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const launcher = require('../launcher.js');
const pkg = require('../package.json');

const HELP = `错题本 wrong-notebook v${pkg.version}

用法：
  wrong-notebook [start] [选项]    启动服务（默认监听 0.0.0.0:3000）
  wrong-notebook version           显示版本
  wrong-notebook help              显示帮助

选项：
  -p, --port <端口>        监听端口，默认 3000（也可用环境变量 PORT）
  -H, --host <地址>        监听地址，默认 0.0.0.0；仅本机访问可设为 127.0.0.1
  -d, --data-dir <目录>    数据目录，默认 ~/.wrong-notebook（也可用环境变量 WRONG_NOTEBOOK_HOME）

数据库、配置文件（config/app-config.json）和会话密钥都保存在数据目录中，升级不会丢失数据。
首次启动时终端会打印一次性初始化链接，打开后设置管理员账号（链接只能使用一次）。`;

const ALIASES = { '-h': 'help', '--help': 'help', '-v': 'version', '--version': 'version' };
const [first, ...rest] = process.argv.slice(2);
const command = ALIASES[first] || (!first || first.startsWith('-') ? 'start' : first);
const args = command === 'start' && first !== 'start' ? process.argv.slice(2) : rest;

switch (command) {
    case 'start':
        try {
            launcher.start(launcher.parseArgs(args));
        } catch (error) {
            console.error(`[wrong-notebook] 启动失败：${error.message}`);
            process.exit(1);
        }
        break;
    case 'prepare-client': {
        // 安装时生成 Prisma Client；失败不阻断安装，首次启动时会再尝试
        const cli = require.resolve('prisma/build/index.js', { paths: [path.join(__dirname, '..')] });
        const schema = path.join(__dirname, '..', 'prisma', 'schema.prisma');
        const result = spawnSync(process.execPath, [cli, 'generate', '--schema', schema], { stdio: 'inherit' });
        if (result.status !== 0) console.warn('[wrong-notebook] Prisma Client 生成失败，首次启动时将重试');
        break;
    }
    case 'version':
        console.log(pkg.version);
        break;
    case 'help':
        console.log(HELP);
        break;
    default:
        console.error(`未知命令：${command}\n\n${HELP}`);
        process.exit(1);
}
