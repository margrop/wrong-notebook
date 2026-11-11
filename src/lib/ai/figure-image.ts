import "server-only";

import { createLogger } from "../logger";
import { figureBoxToRegion } from "./figure-box";
import type { FigureBox } from "./figure-box";

const logger = createLogger("ai:figure-image");

type Sharp = typeof import("sharp").default;

let sharpLoading: Promise<Sharp | null> | undefined;

/**
 * 按需加载 sharp（Next.js 自带的图片处理库）。部分平台（如安卓单机版）没有对应的原生模块，
 * 加载失败时返回 null，调用方退回使用整张原图。
 */
export function loadSharp(): Promise<Sharp | null> {
    sharpLoading ??= import("sharp")
        .then((mod) => mod.default)
        .catch((error: unknown) => {
            logger.warn({ error }, "sharp is unavailable, figure images are sent without cropping");
            return null;
        });
    return sharpLoading;
}

/** 发给模型重绘的配图图片 */
export interface PreparedFigureImage {
    base64: string;
    mimeType: string;
    /** 图片像素尺寸；无法处理图片时为 null */
    width: number | null;
    height: number | null;
    /** 是否按配图位置裁剪过 */
    cropped: boolean;
}

/** 配图图片长边的范围：过小时放大便于模型看清细节，过大时缩小控制坐标范围 */
const MIN_LONG_SIDE = 800;
const MAX_LONG_SIDE = 1600;

/**
 * 准备重绘用的配图图片：有配图位置时裁剪出该区域（四周留白），长边缩放到 800~1600 像素，
 * 输出白底 PNG 并返回尺寸，供提示词要求 SVG 坐标与图片像素一一对应。
 * sharp 不可用或图片无法解码时原样返回整张图。
 */
export async function prepareFigureImage(base64: string, mimeType: string, box: FigureBox | null): Promise<PreparedFigureImage> {
    const original: PreparedFigureImage = { base64, mimeType, width: null, height: null, cropped: false };
    const sharp = await loadSharp();
    if (!sharp) return original;

    try {
        const input = Buffer.from(base64, "base64");
        const { width, height } = await sharp(input).metadata();
        if (!width || !height) return original;

        const region = box ? figureBoxToRegion(box, width, height) : { left: 0, top: 0, width, height };
        const longSide = Math.max(region.width, region.height);
        const scale = Math.min(Math.max(longSide, MIN_LONG_SIDE), MAX_LONG_SIDE) / longSide;
        const { data, info } = await sharp(input)
            .extract(region)
            .resize(Math.max(1, Math.round(region.width * scale)), Math.max(1, Math.round(region.height * scale)), { fit: "fill" })
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer({ resolveWithObject: true });
        return { base64: data.toString("base64"), mimeType: "image/png", width: info.width, height: info.height, cropped: !!box };
    } catch (error) {
        logger.warn({ error }, "Failed to prepare figure image, sending the original image");
        return original;
    }
}

/** 对比图中两半之间的间隔与分隔条 */
const COMPARISON_GAP = 24;
const DIVIDER_WIDTH = 4;

/**
 * 把原配图与 SVG 渲染结果左右并排拼成一张 PNG（中间灰色竖条分隔，两半尺寸相同、坐标一一对应），
 * 供模型比对差异。图片尺寸未知、sharp 不可用或 SVG 无法渲染时返回 null。
 */
export async function renderFigureComparison(image: PreparedFigureImage, svg: string): Promise<string | null> {
    const { width, height } = image;
    if (!width || !height) return null;
    const sharp = await loadSharp();
    if (!sharp) return null;

    try {
        const rendered = await sharp(Buffer.from(svg))
            .resize(width, height, { fit: "contain", background: "#ffffff" })
            .flatten({ background: "#ffffff" })
            .png()
            .toBuffer();
        const comparison = await sharp({ create: { width: width * 2 + COMPARISON_GAP, height, channels: 3, background: "#ffffff" } })
            .composite([
                { input: Buffer.from(image.base64, "base64"), left: 0, top: 0 },
                { input: { create: { width: DIVIDER_WIDTH, height, channels: 3, background: "#9ca3af" } }, left: width + (COMPARISON_GAP - DIVIDER_WIDTH) / 2, top: 0 },
                { input: rendered, left: width + COMPARISON_GAP, top: 0 },
            ])
            .png()
            .toBuffer();
        return comparison.toString("base64");
    } catch (error) {
        logger.warn({ error }, "Failed to render figure comparison");
        return null;
    }
}
