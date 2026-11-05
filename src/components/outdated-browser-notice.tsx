"use client";

import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { detectOutdatedEngine } from "@/lib/browser-support";
import { useIsClient } from "@/lib/hooks/use-is-client";

/**
 * 浏览器内核过旧时在页面顶部提示升级（如安卓手机的系统 WebView 停留在出厂版本）。
 * 只用纯色和普通定位，保证在旧内核上也能正常显示；关闭后本次打开不再提示。
 */
export function OutdatedBrowserNotice() {
    const { t } = useLanguage();
    const isClient = useIsClient();
    const [dismissed, setDismissed] = useState(false);
    const engine = isClient ? detectOutdatedEngine(navigator.userAgent) : null;
    if (!engine || dismissed) return null;

    const template = engine.kind === "webview" ? t.browserSupport.outdatedWebView : t.browserSupport.outdatedBrowser;
    return (
        <div role="alert" data-testid="outdated-browser-notice" className="flex items-start gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            <p className="flex-1">{template.replace("{version}", String(engine.version))}</p>
            <button type="button" onClick={() => setDismissed(true)} className="shrink-0 font-medium underline">
                {t.common.close}
            </button>
        </div>
    );
}
