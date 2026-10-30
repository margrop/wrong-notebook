# AI 模型配置

管理员可以在网页设置中修改 AI 配置，保存后后续请求读取新配置，无需重启服务。配置写入 `config/app-config.json`，已保存字段优先于环境变量。

## 配置步骤

1. 以管理员身份登录，打开“设置 → AI 设置”。
2. 选择提供商，填写 API Key、接口地址和模型或部署名称。提供商下方附有官方接入文档链接（有国内站和国际站的两个都列出），可核对地址和模型名称。
3. 测试连接；需要时从接口获取模型列表。测试失败时，除错误类型外还会显示服务商的原始报错（如额度用完、模型不存在），便于排查。
4. 保存设置，再用一道真实题目检查图片输入、解析格式和答案质量。

AI 设置、连接测试、模型列表与提示词设置只向管理员开放。OpenAI 配置支持多个实例，最多 10 个，通过当前激活实例决定实际使用的配置。

## 提供商参数

| 提供商 | 必需参数 | 地址与默认模型 |
| --- | --- | --- |
| MiniMax | API Key | 默认 `https://api.minimax.cn/v1`；代码默认 `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth | 在设置页网页登录 MiniMax Code 账号 | 固定接口 `https://agent.minimax.cn/mavis/api/v1/llm`；代码默认 `MiniMax-M3.1-Flash` |
| 智谱 GLM | API Key | 默认 `https://open.bigmodel.cn/api/paas/v4`；代码默认 `glm-5.3-flash` |
| DeepSeek | API Key | 默认 `https://api.deepseek.com`；代码默认 `deepseek-flash` |
| Kimi | API Key | 默认 `https://api.moonshot.cn/v1`；代码默认 `kimi-k3` |
| 千问 Qwen | API Key（推荐百炼 Token Plan，以 `sk-sp-` 开头） | 默认 Token Plan 地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，按量付费的 Key 改填 `https://dashscope.aliyuncs.com/compatible-mode/v1`；代码默认 `qwen3.8-max` |
| 阶跃星辰 StepFun | API Key（推荐 Step Plan 套餐） | 默认 Step Plan 地址 `https://api.stepfun.com/step_plan/v1`，按量付费改填 `https://api.stepfun.com/v1`，国际站 `https://api.stepfun.ai/v1`；代码默认 `step-5-preview` |
| 火山引擎 豆包 | API Key（按量付费；订阅套餐时选择对应的套餐渠道） | 默认 `https://ark.cn-beijing.volces.com/api/v3`，国际站 `https://ark.ap-southeast.bytepluses.com/api/v3`；代码默认 `doubao-seed-2-1-lite-260915` |
| 火山引擎 Agent Plan | Agent Plan 专属 API Key | 默认 `https://ark.cn-beijing.volces.com/api/plan/v3`；代码默认 `doubao-seed-2-1-pro-260628`；套餐含豆包语音合成 |
| 火山引擎 Coding Plan | 火山方舟 API Key | 默认 `https://ark.cn-beijing.volces.com/api/coding/v3`（改成 `/api/v3` 不计入套餐、按量计费）；代码默认 `doubao-seed-2.1-lite`；套餐不含语音合成 |
| 火山引擎（免费试用） | 火山方舟 API Key | 默认 `https://ark.cn-beijing.volces.com/api/v3`；使用新用户的[免费推理额度](https://www.volcengine.com/docs/82379/1399514)，开启「安心体验模式」后用完自动暂停，不产生费用 |
| Anthropic 或兼容接口 | API Key、模型 | 默认 `https://api.anthropic.com`；代码默认 `claude-sonnet-5-5` |
| Azure OpenAI | API Key、Endpoint、部署名称 | API 版本默认 `2024-02-15-preview`；模型字段用于显示 |
| OpenAI 或兼容接口 | API Key、模型 | 默认 `https://api.openai.com/v1`；代码默认 `gpt-6.1-sol` |
| Gemini | API Key、可用模型 | 官方 API；代码默认 `gemini-2.5-flash` |

默认名称来自当前代码，不代表你的账户已开通这些模型。模型可用性、计费和能力以服务商为准。

OpenAI 兼容服务的 Base URL 应包含其要求的 API 路径；Anthropic 兼容服务的 Base URL 不含 `/v1`，应用会拼接 `/v1/messages`。国产大模型官方渠道通过 OpenAI 兼容接口调用，地址和模型留空时使用官方默认值；使用国际站时改填国际站地址。

## MiniMax Code OAuth

MiniMax Code OAuth 用 MiniMax Code 账号登录后调用模型，不需要 API Key：

1. 在“设置 → AI 设置”中选择 MiniMax Code OAuth。
2. 点击“网页登录”，在打开的 MiniMax 授权页面登录并确认。浏览器拦截了弹窗时，点击设置页中的“打开授权页面”。
3. 授权完成后，设置页的账号区域显示“已登录”、剩余积分和今日签到情况；保存设置并测试连接。

登录后服务每小时检查一次签到：当天（北京时间）还没有签到时自动领取 MiniMax Code 的签到积分，失败的签到会在下一次检查时重试。账号区域显示今天是否已自动签到、获得的积分和连签天数，也可以点“立即签到”。不需要时关闭“每日自动签到”并保存，或设置环境变量 `MINIMAX_CODE_AUTO_CHECKIN=false`。签到只在服务运行时进行。

登录凭据保存在配置目录的 `minimax-code.json`，Access Token 到期前自动续期；refresh token 失效时账号区域显示“登录已失效”，重新登录即可。凭据不随数据备份导出，迁移服务器时需要重新登录。

该渠道使用 MiniMax Code 桌面客户端的登录方式，不是官方开放接口，MiniMax 可能随时调整或限制，请遵守其服务条款。

## 云端语音讲解

动画的语音讲解默认由浏览器本地语音（Web Speech）朗读。管理员可在「设置 → AI 设置 → 语音讲解」改用云端语音，由服务端合成后播放，所有设备听到的音色一致：

| 方式 | API Key | 默认模型与音色 | 默认接口 |
| --- | --- | --- | --- |
| MiniMax（建议使用 M Plan） | 与 MiniMax 渠道共用 | `speech-2.8-hd`，音色 `male-qn-jingying`（精英青年） | MiniMax Base URL 加 `/t2a_v2`，即 `https://api.minimax.cn/v1/t2a_v2` |
| 千问（建议使用百炼 Token Plan） | 与千问渠道共用 | `qwen-audio-3.0-tts-plus`，音色 `longanlufeng`（龙安鲁风） | 千问 Base URL 的域名加 `/api/v1/services/audio/tts/SpeechSynthesizer` |
| 阶跃星辰（建议使用 Step Plan） | 与阶跃星辰渠道共用 | `stepaudio-2.5-tts`，音色 `qingniandaxuesheng`（青年大学生），并以指令约束语气 | 阶跃星辰 Base URL 加 `/audio/speech`，即 `https://api.stepfun.com/step_plan/v1/audio/speech` |
| 火山引擎豆包语音（建议购买资源包） | 单独的豆包语音 API Key（在[豆包语音控制台](https://console.volcengine.com/speech)创建，与火山方舟不同） | 资源 ID `seed-tts-2.0`（填在「语音模型」），音色 `zh_male_yangguangqingnian_uranus_bigtts`（阳光青年 2.0） | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` |
| 火山引擎 Agent Plan（计入套餐额度） | 与火山引擎 Agent Plan 渠道共用 | 资源 ID `seed-tts-2.0`，音色 `zh_male_yangguangqingnian_uranus_bigtts` | `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional` |
| 智谱 GLM-TTS（建议使用 GLM Coding Plan） | 与智谱 GLM 渠道共用 | `glm-tts`，音色 `xiaochen`（小陈） | GLM Base URL 加 `/audio/speech`，即 `https://open.bigmodel.cn/api/paas/v4/audio/speech` |

- 默认音色为年轻男声，自然、清晰、略带科技感；千问另用指令要求不用播音腔、不模仿角色。模型、音色和接口地址都可修改（各字段旁附有服务商的说明文档或音色列表链接），「保存并试听」会先保存设置再朗读一段示例，失败时在按钮下方显示服务商的原始报错（如 MiniMax 的 `2056` 表示 Token Plan 当前用量窗口的额度已用完）。
- 合成结果统一到约 -15 LUFS 的响度（峰值不超过 -1.5 dBFS），编码为 48kbps 的 MP3，按服务商、模型、音色和文字缓存在配置目录的 `tts-cache/`，同一段讲解只合成一次，超过 500MB 时删除最早的缓存。
- 开启语音时一次合成整个动画的讲解语音，已有动画可点「重新生成语音」重新合成，两者都登记为后台任务；已生成语音的动画打开时默认开启语音讲解。合成会消耗服务商额度，不计入每人每日的 AI 次数。
- 云端语音失败（未配置 Key、服务商报错等）时，播放器自动改用浏览器语音。
- 网页数据导出包含与动画讲解文字一致的云端语音，导入后写回缓存，无需重新合成。

## 环境变量

基础选择使用 `AI_PROVIDER`，默认 `minimax`，可选 `minimax`、`minimax-code`、`glm`、`deepseek`、`kimi`、`qwen`、`stepfun`、`volcengine`、`volcengine-agent`、`volcengine-coding`、`volcengine-free`、`anthropic`、`azure`、`openai`、`gemini`。

| 提供商 | 配置项 |
| --- | --- |
| MiniMax | `MINIMAX_API_KEY`、`MINIMAX_BASE_URL`、`MINIMAX_MODEL` |
| MiniMax Code OAuth | `MINIMAX_CODE_MODEL`、`MINIMAX_CODE_AUTO_CHECKIN`（账号只能在网页中登录） |
| 智谱 GLM | `GLM_API_KEY`、`GLM_BASE_URL`、`GLM_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` |
| Kimi | `KIMI_API_KEY`、`KIMI_BASE_URL`、`KIMI_MODEL` |
| 千问 Qwen | `QWEN_API_KEY`、`QWEN_BASE_URL`、`QWEN_MODEL` |
| 阶跃星辰 StepFun | `STEPFUN_API_KEY`、`STEPFUN_BASE_URL`、`STEPFUN_MODEL` |
| 火山引擎 豆包 | `VOLCENGINE_API_KEY`、`VOLCENGINE_BASE_URL`、`VOLCENGINE_MODEL` |
| 火山引擎 Agent Plan | `VOLCENGINE_AGENT_API_KEY`、`VOLCENGINE_AGENT_BASE_URL`、`VOLCENGINE_AGENT_MODEL` |
| 火山引擎 Coding Plan | `VOLCENGINE_CODING_API_KEY`、`VOLCENGINE_CODING_BASE_URL`、`VOLCENGINE_CODING_MODEL` |
| 火山引擎（免费试用） | `VOLCENGINE_FREE_API_KEY`、`VOLCENGINE_FREE_BASE_URL`、`VOLCENGINE_FREE_MODEL` |
| 豆包语音（云端语音） | `VOLCENGINE_TTS_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL` |
| Azure | `AZURE_OPENAI_API_KEY`、`AZURE_OPENAI_ENDPOINT`、`AZURE_OPENAI_DEPLOYMENT`、`AZURE_OPENAI_API_VERSION`、`AZURE_OPENAI_MODEL` |
| OpenAI | `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` |
| Gemini | `GOOGLE_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_MODEL` |

如果网页里已经保存配置，仅修改环境变量可能不会改变实际生效值；先检查网页中所选提供商和激活实例。全局 AI 分析超时可在管理员“设置 → 通用”中调整，代码默认 180 秒。

## 模型能力要求

| 能力 | 对应功能 |
| --- | --- |
| 图片输入 | 拍照识别、基于原图重绘配图、有原图时重新解答 |
| 数学推理与规范 LaTeX | 答案、解析、错因和难度评定 |
| 按指定标签或 JSON 返回内容 | 各类 AI 结果解析 |
| 输出 SVG 代码 | 静态配图与 SVG 动画讲解 |
| 足够长的输出 | 包含配图的识别结果及分步骤动画 |

SVG 配图与动画由语言模型输出代码生成，不调用图片生成接口。动画常需要较长输出，输出截断时应用会尝试提高输出上限重试；模型本身也必须支持相应长度。

## 提示词与生成规则

管理员可在“提示词”页自定义识别和举一反三模板。应用对生成题目还有统一约束：举一反三和试卷新题使用填空题或解答题，题目内容不含题号、分值和选择题选项。

知识点识别依据错题本的学段与学科，从对应知识点库选择标签。新接入服务时，建议分别验证文字录入、图片识别、举一反三和动画讲解。

## 网络与凭据

容器内的 `localhost` 指容器自身；AI 服务在其他主机或容器时，需要使用容器可访问的地址。需要代理时，可通过 `HTTP_PROXY` / `HTTPS_PROXY` 配置服务端网络。

API Key 保存在服务端配置中。备份 `config/` 时应妥善保存，反馈问题时只提供经过脱敏的配置、日志和错误信息。

实现入口：[配置读取](https://github.com/margrop/wrong-notebook/blob/main/src/lib/config.ts) · [提供商选择](https://github.com/margrop/wrong-notebook/blob/main/src/lib/ai/index.ts) · [提示词](https://github.com/margrop/wrong-notebook/blob/main/src/lib/ai/prompts.ts)。
