"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { EulaConsent } from "@/components/eula/eula-consent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface EulaConsentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 勾选同意并确认后调用；抛错时对话框保持打开 */
    onConfirm: () => Promise<void>;
}

/** 存量实例开启外发前的协议确认：勾选同意后才能确认 */
export function EulaConsentDialog({ open, onOpenChange, onConfirm }: EulaConsentDialogProps) {
    const { t } = useLanguage();
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);

    const handleConfirm = async () => {
        setBusy(true);
        try {
            await onConfirm();
            setChecked(false);
            onOpenChange(false);
        } catch {
            // 调用方负责提示错误
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
            <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t.eula.dialogTitle}</DialogTitle>
                    <DialogDescription>{t.eula.dialogDesc}</DialogDescription>
                </DialogHeader>
                <EulaConsent checked={checked} onCheckedChange={setChecked} disabled={busy} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t.eula.cancel}</Button>
                    <Button onClick={handleConfirm} disabled={!checked || busy}>
                        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t.eula.accept}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
