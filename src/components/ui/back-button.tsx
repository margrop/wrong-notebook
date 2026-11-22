"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
    /** 返回的目标页面URL（必须是逻辑上的父页面） */
    fallbackUrl: string;
    className?: string;
}

/**
 * 返回按钮：始终导航到指定的父页面，确保逻辑层级正确
 */
export function BackButton({ fallbackUrl, className }: BackButtonProps) {
    const router = useRouter();
    const { t } = useLanguage();

    const handleBack = () => {
        router.push(fallbackUrl);
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className={className}
            aria-label={t.common?.back || "Back"}
        >
            <ArrowLeft className="h-5 w-5" />
        </Button>
    );
}
