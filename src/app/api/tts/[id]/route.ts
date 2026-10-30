import { getCurrentUser } from "@/lib/current-user";
import { notFound, unauthorized } from "@/lib/api-errors";
import { readSpeech } from "@/lib/tts/speech-cache";

type RouteContext = { params: Promise<{ id: string }> };

/** 解析单段的 Range 请求头（bytes=start-end），无效时返回 null */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
    const match = header?.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return null;
    let start: number;
    let end: number;
    if (!match[1]) {
        // bytes=-N：最后 N 个字节
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    return start <= end && start < size ? { start, end } : null;
}

/**
 * GET /api/tts/:id
 * 已合成的讲解语音（MP3）。支持 Range 请求：iPhone 上的 Safari 播放音频时要求服务端支持分段读取
 */
export async function GET(req: Request, { params }: RouteContext) {
    const user = await getCurrentUser();
    if (!user) {
        return unauthorized("Authentication required");
    }
    const data = await readSpeech((await params).id);
    if (!data) {
        return notFound("Speech not found");
    }
    const headers: Record<string, string> = {
        'Content-Type': 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        // 缓存文件只按音频处理，禁止浏览器按内容猜测类型（如被篡改成网页）
        'X-Content-Type-Options': 'nosniff',
        // 地址带版本号（?v=），重新合成后地址随之变化
        'Cache-Control': 'private, max-age=604800, immutable',
    };
    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
        const range = parseRange(rangeHeader, data.length);
        if (!range) {
            return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${data.length}` } });
        }
        const chunk = data.subarray(range.start, range.end + 1);
        return new Response(new Uint8Array(chunk), {
            status: 206,
            headers: { ...headers, 'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`, 'Content-Length': String(chunk.length) },
        });
    }
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } });
}
