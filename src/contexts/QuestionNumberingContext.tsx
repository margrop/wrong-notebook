"use client";

import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_QUESTION_NUMBERING, questionNoLabel } from '@/lib/seq-no/seq-no-format';
import type { QuestionNumbering } from '@/lib/seq-no/seq-no-format';

interface QuestionNumberingContextValue {
    numbering: QuestionNumbering;
    setNumbering: (numbering: QuestionNumbering) => void;
}

const QuestionNumberingContext = createContext<QuestionNumberingContextValue>({ numbering: DEFAULT_QUESTION_NUMBERING, setNumbering: () => undefined });

/** 全站题目编号显示方式（系统设置），由根布局从配置传入初始值 */
export function QuestionNumberingProvider({ children, initialNumbering = DEFAULT_QUESTION_NUMBERING }: { children: ReactNode; initialNumbering?: QuestionNumbering }) {
    const [numbering, setNumbering] = useState(initialNumbering);
    return <QuestionNumberingContext.Provider value={{ numbering, setNumbering }}>{children}</QuestionNumberingContext.Provider>;
}

export function useQuestionNumbering(): QuestionNumberingContextValue {
    return useContext(QuestionNumberingContext);
}

/** 返回按当前设置取题目编号的函数 */
export function useQuestionNo(): (item: { shortId?: string | null; seqNo?: number | null }) => string | null {
    const { numbering } = useQuestionNumbering();
    return useCallback((item) => questionNoLabel(item, numbering), [numbering]);
}
