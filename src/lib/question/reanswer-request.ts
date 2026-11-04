export type ReanswerRequestBody = {
    questionText: string;
    language: 'zh' | 'en';
    subject: string;
    imageBase64?: string;
    gradeSemester?: string;
    subjectId?: string;  // 所在错题本，用于限定候选知识点
};

export function buildReanswerRequestBody({
    questionText,
    language,
    subject,
    imagePreview,
    gradeSemester,
    subjectId,
}: {
    questionText: string;
    language: 'zh' | 'en';
    subject: string;
    imagePreview?: string | null;
    gradeSemester?: string;
    subjectId?: string | null;
}): ReanswerRequestBody {
    const requestBody: ReanswerRequestBody = {
        questionText,
        language,
        subject,
    };

    if (imagePreview) {
        requestBody.imageBase64 = imagePreview;
    }

    if (gradeSemester) {
        requestBody.gradeSemester = gradeSemester;
    }

    if (subjectId) {
        requestBody.subjectId = subjectId;
    }

    return requestBody;
}
