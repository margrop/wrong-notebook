"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorListContent } from "@/components/error-list/error-list-content";
import { parseErrorListSearchParams } from "@/lib/error-list/error-list-filters";

interface ErrorListProps {
    subjectId?: string;
    subjectName?: string;
    tagSet?: string;
}

/** 从地址参数读取初始筛选（?mastery=new|reviewing|mastered / ?tag=标签名），仅首次进入时生效 */
function ErrorListWithSearchParams(props: ErrorListProps) {
    const searchParams = useSearchParams();
    // 只在首次进入时作为初始值；之后用户在页面里改筛选不回写 URL
    const initialFilters = useMemo(() => parseErrorListSearchParams(searchParams), [searchParams]);
    return <ErrorListContent {...props} initialMastery={initialFilters.mastery} initialTag={initialFilters.tag} />;
}

export function ErrorList(props: ErrorListProps) {
    return (
        <Suspense fallback={null}>
            <ErrorListWithSearchParams {...props} />
        </Suspense>
    );
}
