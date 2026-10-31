# Openclaw Integration

`POST /api/openclaw/batch-upload` receives an array of images, calls an external Openclaw agent to recognize them, and writes the results into this system. You need to provide a compatible recognition service yourself.

## Data flow and the two credentials

```text
Caller → Wrong Notebook /api/openclaw/batch-upload
       → Openclaw agent /api/recognize
       → Wrong Notebook saves the question or records a repeated import
```

| Setting | Direction and purpose |
| --- | --- |
| `OPENCLAW_INTEGRATION_API_KEY` | Used by callers to access Wrong Notebook, sent in the `x-api-key` header |
| `OPENCLAW_API_KEY` | Used by Wrong Notebook to access the external agent, sent as a Bearer token |

They are used in opposite directions; do not mix them up.

## Server configuration

```dotenv
OPENCLAW_API_URL=http://localhost:8080
OPENCLAW_API_KEY=replace-with-the-key-your-recognition-service-requires
OPENCLAW_TIMEOUT=30000
OPENCLAW_AUTH_MODE=apikey
OPENCLAW_INTEGRATION_API_KEY=replace-with-a-random-integration-key
```

Generate the integration key with `openssl rand -hex 32`. `OPENCLAW_API_URL` defaults to `http://localhost:8080` in the code; in container deployments, change it to an agent address reachable from the container.

`apikey` mode is only enabled when a non-empty `OPENCLAW_INTEGRATION_API_KEY` is also set; otherwise the code falls back to username/password authentication. Restart or recreate the service after changing environment variables.

## API key mode request

Send `Content-Type: application/json` and `x-api-key: <your integration key>`. Example body:

```json
{
  "userEmail": "student@example.com",
  "subjectId": "ID of an existing notebook of the target user",
  "images": [
    {
      "filename": "question-1.png",
      "mimeType": "image/png",
      "base64": "plain Base64 image data without the data: prefix"
    }
  ]
}
```

The target user must already exist. `subjectId` is optional; when given, it must be the ID of one of the target user's notebooks.

Save the actual body as `request.json` and, with the integration key available in the caller's environment, run:

```bash
curl --fail-with-body http://localhost:3000/api/openclaw/batch-upload \
  -H 'Content-Type: application/json' \
  -H "x-api-key: ${OPENCLAW_INTEGRATION_API_KEY}" \
  --data-binary @request.json
```

The endpoint returns after processing the whole batch, so give the caller a long enough request timeout.

## Username/password mode

`OPENCLAW_AUTH_MODE=credentials` is the default. The body carries `username`, `password`, an optional `subjectId` and the same `images` structure; `username` can be the user's email or username. Send it over HTTPS and avoid logging the password in the request.

## Input limits and timeouts

- At most 20 images per batch.
- Expected formats are JPG, JPEG or PNG (`mimeType` must be `image/jpeg` or `image/png`), each at most an estimated 5 MiB after decoding.
- `base64` is plain Base64, and the file extension should match the image content.
- Images are recognized one by one in order; the per-image timeout is currently `min(3000, OPENCLAW_TIMEOUT / image count)` milliseconds.

With the current implementation the per-image timeout is at most 3 seconds; raising `OPENCLAW_TIMEOUT` alone does not lift this cap. When integrating a slow agent, check the implementation against the actual response time.

## Agent recognition API

Wrong Notebook sends this to `${OPENCLAW_API_URL}/api/recognize`:

```json
{
  "image": "plain Base64 image data",
  "mimeType": "image/png"
}
```

The basic successful response:

```json
{
  "success": true,
  "data": {
    "questionText": "Question",
    "answerText": "Answer",
    "analysis": "Analysis",
    "knowledgePoints": ["Knowledge point name"],
    "difficultyStars": 3,
    "gradeSemester": "四年级上"
  }
}
```

It may also return `wrongAnswerText`, `mistakeAnalysis`, `subject`, `errorType` and `source`. On failure, return `success: false` with `error`.

The target user’s grade rule under **Settings → General** applies. Fixed mode uses the selected value, or the current account grade when unset. AI mode uses `gradeSemester` from the recognition result, stored in Chinese (for example, `四年级上` or `初二下`); return `null` when uncertain. If the field is omitted, the app makes one short AI grade request for a non-duplicate question, counted toward that user’s daily limit. A quota or recognition failure fails that item; inspect the per-item results.

## Interpreting results

| Result | How to tell |
| --- | --- |
| All succeeded | HTTP `201`, `success: true` |
| Some items failed, including when all recognitions failed | HTTP `207`, `success: false`; check `failCount` and `results` |
| Authentication or request format error | HTTP `400`, `401`, `404` and so on; read the error response |
| Duplicate question | The item can still be a success and includes fields such as `duplicate`, `mistakeRecorded` and `errorItemId` |

Do not judge the batch by the HTTP status alone; handle every item in `results`, and avoid blindly retrying the whole batch, or successful questions may be recorded as wrong again.

Source: [batch import route](https://github.com/margrop/wrong-notebook/blob/main/src/app/api/openclaw/batch-upload/route.ts).
