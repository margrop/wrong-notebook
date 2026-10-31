"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthShell } from "@/components/auth-shell";
import { SetupGuide } from "@/components/initialize/setup-guide";
import { LoginHelp } from "@/components/login-help";
import { useLanguage } from "@/contexts/LanguageContext";
import { TOO_MANY_ATTEMPTS } from "@/lib/auth-errors";
import { frontendLogger } from "@/lib/frontend-logger";
import { usePageTitle } from "@/lib/page-title";

export default function LoginPage() {
    const router = useRouter();
    const { t } = useLanguage();
    usePageTitle(t.pageTitle.login);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null);
    // 尚未创建管理员时提示使用初始化链接；未知时按已初始化处理，不显示提示
    const [initialized, setInitialized] = useState(true);

    const checkRegistrationStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/register/status");
            const data = await res.json();
            setAllowRegistration(data.allowRegistration === true);
            setInitialized(data.initialized !== false);
        } catch (error) {
            frontendLogger.error('[Login]', 'Failed to check registration status', { error });
            setAllowRegistration(false); // 无法确认时按关闭处理，不显示可能打不开的注册入口
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时获取是否开放注册
        checkRegistrationStatus();
    }, [checkRegistrationStatus]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const result = await signIn("credentials", {
                redirect: false,
                email,
                password,
            });

            if (result?.error === TOO_MANY_ATTEMPTS) {
                setError(t.auth?.login?.tooManyAttempts || 'Too many failed attempts, please try again later');
            } else if (result?.error) {
                setError(t.auth?.login?.failed || 'Login failed');
            } else {
                router.push("/");
                router.refresh();
            }
        } catch {
            setError(t.auth?.login?.error || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell>
            <Card className="w-full rounded-2xl border-0 shadow-xl shadow-indigo-500/5 ring-1 ring-border">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">
                        {t.auth?.login?.title || 'Login'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!initialized && <SetupGuide />}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="email" className="text-sm font-medium">
                                {t.auth?.email || 'Email'}
                            </label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="password" className="text-sm font-medium">
                                {t.auth?.password || 'Password'}
                            </label>
                            <Input
                                id="password"
                                name="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        {error && (
                            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</div>
                        )}
                        <Button type="submit" size="lg" className="w-full" disabled={loading}>
                            {loading
                                ? (t.auth?.login?.loggingIn || 'Logging in...')
                                : (t.auth?.login?.action || 'Login')}
                        </Button>
                        <LoginHelp allowRegistration={allowRegistration} />
                    </form>
                </CardContent>
            </Card>
        </AuthShell>
    );
}
