/**
 * 不调用 AI 的本地判题：只在能确定答案相同时返回 true，其余情况返回 null，交给 AI 或用户判定。
 * 本地无法可靠判断"错误"（等价写法、多个答案等），因此从不返回 false。
 */

// 去掉"答案是""答："等前缀，只比较结论
const ANSWER_PREFIX = /^(?:答案?(?:是|为)?|解|answer(?: is)?|the answer is)[:：]?/i;
// 选择题答案：大写选项字母后接分隔符或结束，如 "B"、"B. 3"、"(B)"、"AC"；区分大小写，避免把英文单词当成选项
const CHOICE_ANSWER = /^\(?([A-H]{1,4})\)?(?:$|[.、:：)]|\s+(?![a-zA-Z]))/;

export function normalizeAnswer(value: string): string {
    return value
        // 全角字母、数字、符号转半角
        .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
        .replace(/　/g, ' ')
        .replace(/\$|\\\(|\\\)|\\\[|\\\]/g, '')
        .replace(/\\(?:text|mathrm)\{([^}]*)\}/g, '$1')
        .replace(/[\s。.，,；;！!]+$/g, '')
        .trim()
        .replace(ANSWER_PREFIX, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

// 需要论证、解释或解题过程时，结论相同也不能证明学生完成了题目要求。
const REASONING_QUESTION = /证明|求证|论证|推导|说明|解释|步骤|过程|列式|理由|原因|\b(?:prove|proof|justify|derive|explain|demonstrate|show|why|reason)\b/iu;

export function matchAnswer(userAnswer: string, correctAnswer: string, questionText: string): true | null {
    if (!questionText.trim() || REASONING_QUESTION.test(questionText)) return null;
    const user = normalizeAnswer(userAnswer);
    const correct = normalizeAnswer(correctAnswer);
    if (!user || !correct) return null;
    if (user === correct) return true;

    // 选择题：学生只填选项字母时，与标准答案开头的选项字母比较（不区分顺序）
    const choice = correctAnswer.trim().replace(ANSWER_PREFIX, '').trim().match(CHOICE_ANSWER);
    const userLetters = user.replace(/^\((.*)\)$/, '$1');
    if (choice && /^[a-h]{1,4}$/.test(userLetters)) {
        const sorted = (letters: string) => [...letters.toLowerCase()].sort().join('');
        return sorted(userLetters) === sorted(choice[1]) ? true : null;
    }
    return null;
}
