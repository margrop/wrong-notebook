/**
 * AI 提示词模板与生成器（按职责拆分的目录入口）
 * 本模块通过 index.ts 汇总 re-export，所有原 './prompts' 导入路径无需修改。
 */

export * from './shared';
export * from './analyze';
export * from './similar';
export * from './reanswer';
export * from './figure';
export * from './geogebra';
export * from './latex-fix';
export * from './svg-animation';
export * from './mastery';
export * from './grading';
export * from './tag-suggest';
export * from './question-split';
export * from './text-fix';
