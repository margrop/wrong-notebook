"use client";

import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { toast, confirmDialog } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { SUBJECTS, getSubjectName } from "./tag-subjects";
import type { SubjectKey } from "./tag-subjects";
import { CustomTagForm } from "./custom-tag-form";

interface CustomTag {
    id: string;
    name: string;
    subject: SubjectKey;
    parentName?: string;
}

interface CustomTagsProps {
    tagSet: string;
}

// 没有所属年级的自定义标签归入此分组
const GENERAL_GROUP = "通用";

/** 自定义标签：当前标签体系下的添加表单 + 按学科、年级分组的列表 */
export function CustomTags({ tagSet }: CustomTagsProps) {
    const { t } = useLanguage();
    const [customTags, setCustomTags] = useState<CustomTag[]>([]);

    const fetchCustomTags = useCallback(async () => {
        try {
            // 获取所有学科的扁平标签，过滤非系统标签
            const allCustom: CustomTag[] = [];
            for (const { key } of SUBJECTS) {
                const data = await apiClient.get<{ tags: Array<{ id: string; name: string; isSystem: boolean; parentName?: string }> }>(
                    `/api/tags?subject=${key}&tagSet=${encodeURIComponent(tagSet)}&flat=true`
                );
                allCustom.push(...data.tags.filter(tag => !tag.isSystem).map(tag => ({ ...tag, subject: key })));
            }
            setCustomTags(allCustom);
        } catch (error) {
            frontendLogger.error('[Tags]', 'Failed to fetch custom tags', { tagSet, error });
        }
    }, [tagSet]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 数据请求：进入页面时加载标签数据
        fetchCustomTags();
    }, [fetchCustomTags]);

    const handleRemove = async (tag: CustomTag) => {
        if (!(await confirmDialog((t.tags?.custom?.deleteConfirm || "Are you sure you want to delete tag \"{tag}\"?").replace("{tag}", tag.name), { destructive: true }))) {
            return;
        }

        try {
            await apiClient.delete(`/api/tags?id=${tag.id}`);
            await fetchCustomTags();
        } catch (error) {
            frontendLogger.error('[Tags]', 'Failed to delete tag', { error });
            toast.error("Failed to delete tag");
        }
    };

    return (
        <div className="space-y-6">
            <CustomTagForm tagSet={tagSet} onAdded={fetchCustomTags} />

            {customTags.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">
                    {t.tags?.custom?.empty || "No custom tags yet, click above to add!"}
                </CardContent></Card>
            ) : (
                SUBJECTS.map(({ key, name }) => {
                    const tags = customTags.filter(tag => tag.subject === key);
                    if (!tags.length) return null;

                    const groupedByParent = tags.reduce((acc, tag) => {
                        const groupName = tag.parentName || GENERAL_GROUP;
                        (acc[groupName] ??= []).push(tag);
                        return acc;
                    }, {} as Record<string, CustomTag[]>);

                    // 年级分组按名称排序，“通用”放最后
                    const groupKeys = Object.keys(groupedByParent).sort((a, b) => {
                        if (a === GENERAL_GROUP) return 1;
                        if (b === GENERAL_GROUP) return -1;
                        return a.localeCompare(b, "zh");
                    });

                    return (
                        <Card key={key}>
                            <CardHeader><CardTitle className="text-lg">{getSubjectName(t.tags?.subjects, key, name)} ({tags.length})</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                {groupKeys.map(groupName => (
                                    <div key={groupName} className="space-y-2">
                                        {(groupName !== GENERAL_GROUP || groupKeys.length > 1) && (
                                            <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1 mb-2">
                                                {groupName === GENERAL_GROUP ? (t.tags?.otherGroup || "Other") : groupName}
                                            </h4>
                                        )}
                                        <div className="flex flex-wrap gap-2">
                                            {groupedByParent[groupName].map((tag) => (
                                                <Badge key={tag.id} variant="secondary" className="px-3 py-1.5 text-sm">
                                                    {tag.name}
                                                    <button
                                                        onClick={() => handleRemove(tag)}
                                                        className="ml-2 hover:text-destructive transition-colors"
                                                        title={t.common?.delete || "Delete"}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
