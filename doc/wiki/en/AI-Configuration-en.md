# AI Configuration

Admins can change the AI configuration in the web settings. Once saved, later requests read the new configuration without restarting the service. The configuration is written to `config/app-config.json`, and saved fields take precedence over environment variables.

## Steps

1. Sign in as an admin and open "Settings → AI Provider".
2. Choose a provider and fill in the API key, endpoint, and model or deployment name. Links to the official API docs appear below the provider (both the China and international sites when a provider has both), and the API key and model fields link to how to get a key and the model list, so you can check the endpoint and model names.
3. Test the connection; fetch the model list from the API if needed. When the test fails, the provider's original error (such as an exhausted quota or a missing model) is shown along with the error type.
4. Save, then check image input, output format and answer quality with a real question.

AI settings, connection tests, model lists and prompt settings are admin-only. “OpenAI / Compatible” (Chat Completions) supports up to 10 instances and uses the currently active instance. Responses API has its own configuration.

## Provider parameters

| Provider | Required | Endpoint and default model |
| --- | --- | --- |
| MiniMax | API key | Defaults to `https://api.minimax.cn/v1`; code default `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth | Sign in to a MiniMax Code account on the settings page | Fixed endpoint `https://agent.minimax.cn/mavis/api/v1/llm`; code default `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth (international) | Separate browser sign-in on the settings page; overseas network required | Fixed endpoint `https://agent.minimax.io/mavis/api/v1/llm`; code default `MiniMax-M3.1-Flash` |
| SiliconFlow (China site) | API key; free text models after registration and identity verification | Defaults to `https://api.siliconflow.cn/v1`; code default free model `THUDM/GLM-Z1-9B-0414` (text input only) |
| SiliconFlow (international) | API key; separate account; $1 credit for new users | Defaults to `https://api.siliconflow.com/v1`; code default `Qwen/Qwen2.5-VL-7B-Instruct` (accepts images) |
| Zhipu GLM | API key | Defaults to `https://open.bigmodel.cn/api/paas/v4`; code default `glm-5.3-flash` |
| DeepSeek | API key | Defaults to `https://api.deepseek.com`; code default `deepseek-v4-flash` |
| Kimi | API key | Defaults to `https://api.moonshot.cn/v1`; code default `kimi-k3.1-pro` |
| Qwen | API key (Model Studio Token Plan recommended, starts with `sk-sp-`) | Defaults to the Token Plan URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; pay-as-you-go keys use `https://dashscope.aliyuncs.com/compatible-mode/v1`; code default `qwen3.8-max` |
| StepFun | API key (Step Plan recommended) | Defaults to the Step Plan URL `https://api.stepfun.com/step_plan/v1`; pay-as-you-go keys use `https://api.stepfun.com/v1`, international `https://api.stepfun.ai/v1`; code default `step-5-preview` |
| Volcengine Doubao | API key (pay-as-you-go; with a plan subscription, choose the matching plan channel) | Defaults to `https://ark.cn-beijing.volces.com/api/v3`; international `https://ark.ap-southeast.bytepluses.com/api/v3`; code default `doubao-seed-evolving` |
| Volcengine Agent Plan | Dedicated Agent Plan API key | Defaults to `https://ark.cn-beijing.volces.com/api/plan/v3`; code default `doubao-seed-evolving` (or enter `ark-code-latest` to use the model chosen under Activation Management in the Ark console); the plan includes Doubao speech synthesis |
| Volcengine Coding Plan | Volcengine Ark API key | Defaults to `https://ark.cn-beijing.volces.com/api/coding/v3` (changing it to `/api/v3` is billed pay-as-you-go instead of the plan); code default `doubao-seed-evolving` (or enter `ark-code-latest` to use the model chosen under Activation Management in the Ark console); the plan does not include speech synthesis |
| Volcengine (free trial) | Volcengine Ark API key | Defaults to `https://ark.cn-beijing.volces.com/api/v3`; uses the new-user [free inference quota](https://www.volcengine.com/docs/82379/1399514); with worry-free trial mode on, calls pause when it runs out, so you are never charged |
| Ollama (local) | API key `ollama` (the local server requires a non-empty value but ignores it); a vision-capable model is required | Defaults to `http://localhost:11434/v1`; code default `qwen3-vl:8b`. Under Docker, use the host address and let Ollama listen on the LAN |
| Anthropic or compatible | API key, model | Defaults to `https://api.anthropic.com`; code default `claude-sonnet-5-5` |
| Azure OpenAI | API key, endpoint, deployment name | API version defaults to `2024-02-15-preview`; the model field is for display |
| OpenAI or compatible (Chat Completions) | API key | Defaults to `https://api.openai.com/v1`; code default `gpt-6.1-sol` |
| OpenAI Responses API (compatible) | API key | Defaults to `https://api.openai.com/v1`; code default `gpt-6.1-sol` |
| Gemini | API key, an available model | Official API; code default `gemini-2.5-flash` |

The default names come from the current code and do not mean these models are enabled for your account. Model availability, billing and capabilities are determined by the provider.

For OpenAI-compatible services, the base URL should include the API path they require. For Anthropic-compatible services, the base URL excludes `/v1`; the app appends `/v1/messages`. The official MiniMax, GLM, DeepSeek, Kimi, Qwen, StepFun and Volcengine channels are called through the OpenAI-compatible API; leaving the endpoint and model empty uses the official defaults. Fill in the international endpoint if you use an international site.

For a gateway that supports Responses, choose “OpenAI Responses API (compatible)” and enter its API key, base URL (for example, `https://api.example.com/v1`) and model ID. The app appends `/responses` to the base URL. If the gateway has no `/models` endpoint, enter the model manually. For image recognition, choose a model that accepts images and verify it with Test Connection.

Local Ollama connects through the OpenAI-compatible API. Pull a vision-capable model first (`ollama pull qwen3-vl:8b`), then choose Ollama under **Settings → AI Provider**; leaving the base URL and model empty uses the defaults. The app calls it from the server, so under Docker `localhost` points at the container: enter the host's LAN address (for example `http://192.168.1.10:11434/v1`) and set Ollama's `OLLAMA_HOST` to `0.0.0.0`. Recognition accuracy depends on the chosen model's vision ability.

## MiniMax Code OAuth

MiniMax Code OAuth calls models after you sign in with a MiniMax Code account, so no API key is needed:

1. In "Settings → AI Provider", choose MiniMax Code OAuth.
2. Click "Sign in with browser", then sign in and confirm on the MiniMax authorization page that opens. If the browser blocks the pop-up, click "Open the authorization page" on the settings page.
3. Once authorized, the account area shows "Signed in", the remaining credits and today's check-in. Save the settings and test the connection.

Once signed in, the server checks every hour: if today's check-in (Beijing time) has not been done yet, it collects the MiniMax Code daily check-in credits, and a failed check-in is retried at the next check. The account area shows whether today's check-in was done automatically, the credits received and the streak, and you can click "Check in now". To turn it off, switch off "Daily auto check-in" and save, or set `MINIMAX_CODE_AUTO_CHECKIN=false`. Check-ins only happen while the service is running.

The credentials are stored in `minimax-code.json` in the config directory, and the access token is renewed automatically before it expires. If the refresh token stops working, the account area shows "Login expired"; sign in again to fix it. The credentials are not included in data backups, so sign in again after moving to another server.

This channel uses the sign-in of the MiniMax Code desktop client rather than an official open API. MiniMax may change or restrict it at any time; follow its terms of service.

## MiniMax Code OAuth (international)

The international site signs in separately from the China site: the account endpoint is `https://account.minimax.io` and the model endpoint is `https://agent.minimax.io/mavis/api/v1/llm`. The account, credits and credentials are separate from the China site (`account.minimax.cn` / `agent.minimax.cn`) and cannot be exchanged.

- **Overseas network required**: requests from mainland China to `account.minimax.io` are redirected to the China site, and the resulting credentials do not work on the international API. Use an overseas network or proxy, and make the server use the same route (for example `HTTPS_PROXY`).
- **Sign-in and check-in**: choose "MiniMax Code OAuth (international)" under **Settings → AI Provider** and sign in on its own page. The account area shows the login status, remaining credits and today's check-in, and daily auto check-in can be toggled independently.
- **Separate configuration**: the international site uses `MINIMAX_CODE_GLOBAL_MODEL` and `MINIMAX_CODE_GLOBAL_AUTO_CHECKIN`; the China site keeps `MINIMAX_CODE_MODEL` and `MINIMAX_CODE_AUTO_CHECKIN`. Both credentials live in separate sections of `minimax-code.json`.
- **Default model**: `MiniMax-M3.1-Flash`; `MiniMax-M3`, `MiniMax-M3.1-Flash-Preview` and other international models are also available, as shown by the model hint on the settings page.

This channel also uses the MiniMax Code desktop client's OAuth device authorization rather than an official open API. MiniMax may change or restrict it at any time; follow its terms of service.

## SiliconFlow

SiliconFlow is split into China-site and international channels, with separate accounts, API keys, endpoints and default models.

- **China site**: default endpoint `https://api.siliconflow.cn/v1`, default free text model `THUDM/GLM-Z1-9B-0414`. After registration and identity verification, the free models also include `THUDM/GLM-4-9B-0414`, `Qwen/Qwen2.5-7B-Instruct`, `Qwen/Qwen3-8B`, `Qwen/Qwen3.5-4B`, `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` and `XingChenAGI/Xing4.0-29B`. They accept text only and have fixed rate limits, which suits text-only work such as solving, grading and tagging.
- **Vision on the China site**: the free models cannot see images; for photo recognition and figure redrawing, switch to a paid vision model with the same key, or route image recognition to another channel under **Channel routing**.
- **International**: default endpoint `https://api.siliconflow.com/v1`, default model `Qwen/Qwen2.5-VL-7B-Instruct` (accepts images and is inexpensive). Register separately; new users get a $1 trial credit, then pay as you go. There are no permanently free text models on the international site.
- **Configuration**: the China site uses `SILICONFLOW_API_KEY`, `SILICONFLOW_BASE_URL` and `SILICONFLOW_MODEL`; the international site uses `SILICONFLOW_GLOBAL_API_KEY`, `SILICONFLOW_GLOBAL_BASE_URL` and `SILICONFLOW_GLOBAL_MODEL`. Get keys from the [China console](https://cloud.siliconflow.cn/account/ak) and the [international console](https://cloud.siliconflow.com/account/ak); free-model availability, credit eligibility and rate limits are shown in your account.

## Cloud voice narration

Animation narration is read by the browser's own voice (Web Speech) by default. Admins can switch to a cloud voice under **Settings → AI → Voice narration**; the server synthesizes the speech, so every device hears the same voice:

| Option | API key | Default model and voice | Default endpoint |
| --- | --- | --- | --- |
| MiniMax (M Plan recommended) | Shared with the MiniMax channel | `speech-2.8-hd`, voice `male-qn-jingying` | MiniMax base URL plus `/t2a_v2`, i.e. `https://api.minimax.cn/v1/t2a_v2` |
| Qwen (Model Studio Token Plan recommended) | Shared with the Qwen channel | `qwen-audio-3.0-tts-plus`, voice `longanlufeng` | Domain of the Qwen base URL plus `/api/v1/services/audio/tts/SpeechSynthesizer` |
| StepFun (Step Plan recommended) | Shared with the StepFun channel | `stepaudio-2.5-tts`, voice `qingniandaxuesheng`, with a style instruction | StepFun base URL plus `/audio/speech`, i.e. `https://api.stepfun.com/step_plan/v1/audio/speech` |
| Volcengine Doubao Speech (resource pack recommended) | Its own Doubao Speech API key (create it in the [Doubao Speech console](https://console.volcengine.com/speech); different from Volcengine Ark) | Resource ID `seed-tts-2.0` (in the speech model field), voice `zh_male_yangguangqingnian_uranus_bigtts` | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` |
| Volcengine Agent Plan (counts toward the plan) | Shared with the Volcengine Agent Plan channel | Resource ID `seed-tts-2.0`, voice `zh_male_yangguangqingnian_uranus_bigtts` | `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional` |
| OpenAI | Optional; leave empty to use the OpenAI configuration active in AI settings | `gpt-4o-mini-tts`, voice `cedar`, with a style instruction (OpenAI plans to retire the model on 2027-01-06) | OpenAI base URL plus `/audio/speech`, i.e. `https://api.openai.com/v1/audio/speech` |
| Zhipu GLM-TTS (GLM Coding Plan recommended) | Shared with the GLM channel | `glm-tts`, voice `xiaochen` | GLM base URL plus `/audio/speech`, i.e. `https://open.bigmodel.cn/api/paas/v4/audio/speech` |

- The default voice is a young male voice that sounds natural, clear and slightly techy; for Qwen, an instruction also asks for no broadcast tone and no character imitation. Model, voice and endpoint can be changed (the API key links to how to get one, and the other fields link to the provider's docs or voice list), and **Save and preview** saves the settings before reading a sample; if it fails, the provider's original error appears below the buttons (for example, MiniMax `2056` means the current Token Plan usage window is used up).
- Speech is normalized to about -15 LUFS (peaks at most -1.5 dBFS), encoded as 48 kbps MP3 and cached in `tts-cache/` under the config directory by provider, model, voice and text. Each segment is synthesized once; the oldest files are removed beyond 500 MB.
- Turning on narration synthesizes the whole animation's voice at once, and **Regenerate voice** on an existing animation synthesizes it again; both are registered as background tasks. Animations with generated voice open with narration on. Synthesis uses the provider's quota and does not count toward the per-user daily AI limit.
- Volcengine offers new users a [free trial quota](https://docs.volcengine.com/docs/ark/free-inference-quota?lang=zh) you can turn on by following its docs; the models it covers, including speech, are shown under Activation Management in the console.
- If cloud voice fails (no key, provider error and so on), the player falls back to the browser's voice.
- Web data export includes the cloud voice matching the animation narration; import writes it back to the cache, so it does not need to be synthesized again.

## Environment variables

`AI_PROVIDER` selects the provider. It defaults to `minimax` and accepts `minimax`, `minimax-code`, `minimax-code-global`, `glm`, `deepseek`, `kimi`, `qwen`, `stepfun`, `volcengine`, `volcengine-agent`, `volcengine-coding`, `volcengine-free`, `siliconflow`, `siliconflow-global`, `ollama`, `anthropic`, `azure`, `openai`, `openai-responses` and `gemini`.

| Provider | Variables |
| --- | --- |
| MiniMax | `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL` |
| MiniMax Code OAuth | `MINIMAX_CODE_MODEL`, `MINIMAX_CODE_AUTO_CHECKIN` (the account can only sign in from the web UI) |
| MiniMax Code OAuth (international) | `MINIMAX_CODE_GLOBAL_MODEL`, `MINIMAX_CODE_GLOBAL_AUTO_CHECKIN` (separate browser sign-in; overseas network required) |
| Zhipu GLM | `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` |
| Kimi | `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL` |
| Qwen | `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` |
| StepFun | `STEPFUN_API_KEY`, `STEPFUN_BASE_URL`, `STEPFUN_MODEL` |
| Volcengine Doubao | `VOLCENGINE_API_KEY`, `VOLCENGINE_BASE_URL`, `VOLCENGINE_MODEL` |
| Volcengine Agent Plan | `VOLCENGINE_AGENT_API_KEY`, `VOLCENGINE_AGENT_BASE_URL`, `VOLCENGINE_AGENT_MODEL` |
| Volcengine Coding Plan | `VOLCENGINE_CODING_API_KEY`, `VOLCENGINE_CODING_BASE_URL`, `VOLCENGINE_CODING_MODEL` |
| Volcengine (free trial) | `VOLCENGINE_FREE_API_KEY`, `VOLCENGINE_FREE_BASE_URL`, `VOLCENGINE_FREE_MODEL` |
| SiliconFlow (China site) | `SILICONFLOW_API_KEY`, `SILICONFLOW_BASE_URL`, `SILICONFLOW_MODEL` |
| SiliconFlow (international) | `SILICONFLOW_GLOBAL_API_KEY`, `SILICONFLOW_GLOBAL_BASE_URL`, `SILICONFLOW_GLOBAL_MODEL` |
| Ollama (local) | `OLLAMA_API_KEY` (may be `ollama`), `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| Doubao Speech (cloud voice) | `VOLCENGINE_TTS_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` |
| Azure | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_MODEL` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |
| OpenAI Responses API | `OPENAI_RESPONSES_API_KEY`, `OPENAI_RESPONSES_BASE_URL`, `OPENAI_RESPONSES_MODEL` |
| Gemini | `GOOGLE_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL` |

If a configuration has already been saved in the web UI, changing only the environment variables may not change what is actually used; check the selected provider and active instance in the web UI first. The global AI analysis timeout can be adjusted in the admin "Settings → General"; the code default is 180 seconds.

## Model capabilities

| Capability | Features |
| --- | --- |
| Image input | Photo recognition, redrawing figures from the original image, re-solving when an image is available |
| Math reasoning and clean LaTeX | Answers, analysis, mistake causes and difficulty rating |
| Returning content in the specified tags or JSON | Parsing of all AI results |
| Emitting SVG code | Static figures and SVG animated explanations |
| Long enough output | Recognition results with figures and step-by-step animations |

SVG figures and animations are generated as code by the language model; no image-generation API is called. Animations often need long output. Every call requests the model's maximum output directly (the official limit for known models, 262144 (256K) for unknown models; if the API rejects it, the limit is read from the error, retried and remembered); the model itself must also support that length. Relay gateways that pre-charge by `max_tokens` (such as NewAPI) need enough balance to cover the pre-charge.

## Prompts and generation rules

Admins can customize the recognition, solving and similar-question templates on the "Prompts" tab — useful for adjusting the explanation style and tone to a child's grade, weak points and habits. **Copy** takes the default template, **Replace with clipboard** overwrites it with your edited version, and **Reset Default** restores it. The `{{variables}}` in a template are replaced with each question's data; the editor lists any that are missing. The app still adds its output contract, language, grade, tag and question-type rules. The app also applies common rules to generated questions: similar questions and exam questions are fill-in-the-blank or free-response, and the question text contains no question number, score or multiple-choice options.

## Channel routing and fallback

**Channel routing** lets image recognition and text analysis use different channels: photo recognition, figure redrawing, image splitting and answering from an image need a vision model, while solving, grading and tagging work with a cheaper text model, each with its own API key. A **fallback channel** can be selected too: when the main channel reports exhausted quota (including used-up free credits or a zero balance), an expired login, missing permission or a missing model, the same call switches to the fallback automatically, so paid credits can back up free MiniMax Code credits without manual switching. Usage is recorded per channel actually used. Leaving a field empty follows the default channel or disables the fallback.

Grading checks equivalent results for calculation questions and the required reasoning for proofs and justification questions. Local matching only marks answers correct when no reasoning is required; other cases go to AI grading.

GeoGebra text, inequalities and caption parameters are checked against a shared command list; regeneration includes actual execution errors as feedback.

The application always supplies the output contract, field languages, grade scope and candidate-tag rules, including for older custom templates with missing variables. Recognition preserves the original question and student work; explanations and mistake analysis follow the interface language, while stored subject, grade and tag names remain unchanged. AI tags are filtered against the candidate list and deduplicated; manually added tags are unaffected. Mastery evaluation includes its evaluation time and practice intervals.

Knowledge points are chosen from the tag library matching the notebook's school stage and subject. When adding a new provider, verify text input, image recognition, similar questions and animated explanations separately.

## Network and credentials

`localhost` inside a container refers to the container itself. When the AI service runs on another host or container, use an address reachable from the container. If a proxy is needed, configure the server network with `HTTP_PROXY` / `HTTPS_PROXY`.

API keys are stored in the server configuration. Keep backups of `config/` safe, and only share redacted configuration, logs and error messages when reporting problems.

Code entry points: [configuration](https://github.com/margrop/wrong-notebook/tree/main/src/lib/config) · [provider selection](https://github.com/margrop/wrong-notebook/blob/main/src/lib/ai/index.ts) · [prompts](https://github.com/margrop/wrong-notebook/tree/main/src/lib/ai/prompts).
