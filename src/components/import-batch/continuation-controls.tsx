"use client";

import type { ChangeEvent, Ref } from "react";
import Link from "next/link";
import { ArrowRight, Layers } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface ContinuationControlsProps {
    inputProps: { ref: Ref<HTMLInputElement>; onChange: (event: ChangeEvent<HTMLInputElement>) => void };
    /** 本页发起的续页批次 */
    created: string[];
}

/** 续页的选图入口（隐藏）与已发起的下一页批次链接 */
export function ContinuationControls({ inputProps, created }: ContinuationControlsProps) {
    const { t } = useLanguage();
    return (
        <>
            <input type="file" accept="image/*" className="hidden" data-testid="continuation-input" {...inputProps} />
            {created.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm" data-testid="continuation-notice">
                    {created.map((id, index) => (
                        <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1"><Layers className="h-4 w-4 text-primary" />{t.importBatch.continuation.notice.replace("{n}", String(index + 2))}</span>
                            <Link href={`/import-batches/${id}`} className="flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                                {t.importBatch.continuation.open}<ArrowRight className="h-3 w-3" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
