import { describe, expect, it } from 'vitest';
import { detectOutdatedEngine, MIN_CHROMIUM_VERSION } from '@/lib/browser-support';

const webView = (version: number) => `Mozilla/5.0 (Linux; Android 13; RMX3031 Build/TP1A.220905.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${version}.0.5060.129 Mobile Safari/537.36 WrongNotebookAndroid/2026.11.4 (phone)`;

describe('detectOutdatedEngine', () => {
    it('识别安卓 App 中过旧的系统 WebView', () => {
        expect(detectOutdatedEngine(webView(103))).toEqual({ kind: 'webview', version: 103 });
    });

    it('应用标识缺失时按 wv 标记识别 WebView', () => {
        expect(detectOutdatedEngine(webView(103).replace(/ WrongNotebookAndroid.*$/, ''))).toEqual({ kind: 'webview', version: 103 });
        expect(detectOutdatedEngine(webView(103).replace('; wv)', ')'))).toEqual({ kind: 'webview', version: 103 });
    });

    it('普通 Chromium 浏览器过旧时提示升级浏览器', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36';
        expect(detectOutdatedEngine(ua)).toEqual({ kind: 'browser', version: 100 });
    });

    it('达到最低版本或非 Chromium 内核时不提示', () => {
        expect(detectOutdatedEngine(webView(MIN_CHROMIUM_VERSION))).toBeNull();
        expect(detectOutdatedEngine(webView(142))).toBeNull();
        expect(detectOutdatedEngine('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBeNull();
        expect(detectOutdatedEngine('Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0')).toBeNull();
        expect(detectOutdatedEngine('')).toBeNull();
    });
});
