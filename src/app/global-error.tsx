"use client";

import { useEffect } from "react";
import { trackError } from "@/lib/telemetry/client";

interface GlobalErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
}

/**
 * 根布局本身出错时的兜底页面：此时 Providers 与语言上下文都不可用，
 * 必须自带 <html><body>，中英文案静态内联，样式不依赖全局 CSS
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
    useEffect(() => {
        trackError({ kind: "boundary", scope: "app.global", error });
    }, [error]);

    return (
        <html lang="zh-CN">
            <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#fff", color: "#111" }}>
                <main style={{ maxWidth: 420, margin: "0 auto", padding: "20vh 16px", textAlign: "center" }}>
                    <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>页面出错了 / Something went wrong</h1>
                    <p style={{ fontSize: 14, color: "#555", margin: "0 0 20px" }}>
                        请重试或刷新页面。<br />Please retry or reload the page.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{ padding: "8px 20px", fontSize: 14, borderRadius: 8, border: "none", background: "#4f46e5", color: "#fff", cursor: "pointer" }}
                    >
                        重试 / Retry
                    </button>
                </main>
            </body>
        </html>
    );
}
