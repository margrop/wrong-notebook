/** 安卓 App 原生保存结果：saved 表示已写入文件，canceled 表示用户取消 */
interface AndroidSaveResult {
    saved: boolean;
    canceled?: boolean;
    message?: string;
}

type WindowWithAndroidSave = Window & {
    /** 由 packaging/android 的 bridge.js 注入；直接接收 Blob，分块交给原生保存 */
    __wrongNotebookSaveAndWait?: (blob: Blob, name: string) => Promise<AndroidSaveResult>;
};

/** 触发文件下载；返回 false 表示用户在安卓「另存为」对话框中取消 */
export async function downloadBlobFile(blob: Blob, fileName: string): Promise<boolean> {
    if (typeof window !== 'undefined') {
        // 安卓 App 注入的已知接口，类型见 WindowWithAndroidSave
        const windowWithAndroidSave = window as WindowWithAndroidSave;
        const androidSave = windowWithAndroidSave.__wrongNotebookSaveAndWait;
        if (androidSave) {
            const result = await androidSave(blob, fileName);
            if (!result.saved && !result.canceled) {
                throw new Error(result.message || 'Download failed');
            }
            return result.saved;
        }
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(objectUrl);
    return true;
}

/** 请求接口并以附件形式下载，文件名优先取响应头 Content-Disposition */
export async function downloadFile(url: string, fallbackName: string): Promise<boolean> {
    const res = await fetch(url);
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
    }
    const blob = await res.blob();
    const filenameMatch = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/);
    return downloadBlobFile(blob, filenameMatch ? filenameMatch[1] : fallbackName);
}
