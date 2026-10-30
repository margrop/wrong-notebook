import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";

interface FieldLabelProps {
    label: ReactNode;
    /** 该字段的官方说明文档（获取 API Key、可选的模型或音色等）；没有时只显示字段名 */
    href?: string;
    linkText: string;
}

/** 字段名，右侧附官方文档链接 */
export function FieldLabel({ label, href, linkText }: FieldLabelProps) {
    if (!href) return <Label>{label}</Label>;
    return (
        <div className="flex items-center justify-between gap-2">
            <Label>{label}</Label>
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline">
                {linkText}
                <ExternalLink className="h-3 w-3" />
            </a>
        </div>
    );
}
