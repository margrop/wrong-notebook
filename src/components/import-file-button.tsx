"use client";

import type { ChangeEvent, RefObject } from "react";
import { useRef } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptedExtensions } from "@/lib/import/file-read";
import type { ImportFileTypeDef } from "@/lib/import/file-read";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/lib/feedback";

export interface ImportFileButtonProps {
    /** 可接受的文件类型列表 */
    types: readonly ImportFileTypeDef[];
    /** 选中并通过校验的文件（含按类型读取所需的内容） */
    onFile: (file: File, type: ImportFileTypeDef) => void;
    disabled?: boolean;
    inputRef?: RefObject<HTMLInputElement | null>;
    className?: string;
}

/**
 * 通用「从文件导入」按钮：隐藏 input[type=file]，移动端可用。
 * 负责类型与体积校验，不通过时给出明确的中英文提示。
 */
export function ImportFileButton({ types, onFile, disabled = false, inputRef, className }: ImportFileButtonProps) {
    const { t } = useLanguage();
    const innerRef = useRef<HTMLInputElement | null>(null);
    const fileInputRef = inputRef ?? innerRef;

    const accept = Array.from(new Set(types.flatMap((type) => [...acceptedExtensions(type), ...type.mimeTypes]))).join(",");

    const handlePicked = (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.target;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        const type = types.find((def) =>
            acceptedExtensions(def).some((ext) => file.name.toLowerCase().endsWith(ext))
            || (file.type && def.mimeTypes.includes(file.type.toLowerCase()))
        );
        if (!type) {
            toast.error(t.importFile.unsupportedType);
            return;
        }
        if (file.size > type.maxBytes) {
            toast.error(t.importFile.tooLarge.replace("{max}", String(Math.round(type.maxBytes / 1024 / 1024))));
            return;
        }
        onFile(file, type);
    };

    return (
        <>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={disabled} className={className}>
                <FolderOpen className="mr-2 h-4 w-4" />
                {t.importFile.button}
            </Button>
            <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={handlePicked}
                data-testid="import-file-input"
                aria-label={t.importFile.button}
            />
        </>
    );
}
