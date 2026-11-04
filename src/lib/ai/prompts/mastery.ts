/**
 * 掌握概率评估提示词模板与生成函数
 */

import { replaceVariables } from './shared';

/**
 * 掌握概率评估提示词模板
 * 根据错题的举一反三历史推测学生已掌握该题的概率
 */
export const DEFAULT_MASTERY_TEMPLATE = `【角色与核心任务 (ROLE AND CORE TASK)】
你是一位经验丰富的学习诊断老师。学生曾做错下面这道题，之后做过若干次举一反三（同知识点的变式题）练习。
请根据练习历史，推测学生**现在已经掌握这道原题**的概率。

{{language_instruction}}

【原题】
{{question_text}}

【知识点】
{{knowledge_points}}

【最初的错误情况】
{{mistake_status}}

【评估时间（UTC）】
{{evaluated_at}}

【举一反三历史（按时间从早到晚）】
{{history}}

【参考值】
按规则公式（近期结果权重更高、难度越高的做对越有说服力）估算的掌握概率为 {{rule_probability}}%。可以参考，但请给出你自己的判断。

【判断要点】
1. 近期表现比早期表现更重要；连续做对比偶尔做对更可靠。
2. 做对更高难度的变式题，说明掌握得更牢；只做对简单题时要保守。
3. "不会做"比"做错"说明掌握程度更低。
4. 距离最近一次练习时间越久，遗忘的可能越大。
5. 练习次数很少时，概率不宜过高或过低。

【输出格式】
只输出一个 JSON 对象，不要输出任何其他内容：
{"probability": 0 到 100 的整数, "reason": "一句话说明判断依据，不超过 60 字"}`;

/**
 * 生成掌握概率评估提示词
 */
export function generateMasteryPrompt(input: {
  questionText: string;
  knowledgePoints: string[];
  mistakeStatus?: string | null;
  history: Array<{ date: string; difficulty: string | null; result: string; source: string }>;
  ruleProbability: number;
  language?: 'zh' | 'en';
  evaluatedAt?: string;
}): string {
  const evaluatedAt = input.evaluatedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(evaluatedAt))) throw new Error('AI_RESPONSE_ERROR: 评估时间无效');
  const resultLabels: Record<string, string> = { correct: '做对', wrong: '做错', not_attempted: '不会做' };
  const difficultyLabels: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难', harder: '挑战' };
  const sourceLabels: Record<string, string> = { practice: '单题练习', manual: '手动录入', exam: '试卷', duplicate_import: '重复导入做错' };
  const mistakeLabels: Record<string, string> = { not_attempted: '不会做', wrong_attempt: '做错', unknown: '未知' };

  const history = input.history.length > 0
    ? input.history.map((entry, index) => {
      const difficulty = entry.difficulty ? (difficultyLabels[entry.difficulty] || entry.difficulty) : '未知';
      return `${index + 1}. ${entry.date.slice(0, 10)}｜难度：${difficulty}｜来源：${sourceLabels[entry.source] || entry.source}｜结果：${resultLabels[entry.result] || entry.result}`;
    }).join('\n')
    : '暂无练习记录';

  return replaceVariables(DEFAULT_MASTERY_TEMPLATE, {
    language_instruction: input.language === 'en'
      ? 'Write the "reason" field in English.'
      : '"reason" 字段使用简体中文。',
    question_text: input.questionText || '（无题目文本）',
    knowledge_points: input.knowledgePoints.length > 0 ? input.knowledgePoints.join('、') : '未标注',
    mistake_status: mistakeLabels[input.mistakeStatus || 'unknown'] || '未知',
    history,
    rule_probability: String(Math.round(input.ruleProbability * 100)),
    evaluated_at: evaluatedAt,
  }).trim();
}
