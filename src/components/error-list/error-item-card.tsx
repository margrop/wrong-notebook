"use client";

import { useState } from "react";
import Link from "next/link";
import { DifficultyStars } from "@/components/difficulty-stars";
import { QuestionSummary } from "@/components/error-list/question-summary";
import { MASTERY_STATUS_BORDER, MasteryStatusBadge } from "@/components/mastery-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTimeZone } from "@/contexts/TimeZoneContext";
import { formatDateTime } from "@/lib/date-time";
import { getItemTags } from "@/lib/item-tags";
import { getMistakeStatusLabel } from "@/lib/mistake-status";
import type { ErrorItemSummary } from "@/types/api";

/** 卡片默认显示的知识点个数，其余折叠 */
const VISIBLE_TAGS = 3;
/** 题干摘要的最大字数 */
const SUMMARY_LENGTH = 80;

interface ErrorItemCardProps {
    item: ErrorItemSummary;
    selectMode: boolean;
    selected: boolean;
    onToggleSelect: () => void;
    selectedTag: string | null;
    onTagClick: (tag: string) => void;
}

/** 错题列表中的一张卡片：复习状态、摘要、作答状态、星级和知识点 */
export function ErrorItemCard({ item, selectMode, selected, onToggleSelect, selectedTag, onTagClick }: ErrorItemCardProps) {
    const { t, language } = useLanguage();
    const { timeZone } = useTimeZone();
    const [tagsExpanded, setTagsExpanded] = useState(false);
    const tags = getItemTags(item);
    const hiddenCount = tags.length - VISIBLE_TAGS;
    const status = item.masteryStatus ?? "new";

    return (
        <div className="relative animate-in fade-in duration-300">
            {/* 选择模式下的复选框 */}
            {selectMode && (
                <div
                    className="absolute top-2 left-2 z-10"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleSelect(); }}
                >
                    <Checkbox
                        checked={selected}
                        aria-label={t.questionSimilarity.selectQuestion.replace("{id}", item.shortId || item.id)}
                        className="h-5 w-5 border-2 bg-background shadow-sm"
                    />
                </div>
            )}
            <Link href={selectMode ? "#" : `/error-items/${item.id}`} onClick={(e) => selectMode && e.preventDefault()}>
                {/* 悬浮只用中性色（浮起、加深阴影、灰底、加深上右下边框），左侧状态色条保持不变，避免与「复习中」的主色混淆 */}
                <Card className={`h-full cursor-pointer gap-2 rounded-2xl border-l-4 pt-4 transition-all duration-200 hover:-translate-y-1 hover:bg-muted/60 hover:shadow-lg ${MASTERY_STATUS_BORDER[status]} ${selectMode && selected ? "ring-2 ring-primary" : "hover:border-y-foreground/25 hover:border-r-foreground/25"}`}>
                    <CardHeader className="pb-0">
                        <div className={`flex justify-between items-start ${selectMode ? "pl-7" : ""}`}>
                            <MasteryStatusBadge status={status} />
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                {typeof item.masteryProbability === "number" && (
                                    <span title={t.mastery.probability}>{Math.round(item.masteryProbability * 100)}%</span>
                                )}
                                {item.shortId && <span className="font-mono">{item.shortId}</span>}
                                {formatDateTime(item.createdAt, "MM/dd", timeZone)}
                            </span>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <QuestionSummary text={item.questionText} maxLength={SUMMARY_LENGTH} className="text-sm line-clamp-3" />
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                            <Badge variant="secondary" className="text-xs">
                                {getMistakeStatusLabel(item.mistakeStatus, language)}
                            </Badge>
                            <DifficultyStars value={item.difficultyStars} showUnrated={false} />
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            {(tagsExpanded ? tags : tags.slice(0, VISIBLE_TAGS)).map((tag) => (
                                <Badge
                                    key={tag}
                                    variant={selectedTag === tag ? "default" : "outline"}
                                    className={`text-xs cursor-pointer transition-colors ${selectedTag === tag ? "" : "bg-background hover:border-foreground/40 hover:bg-foreground/10"}`}
                                    onClick={(e) => { e.preventDefault(); onTagClick(tag); }}
                                >
                                    {tag}
                                </Badge>
                            ))}
                            {hiddenCount > 0 && (
                                <Badge
                                    variant="secondary"
                                    className="text-xs cursor-pointer hover:bg-secondary/80 transition-colors"
                                    title={tagsExpanded
                                        ? (t.notebooks?.collapseTagsTooltip || "Click to collapse")
                                        : (t.notebooks?.expandTagsTooltip || "Click to expand {count} tags").replace("{count}", hiddenCount.toString())}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTagsExpanded(!tagsExpanded); }}
                                >
                                    {tagsExpanded
                                        ? (t.notebooks?.collapseTags || "Collapse")
                                        : (t.notebooks?.expandTags || "+{count} more").replace("{count}", hiddenCount.toString())}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </Link>
        </div>
    );
}
