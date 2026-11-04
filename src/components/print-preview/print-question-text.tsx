import { useMemo } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { splitChoiceOptions } from "@/lib/print/choice-options";
import type { ChoiceColumns } from "@/lib/print/choice-options";

interface PrintQuestionTextProps {
    content: string;
}

/** 手机屏幕较窄时减半列数，打印和宽屏按估算的列数排 */
const COLUMN_CLASSES: Record<ChoiceColumns, string> = {
    4: "grid-cols-2 sm:grid-cols-4 print:grid-cols-4",
    2: "grid-cols-1 sm:grid-cols-2 print:grid-cols-2",
    1: "grid-cols-1",
};

/**
 * 打印用题干：逐行排列的选择题选项按长度横向排成多列，节省纸张；其余题目按原文渲染
 */
export function PrintQuestionText({ content }: PrintQuestionTextProps) {
    const layout = useMemo(() => splitChoiceOptions(content), [content]);
    if (!layout) return <MarkdownRenderer content={content} />;

    return (
        <>
            {layout.stem && <MarkdownRenderer content={layout.stem} />}
            <div className={`choice-options mb-3 grid gap-x-6 gap-y-1 ${COLUMN_CLASSES[layout.columns]}`}>
                {layout.options.map((option) => (
                    <div key={option.label} className="flex min-w-0 items-baseline gap-1.5">
                        <span className="shrink-0">{option.label}</span>
                        <MarkdownRenderer content={option.content} className="flex-1 [&_p]:mb-0" />
                    </div>
                ))}
            </div>
            {layout.after && <MarkdownRenderer content={layout.after} />}
        </>
    );
}
