"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from "@/lib/default-admin";
import { frontendLogger } from "@/lib/frontend-logger";

interface InitializeFormProps {
    /** 初始化链接中的一次性令牌 */
    token: string;
    /** 已有管理员（链接过期或他人已完成初始化）时回调，页面改为提示登录 */
    onAlreadyInitialized: () => void;
}

/** 用一次性初始化链接创建第一个管理员，成功后自动登录并进入安装向导 */
export function InitializeForm({ token, onAlreadyInitialized }: InitializeFormProps) {
    const { t } = useLanguage();
    const texts = t.auth.initialize;
    const router = useRouter();
    const [name, setName] = useState(texts.defaultName);
    const [email, setEmail] = useState(DEFAULT_ADMIN_EMAIL);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (password !== confirmPassword) {
            setError(texts.passwordMismatch);
            return;
        }
        if (password.length < 6 || password === DEFAULT_ADMIN_PASSWORD) {
            setError(texts.passwordHint);
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch("/api/initialize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, name, email, password }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({})) as { code?: string };
                if (res.status === 409 && data.code === "ALREADY_EXISTS") setError(texts.emailExists);
                else if (res.status === 409) onAlreadyInitialized();
                else if (res.status === 403) setError(texts.invalidLink);
                else setError(texts.failed);
                return;
            }

            const result = await signIn("credentials", { redirect: false, email: email.trim(), password });
            if (result?.error) {
                setError(texts.signInFailed);
                return;
            }
            // 新安装没有错题本，首页会把管理员带进安装向导（配置 AI、创建错题本）
            router.replace("/setup");
            router.refresh();
        } catch (error) {
            frontendLogger.error('[Initialize]', 'Failed to create admin', { error });
            setError(texts.failed);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">{texts.desc}</p>
            <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">{texts.name}</label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
            </div>
            <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">{t.auth.email}</label>
                <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">{t.auth.password}</label>
                <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
                <p className="text-xs text-muted-foreground">{texts.passwordHint}</p>
            </div>
            <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-medium">{t.auth.confirmPassword}</label>
                <Input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required />
            </div>
            {error && (
                <div className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</div>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitting ? texts.submitting : texts.submit}
            </Button>
        </form>
    );
}
