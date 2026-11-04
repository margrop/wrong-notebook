"use client";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { QUESTION_TYPES, NO_QUESTION_TYPE } from "@/lib/question/question-type";
import type { QuestionType } from "@/lib/question/question-type";

interface QuestionTypeFilterProps {
    value: string[];
    onChange: (value: string[]) => void;
}

/** 按题型多选筛选的标签按钮，含「未设置」选项（NO_QUESTION_TYPE 占位值） */
export function QuestionTypeFilter({ value, onChange }: QuestionTypeFilterProps) {
    const { t } = useLanguage();

    const toggle = (type: string) => {
        onChange(value.includes(type) ? value.filter((v) => v !== type) : [...value, type]);
    };

    return (
        <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((type) => (
                <Button
                    key={type}
                    type="button"
                    variant={value.includes(type) ? "default" : "outline"}
                    size="sm"
                    className="rounded-full"
                    onClick={() => toggle(type)}
                >
                    {t.questionType.names[type as QuestionType] || type}
                </Button>
            ))}
            <Button
                type="button"
                variant={value.includes(NO_QUESTION_TYPE) ? "default" : "outline"}
                size="sm"
                className="rounded-full"
                onClick={() => toggle(NO_QUESTION_TYPE)}
            >
                {t.questionType.notSet}
            </Button>
        </div>
    );
}
