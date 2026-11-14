"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";

interface ViewAsTarget {
    id: string;
    name: string | null;
    email: string;
}

/** 管理员查看他人数据时的全局提示条；退出后恢复管理员本人视角 */
export function AdminViewAsBanner() {
    const { t } = useLanguage();
    const [target, setTarget] = useState<ViewAsTarget | null>(null);
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        apiClient.get<{ target: ViewAsTarget | null }>("/api/admin/view-as")
            .then((data) => setTarget(data.target))
            .catch((error) => frontendLogger.warn('[AdminViewAs]', 'Failed to read view-as state', { error }));
    }, []);

    if (!target) return null;

    const exit = async () => {
        setExiting(true);
        try {
            await apiClient.delete("/api/admin/view-as");
            window.location.reload();
        } catch (error) {
            frontendLogger.error('[AdminViewAs]', 'Failed to exit view-as mode', { error });
            setExiting(false);
        }
    };

    return (
        <div className="flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900 print:hidden dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <Eye className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
                {(t.admin?.viewAs?.banner || "Viewing as {name}; all changes are recorded under this account.").replace("{name}", target.name || target.email)}
            </span>
            <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/40" onClick={() => { void exit(); }} disabled={exiting}>
                <X className="mr-1 h-3.5 w-3.5" />
                {t.admin?.viewAs?.exit || "Exit"}
            </Button>
        </div>
    );
}
