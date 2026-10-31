"use client";

import { useLanguage } from '@/contexts/LanguageContext';
import { GRADE_NAMES, GRADE_SEMESTERS } from '@/lib/grade-options';

interface GradeSemesterSelectProps {
    id: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}

/** 保留旧题目的自定义年级值，同时提供所有学段的年级学期选项。 */
export function GradeSemesterSelect({ id, value, onChange, disabled }: GradeSemesterSelectProps) {
    const { t } = useLanguage();
    return (
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
            aria-label={t.editor.gradeSemester}
            className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50">
            <option value="">{t.common.notSet}</option>
            {value && !GRADE_SEMESTERS.includes(value) && <option value={value}>{value}</option>}
            {GRADE_NAMES.flatMap((grade, index) => ['上', '下'].map((semester, semesterIndex) => (
                <option key={`${grade}${semester}`} value={`${grade}${semester}`}>
                    {t.gradeSelection.names[index]} · {semesterIndex === 0 ? t.gradeSelection.firstSemester : t.gradeSelection.secondSemester}
                </option>
            )))}
        </select>
    );
}
