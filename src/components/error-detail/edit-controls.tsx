"use client";

import type { ReactNode } from "react";
import { Edit, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

interface EditButtonProps {
    onClick: () => void;
    label?: string;
    ariaLabel?: string;
}

export function EditButton({ onClick, label, ariaLabel }: EditButtonProps) {
    const { t } = useLanguage();
    return (
        <Button variant="ghost" size="sm" onClick={onClick} aria-label={ariaLabel}>
            <Edit className="h-4 w-4 mr-1" />{label || t.common?.edit || "Edit"}
        </Button>
    );
}

interface SaveCancelButtonsProps {
    onSave: () => void;
    onCancel: () => void;
    /** 跟在保存、取消后面的其他按钮 */
    children?: ReactNode;
}

export function SaveCancelButtons({ onSave, onCancel, children }: SaveCancelButtonsProps) {
    const { t } = useLanguage();
    return (
        <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onSave}><Save className="h-4 w-4 mr-1" />{t.common?.save || "Save"}</Button>
            <Button size="sm" variant="outline" onClick={onCancel}><X className="h-4 w-4 mr-1" />{t.common?.cancel || "Cancel"}</Button>
            {children}
        </div>
    );
}

interface SectionHeaderProps {
    title: ReactNode;
    /** 非编辑状态下显示在右侧的按钮 */
    actions?: ReactNode;
}

/** 卡片或小节的标题行：左侧标题，右侧操作按钮 */
export function SectionHeader({ title, actions }: SectionHeaderProps) {
    return <div className="flex justify-between items-center">{title}{actions}</div>;
}
