"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/lib/api-client";
import { getApiErrorMessage, getErrorMessage } from "@/lib/error-message";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { gradesForStage, parseGradeSemester } from "@/lib/grade-options";
import type { UpdateUserProfileRequest, UserProfile } from "@/types/api";

interface ProfileFormState {
    name: string;
    email: string;
    educationStage: string;
    enrollmentYear: string | number;
    /** 从 fixedGradeSemester 解析出的当前年级，空字符串表示未设置 */
    currentGrade: string;
    /** 从 fixedGradeSemester 解析出的当前学期：上 / 下 */
    currentSemester: string;
    password: string;
}

const EMPTY_PROFILE: ProfileFormState = { name: "", email: "", educationStage: "", enrollmentYear: "", currentGrade: "", currentSemester: "", password: "" };

/** 账户设置：姓名、邮箱、学段、当前年级学期、入学年份和修改密码 */
export function AccountSettings() {
    const { t } = useLanguage();
    const [profile, setProfile] = useState<ProfileFormState>(EMPTY_PROFILE);
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const fetchProfile = useCallback(async () => {
        try {
            const data = await apiClient.get<UserProfile>("/api/user");
            const parsed = data.fixedGradeSemester ? parseGradeSemester(data.fixedGradeSemester) : null;
            setProfile({
                name: data.name || "",
                email: data.email || "",
                educationStage: data.educationStage || "",
                enrollmentYear: data.enrollmentYear || "",
                currentGrade: parsed?.grade || "",
                currentSemester: parsed?.semester || "",
                password: ""
            });
        } catch (error) {
            frontendLogger.error('[AccountSettings]', 'Failed to fetch profile', { error });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面或条件变化时加载，请求前后更新加载状态和结果
        fetchProfile();
    }, [fetchProfile]);

    const handleSave = async () => {
        // 验证密码一致性（如果用户输入了密码）
        if (profile.password && profile.password !== confirmPassword) {
            toast.error(t.settings?.messages?.passwordMismatch || 'Passwords do not match');
            return;
        }

        setSaving(true);
        try {
            const payload: UpdateUserProfileRequest = {
                name: profile.name,
                email: profile.email,
                educationStage: profile.educationStage,
            };
            if (profile.enrollmentYear) {
                payload.enrollmentYear = parseInt(profile.enrollmentYear.toString());
            }
            if (profile.password) {
                payload.password = profile.password;
            }
            // 组装 fixedGradeSemester：有年级有学期才提交；清空年级时也提交 null
            if (profile.currentGrade && profile.currentSemester) {
                payload.fixedGradeSemester = `${profile.currentGrade}${profile.currentSemester}`;
            } else if (!profile.currentGrade) {
                payload.fixedGradeSemester = null;
            }

            await apiClient.patch("/api/user", payload);

            toast.success(t.settings?.messages?.profileUpdated || "Profile updated");
            setProfile(prev => ({ ...prev, password: "" }));
            setConfirmPassword("");
            window.location.reload(); // Reload to update user name in UI
        } catch (error) {
            frontendLogger.error('[AccountSettings]', 'Failed to update profile', { error: getApiErrorMessage(error) ?? getErrorMessage(error) });
            toast.error(getApiErrorMessage(error) || (t.settings?.messages?.updateFailed || "Update failed"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>{t.auth?.name || "Name"}</Label>
                    <Input
                        value={profile.name || ""}
                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>{t.auth?.email || "Email"}</Label>
                    <Input
                        value={profile.email || ""}
                        onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                        type="email"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>{t.auth?.educationStage || "Education Stage"}</Label>
                    <Select
                        value={profile.educationStage || ""}
                        onValueChange={(val) => setProfile({
                            ...profile,
                            educationStage: val,
                            // 切换学段时重置年级学期，避免跨学段残留
                            currentGrade: gradesForStage(val).includes(profile.currentGrade) ? profile.currentGrade : "",
                            currentSemester: gradesForStage(val).includes(profile.currentGrade) ? profile.currentSemester : "",
                        })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={t.auth?.selectStage || "Select Stage"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="primary">{t.auth?.primary || 'Primary School'}</SelectItem>
                            <SelectItem value="junior_high">{t.auth?.juniorHigh || 'Junior High'}</SelectItem>
                            <SelectItem value="senior_high">{t.auth?.seniorHigh || 'Senior High'}</SelectItem>
                            <SelectItem value="university">{t.auth?.university || 'University'}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>{t.auth?.enrollmentYear || "Enrollment Year"}</Label>
                    <Input
                        type="number"
                        value={profile.enrollmentYear || ""}
                        onChange={(e) => setProfile({ ...profile, enrollmentYear: e.target.value })}
                        placeholder="YYYY"
                    />
                </div>
            </div>

            {profile.educationStage && gradesForStage(profile.educationStage).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>{t.settings?.account?.currentGrade || "Current Grade & Semester"}</Label>
                        <Select
                            value={profile.currentGrade || ""}
                            onValueChange={(val) => setProfile({ ...profile, currentGrade: val, currentSemester: val ? (profile.currentSemester || '上') : "" })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t.settings?.account?.selectGrade || "Select Grade"} />
                            </SelectTrigger>
                            <SelectContent>
                                {gradesForStage(profile.educationStage).map((grade) => (
                                    <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {profile.currentGrade && (
                        <div className="space-y-2">
                            <Label>{t.settings?.account?.selectSemester || "Select Semester"}</Label>
                            <Select
                                value={profile.currentSemester || ""}
                                onValueChange={(val) => setProfile({ ...profile, currentSemester: val })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder={t.settings?.account?.selectSemester || "Select Semester"} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="上">{t.settings?.account?.firstSemester || "1st Semester"}</SelectItem>
                                    <SelectItem value="下">{t.settings?.account?.secondSemester || "2nd Semester"}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
            )}

            {profile.currentGrade && profile.currentSemester && (
                <p className="text-xs text-muted-foreground -mt-2">
                    {t.settings?.account?.gradeAppliedHint || "New questions will default to this grade. You can also configure AI grade recognition in General Settings."}
                </p>
            )}

            <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                    <Label>{t.settings?.account?.changePassword || "Change Password (Leave empty to keep)"}</Label>
                    <PasswordInput
                        value={profile.password}
                        onChange={(e) => setProfile({ ...profile, password: e.target.value })}
                        placeholder="******"
                        minLength={6}
                    />
                </div>
                {profile.password && (
                    <div className="space-y-2">
                        <Label>{t.auth?.confirmPassword || "Confirm Password"}</Label>
                        <PasswordInput
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="******"
                            minLength={6}
                        />
                    </div>
                )}
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.settings?.account?.update || "Update Profile"}
            </Button>
        </div>
    );
}
