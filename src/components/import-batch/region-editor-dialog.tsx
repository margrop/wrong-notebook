"use client";

import { useState } from "react";
import ReactCrop from "react-image-crop";
import type { PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import { MAX_ITEM_REGIONS, MIN_REGION_SIZE } from "@/lib/question-split/draft";
import type { DraftRegion } from "@/lib/question-split/draft";
import { cn } from "@/lib/utils";

interface RegionEditorDialogProps {
    open: boolean;
    imageUrl: string;
    /** 当前区域；为空时从一个居中的默认框开始 */
    regions: DraftRegion[];
    onClose: () => void;
    onSave: (regions: DraftRegion[]) => void;
}

const DEFAULT_REGION: DraftRegion = { x: 0.1, y: 0.1, width: 0.8, height: 0.3 };

function toCrop(region: DraftRegion): PercentCrop {
    return { unit: "%", x: region.x * 100, y: region.y * 100, width: region.width * 100, height: region.height * 100 };
}

function fromCrop(crop: PercentCrop): DraftRegion | null {
    const region = { x: crop.x / 100, y: crop.y / 100, width: crop.width / 100, height: crop.height / 100 };
    return region.width >= MIN_REGION_SIZE && region.height >= MIN_REGION_SIZE ? region : null;
}

/** 在整页原图上调整一道题的区域；一题最多 4 个区域（如跨栏的题干与配图） */
export function RegionEditorDialog({ open, imageUrl, regions, onClose, onSave }: RegionEditorDialogProps) {
    const { t } = useLanguage();
    const [crops, setCrops] = useState<PercentCrop[]>(() => (regions.length ? regions : [DEFAULT_REGION]).map(toCrop));
    const [active, setActive] = useState(0);
    const current = crops[Math.min(active, crops.length - 1)];

    const save = () => {
        const next = crops.map(fromCrop).filter((region): region is DraftRegion => region !== null);
        if (next.length) onSave(next);
    };

    return (
        <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
            <DialogContent className="flex h-[90vh] max-w-3xl flex-col gap-0 p-0">
                <DialogHeader className="shrink-0 border-b p-4">
                    <DialogTitle>{t.importBatch.regionDialogTitle}</DialogTitle>
                    <DialogDescription>{t.importBatch.regionDialogHint}</DialogDescription>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-auto bg-black p-3">
                    <div className="mx-auto w-fit">
                        <ReactCrop crop={current} onChange={(_, percent) => setCrops((list) => list.map((crop, index) => (index === active ? percent : crop)))}>
                            <img src={imageUrl} alt="" className="block max-h-[65vh] max-w-full" draggable={false} />
                        </ReactCrop>
                    </div>
                </div>
                <div className="shrink-0 space-y-3 border-t p-4">
                    <div className="flex flex-wrap items-center gap-2">
                        {crops.map((_, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setActive(index)}
                                className={cn("rounded-md border px-3 py-1 text-sm", index === active ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground")}
                            >
                                {t.importBatch.regionTab.replace("{index}", String(index + 1))}
                            </button>
                        ))}
                        {crops.length < MAX_ITEM_REGIONS && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => {
                                setCrops((list) => [...list, toCrop(DEFAULT_REGION)]);
                                setActive(crops.length);
                            }}>
                                <Plus className="mr-1 h-4 w-4" />{t.importBatch.addRegion}
                            </Button>
                        )}
                        {crops.length > 1 && (
                            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => {
                                setCrops((list) => list.filter((_, index) => index !== active));
                                setActive(0);
                            }}>
                                <Trash2 className="mr-1 h-4 w-4" />{t.importBatch.removeRegion}
                            </Button>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose}>{t.common.cancel}</Button>
                        <Button type="button" onClick={save}>{t.importBatch.saveRegion}</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
