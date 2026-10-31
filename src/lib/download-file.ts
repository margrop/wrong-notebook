/** 请求接口并以附件形式下载，文件名优先取响应头 Content-Disposition */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
    }
    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    const filenameMatch = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/);
    a.download = filenameMatch ? filenameMatch[1] : fallbackName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(objectUrl);
}
