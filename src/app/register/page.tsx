"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePageTitle } from "@/lib/page-title";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { RegisterRequest } from "@/types/api";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getApiErrorMessage } from "@/lib/error-message";

export default function RegisterPage() {
    const { timeZone } = useTimeZone();
    const router = useRouter();
    const { t } = useLanguage();
    usePageTitle(t.pageTitle.register);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [educationStage, setEducationStage] = useState("junior_high");
    const [enrollmentYear, setEnrollmentYear] = useState("2025");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [allowRegistration, setAllowRegistration] = useState<boolean | null>(null);

    const checkRegistrationStatus = useCallback(async () => {
        try {
            const res = await fetch("/api/register/status");
            const data = await res.json();
            setAllowRegistration(data.allowRegistration);
        } catch (error) {
            frontendLogger.error('[Register]', 'Failed to check registration status', { error });
            setAllowRegistration(false); // 无法确认时按关闭处理，提交时服务端仍会校验
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        checkRegistrationStatus();
    }, [checkRegistrationStatus]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        // 验证两次密码是否一致
        if (password !== confirmPassword) {
            setError(t.auth?.register?.passwordMismatch || 'Passwords do not match');
            setLoading(false);
            return;
        }

        try {
            await apiClient.post<unknown, RegisterRequest>("/api/register", {
                name,
                email,
                password,
                educationStage,
                enrollmentYear: parseInt(enrollmentYear)
            });

            toast.success(t.auth?.register?.success || 'Registration successful! Please login');
            router.push("/login");
        } catch (error) {
            let errorMsg = getApiErrorMessage(error);
            if (errorMsg === 'User with this email already exists') {
                errorMsg = t.auth?.register?.emailExists || errorMsg;
            } else if (errorMsg === 'Too many requests') {
                errorMsg = t.auth?.register?.tooManyAttempts || errorMsg;
            } else {
                errorMsg = errorMsg || (t.auth?.register?.failed || 'Registration failed');
            }
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    // 加载中状态
    if (allowRegistration === null) {
        return (
            <AuthShell>
                <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            </AuthShell>
        );
    }

    // 注册已禁用
    if (allowRegistration === false) {
        return (
            <AuthShell>
                <Card className="w-full rounded-2xl border-0 shadow-xl shadow-indigo-500/5 ring-1 ring-border">
                    <CardHeader>
                        <CardTitle className="text-2xl text-center">
                            {t.auth?.register?.disabled || 'Registration Disabled'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-col items-center gap-4 py-6">
                            <AlertCircle className="h-12 w-12 text-muted-foreground" />
                            <p className="text-center text-muted-foreground">
                                {t.auth?.register?.disabledMessage || 'Registration is currently disabled by administrator. Please contact admin for access.'}
                            </p>
                        </div>
                        <div className="text-center">
                            <Link href="/login" className="text-primary hover:underline">
                                {t.auth?.register?.backToLogin || 'Back to Login'}
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </AuthShell>
        );
    }

    return (
        <AuthShell>
            <Card className="w-full rounded-2xl border-0 shadow-xl shadow-indigo-500/5 ring-1 ring-border">
                <CardHeader>
                    <CardTitle className="text-2xl text-center">
                        {t.auth?.register?.title || 'Create an Account'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label htmlFor="name" className="text-sm font-medium">
                                {t.auth?.name || 'Name'}
                            </label>
                            <Input
                                id="name"
                                name="name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
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
                            <div className="relative">
                                <Input
                                    id="password"
                                    name="password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    className="pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                    onClick={() => setShowPassword(!showPassword)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="confirmPassword" className="text-sm font-medium">
                                {t.auth?.confirmPassword || 'Confirm Password'}
                            </label>
                            <div className="relative">
                                <Input
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    type={showConfirmPassword ? "text" : "password"}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    className="pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    tabIndex={-1}
                                >
                                    {showConfirmPassword ? (
                                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <Eye className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="educationStage" className="text-sm font-medium">
                                {t.auth?.educationStage || 'Education Stage'}
                            </label>
                            <select
                                id="educationStage"
                                name="educationStage"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={educationStage}
                                onChange={(e) => setEducationStage(e.target.value)}
                                required
                            >
                                <option value="" disabled>{t.auth?.selectStage || 'Select Stage'}</option>
                                <option value="primary">{t.auth?.primary || 'Primary School'}</option>
                                <option value="junior_high">{t.auth?.juniorHigh || 'Junior High'}</option>
                                <option value="senior_high">{t.auth?.seniorHigh || 'Senior High'}</option>
                                <option value="university">{t.auth?.university || 'University'}</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="enrollmentYear" className="text-sm font-medium">
                                {t.auth?.enrollmentYear || 'Enrollment Year'}
                            </label>
                            <Input
                                id="enrollmentYear"
                                name="enrollmentYear"
                                type="number"
                                value={enrollmentYear}
                                onChange={(e) => setEnrollmentYear(e.target.value)}
                                placeholder="YYYY"
                                required
                                min={1990}
                                max={Number(formatDateTime(new Date(), 'yyyy', timeZone))}
                            />
                        </div>
                        {error && (
                            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</div>
                        )}
                        <Button type="submit" size="lg" className="w-full" disabled={loading}>
                            {loading
                                ? (t.auth?.register?.registering || 'Registering...')
                                : (t.auth?.register?.action || 'Register')}
                        </Button>
                        <div className="text-center text-sm text-muted-foreground">
                            {t.auth?.register?.hasAccount || "Already have an account? "}
                            <Link href="/login" className="text-primary hover:underline">
                                {t.auth?.register?.loginHere || 'Login here'}
                            </Link>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </AuthShell>
    );
}
