"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromptEditor } from "@/components/settings/prompt-editor";
import { AppConfig } from "@/types/api";
import { DEFAULT_ANALYZE_TEMPLATE, DEFAULT_REANSWER_TEMPLATE, DEFAULT_SIMILAR_TEMPLATE } from "@/lib/ai/prompts";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PromptVariable } from "@/components/settings/prompt-editor";

export type PromptTemplateType = 'analyze' | 'similar' | 'reanswer';

interface PromptSettingsProps {
    config: AppConfig;
    onUpdate: (type: PromptTemplateType, value: string) => void;
}

export function PromptSettings({ config, onUpdate }: PromptSettingsProps) {
    const { t } = useLanguage();
    // 模板直接取自配置，清空时显示默认模板
    const analyzeTemplate = config.prompts?.analyze || DEFAULT_ANALYZE_TEMPLATE;
    const similarTemplate = config.prompts?.similar || DEFAULT_SIMILAR_TEMPLATE;
    const reanswerTemplate = config.prompts?.reanswer || DEFAULT_REANSWER_TEMPLATE;
    const vars = t.settings?.prompts?.vars;

    const analyzeVariables: PromptVariable[] = [
        { name: 'language_instruction', description: vars?.languageInstruction || "Language instructions." },
        { name: 'knowledge_points_list', description: vars?.knowledgePointsList || "Knowledge point tags for the subject." },
        { name: 'grade_instruction', description: vars?.gradeInstruction || "Grade and semester guidance." },
        { name: 'provider_hints', description: vars?.providerHints || "Provider compatibility hints." },
    ];
    const similarVariables: PromptVariable[] = [
        { name: 'original_question', description: vars?.originalQuestion || "The full text of the original question." },
        { name: 'knowledge_points', description: vars?.knowledgePoints || "List of knowledge points to test." },
        { name: 'difficulty_level', description: vars?.difficultyLevel || "Target difficulty level." },
        { name: 'difficulty_instruction', description: vars?.difficultyInstruction || "Specific writing instructions for the target difficulty." },
        { name: 'language_instruction', description: vars?.languageInstructionShort || "Language formatting instructions." },
        { name: 'figure_instruction', description: vars?.figureInstruction || "Instructions for redrawing the original figure." },
        { name: 'grade_instruction', description: vars?.gradeInstruction || "Grade and semester guidance." },
    ];
    const reanswerVariables: PromptVariable[] = [
        { name: 'question_text', description: vars?.questionText || "The corrected question text." },
        { name: 'subject_hint', description: vars?.subjectHint || "Subject of the question." },
        { name: 'knowledge_points_rule', description: vars?.knowledgePointsRule || "Candidate knowledge points to choose from." },
        { name: 'language_instruction', description: vars?.languageInstruction || "Language instructions." },
        { name: 'grade_instruction', description: vars?.gradeInstruction || "Grade and semester guidance." },
        { name: 'provider_hints', description: vars?.providerHints || "Provider compatibility hints." },
    ];

    return (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <Tabs defaultValue="analyze" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="analyze" className="text-xs sm:text-sm">
                        {t.settings?.prompts?.analysisTab || "Analysis Prompt"}
                    </TabsTrigger>
                    <TabsTrigger value="reanswer" className="text-xs sm:text-sm">
                        {t.settings?.prompts?.reanswerTab || "Solving Prompt"}
                    </TabsTrigger>
                    <TabsTrigger value="similar" className="text-xs sm:text-sm">
                        {t.settings?.prompts?.similarTab || "Similar Question Prompt"}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="analyze" className="py-4">
                    <PromptEditor
                        value={analyzeTemplate}
                        defaultValue={DEFAULT_ANALYZE_TEMPLATE}
                        onChange={(value) => onUpdate('analyze', value)}
                        onReset={() => onUpdate('analyze', DEFAULT_ANALYZE_TEMPLATE)}
                        title={t.settings?.prompts?.customAnalysis || "Custom Analysis Template"}
                        variables={analyzeVariables}
                    />
                </TabsContent>

                <TabsContent value="reanswer" className="py-4">
                    <PromptEditor
                        value={reanswerTemplate}
                        defaultValue={DEFAULT_REANSWER_TEMPLATE}
                        onChange={(value) => onUpdate('reanswer', value)}
                        onReset={() => onUpdate('reanswer', DEFAULT_REANSWER_TEMPLATE)}
                        title={t.settings?.prompts?.customReanswer || "Custom Solving Template"}
                        variables={reanswerVariables}
                    />
                </TabsContent>

                <TabsContent value="similar" className="py-4">
                    <PromptEditor
                        value={similarTemplate}
                        defaultValue={DEFAULT_SIMILAR_TEMPLATE}
                        onChange={(value) => onUpdate('similar', value)}
                        onReset={() => onUpdate('similar', DEFAULT_SIMILAR_TEMPLATE)}
                        title={t.settings?.prompts?.customSimilar || "Custom Similar Question Template"}
                        variables={similarVariables}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}