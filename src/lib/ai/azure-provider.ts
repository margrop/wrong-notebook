import { AzureOpenAI } from "openai";
import type OpenAI from "openai";
import type { AIConfig } from "./types";
import { OpenAIProvider } from "./openai-provider";

const DEFAULT_API_VERSION = '2024-02-15-preview';

// Azure 配置接口
export interface AzureConfig {
    apiKey?: string;
    endpoint?: string;       // Azure 资源端点 (https://xxx.openai.azure.com)
    deploymentName?: string; // 部署名称
    apiVersion?: string;     // API 版本
    model?: string;          // 显示用模型名
}

/** Azure 特有的客户端构造参数，随 AIConfig 一起传给 OpenAIProvider 的 createClient */
interface AzureClientConfig extends AIConfig {
    azure: {
        endpoint: string;
        deployment: string;
        apiVersion?: string;
    };
}

export class AzureOpenAIProvider extends OpenAIProvider {
    protected readonly providerName = 'Azure OpenAI';
    private deployment: string;
    private endpoint: string;

    constructor(config?: AzureConfig) {
        const openAIConfig = AzureOpenAIProvider.toOpenAIConfig(config);
        super(openAIConfig);
        this.deployment = openAIConfig.azure.deployment;
        this.endpoint = openAIConfig.azure.endpoint;
    }

    /** 校验 Azure 必填配置并转为 OpenAIProvider 可用的 AIConfig（含 azure 客户端参数） */
    private static toOpenAIConfig(config?: AzureConfig): AzureClientConfig {
        if (!config?.apiKey) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_API_KEY is required for Azure OpenAI provider");
        }
        if (!config.endpoint) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_ENDPOINT is required for Azure OpenAI provider");
        }
        if (!config.deploymentName) {
            throw new Error("AI_AUTH_ERROR: AZURE_OPENAI_DEPLOYMENT is required for Azure OpenAI provider");
        }
        return {
            apiKey: config.apiKey,
            baseUrl: config.endpoint,
            model: config.model || config.deploymentName,
            azure: {
                endpoint: config.endpoint,
                deployment: config.deploymentName,
                apiVersion: config.apiVersion,
            },
        };
    }

    /** 使用 AzureOpenAI 客户端（endpoint、deployment、apiVersion 与 OpenAI 不同） */
    protected createClient(config: AIConfig): OpenAI {
        const azure = (config as AzureClientConfig).azure;
        return new AzureOpenAI({
            apiKey: this.apiKey,
            endpoint: azure.endpoint,
            deployment: azure.deployment,
            apiVersion: azure.apiVersion || DEFAULT_API_VERSION,
        });
    }

    /** Azure 请求体中的 model 使用 deployment 名称 */
    protected override get requestModel(): string {
        return this.deployment;
    }

    /** Azure 的输出上限按显示用模型名（而非 deployment）查询 */
    protected override get outputLimitModel(): string {
        return this.model;
    }
}
