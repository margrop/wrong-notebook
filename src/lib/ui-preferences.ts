// 本机浏览器记住的界面选择：保存键与可选值。读写见 @/lib/hooks/use-stored-choice。

/** 录入方式：首页与错题本添加页共用，添加页只有拍照和文字两种，保存的是其他方式时回到拍照 */
export const INPUT_MODE_STORAGE_KEY = "question-input-mode";
export const HOME_INPUT_MODES = ["image", "text", "file", "direct"] as const;
export type HomeInputMode = typeof HOME_INPUT_MODES[number];
export const NOTEBOOK_INPUT_MODES = ["image", "text"] as const;
export type NotebookInputMode = typeof NOTEBOOK_INPUT_MODES[number];

/** 拍照裁剪模式：单题裁剪 / 自动分题 / 手工框选；当前裁剪框不提供保存的模式时用单题裁剪 */
export const CROP_MODE_STORAGE_KEY = "image-cropper-mode";
export const CROP_MODES = ["single", "auto", "multi"] as const;
export type CropMode = typeof CROP_MODES[number];
