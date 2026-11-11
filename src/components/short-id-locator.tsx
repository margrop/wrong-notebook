"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { locateByShortId } from "@/lib/short-id/short-id-client";
import { isShortId } from "@/lib/short-id/short-id-format";
import { parseSeqNoQuery } from "@/lib/seq-no/seq-no-format";

/** 输入题目编号（6 位 ID 或流水号 #1000）直接跳转到题目详情 */
export function ShortIdLocator() {
    const { t } = useLanguage();
    const router = useRouter();
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const input = value.trim();
        const seqNo = parseSeqNoQuery(input);
        if (!isShortId(input) && seqNo === null) {
            setError(t.shortId.invalid);
            return;
        }
        setLoading(true);
        setError(null);
        // 流水号去掉 # 后查询；服务端先按流水号、再按 6 位 ID 查找
        const id = await locateByShortId(seqNo !== null ? String(seqNo) : input);
        setLoading(false);
        if (id) {
            router.push(`/error-items/${id}`);
        } else {
            setError(t.shortId.notFound);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-1">
            <div className="flex gap-2">
                <Input
                    value={value}
                    onChange={(e) => { setValue(e.target.value); setError(null); }}
                    placeholder={t.shortId.locatePlaceholder}
                    maxLength={12}
                    className="font-mono sm:max-w-xs"
                    aria-label={t.shortId.locateTitle}
                />
                <Button type="submit" variant="outline" disabled={loading || !value.trim()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                    <span className="ml-2">{t.shortId.locate}</span>
                </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
    );
}
