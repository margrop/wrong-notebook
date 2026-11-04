"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Loader2, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient, ApiError } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";

interface DeleteAccountSettingsProps {
    isAdmin: boolean;
}

/** 注销账号：普通用户输入密码后永久删除账号及数据；管理员只显示不可注销的说明 */
export function DeleteAccountSettings({ isAdmin }: DeleteAccountSettingsProps) {
    const { t } = useLanguage();
    const text = t.settings.deleteAccount;
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState("");
    const [deleting, setDeleting] = useState(false);

    const handleOpenChange = (next: boolean) => {
        if (deleting) return;
        setOpen(next);
        if (!next) setPassword("");
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!password) return;
        setDeleting(true);
        try {
            await apiClient.delete("/api/user", { body: JSON.stringify({ password }) });
            toast.success(text.success);
            await signOut({ callbackUrl: "/login" });
        } catch (error) {
            const wrongPassword = error instanceof ApiError && error.status === 400;
            if (!wrongPassword) frontendLogger.error("[DeleteAccountSettings]", "delete account failed", { error });
            toast.error(wrongPassword ? text.wrongPassword : text.failed);
            setDeleting(false);
        }
    };

    return (
        <div className="p-4 border rounded-lg border-red-600/50 bg-red-100/50 dark:bg-red-900/40">
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm flex items-center gap-2 text-red-900 dark:text-red-200 font-bold">
                    <UserX className="h-4 w-4" />
                    {text.title}
                </span>
                <Button
                    variant="destructive"
                    size="sm"
                    className="bg-red-700 hover:bg-red-800"
                    disabled={isAdmin}
                    onClick={() => setOpen(true)}
                    aria-label={text.title}
                >
                    <UserX className="h-4 w-4" />
                </Button>
            </div>
            <p className="text-xs mt-2 text-red-800 dark:text-red-200 font-medium">
                {isAdmin ? text.adminDisabled : text.desc}
            </p>

            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>{text.confirmTitle}</DialogTitle>
                            <DialogDescription>{text.confirmDesc}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="delete-account-password">{text.passwordLabel}</Label>
                            <PasswordInput
                                id="delete-account-password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                disabled={deleting}
                            />
                        </div>
                        <DialogFooter className="gap-2">
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={deleting}>
                                {text.cancel}
                            </Button>
                            <Button type="submit" variant="destructive" disabled={!password || deleting}>
                                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                                {text.confirm}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
