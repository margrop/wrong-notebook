"use client";

import { ExternalLink, Loader2, LogIn, LogOut, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MiniMaxCodeCheckin } from "@/components/settings/minimax-code-checkin";
import { useLanguage } from "@/contexts/LanguageContext";
import { DEFAULT_MINIMAX_CODE_MODEL, MINIMAX_CODE_MODELS } from "@/lib/minimax-code/constants";
import type { MiniMaxCodeConfig } from "@/lib/minimax-code/constants";
import { useMiniMaxCodeAccount } from "@/lib/hooks/use-minimax-code-account";

interface MiniMaxCodeSettingsProps {
    value?: MiniMaxCodeConfig;
    onChange: (value: MiniMaxCodeConfig) => void;
}

/** MiniMax Code OAuth 渠道：账号状态（登录、剩余积分、今日签到）、网页登录、自动签到与模型选择 */
export function MiniMaxCodeSettings({ value, onChange }: MiniMaxCodeSettingsProps) {
    const { t } = useLanguage();
    const texts = t.settings?.ai?.minimaxCode;
    const { status, loading, pending, busy, refresh, login, logout, checkin } = useMiniMaxCodeAccount();
    const loginState = status?.login ?? 'none';
    const account = status?.account;
    const credits = status?.credits;

    const statusLabel = {
        none: texts?.statusNone || "Not signed in",
        active: texts?.statusActive || "Signed in",
        expired: texts?.statusExpired || "Login expired",
    }[loginState];

    return (
        <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            <p className="text-xs text-muted-foreground">{texts?.intro}</p>

            <section className="space-y-3 rounded-md border bg-background p-3" aria-label={texts?.title || "MiniMax Code account"}>
                <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">{texts?.title || "MiniMax Code account"}</h4>
                    <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading} aria-label={texts?.refresh || "Refresh"}>
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{texts?.loginStatus || "Login status"}</dt>
                    <dd className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant={loginState === 'active' ? 'default' : loginState === 'expired' ? 'destructive' : 'secondary'}>
                            {statusLabel}
                        </Badge>
                        {account && <span className="truncate text-muted-foreground">{account.name || account.email || account.userId}</span>}
                    </dd>

                    {loginState === 'active' && (
                        <>
                            <dt className="text-muted-foreground">{texts?.credits || "Remaining credits"}</dt>
                            <dd>
                                {credits ? (
                                    <>
                                        <span className="font-medium tabular-nums">{credits.total}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">
                                            {(texts?.creditsDetail || "Free {free} · Purchased {purchased}")
                                                .replace('{free}', String(credits.free))
                                                .replace('{purchased}', String(credits.purchased))}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-muted-foreground">{texts?.creditsUnavailable || "Unavailable"}</span>
                                )}
                            </dd>
                        </>
                    )}
                </dl>

                {loginState === 'active' && status && (
                    <MiniMaxCodeCheckin
                        checkin={status.checkin}
                        autoCheckin={value?.autoCheckin !== false}
                        onAutoCheckinChange={(autoCheckin) => onChange({ ...value, autoCheckin })}
                        busy={busy}
                        onCheckin={() => void checkin()}
                    />
                )}

                {pending ? (
                    <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                        <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{texts?.waiting}</p>
                        {pending.userCode && <p>{texts?.userCode || "Verification code"}: <span className="font-mono font-medium">{pending.userCode}</span></p>}
                        <a href={pending.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
                            {texts?.openLink || "Open the authorization page"} <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => void login()} disabled={busy}>
                            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                            {loginState === 'none' ? (texts?.login || "Sign in with browser") : (texts?.relogin || "Sign in again")}
                        </Button>
                        {loginState !== 'none' && (
                            <Button size="sm" variant="outline" onClick={() => void logout()} disabled={busy}>
                                <LogOut className="mr-2 h-4 w-4" />{texts?.logout || "Sign out"}
                            </Button>
                        )}
                    </div>
                )}
            </section>

            <div className="space-y-2">
                <Label htmlFor="minimax-code-model">{texts?.model || "Model"}</Label>
                <Input
                    id="minimax-code-model"
                    list="minimax-code-models"
                    value={value?.model || ""}
                    onChange={(e) => onChange({ ...value, model: e.target.value })}
                    placeholder={DEFAULT_MINIMAX_CODE_MODEL}
                />
                <datalist id="minimax-code-models">
                    {MINIMAX_CODE_MODELS.map((model) => <option key={model} value={model} />)}
                </datalist>
                <p className="text-xs text-muted-foreground">{texts?.modelHint}</p>
            </div>

            <p className="text-xs text-muted-foreground">{texts?.risk}</p>
        </div>
    );
}
