/**
 * 剪贴板读写：局域网 HTTP 访问时不是安全上下文，navigator.clipboard 不可用，
 * 此时复制退回到让用户手动选中文本，读取则提示手动粘贴到输入框。
 */

/** 复制文本；返回是否成功写入剪贴板（无法写入时提示用户手动复制） */
export async function copyText(text: string, fallbackPrompt: (text: string) => void): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        fallbackPrompt(text);
        return false;
    }
}

/** 读取剪贴板文本；不可用或被拒绝时返回 null */
export async function readClipboardText(): Promise<string | null> {
    try {
        return await navigator.clipboard.readText();
    } catch {
        return null;
    }
}