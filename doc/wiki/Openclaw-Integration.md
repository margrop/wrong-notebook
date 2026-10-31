# Openclaw 集成

`POST /api/openclaw/batch-upload` 接收图片数组，调用外部 Openclaw agent 识别，再把结果写入本系统。使用前需要自行提供兼容的识别服务。

## 数据流与两组凭据

```text
调用方 → 错题本 /api/openclaw/batch-upload
       → Openclaw agent /api/recognize
       → 错题本保存题目或记录重复导入
```

| 配置 | 方向与作用 |
| --- | --- |
| `OPENCLAW_INTEGRATION_API_KEY` | 调用方访问错题本时使用，放在 `x-api-key` 请求头 |
| `OPENCLAW_API_KEY` | 错题本访问外部 agent 时使用，作为 Bearer 凭据发送 |

两者用于不同方向，不应混淆。

## 服务端配置

```dotenv
OPENCLAW_API_URL=http://localhost:8080
OPENCLAW_API_KEY=替换为识别服务要求的密钥
OPENCLAW_TIMEOUT=30000
OPENCLAW_AUTH_MODE=apikey
OPENCLAW_INTEGRATION_API_KEY=替换为随机生成的集成密钥
```

可用 `openssl rand -hex 32` 生成集成密钥。`OPENCLAW_API_URL` 在代码中的缺省值为 `http://localhost:8080`；容器部署时需改成容器可访问的 agent 地址。

`apikey` 模式必须同时配置非空的 `OPENCLAW_INTEGRATION_API_KEY` 才会启用；否则代码进入用户名密码认证分支。修改环境变量后，应重启或重建服务使其生效。

## API Key 模式请求

请求头为 `Content-Type: application/json` 和 `x-api-key: 你的集成密钥`。请求体示例：

```json
{
  "userEmail": "student@example.com",
  "subjectId": "目标用户已有的错题本 ID",
  "images": [
    {
      "filename": "question-1.png",
      "mimeType": "image/png",
      "base64": "不带 data: 前缀的纯 Base64 图片数据"
    }
  ]
}
```

目标用户必须已经存在。`subjectId` 可省略；填写时应使用目标用户已有的错题本 ID。

把实际请求体保存为 `request.json`，并在调用端环境中提供集成密钥后，可执行：

```bash
curl --fail-with-body http://localhost:3000/api/openclaw/batch-upload \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${OPENCLAW_INTEGRATION_API_KEY}" \
  --data-binary @request.json
```

该接口处理完整批次后返回结果，请为调用端设置足够的请求超时。

## 用户名密码模式

默认 `OPENCLAW_AUTH_MODE=credentials`。请求体携带 `username`、`password`、可选 `subjectId` 和相同结构的 `images`；`username` 可使用用户邮箱或用户名。通过 HTTPS 传输并避免记录请求中的密码。

## 输入限制与超时

- 每批最多 20 张图片。
- 预期格式为 JPG、JPEG 或 PNG（`mimeType` 须为 `image/jpeg` 或 `image/png`），单张解码后估算大小不超过 5 MiB。
- `base64` 使用纯 Base64，文件名扩展名应与图片内容匹配。
- 图片按顺序逐张识别；当前单张识别超时为 `min(3000, OPENCLAW_TIMEOUT / 图片数)` 毫秒。

当前实现的单张超时最多 3 秒；只调大 `OPENCLAW_TIMEOUT` 不会突破这一上限。接入耗时较长的 agent 时，需要特别核对接口实现与实际响应时间。

## agent 识别接口

错题本向 `${OPENCLAW_API_URL}/api/recognize` 发送：

```json
{
  "image": "纯 Base64 图片数据",
  "mimeType": "image/png"
}
```

成功响应的基本结构：

```json
{
  "success": true,
  "data": {
    "questionText": "题干",
    "answerText": "答案",
    "analysis": "解析",
    "knowledgePoints": ["知识点名称"],
    "difficultyStars": 3,
    "gradeSemester": "四年级上"
  }
}
```

还可返回 `wrongAnswerText`、`mistakeAnalysis`、`subject`、`errorType` 和 `source`；失败时返回 `success: false` 与 `error`。

录入年级遵循目标用户在「设置 → 通用」保存的规则。固定模式使用所选值，未指定时按账户当前年级计算；AI 模式使用识别结果中的 `gradeSemester`（如「四年级上」「初二下」），无法确定时可返回 `null`。省略该字段时，错题本会为非重复题补充一次 AI 年级识别，计入目标用户的每日 AI 用量；达到上限或识别失败时，该题返回失败，需读取逐项结果。

## 结果判断

| 结果 | 判断方式 |
| --- | --- |
| 全部成功 | HTTP `201`，`success: true` |
| 存在逐项失败，包括全部识别失败 | HTTP `207`，`success: false`，检查 `failCount` 与 `results` |
| 认证或请求格式错误 | HTTP `400`、`401`、`404` 等，读取错误响应 |
| 重复题 | 对应项仍可为成功，包含 `duplicate`、`mistakeRecorded`、`errorItemId` 等字段 |

不要仅凭 HTTP 成功状态判断整批导入成功；应处理每个 `results` 项，并避免无差别重试整批，否则成功的题目可能再次记错。

实现依据：[批量导入路由](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/openclaw/batch-upload/route.ts)。
