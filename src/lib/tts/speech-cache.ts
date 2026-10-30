/**
 * 服务端语音合成：按服务商、模型、音色和文字缓存合成结果（已归一化响度的 MP3，另存一份描述文件），
 * 同一段讲解只合成一次，重复播放不再调用服务商；可强制重新合成。
 * 缓存随数据备份导出、导入：导出与用户动画讲解文字一致的语音，导入时按同样的规则写回缓存。
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getAppConfig } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { MAX_NARRATION_TEXT_LENGTH, decodeXmlText, getEmbeddedNarration } from "@/lib/svg-animation";
import { QWEN_TTS_INSTRUCTION, TARGET_LOUDNESS_LUFS, isCloudTtsProvider } from "./constants";
import type { CloudTtsProvider, TtsMode } from "./constants";
import { normalizeLoudness } from "./loudness";
import { encodeMp3, looksLikeMp3 } from "./mp3";
import { resolveTtsSettings, synthesizeWithProvider } from "./providers";
import type { ResolvedTtsSettings } from "./providers";

const logger = createLogger('tts');

/** 缓存总大小上限，超出时删除最早合成的文件 */
const MAX_CACHE_BYTES = 500 * 1024 * 1024;
/** 单段语音的大小上限（导入时校验）；300 字的讲解约 1 分钟，48kbps 约 360KB */
const MAX_SPEECH_BYTES = 2 * 1024 * 1024;
/** 缓存内容的版本：归一化或编码方式变化时递增，使旧缓存失效 */
const CACHE_VERSION = 1;
const SPEECH_ID_PATTERN = /^[a-f0-9]{64}$/;

/** 一段语音的来源：服务商、模型、音色、语言和文字决定编号 */
export interface SpeechSource {
    provider: CloudTtsProvider;
    model: string;
    voice: string;
    language: 'zh' | 'en';
    text: string;
}

/** 数据备份中的一段云端语音，audio 为 Base64 编码的 MP3 */
export interface BackupSpeech extends SpeechSource {
    audio: string;
}

function cacheDir(): string {
    return path.join(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'), 'tts-cache');
}

function audioPath(id: string): string {
    return path.join(cacheDir(), `${id}.mp3`);
}

function metaPath(id: string): string {
    return path.join(cacheDir(), `${id}.json`);
}

/** 当前配置的朗读方式；未设置时为浏览器本地语音 */
export function getTtsMode(): TtsMode {
    const mode = getAppConfig().tts?.mode;
    return isCloudTtsProvider(mode) ? mode : 'browser';
}

function currentSettings(): ResolvedTtsSettings | null {
    const config = getAppConfig();
    const mode = config.tts?.mode;
    if (!isCloudTtsProvider(mode)) return null;
    return resolveTtsSettings(mode, config.tts?.[mode], config[mode]);
}

export function speechId({ provider, model, voice, language, text }: SpeechSource): string {
    const key = [CACHE_VERSION, TARGET_LOUDNESS_LUFS, provider, model, voice, provider === 'qwen' ? QWEN_TTS_INSTRUCTION : '', language, text];
    return crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex');
}

/** 从最早合成的开始删除缓存，直到总大小低于上限（修改时间同时用作版本号，读取时不刷新） */
async function pruneCache(): Promise<void> {
    const dir = cacheDir();
    const names = (await fs.readdir(dir)).filter((name) => name.endsWith('.mp3'));
    const files = await Promise.all(names.map(async (name) => {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        return { id: name.slice(0, -4), size: stat?.size ?? 0, time: stat?.mtimeMs ?? 0 };
    }));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
        if (total <= MAX_CACHE_BYTES) break;
        await fs.rm(audioPath(file.id), { force: true });
        await fs.rm(metaPath(file.id), { force: true });
        total -= file.size;
    }
}

/** 写入一段语音和描述文件；先写临时文件再改名，避免读到写了一半的音频 */
async function writeSpeech(id: string, source: SpeechSource, audio: Buffer): Promise<void> {
    await fs.mkdir(cacheDir(), { recursive: true });
    const tmp = `${audioPath(id)}.${process.pid}.tmp`;
    await fs.writeFile(metaPath(id), JSON.stringify(source));
    await fs.writeFile(tmp, audio);
    await fs.rename(tmp, audioPath(id));
}

/** 语音文件的版本（修改时间），重新合成后变化，前端据此绕过浏览器缓存 */
async function speechVersion(id: string): Promise<number | null> {
    const stat = await fs.stat(audioPath(id)).catch(() => null);
    return stat ? Math.floor(stat.mtimeMs) : null;
}

/** 已合成的一段讲解（不触发合成）；没有缓存或当前为浏览器本地语音时返回 null */
export async function getCachedSpeech(text: string, language: 'zh' | 'en'): Promise<SpeechResult | null> {
    const settings = currentSettings();
    if (!settings) return null;
    const id = speechId({ provider: settings.provider, model: settings.model, voice: settings.voice, language, text });
    const version = await speechVersion(id);
    return version === null ? null : { id, version };
}

