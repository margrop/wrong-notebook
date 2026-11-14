"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExamCreateForm } from "@/components/exam/exam-create-form";
import { useLanguage } from "@/contexts/LanguageContext";

interface ExamCreateDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** 右侧抽屉式组卷面板：题数、上次作答结果与知识点均衡选项都在同一面板内选择 */
export function ExamCreateDrawer({ open, onOpenChange }: ExamCreateDrawerProps) {
    const { t } = useLanguage();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="inset-y-0 left-auto right-0 m-0 flex h-full max-h-none w-full max-w-xl flex-col gap-0 rounded-none border-l p-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right">
                <div className="border-b px-4 py-3 pr-12">
                    <DialogTitle className="text-lg">{t.exam.createTitle}</DialogTitle>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <ExamCreateForm onClose={() => onOpenChange(false)} />
                </div>
            </DialogContent>
        </Dialog>
    );
}
