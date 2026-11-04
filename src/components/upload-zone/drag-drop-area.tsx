"use client";

import type { HTMLAttributes, InputHTMLAttributes } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, UploadCloud } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface DragDropAreaProps {
    getRootProps: () => HTMLAttributes<HTMLElement>;
    getInputProps: () => InputHTMLAttributes<HTMLInputElement>;
    isDragActive: boolean;
    isAnalyzing: boolean;
}

/** 拖拽/点击上传区域 */
export function DragDropArea({ getRootProps, getInputProps, isDragActive, isAnalyzing }: DragDropAreaProps) {
    const { t } = useLanguage();

    return (
        <Card
            {...getRootProps()}
            className={`group cursor-pointer rounded-2xl border-2 border-dashed shadow-none transition-all hover:border-primary/60 hover:bg-accent/40 ${isDragActive ? "border-primary bg-accent/60" : "border-border bg-card"
                }`}
        >
            <CardContent className="flex min-h-[260px] flex-col items-center justify-center space-y-4 py-10 text-center md:min-h-[300px]">
                <input {...getInputProps()} />
                <div className="rounded-2xl bg-accent p-4 text-primary transition-transform group-hover:scale-105">
                    {isAnalyzing ? (
                        <Loader2 className="h-10 w-10 animate-spin" />
                    ) : (
                        <UploadCloud className="h-10 w-10" />
                    )}
                </div>
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold">
                        {isAnalyzing ? t.app.analyzing : t.upload.analyze}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {isAnalyzing ? t.app.analyzing : t.app.dragDrop}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                        {t.upload.support}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
