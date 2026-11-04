"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { locateByShortId } from "@/lib/short-id/short-id-client";
import { isShortId } from "@/lib/short-id/short-id-format";

/** 输入短 ID 直接跳转到题目详情 */
export function ShortIdLocator() {
    const { t } = useLanguage();
    const router = useRouter();
    const [value, setValue] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const shortId = value.trim();
        if (!isShortId(shortId)) {
            setError(t.shortId.invalid);
            return;
        }
        setLoading(true);
        setError(null);
        const id = await locateByShortId(shortId);
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
                    maxLength={6}
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
