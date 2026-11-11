"use client";

import { useState } from "react";
import type { RefObject } from "react";
import { ChevronDown, ChevronUp, Languages } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { convertToneNumbers } from "@/lib/pinyin-tone";
import { inferSubjectFromName } from "@/lib/tags/knowledge-tags";
import { cn } from "@/lib/utils";

/** 一排可点击插入的带调元音；顺序与拼音教学中的声调表一致 */
const TONE_VOWELS = [
    "ā", "á", "ǎ", "à",
    "ō", "ó", "ǒ", "ò",
    "ē", "é", "ě", "è",
    "ī", "í", "ǐ", "ì",
    "ū", "ú", "ǔ", "ù",
    "ǖ", "ǘ", "ǚ", "ǜ",
];

interface PinyinToolbarProps {
    /** 当前编辑框内容 */
    value: string;
    onChange: (value: string) => void;
    /** 题干 textarea；用于按光标位置插入带调元音 */
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    /** 学科标识或错题本名称；语文时默认展开，拿不到或非语文时默认收起 */
    subject?: string | null;
    className?: string;
}

/** 题干编辑框的拼音小工具：点击带调元音在光标处插入，或把数字声调整体转换 */
export function PinyinToolbar({ value, onChange, textareaRef, subject, className }: PinyinToolbarProps) {
    const { t } = useLanguage();
    // 默认按学科决定展开状态；用户手动切换后以手动选择为准
    const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
    const expanded = expandedOverride ?? inferSubjectFromName(subject ?? null) === "chinese";

    const insertAtCursor = (tone: string) => {
        const textarea = textareaRef.current;
        const start = textarea?.selectionStart ?? value.length;
        const end = textarea?.selectionEnd ?? start;
        onChange(value.slice(0, start) + tone + value.slice(end));
        // 等受控组件完成渲染后再恢复光标，落到插入内容之后
        requestAnimationFrame(() => {
            const target = textareaRef.current;
            if (!target) return;
            target.focus();
            target.setSelectionRange(start + tone.length, start + tone.length);
        });
    };

    return (
        <div className={cn("space-y-1.5", className)}>
            <button
                type="button"
                onClick={() => setExpandedOverride(!expanded)}
                aria-expanded={expanded}
                aria-label={expanded ? t.pinyinToolbar.collapse : t.pinyinToolbar.expand}
                className="flex h-8 items-center gap-1 rounded-md border bg-muted/40 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
                <Languages className="h-3.5 w-3.5" />
                {t.pinyinToolbar.title}
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>

            {expanded && (
                <div className="rounded-md border bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">{t.pinyinToolbar.toneHint}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {TONE_VOWELS.map((tone) => (
                            <button
                                key={tone}
                                type="button"
                                onClick={() => insertAtCursor(tone)}
                                aria-label={t.pinyinToolbar.insertTone.replace("{tone}", tone)}
                                className="h-8 min-w-8 rounded-md border bg-background px-0 text-sm transition-colors hover:bg-accent"
                            >
                                {tone}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange(convertToneNumbers(value))}
                        className="mt-2 h-8 rounded-md border bg-background px-3 text-xs transition-colors hover:bg-accent"
                    >
                        {t.pinyinToolbar.convert}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">{t.pinyinToolbar.convertHint}</p>
                </div>
            )}
        </div>
    );
}
