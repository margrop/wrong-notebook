"use client";

import { ClipboardPaste, Loader2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface PasteButtonProps {
    onPaste: () => void;
    isAnalyzing: boolean;
}

/** 剪贴板粘贴按钮 */
export function PasteButton({ onPaste, isAnalyzing }: PasteButtonProps) {
    const { t } = useLanguage();

    return (
        <div className="flex flex-col items-center gap-2">
            <Button
                variant="outline"
                onClick={onPaste}
                disabled={isAnalyzing}
                className="flex items-center gap-2 w-full sm:w-auto"
            >
                <ClipboardPaste className="h-4 w-4" />
                {t.upload.paste}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
                {t.upload.pasteDesc}
            </p>
        </div>
    );
}

interface ScreenshotButtonProps {
    onScreenshot: () => void;
    isAnalyzing: boolean;
    isScreenshotting: boolean;
}

/** 屏幕截图按钮 */
export function ScreenshotButton({ onScreenshot, isAnalyzing, isScreenshotting }: ScreenshotButtonProps) {
    const { t } = useLanguage();

    return (
        <div className="flex flex-col items-center gap-2">
            <Button
                variant="outline"
                onClick={onScreenshot}
                disabled={isAnalyzing || isScreenshotting}
                className="flex items-center gap-2 w-full sm:w-auto"
            >
                {isScreenshotting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Monitor className="h-4 w-4" />
                )}
                {isScreenshotting ? t.common.pleaseWait : t.upload.screenshot}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
                {t.upload.screenshotDesc}
            </p>
        </div>
    );
}
