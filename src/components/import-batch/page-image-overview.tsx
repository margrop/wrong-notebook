"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { DraftItem } from "@/lib/question-split/draft";
import { cn } from "@/lib/utils";

interface PageImageOverviewProps {
    imageUrl: string;
    items: DraftItem[];
    /** 点击框时定位到对应题目 */
    onSelectItem: (key: string) => void;
    highlightedKey?: string | null;
}

/** 整页原图与各题区域：编号框标出每道题，已取消选择的题用虚线；手机上默认收起 */
export function PageImageOverview({ imageUrl, items, onSelectItem, highlightedKey }: PageImageOverviewProps) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(true);

    return (
        <section className="rounded-xl border bg-card p-3" data-testid="page-image-overview">
            <Button type="button" variant="ghost" size="sm" className="mb-2 h-8 px-2 md:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                {open ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                {open ? t.importBatch.hideImage : t.importBatch.showImage}
            </Button>
            <div className={cn("relative mx-auto w-fit max-w-full", !open && "hidden md:block")}>
                <img src={imageUrl} alt="" className="block max-h-[70vh] max-w-full select-none rounded-md" draggable={false} />
                {items.map((item, index) => item.regions.map((region, regionIndex) => (
                    <button
                        key={`${item.key}-${regionIndex}`}
                        type="button"
                        onClick={() => onSelectItem(item.key)}
                        className={cn(
                            "absolute rounded-sm border-2 transition-colors",
                            item.selected ? "border-primary bg-primary/10" : "border-dashed border-muted-foreground/70 bg-transparent",
                            highlightedKey === item.key && "border-amber-500 bg-amber-400/20",
                        )}
                        style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                        aria-label={t.importBatch.question.replace("{index}", String(index + 1))}
                    >
                        {regionIndex === 0 && (
                            <span className={cn("absolute -left-0.5 -top-0.5 rounded-br-md px-1.5 text-xs font-semibold text-white", item.selected ? "bg-primary" : "bg-muted-foreground")}>
                                {index + 1}
                            </span>
                        )}
                    </button>
                )))}
            </div>
        </section>
    );
}
