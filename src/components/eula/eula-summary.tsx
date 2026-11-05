"use client";

import { useLanguage } from "@/contexts/LanguageContext";

/** 协议摘要与“查看完整协议”链接（新标签页打开 /eula） */
export function EulaSummary() {
    const { t } = useLanguage();
    return (
        <div className="space-y-2 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {t.eula.summary.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <a href="/eula" target="_blank" rel="noopener noreferrer" className="inline-block text-primary hover:underline">
                {t.eula.viewFull}
            </a>
        </div>
    );
}
