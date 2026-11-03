"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { toast } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { getErrorMessage } from "@/lib/error-message";
import { SUBJECTS, getSubjectName } from "./tag-subjects";
import type { SubjectKey, TagTreeNode } from "./tag-subjects";

interface CustomTagFormProps {
    tagSet: string;
    onAdded: () => Promise<void>;
}

/** 添加自定义标签表单：在当前标签体系下选择学科、年级并输入名称 */
export function CustomTagForm({ tagSet, onAdded }: CustomTagFormProps) {
    const { t } = useLanguage();
    const [subject, setSubject] = useState<SubjectKey>("math");
    const [grade, setGrade] = useState<string>(""); // 年级ID
    const [gradeOptions, setGradeOptions] = useState<Array<{ id: string; name: string }>>([]);
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // 学科变化时获取对应的年级列表
    useEffect(() => {
        const fetchGrades = async () => {
            try {
                const data = await apiClient.get<{ tags: TagTreeNode[] }>(`/api/tags?subject=${subject}&tagSet=${encodeURIComponent(tagSet)}`);
                // 顶级节点就是年级，只取系统标签
                setGradeOptions(data.tags.filter(tag => tag.isSystem).map(tag => ({ id: tag.id, name: tag.name })));
                setGrade("");
            } catch (error) {
                frontendLogger.error('[Tags]', 'Failed to fetch grades', { error });
                setGradeOptions([]);
            }
        };
        fetchGrades();
    }, [subject, tagSet]);

    const handleAdd = async () => {
        if (!name.trim()) {
            toast.warning(t.tags?.custom?.enterName || "Please enter tag name");
            return;
        }

        setSubmitting(true);
        try {
            await apiClient.post('/api/tags', {
                name: name.trim(),
                subject,
                tagSet,
                parentId: (grade && grade !== 'none') ? grade : undefined,
            });
            setName("");
            await onAdded();
            toast.success(t.tags?.custom?.success || "Tag added successfully!");
        } catch (error) {
            if (getErrorMessage(error).includes('409')) {
                toast.warning(t.tags?.custom?.exists || "Tag already exists");
            } else {
                toast.error("Failed to add tag");
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>{t.tags?.custom?.addTitle || "Add Custom Tag"}</CardTitle></CardHeader>
            <CardContent>
                <div className="flex gap-3 flex-wrap">
                    <Select value={subject} onValueChange={(v) => setSubject(v as SubjectKey)}>
                        <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {SUBJECTS.map(({ key, name: fallback }) => (
                                <SelectItem key={key} value={key}>{getSubjectName(t.tags?.subjects, key, fallback)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={grade} onValueChange={setGrade}>
                        <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder={t.tags?.custom?.selectGrade || "Select Grade"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">{t.tags?.custom?.noGrade || "No Grade"}</SelectItem>
                            {gradeOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Input
                        placeholder={t.tags?.custom?.placeholder || "Enter tag name..."}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        className="flex-1 min-w-[200px]"
                    />
                    <Button onClick={handleAdd} disabled={submitting}>
                        {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                        {t.tags?.custom?.add || "Add"}
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                    {t.tags?.custom?.hint || "💡 Custom tags will automatically appear in tag suggestions"}
                </p>
            </CardContent>
        </Card>
    );
}