const pending = new Map<string, Promise<SpeechResult>>();

export interface SpeechResult {
    id: string;
    version: number;
}

/**
 * 合成一段讲解，返回语音编号和版本（用 GET /api/tts/:id?v=版本 取音频）；已有缓存时直接返回，
 * regenerate 为 true 时忽略缓存重新合成。当前为浏览器本地语音时返回 null
 */
export async function synthesizeSpeech(text: string, language: 'zh' | 'en', { regenerate = false } = {}): Promise<SpeechResult | null> {
    const settings = currentSettings();
    if (!settings) return null;
    const source: SpeechSource = { provider: settings.provider, model: settings.model, voice: settings.voice, language, text };
    const id = speechId(source);
    const running = pending.get(id);
    if (running) return running;
    if (!regenerate) {
        const version = await speechVersion(id);
        if (version !== null) return { id, version };
    }
    const task = (async () => {
        const started = Date.now();
        const audio = normalizeLoudness(await synthesizeWithProvider(text, language, settings));
        await writeSpeech(id, source, encodeMp3(audio));
        logger.info({ provider: settings.provider, model: settings.model, chars: text.length, regenerate, ms: Date.now() - started }, 'Speech synthesized');
        pruneCache().catch((error) => logger.warn({ error }, 'Failed to prune TTS cache'));
        return { id, version: (await speechVersion(id)) ?? Date.now() };
    })().finally(() => pending.delete(id));
    pending.set(id, task);
    return task;
}

/** 读取已合成的语音（MP3）；编号无效或缓存已删除时返回 null */
export async function readSpeech(id: string): Promise<Buffer | null> {
    if (!SPEECH_ID_PATTERN.test(id)) return null;
    try {
        return await fs.readFile(audioPath(id));
    } catch {
        return null;
    }
}

export interface AnimationNarrationSource {
    language: 'zh' | 'en';
    svg: string;
}

/**
 * 备份导出：缓存中与这些动画讲解文字一致的云端语音（讲解稿中的段落，或动画字幕中出现的文字）
 */
export async function exportSpeeches(animations: AnimationNarrationSource[]): Promise<BackupSpeech[]> {
    if (!animations.length) return [];
    const texts = { zh: new Set<string>(), en: new Set<string>() };
    const decoded = { zh: [] as string[], en: [] as string[] };
    for (const { language, svg } of animations) {
        getEmbeddedNarration(svg)?.forEach((segment) => texts[language].add(segment.text));
        decoded[language].push(decodeXmlText(svg));
    }
    let names: string[];
    try {
        names = (await fs.readdir(cacheDir())).filter((name) => name.endsWith('.json'));
    } catch {
        return [];
    }
    const result: BackupSpeech[] = [];
    for (const name of names) {
        const id = name.slice(0, -5);
        try {
            const source = parseSpeechSource(JSON.parse(await fs.readFile(metaPath(id), 'utf-8')));
            if (!source || speechId(source) !== id) continue;
            const used = texts[source.language].has(source.text) || decoded[source.language].some((svg) => svg.includes(source.text));
            if (!used) continue;
            const audio = await fs.readFile(audioPath(id));
            result.push({ ...source, audio: audio.toString('base64') });
        } catch {
            // 描述文件损坏或音频已被淘汰时跳过
        }
    }
    return result;
}

function parseSpeechSource(value: unknown): SpeechSource | null {
    if (!value || typeof value !== 'object') return null;
    const { provider, model, voice, language, text } = value as Record<string, unknown>;
    if (!isCloudTtsProvider(provider) || (language !== 'zh' && language !== 'en')) return null;
    if (typeof model !== 'string' || !model || model.length > 100) return null;
    if (typeof voice !== 'string' || !voice || voice.length > 200) return null;
    if (typeof text !== 'string' || !text || text.length > MAX_NARRATION_TEXT_LENGTH) return null;
    return { provider, model, voice, language, text };
}

/** 备份导入：校验后写入缓存，已有的跳过；返回写入的段数 */
export async function importSpeeches(entries: unknown): Promise<number> {
    if (!Array.isArray(entries)) return 0;
    let imported = 0;
    for (const entry of entries) {
        const source = parseSpeechSource(entry);
        const encoded = (entry as { audio?: unknown } | null)?.audio;
        if (!source || typeof encoded !== 'string' || encoded.length > MAX_SPEECH_BYTES * 4 / 3 + 4) continue;
        const audio = Buffer.from(encoded, 'base64');
        if (!looksLikeMp3(audio)) continue;
        const id = speechId(source);
        if (await speechVersion(id) !== null) continue;
        await writeSpeech(id, source, audio);
        imported++;
    }
    if (imported) pruneCache().catch((error) => logger.warn({ error }, 'Failed to prune TTS cache'));
    return imported;
}
