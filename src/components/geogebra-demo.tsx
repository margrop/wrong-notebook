"use client";

import { useEffect, useId, useRef, useState, useCallback, useMemo } from "react";
import { Loader2, Maximize2, Minimize2, RotateCcw, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast, confirmDialog } from "@/lib/feedback";
import { frontendLogger } from "@/lib/frontend-logger";
import { parseCommands, runCommands as executeCommands } from "@/lib/geogebra-commands";

interface GeogebraDemoProps {
    commands: string;
    height?: number;
    showToolBar?: boolean;
    showAlgebraInput?: boolean;
    showMenuBar?: boolean;
    className?: string;
    onRegenerate?: (errors?: string) => Promise<void>;
    onSaveCommands?: (commands: string) => Promise<void>;
    /** 删除已生成的演示；点击后先二次确认 */
    onDelete?: () => Promise<void>;
}

/** GeoGebra 小程序 API（只列出用到的方法） */
interface GgbApi {
    evalCommand(command: string): boolean;
    setSize(width: number, height: number): void;
    resetConstruction(): void;
    remove?: () => void;
    // 命令中以 API 形式调用的其他方法（见 GEOGEBRA_API_METHODS）
    [method: string]: unknown;
}

interface GgbAppletConstructor {
    new (parameters: Record<string, unknown> & { appletOnLoad?: (api: GgbApi) => void }, html5NoWebSimple?: boolean): { inject(id: string): void };
}

declare global {
    interface Window {
        GGBApplet?: GgbAppletConstructor;
    }
}

// ── Singleton script loader ─────────────────────────────────────────────
let ggbScriptPromise: Promise<void> | null = null;

function loadGeoGebraScript(): Promise<void> {
    if (ggbScriptPromise) return ggbScriptPromise;
    ggbScriptPromise = new Promise<void>((resolve, reject) => {
        if (typeof window !== "undefined" && window.GGBApplet) {
            resolve();
            return;
        }
        const s = document.createElement("script");
        s.src = "https://www.geogebra.org/apps/deployggb.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => {
            ggbScriptPromise = null;
            reject(new Error("Failed to load GeoGebra"));
        };
        document.head.appendChild(s);
    });
    return ggbScriptPromise;
}

// ── Command helpers ─────────────────────────────────────────────────────
/** 让小程序宽度铺满容器，并设置高度 */
function resizeApplet(host: HTMLDivElement | null, api: GgbApi | null, height: number) {
    const ggbDiv = host?.firstElementChild as HTMLElement | null;
    if (!ggbDiv) return;
    ggbDiv.style.width = '100%';
    ggbDiv.style.height = `${height}px`;
    api?.setSize(host?.offsetWidth || ggbDiv.offsetWidth || 800, height);
}

function runCommands(api: GgbApi, commands: string[]) {
    const failures = executeCommands(api, commands);
    for (const failure of failures) {
        frontendLogger.warn('[GGB]', '命令执行失败', { ...failure });
    }
    return failures.map(failure => failure.command + '：' + failure.message).join('\n') || undefined;
}

