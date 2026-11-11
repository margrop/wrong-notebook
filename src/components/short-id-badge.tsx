"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useQuestionNumbering } from "@/contexts/QuestionNumberingContext";
import { questionNoLabel } from "@/lib/seq-no/seq-no-format";

interface ShortIdBadgeProps {
    shortId?: string | null;
    seqNo?: number | null;
    className?: string;
}

/** 显示题目编号（按系统设置为 6 位 ID 或流水号），点击复制 */
export function ShortIdBadge({ shortId, seqNo, className = "" }: ShortIdBadgeProps) {
    const { t } = useLanguage();
    const { numbering } = useQuestionNumbering();
    const [copied, setCopied] = useState(false);

    const label = questionNoLabel({ shortId, seqNo }, numbering);
    if (!label) return null;
    // 流水号自带 # 前缀，不再显示「ID」字样
    const isSeqNo = label.startsWith("#");

    const handleCopy = async (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(label);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // 非安全上下文无法写剪贴板，退回到选中文本
            window.prompt(t.shortId.copy, label);
        }
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            title={copied ? t.shortId.copied : t.shortId.copy}
            className={`inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors ${className}`}
        >
            {!isSeqNo && <span>{t.shortId.label}</span>}
            <span className="font-semibold text-foreground">{label}</span>
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}
