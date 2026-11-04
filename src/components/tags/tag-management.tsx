"use client";

import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTagStats } from "@/lib/hooks/use-tag-stats";
import { DEFAULT_TAG_SET, getTagSetName, useTagSets } from "@/lib/hooks/use-tag-sets";
import { TagUsageStats } from "./tag-usage-stats";
import { StandardTags } from "./standard-tags";
import { CustomTags } from "./custom-tags";

/** 知识点页签：按标签体系查看使用频率、标准标签库与自定义标签 */
export function TagManagement() {
    const { t } = useLanguage();
    const tagSets = useTagSets();
    const [tagSet, setTagSet] = useState(DEFAULT_TAG_SET);
    const { stats, loading } = useTagStats(tagSet);

    return (
        <div className="space-y-4">
            {tagSets.length > 1 && (
                <div className="flex items-center gap-3 flex-wrap">
                    <Label htmlFor="tag-management-tagset">{t.notebooks?.dialog?.tagSetLabel || "Tag System"}</Label>
                    <Select value={tagSet} onValueChange={setTagSet}>
                        <SelectTrigger id="tag-management-tagset" className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {tagSets.map((ts) => (
                                <SelectItem key={ts} value={ts}>{getTagSetName(t.notebooks?.dialog, ts)}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            <TagUsageStats stats={stats} loading={loading} />
            <Tabs defaultValue="standard" className="w-full">
                <TabsList className="mb-4">
                    <TabsTrigger value="standard">{t.tags?.tabs?.standard || "Standard Tags"}</TabsTrigger>
                    <TabsTrigger value="custom">{t.tags?.tabs?.custom || "Custom Tags"}</TabsTrigger>
                </TabsList>
                {/* 切换体系时重新挂载，清空按学科缓存的标签数据 */}
                <TabsContent value="standard" className="space-y-4"><StandardTags key={tagSet} tagSet={tagSet} stats={stats} /></TabsContent>
                <TabsContent value="custom"><CustomTags key={tagSet} tagSet={tagSet} /></TabsContent>
            </Tabs>
        </div>
    );
}