// ── Component ───────────────────────────────────────────────────────────
export function GeogebraDemo({
    commands,
    height = 700,
    showToolBar = false,
    showAlgebraInput = false,
    showMenuBar = false,
    className = "",
    onRegenerate,
    onDelete,
}: GeogebraDemoProps) {
    const { t } = useLanguage();
    // This ref points to a div that React NEVER puts children into.
    // All GeoGebra DOM is injected via innerHTML in the effect, so
    // React's reconciler never touches the inside of this node.
    const ggbHostRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<GgbApi | null>(null);
    const commandErrorsRef = useRef<string | undefined>(undefined);
    // useId 可能含冒号等字符，去掉后作为注入目标的元素 ID
    const reactId = useId();
    const idRef = useRef(`ggb-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [regenerating, setRegenerating] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const cmds = useMemo(() => parseCommands(commands), [commands]);

    // ── Init effect: load script → inject applet → run commands ─────────
    useEffect(() => {
        if (typeof window === "undefined" || cmds.length === 0) return;

        let dead = false;
        const id = idRef.current;
        const host = ggbHostRef.current;

        loadGeoGebraScript().then(() => {
            if (dead) return;
            const GGBApplet = window.GGBApplet;
            if (!GGBApplet) { setError(t.geogebra.notLoaded); setLoading(false); return; }

            if (!host) return;

            // Write the inject target directly — React never reconciles this.
            host.innerHTML = `<div id="${id}" style="width:100%;height:${height}px"></div>`;

            try {
                const applet = new GGBApplet({
                    appName: "classic",
                    width: "100%",
                    height,
                    showToolBar,
                    showAlgebraInput,
                    showMenuBar,
                    showResetIcon: true,
                    enableRightClick: true,
                    enableShiftDragZoom: true,
                    language: "zh",
                    appletOnLoad: (api: GgbApi) => {
                        if (dead) return;
                        apiRef.current = api;
                        resizeApplet(host, api, height);
                        commandErrorsRef.current = runCommands(api, cmds);
                        setLoading(false);
                    },
                }, true);
                // deployggb.js auto-resolves the codebase — do NOT call setHTML5Codebase
                applet.inject(id);
            } catch (e) {
                frontendLogger.error('[GGB]', 'Init failed', { error: e });
                if (!dead) { setError(t.geogebra.initFailed); setLoading(false); }
            }
        }).catch((e) => {
            frontendLogger.error('[GGB]', 'Script load failed', { error: e });
            if (!dead) { setError(t.geogebra.scriptFailed); setLoading(false); }
        });

        return () => {
            dead = true;
            // Cleanup GeoGebra instance to prevent memory leaks
            try {
                const api = apiRef.current;
                if (api?.remove) {
                    api.remove();
                }
            } catch (e) {
                frontendLogger.warn('[GGB]', 'Cleanup failed', { error: e });
            }
            apiRef.current = null;
            // Clear injected DOM
            if (host) {
                host.innerHTML = '';
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cmds, showToolBar, showAlgebraInput, showMenuBar]);

    // ── Resize when expanded toggles ────────────────────────────────────
    useEffect(() => {
        resizeApplet(ggbHostRef.current, apiRef.current, expanded ? 700 : height);
    }, [expanded, height]);

    // ── Reset ───────────────────────────────────────────────────────────
    const handleReset = useCallback(() => {
        const api = apiRef.current;
        if (!api) return;
        try {
            api.resetConstruction();
            setTimeout(() => { if (apiRef.current) commandErrorsRef.current = runCommands(apiRef.current, cmds); }, 300);
        } catch (e) { frontendLogger.warn('[GGB]', 'Reset failed', { error: e }); }
    }, [cmds]);

    // ── Regenerate ──────────────────────────────────────────────────────
    const handleRegenerate = useCallback(async () => {
        if (!onRegenerate || regenerating) return;
        setRegenerating(true);
        try {
            await onRegenerate(commandErrorsRef.current);
        } finally {
            setRegenerating(false);
        }
    }, [onRegenerate, regenerating]);

    // ── Delete ──────────────────────────────────────────────────────────
    const handleDelete = useCallback(async () => {
        if (!onDelete || deleting) return;
        if (!(await confirmDialog(t.geogebra.confirmDelete, { destructive: true }))) return;
        setDeleting(true);
        try {
            await onDelete();
        } catch {
            toast.error(t.geogebra.deleteFailed);
        } finally {
            setDeleting(false);
        }
    }, [onDelete, deleting, t]);

    if (cmds.length === 0) return null;

    return (
        <div className={`relative rounded-lg border bg-card ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                        {t.geogebra.title}
                    </span>
                    {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-1">
                    {onRegenerate && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"
                            onClick={handleRegenerate} title={t.geogebra.regenerate} disabled={regenerating || loading}>
                            {regenerating
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <RefreshCw className="h-3.5 w-3.5" />}
                            <span>{t.geogebra.regenerate}</span>
                        </Button>
                    )}
                    {onDelete && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                            onClick={handleDelete} title={t.geogebra.delete} disabled={deleting || regenerating}>
                            {deleting
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Trash2 className="h-3.5 w-3.5" />}
                            <span>{t.geogebra.delete}</span>
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                        onClick={handleReset} title={t.geogebra.reset} disabled={loading}>
                        <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                        onClick={() => setExpanded((v) => !v)}
                        title={expanded ? t.geogebra.shrink : t.geogebra.enlarge}>
                        {expanded
                            ? <Minimize2 className="h-3.5 w-3.5" />
                            : <Maximize2 className="h-3.5 w-3.5" />}
                    </Button>
                </div>
            </div>

            {/*
             * GeoGebra container — NO React children inside.
             * The effect writes innerHTML directly, so React never
             * tries to reconcile DOM nodes inside this div.
             */}
            <div ref={ggbHostRef} style={{ width: '100%' }} />

            {/* Loading overlay — sibling, not child of ggbHost */}
            {loading && (
                <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 rounded-b-lg"
                    style={{ top: 37 }}
                >
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">{t.geogebra.loading}</span>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div
                    className="flex items-center justify-center text-sm text-destructive"
                    style={{ minHeight: height }}
                >
                    {error}
                </div>
            )}
        </div>
    );
}
