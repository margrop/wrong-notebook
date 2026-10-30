import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoginHelp } from '@/components/login-help';
import { LanguageProvider } from '@/contexts/LanguageContext';

const render = (allowRegistration: boolean | null) =>
    renderToStaticMarkup(<LanguageProvider><LoginHelp allowRegistration={allowRegistration} /></LanguageProvider>);

describe('登录页帮助', () => {
    it('开放注册时显示注册入口', () => {
        const html = render(true);
        expect(html).toContain('href="/register"');
        expect(html).toContain('立即注册');
        expect(html).not.toContain('请联系管理员开启注册');
    });

    it('关闭注册时去掉注册入口，改为提示联系管理员', () => {
        const html = render(false);
        expect(html).not.toContain('href="/register"');
        expect(html).toContain('请联系管理员开启注册');
    });

    it('尚未取得注册状态时不显示注册相关文字', () => {
        const html = render(null);
        expect(html).not.toContain('href="/register"');
        expect(html).not.toContain('请联系管理员开启注册');
    });

    it('首次使用指引给出默认管理员邮箱和文档链接，不显示密码', () => {
        const html = render(false);
        expect(html).toContain('首次使用？');
        expect(html).toContain('admin@localhost');
        expect(html).toContain('https://github.com/margrop/wrong-notebook/wiki/FAQ');
        expect(html).not.toContain('123456');
    });
});

describe('初始化链接指引', () => {
    it('说明各安装方式到哪里找初始化链接，不包含任何密码', async () => {
        const { SetupGuide } = await import('@/components/initialize/setup-guide');
        const html = renderToStaticMarkup(<LanguageProvider><SetupGuide /></LanguageProvider>);
        expect(html).toContain('尚未创建管理员');
        expect(html).toContain('/initialize?token=');
        expect(html).toContain('docker logs wrong-notebook');
        expect(html).toContain('config/setup-token');
        expect(html).not.toContain('123456');
    });
});
