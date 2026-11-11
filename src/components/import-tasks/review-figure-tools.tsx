"use client";

import { Trash2 } from "lucide-react";
import { RegenerateFigureButton } from "@/components/regenerate-figure-button";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface ReviewFigureToolsProps {
    /** 任务原图；框选配图区域后交给 AI */
    originalImageUrl?: string | null;
    /** 重绘配图的接口地址 */
    endpoint: string;
    /** 后台任务防重复 target */
    target: string;
    /** 任务结束后读取已保存的配图 */
    reload: () => Promise<{ hasFigure: boolean; figureSvg: string | null }>;
    /** 当前草稿是否已有配图；决定是否显示「去掉配图」 */
    hasFigure: boolean;
    /** 重新生成或去掉配图后更新草稿 */
    onChange: (figure: { hasFigure: boolean; figureSvg: string | null }) => void;
}

/** 校对页的配图工具：重新生成配图（可框选区域）与去掉配图；去掉只改草稿，确认入库时生效 */
export function ReviewFigureTools({ originalImageUrl, endpoint, target, reload, hasFigure, onChange }: ReviewFigureToolsProps) {
    const { t } = useLanguage();
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
            <RegenerateFigureButton
                endpoint={endpoint}
                target={target}
                reload={reload}
                originalImageUrl={originalImageUrl}
                onDone={onChange}
            />
            {hasFigure && (
                <Button variant="outline" size="sm" onClick={() => onChange({ hasFigure: false, figureSvg: null })} className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4" />
                    {t.figure.remove}
                </Button>
            )}
        </div>
    );
}
