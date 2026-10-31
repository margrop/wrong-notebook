"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import type { PracticeDifficulty } from "@/lib/use-practice-session";

interface DifficultyPickerProps {
    value: PracticeDifficulty;
    onChange: (value: PracticeDifficulty) => void;
}

const LEVEL_COLORS: Record<PracticeDifficulty, string> = {
    easy: "bg-green-100 text-green-700 hover:bg-green-200",
    medium: "bg-blue-100 text-blue-700 hover:bg-blue-200",
    hard: "bg-orange-100 text-orange-700 hover:bg-orange-200",
    harder: "bg-red-100 text-red-700 hover:bg-red-200",
};

/** 首次生成题目前选择难度的按钮组 */
export function DifficultyPicker({ value, onChange }: DifficultyPickerProps) {
    const { t } = useLanguage();
    const labels: Record<PracticeDifficulty, string> = {
        easy: t.practice.difficulty?.easy || "Easy",
        medium: t.practice.difficulty?.medium || "Medium",
        hard: t.practice.difficulty?.hard || "Hard",
        harder: t.practice.difficulty?.harder || "Challenge",
    };

    return (
        <div className="flex items-center gap-2 bg-muted/50 p-2 rounded-lg">
            <span className="text-sm font-medium text-muted-foreground">{t.practice.difficulty?.label || "Difficulty"}:</span>
            <div className="flex gap-1">
                {(Object.keys(LEVEL_COLORS) as PracticeDifficulty[]).map((level) => {
                    const color = LEVEL_COLORS[level];
                    const selected = value === level;
                    return (
                        <button
                            key={level}
                            onClick={() => onChange(level)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${selected
                                ? color.replace("bg-", "bg-opacity-100 bg-").replace("text-", "ring-2 ring-offset-1 ring-")
                                : "bg-transparent hover:bg-muted text-muted-foreground"
                                } ${selected ? color : ''}`}
                        >
                            {labels[level]}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** 已生成题目后在卡片标题栏切换难度的下拉框 */
export function DifficultySelect({ value, onChange, disabled }: DifficultyPickerProps & { disabled?: boolean }) {
    const { t } = useLanguage();
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as PracticeDifficulty)}
            className="h-8 text-xs border rounded px-2 bg-background"
            disabled={disabled}
        >
            <option value="easy">{t.practice.difficulty?.easy || "Easy"}</option>
            <option value="medium">{t.practice.difficulty?.medium || "Medium"}</option>
            <option value="hard">{t.practice.difficulty?.hard || "Hard"}</option>
            <option value="harder">{t.practice.difficulty?.harder || "Challenge"}</option>
        </select>
    );
}
