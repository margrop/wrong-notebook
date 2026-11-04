# 后台任务防重复机制

本文说明 wrong-notebook 中「同一操作目标的后台任务防重复触发」的通用机制与接入步骤。

## 已接入功能

| 功能 | 路由 | target |
| --- | --- | --- |
| AI 修正文字（分题预览） | `POST /api/import-batches/:id/fix-text` | `import-batch:<id>:fix-text` |
| 重新解答（错题详情页） | `POST /api/error-items/:id/reanswer` | `error-item:<id>:reanswer` |
| 修复 LaTeX（错题详情页） | `POST /api/error-items/:id/fix-latex` | `error-item:<id>:fix-latex` |
| 单题重新标注（错题详情页） | `POST /api/error-items/:id/retag` | `error-item:<id>:retag` |
| 重绘配图 | `POST /api/error-items/:id/figure` | `error-item:<id>:figure` |
| SVG 动画讲解 | `POST /api/error-items/:id/svg-animation` | `error-item:<id>:svg-animation:<语言>` |
| 讲解稿 | `POST /api/error-items/:id/svg-animation/narration` | `error-item:<id>:svg-narration:<语言>` |
| 云端语音 | `POST /api/tts/batch`（带错题 id 时） | `error-item:<id>:tts-voice:<语言>` |
| GeoGebra 演示 | `POST /api/error-items/:id/geogebra` | `error-item:<id>:geogebra` |
| 举一反三 | `POST /api/practice/generate` | `error-item:<id>:practice` |
| 试卷单题重新生成 | `POST /api/exams/:id/questions/:questionId/regenerate` | `exam-question:<id>:regenerate` |
| 试卷重试失败题目 | `POST /api/exams/:id/retry` | `exam-paper:<id>:generate` |
| 错题本批量重新标注 | `POST /api/notebooks/:id/retag` | `notebook:<id>:retag` |
| 备份数据导入 | `POST /api/import` | `user:<userId>:data-import` |

导入任务与批次的重试使用等效的独立机制（进程内 `register`/`isRunningHere` + 数据库条件更新抢占），重复触发不会重复扣额度或调用 AI，未按 target 接入。

未接入：`/api/reanswer`（录入校对页对未入库题目的文字解题）与 `/api/geogebra-analyze`（未保存草稿）没有稳定的对象标识；不带错题 id 的云端语音请求同理。

## 约定

- **target**：操作对象标识，格式 `<对象类型>:<id>:<动作>`，全小写、冒号分隔。
  例：`import-batch:abc123:fix-text`、`error-item:xyz:reanswer`、`error-item:xyz:svg-animation`。
- **同一用户同一 target**：同一时刻只允许一个 `running` 的后台任务。并发请求只有一个能预占成功；
  已结束后（成功或失败）可再次发起。
- **预占后必须收尾**：
  - 真正开始执行 → 用 `runReservedTask` 包装，自动 succeed/fail。
  - 因额度不足等原因未开始 → 调用 `handle.cancel()`，**不留任何记录**。


## 服务端接入（路由三步）

```ts
import { reserveBackgroundTask, runReservedTask } from "@/lib/background-tasks";
import { taskAlreadyRunning } from "@/lib/api-errors";

const TARGET = `import-batch:${id}:fix-text`;

// 1. 预占：同一 target 已有 running 任务时返回 null，并发请求只有一个成功
const handle = reserveBackgroundTask({ userId: user.id, kind: "fix_text", target: TARGET, subject, link });
if (!handle) {
    const running = findRunningTask(user.id, TARGET);
    return taskAlreadyRunning(running ?? { id: "", kind: "fix_text", startedAt: "", target: TARGET });
}

// 2. 额度：超额时 cancel 撤下预占，直接返回原有响应
const limited = await serializeWrite(() => consumeAiQuota(user, "split"));
if (limited) {
    handle.cancel();
    return limited;
}

// 3. 执行：runReservedTask 自动 succeed/fail
const settled = await runReservedTask(handle, () => Promise.allSettled(groups.map((g) => ai.fixQuestionText(g))));
```

要点：

- `reserveBackgroundTask` 的检查与登记之间没有 `await`，是同步的——并发请求只有一个成功。
- `cancel()` 只适用于「预占后未真正开始」；`runReservedTask` 已开始执行后请用 succeed/fail 收尾。
- 服务重启时还在 `running` 的任务已有的标记逻辑保持不变（标记为 `SERVER_RESTARTED` 失败），
  不会留下永久「进行中」的预占。

## 前端接入

```tsx
import { useRunningTask } from "@/lib/hooks/use-running-task";
import { backgroundTaskStore } from "@/lib/background-task-store";

const target = `import-batch:${batchId}:fix-text`;
const { running, refresh } = useRunningTask(target);

// 按钮禁用：本页 fixingKeys 或 useRunningTask(target).running
<Button disabled={fixing || !!running} onClick={onFix}>...</Button>
```

- `useRunningTask(target)` 与页面右下角的「后台任务」按钮共用同一份
  `backgroundTaskStore` 轮询结果（有 running 任务时 3 秒轮询、无任务时 15 秒、
  页面不可见时暂停），不会为每个按钮单独发起请求。
- 收到 `TASK_ALREADY_RUNNING`（409）时：调用 `backgroundTaskStore.refresh()`
  立刻取回 running 任务，提示「该操作正在进行中，请等待完成」，按钮自动进入等待状态。
- 任务结束时 `running` 从任务对象变为 `null`，调用方据此恢复按钮可用并刷新数据。

## 错误码

- `TASK_ALREADY_RUNNING`（HTTP 409）：body 中 `details.task` 附带原任务
  （`id`、`kind`、`startedAt`、`target`），前端可据 waitingTask.target 进入等待。
- 中英文文案在 `src/lib/i18n/zh.ts` 与 `src/lib/i18n/en.ts` 的 `errors.TASK_ALREADY_RUNNING`。

## 测试

- 服务端：`src/__tests__/unit/background-tasks.test.ts`（reserve/cancel/findRunningTask、
  并发唯一、不同用户/不同 target 互不影响、结束后可再次预占）、
  `src/__tests__/integration/background-tasks.test.ts`（/api/tasks 返回 target）。
- 前端：`src/__tests__/unit/background-task-store.test.ts`（轮询节奏、可见性暂停、refresh）、
  `src/__tests__/unit/use-running-task.test.tsx`（running 查询、结束置空、target=null 不请求）、
  `src/__tests__/unit/regenerate-figure-button.test.tsx`（代表性按钮：running 时禁用、结束后刷新数据、收到 409 进入等待）。


---

## Anti-duplication for background tasks (English)

The same user may only have one `running` background task per `target`
(`<object-type>:<id>:<action>`, e.g. `import-batch:abc123:fix-text`). Server routes
reserve with `reserveBackgroundTask` (synchronous check-and-register; only one concurrent
request wins), then consume AI quota, then wrap execution in `runReservedTask`. Call
`handle.cancel()` when aborting before starting (e.g. quota exceeded) — no failure record
is left behind. On the client, `useRunningTask(target)` shares a single polling result
with the background-tasks button via `backgroundTaskStore`; on `TASK_ALREADY_RUNNING` (409)
call `backgroundTaskStore.refresh()` and enter the waiting state. See the Chinese section
above for step-by-step code.
