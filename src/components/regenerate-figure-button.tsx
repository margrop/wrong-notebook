"use client";

import { useState } from "react";
import { Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";

interface RegenerateFigureButtonProps {
    errorItemId: string;
    /** 生成完成后回调新的配图（无配图时为 null） */
    onDone: (figure: { hasFigure: boolean; figureSvg: string | null }) => void;
}

/** 用原题图片让 AI 重新绘制 SVG 配图 */
export function RegenerateFigureButton({ errorItemId, onDone }: RegenerateFigureButtonProps) {
    const { t } = useLanguage();
    const [running, setRunning] = useState(false);

    const handleClick = async () => {
        setRunning(true);
        try {
            const figure = await apiClient.post<{ hasFigure: boolean; figureSvg: string | null }>(`/api/error-items/${errorItemId}/figure`, {}, { recoverable: true });
            onDone(figure);
            if (!figure.figureSvg) toast.warning(t.figure.noFigure);
        } catch (error) {
            const code = (error as { data?: { message?: string } })?.data?.message || "";
            const mapped = (t.errors as Record<string, unknown>)[code];
            frontendLogger.error('[RegenerateFigure]', 'Failed to regenerate figure', { code });
            toast.error(code === "NO_ORIGINAL_IMAGE" ? t.figure.noImage : typeof mapped === "string" ? mapped : t.figure.failed);
        } finally {
            setRunning(false);
        }
    };

    return (
        <Button variant="outline" size="sm" onClick={handleClick} disabled={running} className="flex items-center gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shapes className="h-4 w-4" />}
            {running ? t.figure.regenerating : t.figure.regenerate}
        </Button>
    );
}
