"use client";

import { useCallback, useEffect, useState } from "react";
import { LibraryBig, Loader2 } from "lucide-react";
import { BankDetail } from "@/components/banks/bank-detail";
import { BankImportPanel } from "@/components/banks/bank-import-panel";
import { SharedBankPicker } from "@/components/banks/shared-bank-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";
import type { QuestionBankSummary } from "@/lib/question-bank/types";
import type { Notebook } from "@/types/api";

const STAGE_KEYS: Record<string, "primary" | "juniorHigh" | "seniorHigh" | "university"> = {
    primary: "primary",
    junior_high: "juniorHigh",
    senior_high: "seniorHigh",
    university: "university",
};

/** 真题库：导入共享/本地题库、管理题目，并与举一反三按知识点联动 */
export default function BanksPage() {
    const { t } = useLanguage();
    usePageTitle(t.banks.title);
    const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
    const [notebooks, setNotebooks] = useState<Notebook[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchBanks = useCallback(async () => {
        try {
            const data = await apiClient.get<{ banks: QuestionBankSummary[] }>("/api/question-banks");
            setBanks(data.banks);
        } catch (error) {
            frontendLogger.error('[Banks]', 'Failed to fetch question banks', { error });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void Promise.all([
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时读取题库
            fetchBanks(),
            apiClient.get<Notebook[]>("/api/notebooks").then(setNotebooks).catch((error) => {
                frontendLogger.error('[Banks]', 'Failed to fetch notebooks', { error });
            }),
        ]);
    }, [fetchBanks]);

    return (
        <main className="mx-auto min-h-screen max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="space-y-6">
                <PageHeader title={t.banks.title} description={t.banks.subtitle} />

                <BankImportPanel notebooks={notebooks} onImported={fetchBanks} />
                <SharedBankPicker existingNames={banks.map((bank) => bank.name)} onImported={fetchBanks} />

                <section className="space-y-3">
                    <h2 className="text-lg font-semibold">{t.banks.title}</h2>
                    {loading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : banks.length === 0 ? (
                        <EmptyState icon={LibraryBig} title={t.banks.empty} />
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {banks.map((bank) => (
                                <button
                                    key={bank.id}
                                    type="button"
                                    onClick={() => setSelectedId(bank.id)}
                                    className={`rounded-lg border p-4 text-left transition-colors hover:bg-muted ${
                                        selectedId === bank.id ? "border-primary bg-muted" : "border-border"
                                    }`}
                                >
                                    <p className="truncate font-medium">{bank.name}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {t.banks.stageNames[STAGE_KEYS[bank.stage] ?? "primary"]}
                                        {bank.subjectKey ? ` · ${t.tags.subjects[bank.subjectKey as keyof typeof t.tags.subjects] ?? bank.subjectKey}` : ""}
                                        {` · ${bank.questionCount} ${t.banks.questions}`}
                                    </p>
                                    <p className="mt-1 truncate text-xs text-muted-foreground">
                                        {bank.source ?? ""} {bank.license ? `· ${bank.license}` : ""}
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                {selectedId && (
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">{t.banks.detailTitle}</h2>
                        <BankDetail
                            bankId={selectedId}
                            notebooks={notebooks}
                            onChanged={fetchBanks}
                            onDeleted={() => setSelectedId(null)}
                        />
                    </section>
                )}
            </div>
        </main>
    );
}
