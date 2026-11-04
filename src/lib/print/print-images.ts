/** 等待单张图片加载结束（成功或失败均视为结束） */
function waitForImage(image: HTMLImageElement): Promise<void> {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
    });
}

/**
 * 打印前把容器内懒加载的图片改为立即加载并等待完成，避免打印出空白图片。
 * 超时后不再等待，交给浏览器打印流程继续加载。
 */
export async function loadAllImages(
    root: ParentNode,
    { timeoutMs = 30_000, onProgress }: { timeoutMs?: number; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<void> {
    const images = Array.from(root.querySelectorAll("img"));
    let loaded = 0;
    onProgress?.(loaded, images.length);
    const all = Promise.all(images.map(async (image) => {
        image.loading = "eager";
        await waitForImage(image);
        loaded += 1;
        onProgress?.(loaded, images.length);
    }));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    await Promise.race([all, timeout]);
    clearTimeout(timer);
}
