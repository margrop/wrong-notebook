# 更新日志

本文件记录各正式版的改动，由 `scripts/changelog.sh` 根据提交信息生成，请勿手动编辑。
预览版（`v年.月.日-n`）的改动见 [GitHub Releases](https://github.com/margrop/wrong-notebook/releases)，并归入其后的正式版。

## [2026.10.30](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.30) - 2026-10-30

### ✨ 新功能
- 云端语音支持 OpenAI
- 云端语音设置的 API Key 附上获取说明链接
- AI 设置的 API Key 与模型名称附上服务商文档链接
- 调整渠道默认模型：火山引擎套餐用 ark-code-latest，DeepSeek 用 deepseek-v4-flash，Kimi 用 kimi-k3.1-pro
- 增加火山引擎 Coding Plan 渠道
- 增加火山引擎 Agent Plan 渠道及其云端语音
- 增加火山引擎豆包渠道、火山引擎（免费试用）渠道及豆包语音
- 增加阶跃星辰 StepFun 渠道及其云端语音
- 云端语音支持智谱 GLM-TTS
- 动画语音的合成登记为后台任务，已生成语音的动画默认开启语音讲解
- 云端语音设置的模型、音色和接口地址附上服务商文档链接
- AI 设置附上各提供商的官方接入文档链接
- 测试连接和语音试听失败时显示服务商的原始报错
- 动画语音讲解支持云端语音（MiniMax、千问）
- 国产大模型官方渠道增加千问 Qwen
- 已有动画可单独补写语音讲解稿
- SVG 动画讲解支持语音朗读
- 已掌握阈值改为按用户独立配置，默认仍为 50%

### 🛠 修复
- 云端语音的音频接口禁止浏览器猜测内容类型
- 英文界面中残留的中文文字和全角标点
- 英文界面下 AI 提供商列表仍显示中文渠道名
- 等待朗读时画面停在换步过渡中显得模糊
- 耗时 AI 请求被浏览器中断后取回服务端的结果
- iPhone 上动画语音讲解没有声音
- iPhone 上生成动画或讲解稿时请求被中断后改为等待后台任务
- 裁剪弹窗只渲染 blob 与 data 图片地址
- E2E 准备脚本直接读取配置并处理文件不存在，消除先判断后读写的竞态

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.26...v2026.10.30

## [2026.10.26](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.26) - 2026-10-26

### ✨ 新功能
- 裁剪图片支持滚轮、双指捏合和按钮缩放
- 错题本列表去掉编辑和删除按钮，删除移到错题本详情页；题数改为「xx 题」
- 试卷生成完成显示为「已生成」，录入过结果后才显示「已完成」
- 新增管理员安装向导：修改默认密码、配置 AI 渠道、创建第一个错题本
- 管理员使用默认密码登录时强制先修改密码
- 知识点栏目并入统计中心，导航由 6 项精简为 5 项

### 🛠 修复
- 精简错题列表查询并按需加载打印数据

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.25...v2026.10.26

## [2026.10.25](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.25) - 2026-10-25

### ✨ 新功能
- MiniMax Code 每日自动签到，设置页显示今天是否已自动签到
- 新增 MiniMax Code OAuth 渠道，网页登录后调用 MiniMax-M3.1-Flash
- 新增每人每日 AI 次数限制，用户管理显示今日用量
- 新增今日复习，按艾宾浩斯间隔安排每道错题的复习
- 数据导出导入包含用户偏好设置
- 数据导出导入包含随机错题试卷、试卷题目及其作答记录
- 暂存每道错题最近一次生成的举一反三题目与解答，再次进入直接显示

### 🛠 修复
- 新用户注册默认关闭，可用 ALLOW_REGISTRATION 修改默认值
- 举一反三改为严格本地比对加 AI 判题，修复部分答案被误判为正确
- 补齐写死在界面中的中文文案，缺省回退统一改为英文
- 错题详情点击参考图片或我的答案图片时，放大显示的是题目原图
- 行内代码被渲染成代码块样式，打断题目和解析的正文
- Openclaw 批量上传校验图片 MIME 类型，仅接受 image/jpeg 与 image/png
- 升级 Next.js 16.4.3 与 zod 4.6.7，修复依赖安全漏洞
- 数据导入补齐 GeoGebra、SVG 动画、暂存练习和掌握概率等字段，导出格式升到第 2 版

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.23...v2026.10.25

## [2026.10.23](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.23) - 2026-10-23

### ✨ 新功能
- 错题复习状态改为待复习、复习中、已掌握三类
- 新增安卓单机版，APK 内置 Node.js 与服务端，无需部署服务器
- 新增安卓手机版、平板版客户端，发布时随 Release 提供 APK
- 完善 PWA，补齐多尺寸图标并加入 Service Worker 与离线页
- SVG 动画讲解绑定界面语言，中英文版本分别生成并随语言自动切换

### 🛠 修复
- SVG 净化循环内联到替换处，日志去换行改用标准写法，便于代码扫描识别
- 桌面版 Electron 升级到 42.11.3，修复多项已公开的安全漏洞
- 安卓 App 关闭系统备份，Bridge 只为本服务器页面执行操作
- HTTPS 代理与测试脚本日志去掉换行，防止伪造日志行
- 配置文件和会话密钥读写消除先判断后操作的竞态
- 题目配图 SVG 反复净化直到稳定，防止嵌套拼接出脚本
- 拉取模型列表只允许 http/https 地址，去掉末尾斜杠改用无回溯实现
- 升级 global-agent 4 与 KaTeX 0.19，修复依赖漏洞和 http 模块代理未生效
- 「关于」页链接指向本项目仓库，更新版权说明

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.22...v2026.10.23

## [2026.10.22](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.22) - 2026-10-22

### ✨ 新功能
- 默认 AI 渠道改为 MiniMax，OpenAI 和 Gemini 移至渠道列表末尾
- 新增 Kimi 官方大模型渠道，默认使用 kimi-k3
- 新增 DeepSeek 官方大模型渠道，默认使用 deepseek-flash
- 新增智谱 GLM 官方大模型渠道，默认使用 glm-5.3-flash
- 新增 MiniMax 官方大模型渠道，默认使用 MiniMax-M3.1-Flash
- OpenAI 渠道默认模型改为 gpt-6.1-sol
- AI 识别知识点时将题目与完整解答过程一并提交
- 精简安装包中的 Prisma 文件，飞牛OS 和桌面版体积减半

### 🛠 修复
- 补全错题本筛选与原题图片按钮的英文翻译

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.21...v2026.10.22

## [2026.10.21](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.21) - 2026-10-21

### ✨ 新功能
- 增加 npm、Windows、macOS、Linux、飞牛OS 全平台安装包

**完整变更**：https://github.com/margrop/wrong-notebook/compare/v2026.10.20...v2026.10.21

## [2026.10.20](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.20) - 2026-10-20

- 首个正式版本，此前的改动见 Git 提交历史

