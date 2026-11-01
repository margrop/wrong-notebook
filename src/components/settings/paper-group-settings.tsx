"use client";

import { useState } from "react";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { toast, confirmDialog } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePaperGroups } from "@/lib/use-paper-groups";

/** 卷别分组管理：增删改查、停用启用 */
export function PaperGroupSettings() {
    const { t } = useLanguage();
    const { groups, loading, refetch } = usePaperGroups();
    const [newName, setNewName] = useState("");
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async () => {
        const name = newName.trim();
        if (!name) return;
        setIsAdding(true);
        try {
            await apiClient.post("/api/paper-groups", { name });
            setNewName("");
            toast.success(t.common?.messages?.saveSuccess || "Saved");
            refetch();
        } catch (error) {
            frontendLogger.error("[PaperGroupSettings]", "Failed to add group", { error });
            toast.error(t.common?.messages?.saveFailed || "Failed to save");
        } finally {
            setIsAdding(false);
        }
    };

    const handleRename = async (id: string, oldName: string) => {
        const name = window.prompt(
            t.settings?.paperGroups?.renamePrompt || "Rename group",
            oldName,
        );
        if (!name || name.trim() === oldName) return;
        try {
            await apiClient.patch(`/api/paper-groups/${id}`, { name: name.trim() });
            toast.success(t.common?.messages?.saveSuccess || "Saved");
            refetch();
        } catch (error) {
            frontendLogger.error("[PaperGroupSettings]", "Failed to rename group", { error });
            toast.error(t.common?.messages?.saveFailed || "Failed to save");
        }
    };

    const handleToggleActive = async (id: string, isActive: boolean) => {
        try {
            await apiClient.patch(`/api/paper-groups/${id}`, { isActive: !isActive });
            toast.success(t.common?.messages?.saveSuccess || "Saved");
            refetch();
        } catch (error) {
            frontendLogger.error("[PaperGroupSettings]", "Failed to toggle group", { error });
            toast.error(t.common?.messages?.saveFailed || "Failed to save");
        }
    };

    const handleDelete = async (id: string, name: string, count: number) => {
        if (count > 0) {
            const msg = (t.settings?.paperGroups?.deleteConfirmWithItems || "Group \"{name}\" has {count} questions. Deleting will clear their group assignment. Continue?")
                .replace("{name}", name)
                .replace("{count}", String(count));
            if (!(await confirmDialog(msg, { destructive: true }))) return;
            try {
                await apiClient.delete(`/api/paper-groups/${id}?clear=true`);
                toast.success(t.common?.messages?.deleteSuccess || "Deleted");
                refetch();
            } catch (error) {
                frontendLogger.error("[PaperGroupSettings]", "Failed to delete group", { error });
                toast.error(t.common?.messages?.deleteFailed || "Delete failed");
            }
            return;
        }

        const msg = (t.settings?.paperGroups?.deleteConfirm || "Delete group \"{name}\"?").replace("{name}", name);
        if (!(await confirmDialog(msg, { destructive: true }))) return;
        try {
            await apiClient.delete(`/api/paper-groups/${id}`);
            toast.success(t.common?.messages?.deleteSuccess || "Deleted");
            refetch();
        } catch (error) {
            frontendLogger.error("[PaperGroupSettings]", "Failed to delete group", { error });
            toast.error(t.common?.messages?.deleteFailed || "Delete failed");
        }
    };

    if (loading) {
        return (
            <Card>
                <CardContent className="py-12 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5" />
                    {t.settings?.paperGroups?.title || "Paper Groups"}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    {t.settings?.paperGroups?.desc || "Customize paper groups like Unit Test, Midterm, Final. Default groups A/B/Other can be renamed but not deleted."}
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Add new group */}
                <div className="flex gap-2">
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t.settings?.paperGroups?.addPlaceholder || "e.g. Unit Test"}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleAdd();
                        }}
                    />
                    <Button onClick={handleAdd} disabled={isAdding || !newName.trim()}>
                        {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        {t.common?.add || "Add"}
                    </Button>
                </div>

                {/* Group list */}
                <div className="space-y-2">
                    {groups.map((group) => (
                        <div
                            key={group.id}
                            className={`flex items-center justify-between rounded-lg border p-3 ${!group.isActive ? "opacity-50" : ""}`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="font-medium">{group.name}</span>
                                {group.key && (
                                    <Badge variant="secondary" className="text-xs">
                                        {t.settings?.paperGroups?.systemBadge || "Default"}
                                    </Badge>
                                )}
                                {!group.isActive && (
                                    <Badge variant="outline" className="text-xs">
                                        {t.common?.inactive || "Inactive"}
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRename(group.id, group.name)}
                                >
                                    {t.common?.rename || "Rename"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleToggleActive(group.id, group.isActive)}
                                >
                                    {group.isActive
                                        ? (t.common?.deactivate || "Deactivate")
                                        : (t.common?.activate || "Activate")}
                                </Button>
                                {!group.key && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => handleDelete(group.id, group.name, group._count?.errorItems || 0)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
