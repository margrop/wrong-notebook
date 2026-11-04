"use client";

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiClient } from '@/lib/api-client';
import { frontendLogger } from '@/lib/frontend-logger';
import { DEFAULT_QUESTION_DUPLICATE_THRESHOLD } from '@/lib/question/question-similarity';
import type { UserProfile } from '@/types/api';

interface DuplicateThresholdSettingProps {
    onSaved?: (threshold: number) => void;
}

/** 个人判重阈值独立保存，导入接口直接读取持久化值。 */
export function DuplicateThresholdSetting({ onSaved }: DuplicateThresholdSettingProps) {
    const { t } = useLanguage();
    const [value, setValue] = useState(String(DEFAULT_QUESTION_DUPLICATE_THRESHOLD));
    const [saved, setSaved] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const number = Number(value);
    const valid = value.trim() !== '' && Number.isFinite(number) && number >= 1 && number <= 100
        && Math.abs(number * 100 - Math.round(number * 100)) < 0.000001;

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const user = await apiClient.get<UserProfile>('/api/user');
            const threshold = user.questionDuplicateThreshold ?? DEFAULT_QUESTION_DUPLICATE_THRESHOLD;
            setValue(String(threshold));
            setSaved(threshold);
        } catch (error) {
            setMessage(t.importFlow.thresholdLoadFailed);
            frontendLogger.error('[Settings]', '加载判重阈值失败', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            setLoading(false);
        }
    }, [t.importFlow.thresholdLoadFailed]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        if (!valid || saved === null) return;
        setSaving(true);
        setMessage(null);
        try {
            const user = await apiClient.patch<UserProfile>('/api/user', { questionDuplicateThreshold: number });
            const threshold = user.questionDuplicateThreshold ?? number;
            setSaved(threshold);
            setValue(String(threshold));
            setMessage(t.importFlow.preferenceSaved);
            onSaved?.(threshold);
        } catch (error) {
            setMessage(t.importFlow.preferenceSaveFailed);
            frontendLogger.error('[Settings]', '保存判重阈值失败', { error: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-2 border-t pt-4">
            <Label htmlFor="question-duplicate-threshold">{t.importFlow.thresholdLabel}</Label>
            <div className="flex flex-wrap items-center gap-2">
                <Input id="question-duplicate-threshold" type="number" min={1} max={100} step={0.01}
                    value={value} onChange={(event) => { setValue(event.target.value); setMessage(null); }}
                    disabled={loading || saving || saved === null} className="w-28" aria-describedby="question-duplicate-threshold-hint" />
                <span aria-hidden="true">%</span>
                <Button type="button" size="sm" variant="outline" onClick={save} disabled={loading || saving || saved === null || !valid || number === saved}>
                    {(loading || saving) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t.importFlow.saveThreshold}
                </Button>
                {!loading && saved === null && <Button type="button" size="sm" variant="outline" onClick={load}>{t.importFlow.retryLoad}</Button>}
            </div>
            <p id="question-duplicate-threshold-hint" className="text-xs text-muted-foreground">{t.importFlow.thresholdDescription}</p>
            {saved !== null && !valid && <p className="text-xs text-destructive" role="alert">{t.importFlow.thresholdInvalid}</p>}
            {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
        </div>
    );
}
