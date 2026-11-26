/**
 * Promise.withResolvers 兜底脚本（ES2024）。
 *
 * 图片裁剪与扫描版 PDF 转图片直接使用该 API；HarmonyOS ArkWeb / Chromium < 119 等旧内核
 * 没有实现，会报 `Promise.withResolvers is not a function`。脚本在 <head> 中先于应用代码执行，
 * 已有实现时不覆盖。
 */

/** 内联到首屏 <head> 的脚本；IIFE 参数 Promise 便于测试替换为旧内核构造器 */
export const PROMISE_WITH_RESOLVERS_POLYFILL_SCRIPT = `(function(P){if(typeof P.withResolvers==="function")return;P.withResolvers=function(){var resolve,reject;var promise=new P(function(res,rej){resolve=res;reject=rej;});return{promise:promise,resolve:resolve,reject:reject};};})(Promise);`;
