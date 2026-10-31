"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface GenerateButtonProps {
    loading: boolean;
    onClick: () => void;
    /** 已有题目时显示「重新生成」，否则显示「生成」 */
    regenerate?: boolean;
}

/** 生成或重新生成举一反三题目的按钮，生成中显示加载状态 */
export function GenerateButton({ loading, onClick, regenerate }: GenerateButtonProps) {
    const { t } = useLanguage();
    return (
        <Button size={regenerate ? "sm" : "lg"} variant={regenerate ? "ghost" : "default"} onClick={onClick} disabled={loading}>
            {loading ? (
                <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.practice.generating}
                </>
            ) : (
                <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {regenerate ? t.practice.regenerate : t.practice.generate}
                </>
            )}
        </Button>
    );
}
