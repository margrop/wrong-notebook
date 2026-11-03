import http from 'node:http';

export const DUMMY_KEY = 'e2e-dummy-key';
export const FIGURE = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" fill="none" stroke="black"/></svg>';

function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
}

/** 多题照片样例（src/__tests__/fixtures/images/multi-question-page.jpg）中各题的位置，按 0～1000 归一化 */
export const PAGE_QUESTIONS = [
    { label: '1', text: '如图，长方形 ABCD 的长和宽如图中所示，求它的面积是多少平方厘米？', regions: [{ x: 48, y: 197, w: 905, h: 350 }], hasFigure: true },
    { label: '2', text: '下列分数中，与 3/4 相等的是（　　）。A．6/8 B．4/6 C．9/16 D．5/7', regions: [{ x: 48, y: 590, w: 905, h: 105 }], hasFigure: false },
    { label: '3', text: '一根绳子长 24 米。（1）用去它的 1/4，用去多少米？（2）再用去 1/4 米，还剩多少米？', regions: [{ x: 48, y: 739, w: 905, h: 158 }], hasFigure: false },
];

/** 文字分题：按空行分段，每段是一题，只返回行号范围（与正式协议一致） */
function splitLines(lines) {
    const questions = [];
    let start = null;
    lines.forEach((line, index) => {
        if (line.text.trim()) {
            if (start === null) start = index + 1;
        } else if (start !== null) {
            questions.push({ label: null, lines: [start, index], material: null });
            start = null;
        }
    });
    if (start !== null) questions.push({ label: null, lines: [start, lines.length], material: null });
    return questions;
}

/**
 * 修正文字：删去以「草稿：」开头的行、把「公项」改为「公顷」；
 * 含「改数字」的题把 77 改成 78，用来验证应用会拒绝改动数字的建议
 */
function fixText(text) {
    let fixed = text.split('\n').filter((line) => !line.startsWith('草稿：')).join('\n').replaceAll('公项', '公顷');
    if (text.includes('改数字')) fixed = fixed.replaceAll('77', '78');
    return { text: fixed, uncertain: text.includes('公项') ? ['公项'] : [] };
}

