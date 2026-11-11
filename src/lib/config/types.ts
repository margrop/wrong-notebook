import type { VendorConfig, VendorProviderId } from '../ai/vendor-presets';
import type { MiniMaxCodeConfig } from '../minimax-code/constants';
import type { TtsConfig } from '../tts/constants';
import type { QuestionNumbering } from '../seq-no/seq-no-format';

/** 全部内置 AI 渠道：国产大模型官方渠道 + 各通用接口 */
export type AiProviderId = 'gemini' | 'openai' | 'azure' | 'anthropic' | 'minimax-code' | VendorProviderId;

// OpenAI 实例配置
export interface OpenAIInstance {
    id: string;           // 唯一标识 (UUID)
    name: string;         // 用户自定义名称
    apiKey: string;
    baseUrl: string;
    model: string;
}

// MiniMax、GLM 等国产大模型官方渠道（OpenAI 兼容接口），每个渠道一组配置
export type VendorConfigs = { [K in VendorProviderId]?: VendorConfig };

/** 管理员同意使用协议的记录（实例级，不记录是哪位管理员） */
export interface EulaConfig {
    /** 最近一次同意的协议版本，如 v1；从未同意时不存在 */
    acceptedVersion?: string;
    acceptedAt?: string;
    /** initialize 初始化链接 | preset 安装向导预置 | admin-dialog 设置或升级对话框 */
    acceptedBy?: 'initialize' | 'preset' | 'admin-dialog';
}

/** 匿名遥测的实例级开关，见 doc/TELEMETRY_DESIGN.md */
export interface TelemetryConfig {
    /** 本地记录，默认关闭 */
    recording?: boolean;
    /** 错误回报，只在本地记录或外发开启时生效 */
    errors?: boolean;
    /** 外发到收集服务；同意协议时写入 true，缺省 false */
    forwarding?: boolean;
    /** 收集服务地址，留空使用官方地址 */
    endpoint?: string;
    /** 本地记录的保留天数，1–365 */
    retentionDays?: number;
    /** 存量实例的告知横幅被关闭的时间 */
    noticeDismissedAt?: string | null;
    /** 上次外发成功的时间，系统维护 */
    lastFlushAt?: string | null;
}

export interface AppConfig extends VendorConfigs {
    aiProvider: 'gemini' | 'openai' | 'azure' | 'anthropic' | 'minimax-code' | VendorProviderId;
    allowRegistration?: boolean;
    /** 普通用户每天可发起的 AI 调用次数，0 表示不限制；管理员不受限制 */
    aiDailyLimit?: number;
    /** 同一模型同时进行的 AI 调用上限，超出的调用排队；默认 5 */
    aiConcurrencyLimit?: number;
    timeZone?: string;
    /** 题目编号显示方式：shortId 为 6 位随机 ID（默认），seqNo 为用户内的流水号 #123 */
    questionNumbering?: QuestionNumbering;
    /** AI 配图比对校正：重绘配图后把原图与结果并排交给 AI 比对并修正差异；默认关闭，每张配图会多一次带图片的 AI 调用 */
    figureReview?: boolean;
    /** 管理员完成（或跳过）安装向导的时间，ISO 字符串；未设置时新安装会自动进入向导 */
    setupCompletedAt?: string;
    openai?: {
        instances?: OpenAIInstance[];
        activeInstanceId?: string;
    };
    gemini?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    azure?: {
        apiKey?: string;
        endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
        deploymentName?: string; // 部署名称
        apiVersion?: string;     // API 版本
        model?: string;          // 显示用模型名
    };
    // Anthropic 及兼容接口（baseUrl 不含 /v1，如 https://api.anthropic.com）
    anthropic?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    };
    // MiniMax Code OAuth 渠道：模型与自动签到开关；登录凭据另存于 minimax-code.json
    minimaxCode?: MiniMaxCodeConfig;
    /**
     * 渠道分工：图片识别与文本分析可分别使用不同渠道，主渠道额度用完或登录失效时改用备用渠道。
     * 留空表示跟随 aiProvider；备用渠道与主渠道相同时不启用。
     */
    routing?: {
        /** 图片识别（OCR、配图重绘、图片分题、带图重新解题）使用的渠道 */
        vision?: AiProviderId | '';
        /** 纯文本分析（解题、举一反三、判分、知识点等）使用的渠道 */
        text?: AiProviderId | '';
        /** 主渠道返回额度不足、鉴权失败或不支持图片时自动切换的渠道 */
        fallback?: AiProviderId | '';
    };
    prompts?: {
        analyze?: string;
        similar?: string;
        reanswer?: string;
    };
    timeouts?: {
        analyze?: number; // 毫秒
    };
    /** 动画语音讲解的朗读方式：浏览器本地语音或云端语音合成 */
    tts?: TtsConfig;
    /** 使用协议同意状态，只能经同意接口写入 */
    eula?: EulaConfig;
    /** 匿名遥测设置，只能经管理员遥测接口写入 */
    telemetry?: TelemetryConfig;
}

// 旧版 OpenAI 配置格式（用于迁移检测）
export interface LegacyOpenAIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
}
