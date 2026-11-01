/**
 * 界面主题：用户可选跟随系统、浅色或深色。偏好保存在账号中，并在浏览器本地缓存一份，
 * 以便首屏渲染前就能应用，避免页面先以浅色闪现。前后端共用，不要引入服务端模块。
 */

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** 浏览器本地缓存主题偏好的 localStorage 键 */
export const THEME_STORAGE_KEY = "app-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
    return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** 根据偏好和系统是否为深色，得出实际使用的主题 */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
    if (preference === "system") return systemDark ? "dark" : "light";
    return preference;
}

/**
 * 在 <head> 中内联执行的脚本：首屏绘制前读取本地缓存的偏好并设置 html 的 dark 类，
 * 读取失败（如隐私模式禁用存储）时按系统设置处理
 */
// 首屏脚本保持静态文本，不向可执行代码中插入序列化值；缓存键的一致性由执行测试验证。
export const THEME_INIT_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem("app-theme")}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})();`;