function textOf(messages) {
    return messages.map((message) => typeof message.content === 'string' ? message.content :
        (message.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n')).join('\n');
}

export async function startMockAI() {
    const cases = new Map();
    const violations = [];
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname === '/health') return json(response, 200, { status: 'ok' });
            const control = url.pathname.match(/^\/control\/([^/]+)$/);
            if (control) {
                const id = control[1];
                if (request.method === 'POST') {
                    const chunks = [];
                    for await (const chunk of request) chunks.push(chunk);
                    const patch = JSON.parse(Buffer.concat(chunks).toString() || '{}');
                    const state = cases.get(id) || { id, calls: [], inflight: 0, held: [], partial: false, gradeError: false, hold: false, masteryProbability: 30, failNext: 0, distinctAnalysis: false };
                    // 控制接口只更新声明的标量字段，保持内部集合及对象原型不受请求体影响。
                    const allowed = new Set(['partial', 'gradeError', 'hold', 'masteryProbability', 'title', 'retry', 'failNext', 'distinctAnalysis']);
                    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !allowed.has(key))) {
                        return json(response, 400, { error: '不支持的场景控制字段' });
                    }
                    if (['partial', 'gradeError', 'hold', 'distinctAnalysis'].some((key) => patch[key] !== undefined && typeof patch[key] !== 'boolean') ||
                        (patch.masteryProbability !== undefined && (!Number.isFinite(patch.masteryProbability) || patch.masteryProbability < 0 || patch.masteryProbability > 100)) ||
                        (patch.title !== undefined && (typeof patch.title !== 'string' || patch.title.length > 500)) ||
                        (patch.retry !== undefined && (!Number.isInteger(patch.retry) || patch.retry < 0)) ||
                        (patch.failNext !== undefined && (!Number.isInteger(patch.failNext) || patch.failNext < 0 || patch.failNext > 100))) {
                        return json(response, 400, { error: '场景控制字段类型无效' });
                    }
                    if (patch.partial !== undefined) state.partial = patch.partial;
                    if (patch.gradeError !== undefined) state.gradeError = patch.gradeError;
                    if (patch.hold !== undefined) state.hold = patch.hold;
                    if (patch.masteryProbability !== undefined) state.masteryProbability = patch.masteryProbability;
                    if (patch.title !== undefined) state.title = patch.title;
                    if (patch.retry !== undefined) state.retry = patch.retry;
                    if (patch.failNext !== undefined) state.failNext = patch.failNext;
                    if (patch.distinctAnalysis !== undefined) state.distinctAnalysis = patch.distinctAnalysis;
                    if (!state.hold) state.held.splice(0).forEach((release) => release());
                    cases.set(id, state);
                }
                const state = cases.get(id);
                if (!state) return json(response, 404, { error: '场景不存在' });
                return json(response, 200, { ...state, held: state.held.length });
            }
            const match = url.pathname.match(/^\/cases\/([^/]+)\/v1\/(chat\/completions|models)$/);
            if (!match || !cases.has(match[1])) {
                violations.push({ path: url.pathname, reason: '未声明的场景或接口' });
                return json(response, 400, { error: { message: '未声明的模型请求', type: 'invalid_request_error' } });
            }
            if (request.headers.authorization !== `Bearer ${DUMMY_KEY}`) {
                violations.push({ path: url.pathname, reason: '认证不是固定假 Key' });
                return json(response, 401, { error: { message: '只接受测试假 Key', type: 'authentication_error' } });
            }
            if (match[2] === 'models') return json(response, 200, { object: 'list', data: [{ id: 'e2e-mock-model', object: 'model', owned_by: 'e2e', created: 0 }] });
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const body = JSON.parse(Buffer.concat(chunks).toString());
            const messages = body.messages || [];
            const text = textOf(messages);
            const system = typeof messages[0]?.content === 'string' ? messages[0].content : '';
            const image = messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'));
            const operation = system.includes('【分题输出协议】') ? 'split' : system.includes('【文字修正输出协议】') ? 'fix-text' : image ? 'analysis' : /"probability"/.test(system) ? 'mastery' : /"correct"/.test(system) ? 'grade' :
                system.includes('<mistake_status>内容') && !system.includes('<question_text>内容') ? 'reanswer' :
                /"gradeSemester"/.test(system) && !/question_text|"questionText"/.test(system) ? 'grade-recognition' : /question_text|"questionText"/.test(system) ? 'variant' : 'unknown';
            const marker = text.match(/E2E_[a-zA-Z0-9]+_[ABC]/)?.[0] || `E2E_${match[1].replace(/[^a-zA-Z0-9]/g, '')}_A`;
            const state = cases.get(match[1]);
            const call = { operation, marker, hasImage: image, completed: false, failed: false };
            state.calls.push(call);
            state.inflight++;
            try {
                if (state.hold && ['analysis', 'variant', 'split', 'reanswer'].includes(operation)) await new Promise((resolve) => state.held.push(resolve));
                // 固定上游失败：用于验证部分失败只重试失败的题
                if (state.failNext > 0 && ['analysis', 'reanswer'].includes(operation)) {
                    state.failNext--;
                    call.failed = true;
                    // 使用不会被 SDK 自动重试的状态码，确保失败真正交给应用处理
                    return json(response, 400, { error: { message: 'E2E 固定上游失败', type: 'invalid_request_error', code: 'e2e_failure' } });
                }
                if (operation === 'split') {
                    const user = JSON.parse(messages.find((message) => message.role === 'user') ? textOf(messages.filter((message) => message.role === 'user')) : '{}');
                    const content = image
                        ? { quality: 'clear', questions: PAGE_QUESTIONS }
                        : { questions: splitLines(user.data?.lines || []) };
                    return json(response, 200, { id: `e2e-${state.id}-${state.calls.length}`, object: 'chat.completion', created: 0, model: 'e2e-mock-model',
                        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                }
                if (operation === 'fix-text') {
                    const user = JSON.parse(textOf(messages.filter((message) => message.role === 'user')) || '{}');
                    const questions = (user.data?.questions || []).map((question) => ({ id: question.id, ...fixText(String(question.text || '')) }));
                    return json(response, 200, { id: `e2e-${state.id}-${state.calls.length}`, object: 'chat.completion', created: 0, model: 'e2e-mock-model',
                        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ questions }) }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                }
                if (operation === 'reanswer') {
                    const user = JSON.parse(textOf(messages.filter((message) => message.role === 'user')) || '{}');
                    const question = String(user.data?.questionText || '');
                    return json(response, 200, { id: `e2e-${state.id}-${state.calls.length}`, object: 'chat.completion', created: 0, model: 'e2e-mock-model',
                        choices: [{ index: 0, message: { role: 'assistant', content:
                            `<answer_text>E2E 答案：${question.slice(0, 12)}</answer_text><analysis>按题意逐步计算。</analysis><knowledge_points>一元一次方程</knowledge_points>` +
                            '<wrong_answer_text></wrong_answer_text><mistake_status>unknown</mistake_status><mistake_analysis></mistake_analysis>' +
                            '<subject>数学</subject><difficulty_stars>2</difficulty_stars><grade_semester>初二上</grade_semester>' }, finish_reason: 'stop' }],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
                }
                if (operation === 'unknown') {
                    violations.push({ caseId: state.id, reason: '无法识别的模型操作' });
                    return json(response, 400, { error: { message: '未声明的模型操作', type: 'invalid_request_error' } });
                }
                if ((state.partial && operation === 'variant' && marker.endsWith('_B')) || (state.gradeError && operation === 'grade')) {
                    call.failed = true;
                    return json(response, 400, { error: { message: 'E2E 固定上游失败', type: 'invalid_request_error', code: 'e2e_failure' } });
                }
                let payload;
                if (operation === 'mastery') payload = { probability: state.masteryProbability, reason: '测试夹具的固定掌握评估' };
                else if (operation === 'grade') payload = { correct: true, reason: '测试夹具判定：结论及论证完整' };
                else if (operation === 'grade-recognition') payload = { gradeSemester: '初二上' };
                else payload = {
                    // distinctAnalysis：每次图片识别返回不同题干（多题照片的各题），避免被判为重复题
                    questionText: operation === 'analysis'
                        ? (state.distinctAnalysis
                            ? `${PAGE_QUESTIONS[((state.analysisSeq = (state.analysisSeq || 0) + 1) - 1) % PAGE_QUESTIONS.length].text}${marker}`
                            : `求解方程 x + 2 = 5。${marker}`)
                        : `证明两个连续整数之和为奇数，并说明理由。${marker}变式`,
                    answerText: operation === 'analysis' ? 'x = 3' : '设整数为 n 与 n+1，其和为 2n+1，所以是奇数。',
                    analysis: '按定义列式并逐步推导。', subject: '数学', knowledgePoints: ['一元一次方程'],
                    difficultyStars: 3, gradeSemester: '初二上', requiresImage: false,
                    hasFigure: operation === 'variant', figureSvg: operation === 'variant' ? FIGURE : null,
                };
                return json(response, 200, { id: `e2e-${state.id}-${state.calls.length}`, object: 'chat.completion', created: 0, model: 'e2e-mock-model',
                    choices: [{ index: 0, message: { role: 'assistant', content: ['analysis', 'variant'].includes(operation) ?
                        `<question_text>${payload.questionText}</question_text><answer_text>${payload.answerText}</answer_text><analysis>${payload.analysis}</analysis>` +
                        `<subject>${payload.subject}</subject><knowledge_points>${payload.knowledgePoints.join(',')}</knowledge_points>` +
                        `<difficulty_stars>${payload.difficultyStars}</difficulty_stars><grade_semester>${payload.gradeSemester}</grade_semester>` +
                        `<requires_image>false</requires_image><has_figure>${payload.hasFigure}</has_figure><figure_svg>${payload.figureSvg || ''}</figure_svg>` : JSON.stringify(payload) }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
            } finally {
                call.completed = true;
                state.inflight--;
            }
        } catch (error) {
            violations.push({ reason: error instanceof Error ? error.message : String(error) });
            if (!response.headersSent) json(response, 500, { error: { message: '模拟服务处理失败', type: 'e2e_error' } });
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    return { origin: `http://127.0.0.1:${address.port}`, cases, violations,
        close: async () => { for (const state of cases.values()) state.held.splice(0).forEach((release) => release()); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}
