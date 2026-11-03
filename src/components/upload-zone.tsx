"use client";

import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2, Monitor, ClipboardPaste } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { frontendLogger } from "@/lib/frontend-logger";
import { toast } from "@/lib/feedback";
import { useIsClient } from "@/lib/use-is-client";

// 添加 CaptureController 类型声明
declare global {
    interface CaptureController {
        setFocusBehavior(behavior: 'no-focus-change' | 'focus-capturing-application'): void;
    }

    interface Window {
        CaptureController: {
            new(): CaptureController;
        };
    }
}

/**
 * 拖拽区接受的类型：image/* 加常见扩展名。部分系统不认识 HEIC/HEIF 的 MIME（报告为空或 octet-stream），
 * 按扩展名放行，选择后再按文件头识别真实格式。
 */
const IMAGE_ACCEPT = { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"] };

interface UploadZoneProps {
    onImageSelect: (file: File) => void;  // 改为传递 File 对象
    isAnalyzing: boolean;
}

export function UploadZone({ onImageSelect, isAnalyzing }: UploadZoneProps) {
    const { t } = useLanguage();
    const [isScreenshotting, setIsScreenshotting] = useState(false);
    // 确保只在客户端渲染屏幕截图功能
    const isClient = useIsClient();

    useEffect(() => {
        // 请求通知权限
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            const file = acceptedFiles[0];
            if (file) {
                // 直接传递 File 对象，让父组件处理压缩
                onImageSelect(file);
            }
        },
        [onImageSelect]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: IMAGE_ACCEPT,
        maxFiles: 1,
        disabled: isAnalyzing,
    });
    // 将剪贴板中的图片 Blob 转为 File 并交给父组件
    const selectClipboardImage = useCallback(
        (blob: Blob) => {
            const type = blob.type || "image/png";
            const ext = type.split("/")[1] || "png";
            const file = blob instanceof File && blob.name
                ? blob
                : new File([blob], `clipboard-${Date.now()}.${ext}`, { type });
            onImageSelect(file);
        },
        [onImageSelect]
    );

    // 监听 Ctrl/Cmd+V 粘贴图片
    useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (isAnalyzing) return;

            // 在输入框中粘贴时不拦截
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))) {
                return;
            }

            const items = Array.from(event.clipboardData?.items ?? []);
            const imageItem = items.find((item) => item.kind === "file" && item.type.startsWith("image/"));
            const file = imageItem?.getAsFile();
            if (!file) return;

            event.preventDefault();
            selectClipboardImage(file);
        };

        window.addEventListener("paste", handlePaste);
        return () => window.removeEventListener("paste", handlePaste);
    }, [isAnalyzing, selectClipboardImage]);

    // 检查是否支持通过按钮读取剪贴板（需要安全上下文）
    const isClipboardReadSupported = () => {
        return isClient &&
            typeof navigator !== 'undefined' &&
            !!navigator.clipboard &&
            typeof navigator.clipboard.read === 'function';
    };

    // 点击按钮读取剪贴板图片
    const handleClipboardRead = async () => {
        if (!isClipboardReadSupported()) {
            toast.warning(t.upload.pasteNotSupported);
            return;
        }

        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((type) => type.startsWith("image/"));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    selectClipboardImage(blob);
                    return;
                }
            }
            toast.warning(t.upload.pasteNoImage);
        } catch (error) {
            frontendLogger.warn('[UploadZone]', 'Clipboard read failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            if (error instanceof Error && error.name === 'NotAllowedError') {
                toast.warning(t.upload.pastePermissionDenied);
            } else {
                toast.error(t.upload.pasteFailed);
            }
        }
    };

    // 检查是否支持屏幕截图
    const isScreenshotSupported = () => {
        return isClient &&
            typeof navigator !== 'undefined' &&
            'mediaDevices' in navigator &&
            'getDisplayMedia' in navigator.mediaDevices;
    };
    // 屏幕截图功能
    const handleScreenshot = async () => {
        if (!isScreenshotSupported()) {
            toast.warning(t.upload.screenshotNotSupported);
            return;
        }

        setIsScreenshotting(true);

        try {
            // 创建 CaptureController 来控制焦点行为
            let controller: CaptureController | undefined;
            if ('CaptureController' in window) {
                controller = new window.CaptureController();
            }

            // 请求屏幕共享权限，优先当前标签页
            const displayMediaOptions: DisplayMediaStreamOptions & {
                preferCurrentTab?: boolean;
                controller?: CaptureController;
            } = {
                video: true,
                audio: false,
                preferCurrentTab: false,  // 优先显示"此标签页"选项
            };

            if (controller) {
                displayMediaOptions.controller = controller;
            }

            const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            // 获取视频轨道并检查捕获类型
            const [videoTrack] = stream.getVideoTracks();
            const settings = videoTrack.getSettings();
            const displaySurface = settings.displaySurface;  // 'browser' 表示标签页

            // 如果是标签页或窗口，设置不切换焦点
            if (controller && (displaySurface === 'browser' || displaySurface === 'window')) {
                try {
                    controller.setFocusBehavior('no-focus-change');  // 关键：不切换焦点到选中标签页
                    frontendLogger.info('[UploadZone]', 'Screenshot focus behavior set to no-change', undefined, { sendToBackend: false });
                } catch (e) {
                    frontendLogger.warn('[UploadZone]', 'Unable to set screenshot focus behavior', { error: e });
                }
            }

            // 创建视频元素
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            // 等待视频准备并播放
            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        resolve();
                    }).catch(reject);
                };
                video.onerror = reject;
            });

            // 等待一帧渲染（确保稳定）
            await new Promise(resolve => setTimeout(resolve, 500));

            // 检查视频尺寸
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                throw new Error('视频没有有效尺寸');
            }

            // 创建canvas并捕获
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                throw new Error('无法获取canvas上下文');
            }

            // 绘制视频帧
            ctx.drawImage(video, 0, 0);

            // 停止屏幕共享
            stream.getTracks().forEach(track => track.stop());

            // 转换为blob并创建文件
            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `screenshot-${Date.now()}.png`, {
                        type: 'image/png'
                    });
                    onImageSelect(file);
                    frontendLogger.info('[UploadZone]', 'Screenshot captured', undefined, { sendToBackend: false });
                } else {
                    toast.error('截图转换失败');
                }
            }, 'image/png', 1.0);

        } catch (error) {
            frontendLogger.error('[UploadZone]', 'Screenshot failed', { error });
            if (error instanceof Error) {
                if (error.name === 'NotAllowedError') {
                    toast.warning(t.upload.screenshotPermissionDenied);
                } else {
                    toast.error(`${t.upload.screenshotFailed}: ${error.message}`);
                }
            }
        } finally {
            setIsScreenshotting(false);
        }
    };
    return (
        <div className="space-y-4">
            <Card
                {...getRootProps()}
                className={`group cursor-pointer rounded-2xl border-2 border-dashed shadow-none transition-all hover:border-primary/60 hover:bg-accent/40 ${isDragActive ? "border-primary bg-accent/60" : "border-border bg-card"
                    }`}
            >
                <CardContent className="flex min-h-[260px] flex-col items-center justify-center space-y-4 py-10 text-center md:min-h-[300px]">
                    <input {...getInputProps()} />
                    <div className="rounded-2xl bg-accent p-4 text-primary transition-transform group-hover:scale-105">
                        {isAnalyzing ? (
                            <Loader2 className="h-10 w-10 animate-spin" />
                        ) : (
                            <UploadCloud className="h-10 w-10" />
                        )}
                    </div>
                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold">
                            {isAnalyzing ? t.app.analyzing : t.upload.analyze}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {isAnalyzing ? t.app.analyzing : t.app.dragDrop}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                            {t.upload.support}
                        </p>
                    </div>
                </CardContent>
            </Card>
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-start justify-center gap-4">
            {/* 剪贴板粘贴按钮 - 只在客户端渲染 */}
            {isClient && (
                <div className="flex flex-col items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={handleClipboardRead}
                        disabled={isAnalyzing}
                        className="flex items-center gap-2 w-full sm:w-auto"
                    >
                        <ClipboardPaste className="h-4 w-4" />
                        {t.upload.paste}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                        {t.upload.pasteDesc}
                    </p>
                </div>
            )}
            {/* 屏幕截图按钮 - 只在客户端渲染 */}
            {isScreenshotSupported() && (
                <div className="flex flex-col items-center gap-2">
                    <Button
                        variant="outline"
                        onClick={handleScreenshot}
                        disabled={isAnalyzing || isScreenshotting}
                        className="flex items-center gap-2 w-full sm:w-auto"
                    >
                        {isScreenshotting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Monitor className="h-4 w-4" />
                        )}
                        {isScreenshotting ? t.common.pleaseWait : t.upload.screenshot}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                        {t.upload.screenshotDesc}
                    </p>
                </div>
            )}
            </div>
        </div>
    );
}
