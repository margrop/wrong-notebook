"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { Plus, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { ErrorList } from "@/components/error-list";
import { RenameNotebookDialog } from "@/components/rename-notebook-dialog";
import { RetagNotebookButton } from "@/components/retag-notebook-button";
import { NotebookScopeLabel } from "@/components/notebook-scope-label";

import { Notebook } from "@/types/api";
import { apiClient } from "@/lib/api-client";

import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { confirmDialog, toast } from "@/lib/feedback";
import { getApiErrorMessage } from "@/lib/error-message";
import { frontendLogger } from "@/lib/frontend-logger";

export default function NotebookDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { t } = useLanguage();
    const [notebook, setNotebook] = useState<Notebook | null>(null);
    usePageTitle(t.notebooks.title, notebook?.name);
    const [loading, setLoading] = useState(true);
    const [renameDialogOpen, setRenameDialogOpen] = useState(false);
    // 批量重新生成知识点后递增，用于刷新题目列表
    const [listVersion, setListVersion] = useState(0);

    const fetchNotebook = useCallback(async (id: string) => {
        try {
            const data = await apiClient.get<Notebook>(`/api/notebooks/${id}`);
            setNotebook(data);
        } catch (error) {
            frontendLogger.error('[NotebookDetail]', 'Failed to fetch notebook', { error });
            toast.error(t.notebooks?.notFound || "Notebook not found");
            router.push("/notebooks");
        } finally {
            setLoading(false);
        }
    }, [router, t]);

    useEffect(() => {
        if (params.id) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
            fetchNotebook(params.id as string);
        }
    }, [params.id, fetchNotebook]);

    const handleRename = async (name: string) => {
        if (!notebook) return;
        const updated = await apiClient.put<Notebook>(`/api/notebooks/${notebook.id}`, { name });
        setNotebook(updated);
    };

    const handleDelete = async () => {
        if (!notebook) return;
        try {
            // 列表中可能刚删过题目，先取最新题目数再判断
            const latest = await apiClient.get<Notebook>(`/api/notebooks/${notebook.id}`);
            if ((latest._count?.errorItems || 0) > 0) {
                toast.warning(t.notebooks?.deleteNotEmpty || "Please clear all items in this notebook first.");
                return;
            }
            if (!(await confirmDialog((t.notebooks?.deleteConfirm || "Are you sure?").replace("{name}", notebook.name), { destructive: true }))) return;
            await apiClient.delete(`/api/notebooks/${notebook.id}`);
            router.replace("/notebooks");
        } catch (error) {
            frontendLogger.error('[NotebookDetail]', 'Failed to delete notebook', { error });
            toast.error(getApiErrorMessage(error) || t.notebooks?.deleteError || "Failed to delete");
        }
    };

    if (loading) {
        return <PageLoading label={t.common.loading} />;
    }

    if (!notebook) return null;

    return (
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="space-y-6">
                <PageHeader
                    backHref="/notebooks"
                    title={notebook.name}
                    titleAddon={
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-muted-foreground"
                            onClick={() => setRenameDialogOpen(true)}
                            title={t.notebooks?.rename || "Rename"}
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    }
                    description={
                        <>
                            <NotebookScopeLabel notebook={notebook} />
                            {" · "}
                            {(t.notebooks?.totalErrors || "Total {count} errors").replace("{count}", (notebook._count?.errorItems || 0).toString())}
                        </>
                    }
                    actions={
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={handleDelete}
                                aria-label={t.common.delete}
                            >
                                <Trash2 className="h-4 w-4" />
                                <span className="hidden sm:inline">{t.common.delete}</span>
                            </Button>
                            <RetagNotebookButton notebookId={notebook.id} onFinished={() => setListVersion(v => v + 1)} />
                            <Link href={`/notebooks/${notebook.id}/add`}>
                                <Button aria-label={t.notebooks?.addError || "Add Error"}>
                                    <Plus className="h-4 w-4" />
                                    <span className="hidden sm:inline">{t.notebooks?.addError || "Add Error"}</span>
                                </Button>
                            </Link>
                        </>
                    }
                />

                <ErrorList key={listVersion} subjectId={notebook.id} subjectName={notebook.name} tagSet={notebook.tagSet || 'default'} />

                <RenameNotebookDialog
                    open={renameDialogOpen}
                    onOpenChange={setRenameDialogOpen}
                    currentName={notebook.name}
                    onRename={handleRename}
                />
            </div>
        </main>
    );
}
