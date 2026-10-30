# AI Configuration

Admins can change the AI configuration in the web settings. Once saved, later requests read the new configuration without restarting the service. The configuration is written to `config/app-config.json`, and saved fields take precedence over environment variables.

## Steps

1. Sign in as an admin and open "Settings → AI Provider".
2. Choose a provider and fill in the API key, endpoint, and model or deployment name.
3. Test the connection; fetch the model list from the API if needed. When the test fails, the provider's original error (such as an exhausted quota or a missing model) is shown along with the error type.
4. Save, then check image input, output format and answer quality with a real question.

AI settings, connection tests, model lists and prompt settings are admin-only. The OpenAI configuration supports up to 10 instances; the currently active instance decides which configuration is used.

## Provider parameters

| Provider | Required | Endpoint and default model |
| --- | --- | --- |
| MiniMax | API key | Defaults to `https://api.minimax.cn/v1`; code default `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth | Sign in to a MiniMax Code account on the settings page | Fixed endpoint `https://agent.minimax.cn/mavis/api/v1/llm`; code default `MiniMax-M3.1-Flash` |
| Zhipu GLM | API key | Defaults to `https://open.bigmodel.cn/api/paas/v4`; code default `glm-5.3-flash` |
| DeepSeek | API key | Defaults to `https://api.deepseek.com`; code default `deepseek-flash` |
| Kimi | API key | Defaults to `https://api.moonshot.cn/v1`; code default `kimi-k3` |
| Qwen | API key (Model Studio Token Plan recommended, starts with `sk-sp-`) | Defaults to the Token Plan URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; pay-as-you-go keys use `https://dashscope.aliyuncs.com/compatible-mode/v1`; code default `qwen3.8-max` |
| Anthropic or compatible | API key, model | Defaults to `https://api.anthropic.com`; code default `claude-sonnet-5-5` |
| Azure OpenAI | API key, endpoint, deployment name | API version defaults to `2024-02-15-preview`; the model field is for display |
| OpenAI or compatible | API key, model | Defaults to `https://api.openai.com/v1`; code default `gpt-6.1-sol` |
| Gemini | API key, an available model | Official API; code default `gemini-2.5-flash` |

The default names come from the current code and do not mean these models are enabled for your account. Model availability, billing and capabilities are determined by the provider.

For OpenAI-compatible services, the base URL should include the API path they require. For Anthropic-compatible services, the base URL excludes `/v1`; the app appends `/v1/messages`. The official MiniMax, GLM, DeepSeek, Kimi and Qwen channels are called through the OpenAI-compatible API; leaving the endpoint and model empty uses the official defaults. Fill in the international endpoint if you use an international site.

## MiniMax Code OAuth

MiniMax Code OAuth calls models after you sign in with a MiniMax Code account, so no API key is needed:

1. In "Settings → AI Provider", choose MiniMax Code OAuth.
2. Click "Sign in with browser", then sign in and confirm on the MiniMax authorization page that opens. If the browser blocks the pop-up, click "Open the authorization page" on the settings page.
3. Once authorized, the account area shows "Signed in", the remaining credits and today's check-in. Save the settings and test the connection.

Once signed in, the server checks every hour: if today's check-in (Beijing time) has not been done yet, it collects the MiniMax Code daily check-in credits, and a failed check-in is retried at the next check. The account area shows whether today's check-in was done automatically, the credits received and the streak, and you can click "Check in now". To turn it off, switch off "Daily auto check-in" and save, or set `MINIMAX_CODE_AUTO_CHECKIN=false`. Check-ins only happen while the service is running.

The credentials are stored in `minimax-code.json` in the config directory, and the access token is renewed automatically before it expires. If the refresh token stops working, the account area shows "Login expired"; sign in again to fix it. The credentials are not included in data backups, so sign in again after moving to another server.

This channel uses the sign-in of the MiniMax Code desktop client rather than an official open API. MiniMax may change or restrict it at any time; follow its terms of service.

## Cloud voice narration

Animation narration is read by the browser's own voice (Web Speech) by default. Admins can switch to a cloud voice under **Settings → AI → Voice narration**; the server synthesizes the speech, so every device hears the same voice:

| Option | API key | Default model and voice | Default endpoint |
| --- | --- | --- | --- |
| MiniMax (M Plan recommended) | Shared with the MiniMax channel | `speech-2.8-hd`, voice `male-qn-jingying` | MiniMax base URL plus `/t2a_v2`, i.e. `https://api.minimax.cn/v1/t2a_v2` |
| Qwen (Model Studio Token Plan recommended) | Shared with the Qwen channel | `qwen-audio-3.0-tts-plus`, voice `longanlufeng` | Domain of the Qwen base URL plus `/api/v1/services/audio/tts/SpeechSynthesizer` |

- The default voice is a young male voice that sounds natural, clear and slightly techy; for Qwen, an instruction also asks for no broadcast tone and no character imitation. Model, voice and endpoint can be changed, and **Save and preview** saves the settings before reading a sample; if it fails, the provider's original error appears below the buttons (for example, MiniMax `2056` means the current Token Plan usage window is used up).
- Speech is normalized to about -15 LUFS (peaks at most -1.5 dBFS), encoded as 48 kbps MP3 and cached in `tts-cache/` under the config directory by provider, model, voice and text. Each segment is synthesized once; the oldest files are removed beyond 500 MB.
- **Regenerate voice** on an existing animation synthesizes it again segment by segment. Synthesis uses the provider's quota and does not count toward the per-user daily AI limit.
- If cloud voice fails (no key, provider error and so on), the player falls back to the browser's voice.
- Web data export includes the cloud voice matching the animation narration; import writes it back to the cache, so it does not need to be synthesized again.

## Environment variables

`AI_PROVIDER` selects the provider. It defaults to `minimax` and accepts `minimax`, `minimax-code`, `glm`, `deepseek`, `kimi`, `qwen`, `anthropic`, `azure`, `openai` and `gemini`.

| Provider | Variables |
| --- | --- |
| MiniMax | `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL` |
| MiniMax Code OAuth | `MINIMAX_CODE_MODEL`, `MINIMAX_CODE_AUTO_CHECKIN` (the account can only sign in from the web UI) |
| Zhipu GLM | `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL` |
| DeepSeek | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` |
| Kimi | `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL` |
| Qwen | `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` |
| Azure | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_MODEL` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` |
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

SVG figures and animations are generated as code by the language model; no image-generation API is called. Animations often need long output. When the output is truncated, the app retries with a higher output limit; the model itself must also support that length.

## Prompts and generation rules

Admins can customize the recognition and similar-question templates on the "Prompts" tab. The app also applies common rules to generated questions: similar questions and exam questions are fill-in-the-blank or free-response, and the question text contains no question number, score or multiple-choice options.

Knowledge points are chosen from the tag library matching the notebook's school stage and subject. When adding a new provider, verify text input, image recognition, similar questions and animated explanations separately.

## Network and credentials

`localhost` inside a container refers to the container itself. When the AI service runs on another host or container, use an address reachable from the container. If a proxy is needed, configure the server network with `HTTP_PROXY` / `HTTPS_PROXY`.

API keys are stored in the server configuration. Keep backups of `config/` safe, and only share redacted configuration, logs and error messages when reporting problems.

Code entry points: [configuration](https://github.com/margrop/wrong-notebook/blob/main/src/lib/config.ts) · [provider selection](https://github.com/margrop/wrong-notebook/blob/main/src/lib/ai/index.ts) · [prompts](https://github.com/margrop/wrong-notebook/blob/main/src/lib/ai/prompts.ts).
