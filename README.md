<p align="center">
  <img src="public/icons/icon.png" width="128" height="128" alt="智能错题本应用图标">
</p>

# Smart Wrong Notebook (智能错题本)

**简体中文** | [English](README.en.md)

[![GitHub downloads](https://img.shields.io/github/downloads/margrop/wrong-notebook/total?label=downloads&logo=github)](https://github.com/margrop/wrong-notebook/releases) [![npm downloads](https://img.shields.io/npm/d18m/wrong-notebook?label=npm%20downloads&logo=npm)](https://www.npmjs.com/package/wrong-notebook) [![GitHub stars](https://img.shields.io/github/stars/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/stargazers) [![GitHub forks](https://img.shields.io/github/forks/margrop/wrong-notebook?logo=github)](https://github.com/margrop/wrong-notebook/forks)

[![桌面版](https://img.shields.io/badge/%E6%A1%8C%E9%9D%A2%E7%89%88-Windows%20%7C%20macOS%20%7C%20Linux-informational)](https://github.com/margrop/wrong-notebook/releases) [![Android](https://img.shields.io/badge/Android-34A853?logo=android&logoColor=white)](https://github.com/margrop/wrong-notebook/releases) [![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://github.com/margrop/wrong-notebook/pkgs/container/wrong-notebook) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/wrong-notebook) [![飞牛OS](https://img.shields.io/badge/%E9%A3%9E%E7%89%9BOS-fpk-0A84FF)](https://github.com/margrop/wrong-notebook/releases) [![Web](https://img.shields.io/badge/Web-PC%20%7C%20Mobile-orange)](https://wrong-notebook-demo.margrop.net)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![Release](https://img.shields.io/github/v/release/margrop/wrong-notebook?include_prereleases)](https://github.com/margrop/wrong-notebook/releases) [![CI](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/ci.yml) [![CodeQL](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml/badge.svg)](https://github.com/margrop/wrong-notebook/actions/workflows/codeql.yml) [![npm](https://img.shields.io/npm/v/wrong-notebook)](https://www.npmjs.com/package/wrong-notebook)

一个基于 AI 的智能错题管理系统：拍照或输入题目后，由 AI 识别、解答、打知识点标签并评定难度，支持错题本管理、举一反三练习、组卷打印和掌握程度跟踪。

**⬇️ [下载安装包](https://wrong-notebook.margrop.net/download/)** · **🚀 [在线演示](https://wrong-notebook-demo.margrop.net)**（账号 `demo@localhost`，密码 `demo123456`） · **🌐 [项目介绍页](https://wrong-notebook.margrop.net/)** · **📖 [使用文档（Wiki）](https://github.com/margrop/wrong-notebook/wiki)**

> 演示站点为共享账号，数据对所有访客可见，请勿录入个人信息。介绍文章：[别让错题本变成抄题本：我给孩子用的 AI 错题本开源了](https://blog.margrop.net/post/wrong-notebook-ai-family-learning/) · [不用先配 API Key：接上 MiniMax 免费账号](https://blog.margrop.net/post/wrong-notebook-minimax-free-ai-review/)

## 🌟 亮点

- **🤖 AI 识题与讲解**：拍照、截图或输入文字，AI 识别题目、生成答案和解析，分析错因，打知识点标签并评定 1～5 星难度。
- **🔊 会说话的 SVG 动画讲解**：AI 把解题思路做成分步骤动画并逐步语音讲解，画面等语音读完再进入下一步。语音有两种选择：

  | 语音 | 效果 | 费用 |
  | :--- | :--- | :--- |
  | 浏览器本地语音（Web Speech） | 由设备自带的语音朗读，听起来比较生硬，音色因设备而异 | 免费 |
  | 云端 TTS 语音（MiniMax、千问、智谱 GLM-TTS、阶跃星辰、火山引擎豆包语音、火山引擎 Agent Plan、OpenAI） | 声音自然，与真人讲题无异，所有设备音色一致 | 需要付费，**建议购买 Token Plan 等套餐**，比按量付费划算；火山引擎有[免费试用额度](https://docs.volcengine.com/docs/ark/free-inference-quota?lang=zh)，可参考文档自行开通 |

- **🆓 免费账号就能用**：选择「MiniMax Code OAuth」渠道，用 MiniMax Code 账号网页登录即可使用，不需要购买 API Key，应用每天自动签到领取积分（见 [MiniMax Code OAuth](#minimax-code-oauth)）；火山引擎新用户也有[免费推理额度](#火山引擎免费试用)。
- **📚 复习闭环**：举一反三变式题自动判题、AI 评估掌握概率、艾宾浩斯间隔的今日复习、按错题组卷打印并回填结果。
- **📦 多平台安装**：Docker 镜像（amd64 / arm64）、npm、Windows、macOS、Linux、飞牛OS、安卓手机与平板（单机版或客户端），也可添加到手机主屏幕（PWA）。

> 本仓库 fork 自 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)，在其基础上增加了上述及下文列出的大部分功能。

## ⭐ Star 增长趋势

<a href="https://www.star-history.com/#margrop/wrong-notebook&amp;Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date&amp;theme=dark">
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date">
    <img src="https://api.star-history.com/svg?repos=margrop/wrong-notebook&amp;type=Date" alt="margrop/wrong-notebook 的 GitHub Star 增长趋势图">
  </picture>
</a>

## 🖼️ 功能预览

以下截图采集自实际运行的应用（2026-10-20），展示已有题目、讲解和试卷。用户名已遮挡，可点击图片查看大图。

**错题管理**：在同一页面查看题目摘要、难度星级和知识点，按年级、学期、掌握情况及 A/B 卷筛选，也可通过题目 ID 定位、比较相似度或批量打印。列表按需加载卡片数据，原图、答案和解析在详情或打印预览时读取，减少翻页时的数据传输。错题列表支持用地址参数预设掌握状态（`?mastery=new|reviewing|mastered`）和知识点标签（`?tag=标签名`）筛选。

![错题本中的真实题目卡片、难度星级、知识点标签与筛选入口](doc/screenshots/notebook.png)

<details>
<summary><strong>录入与偏好：拍照上传、文字录入、人工确认和可配置判重</strong></summary>

首页提供拍照上传、手动输入、导入题库文件和直接录入入口，支持拖拽图片与剪贴板粘贴。手机上有「拍照」「相册」「从文件选择」三个独立入口：拍照直接打开相机，相册中找不到的照片可从文件选择。

「导入题库文件」支持 JSON（题目交换格式 v1）、Word（.docx）、Excel（.xlsx）、CSV 与 PDF 题库文件，解析后展示摘要（题数、错误原因、警告、暂未导入字段），选择目标错题本后按批次进入导入中心，可「按原样入库」不调用 AI；一次最多导入 2000 题。导入页可下载 Excel / CSV 模板。TXT / Markdown 文件仍在「手动输入」中经「从文件导入」填入文字框。PDF 必须带文字层；扫描版 PDF 可选择页码范围（单次最多 20 页）转为图片，由 AI 识别分题导入，每页消耗一次 AI 分题额度。带文字层的 PDF 默认给每道题按版面区域截图作为题目原图（可改为只截有图形的题或不保存），公式与图形不会因文字层乱码而丢失。

直接录入和人工校对保存失败时，页面会保留具体原因及处理建议，区分 AI 年级识别、字段长度或卷别校验、登录状态、数据库迁移与写入权限、网络或代理等问题。AI 年级识别失败时，可手动填写年级或改用固定年级后再保存；超时或断网后先确认错题本中是否已保存，避免重复提交。

![首页的拍照上传、手动输入、直接录入、剪贴板粘贴和截屏入口](doc/screenshots/upload.png)

通用设置可调整导入前人工确认、录入题目的年级识别规则（固定年级或 AI 识别）、SVG 动画讲解、GeoGebra 动态演示、题目判重相似度阈值和已掌握阈值。卷别分组（A卷/B卷/其他）可在设置中自定义名称、新增分组（如单元测试、期中、期末）、停用或删除自定义分组。

![通用设置中的导入确认、动画讲解、GeoGebra 和判重阈值](doc/screenshots/preferences.png)

</details>

<details>
<summary><strong>题目详情：公式排版、难度星级、知识点和试题信息</strong></summary>

一道错题集中展示题干、知识点、年级学期与试卷等级；点击「编辑年级/学期」可调整归属，校对页也可手工选择，可核对原题图片，并从详情页进入举一反三。

![真实错题详情中的公式、难度星级、知识点和年级学期信息](doc/screenshots/question-detail.png)

</details>

<details>
<summary><strong>SVG 动画讲解：把解题思路变成分步骤的动态演示，并配语音讲解</strong></summary>

下图为已有六边形染色题的动画讲解，展示区域关系与递推计数过程；播放器支持暂停、拖动进度、重播和全屏。点击喇叭开启语音讲解：浏览器本地语音免费但较生硬，云端 TTS 语音自然、与真人无异（需付费，建议购买 Token Plan 等套餐）。

![六边形染色题的 SVG 动画讲解、递推计数表与播放控制](doc/screenshots/svg-animation.png)

</details>

<details>
<summary><strong>复习反馈：回看变式题、作答历史和 AI 掌握概率</strong></summary>

原题下汇总举一反三和试卷作答结果，展开记录可回看变式题与答案。AI 根据实际作答历史评估掌握概率，辅助安排后续复习。

![已有试卷变式题、先错后对的作答历史与 AI 掌握概率评估](doc/screenshots/mastery-history.png)

</details>

<details>
<summary><strong>组卷与打印：针对错题生成试卷，做完后按题回填结果</strong></summary>

生成的试卷保留来源题目 ID，并展示各次作答结果，方便回到原题跟踪复习效果。

![已生成的真实错题试卷、来源 ID 和多次作答结果](doc/screenshots/exam.png)

打印预览可选择包含答案页，并设置每题下方的留白：按题型自动（填空、选择、判断题少留，解答题按小问数多留），或固定为不留白、小、中、大，也可在单题下方手动调节留白高度（调整后自动保存，下次打印直接沿用）；逐行排列的选择题选项按长度自动横排为 4 列、2 列或 1 列，单独成行的作答横线上方留出书写空间；支持下载 HTML、打印或通过浏览器保存为 PDF。

![真实试卷的打印预览、来源 ID、答案页开关和导出入口](doc/screenshots/exam-print.png)

</details>

<details>
<summary><strong>知识点库：按学科、年级、章节逐级浏览</strong></summary>

标准标签库按教学层级组织知识点。知识点已并入「统计」栏目：「知识点」页签顶部可切换标签体系（导入其他标签体系后显示切换器），中部展示使用频率 Top 20（按标签体系和学科分别计数，不同体系或学科的同名知识点不合并），下方可浏览标准标签库、增删自定义标签（均按所选体系显示和添加）。

![数学知识点按四年级、几何图形、角和四边形逐级展开](doc/screenshots/knowledge-tags.png)

</details>

<details>
<summary><strong>学习统计：查看错题分布、掌握率、练习正确率和趋势</strong></summary>

错题统计展示累计错题、待复习、复习中、已掌握数量及掌握率，附三段式复习状态进度条、科目分布和趋势图；支持按时间范围（近 7 天 / 近 30 天 / 近 6 个月 / 全部）和学科筛选。筛选某个学科后，点击待复习 / 复习中 / 已掌握卡片可直接跳转到该错题本中对应状态的错题列表（地址栏带 `?mastery=` 参数，错题列表按此参数预设筛选）。趋势图按粒度显示每日或月度，包含「新增」与「新掌握」两个系列：新增是每桶内创建的错题数，新掌握是最近一次掌握评估时间落在该桶内的已掌握错题数（近似口径，以最近一次评估时间作为掌握时间；这类错题可能创建于范围之前，因此不受创建时间范围限制）。对比两个系列可以直观看出错题本是在变少还是越积越多。没有数据时显示引导去录入错题，加载失败时可重试。

错题统计页签在科目分布与趋势图下方还有「错因分布」卡片：上半部分按作答状态（不会做 / 做错了 / 未判断）展示环形图与占比，下半部分按错误类型展示横向条形列表（名称 + 数量 + 进度条），错误类型为自由文本，仅显示数量前 7 个，其余合并为「其他」；尚未填写错误类型时显示提示文案。统计同样受当前时间范围与学科筛选约束。

错题统计页签在错因分布右侧还有「难度分布」卡片：按难度星级（1~5 星）展示每个难度的总错题数与已掌握数，已掌握部分以不同颜色叠加显示；未评定的错题也会单独列出。没有任何已评星错题时该卡片不显示。

错题统计页签在概览与进度条下方还有「薄弱知识点」排行：按未掌握错题数、近期练习错误率排序，列出最需要巩固的知识点 Top 10。每行展示排名、知识点名称、所属学科、未掌握/总数、近期正确率（无记录时显示「近期未练习」）和未掌握占比进度条；点击一行可跳转到对应错题本并按该知识点筛选的错题列表（地址栏带 `?tag=` 参数）。排行只统计当前时间范围内、当前学科筛选下的错题，近期正确率口径与练习统计一致（近 30 天 result 为 correct/wrong 的记录，排除重复导入产生的记录）。

![真实错题数量、掌握率、科目分布和月度趋势图表](doc/screenshots/error-stats.png)

练习统计单独展示累计练习、正确率（答对数 / 已作答数）和活跃天数，并按学科、难度观察练习分布与趋势；同样支持时间范围和学科筛选；没有数据时显示引导去复习，加载失败时可重试。练习统计页签顶部还有「学习日历」热力图，以 GitHub 风格方格展示最近 26 周每天的学习活动（录入错题 + 练习次数），顶部和左侧分别标注月份与星期，并显示当前连续天数、最长连续天数和累计活跃天数；录入错题也算活动，所以没有练习记录时热力图也能显示。练习统计页签最下方还有「反复错题目」榜：列出所选范围内做错 2 次以上的题目 Top 10（含举一反三、试卷、手动录入与重复导入的做错记录），每行显示题干预览、学科、出错次数、最近出错日期和复习状态，点击可跳到对应错题详情，提示重点复习；没有数据时显示一句简短提示。

![真实练习次数、正确率、活跃月份与练习趋势图表](doc/screenshots/practice-stats.png)

</details>

## ✨ 主要功能

### 录入与识别

- **📷 多种录入方式**：上传图片、从剪贴板粘贴（Ctrl/⌘+V）、屏幕截图，或直接输入题目文字（支持 Markdown 和 LaTeX）；图片可裁剪（支持滚轮、双指捏合或按钮缩放图片，方便精确框选），也可在一张图上框选多道题批量导入。
- **🤖 AI 识别与解答**：识别题目文字、答案、解析、学生的错误解答和错因，判断学科，并从知识点库中选择标签。可在「设置 → 通用」中开启「导入前人工确认」，先在校对页修改再保存。
- **📷 照片格式与压缩**：按文件内容识别真实格式（扩展名写错也能识别），支持 JPG、PNG、WebP、HEIC/HEIF。浏览器能解码 HEIC 时直接使用（如 Safari），不能时自动加载解码组件，在裁剪前转换为 JPEG 并按照片的旋转信息摆正；无法解码时提示具体原因。裁剪预览使用缩略图，最终从原图裁剪，输出按最长边 4096、约 490 万像素、1.5MB 共同限制，JPEG 质量不低于 0.8，体积超出时缩小尺寸而不是继续降低质量，避免题目小字和公式模糊。读取、转换、裁剪压缩、上传、AI 识别和保存各阶段显示实际用时，百分比为阶段估算。
- **🧩 多题录入**：「手动输入」中一次粘贴多道题时，按题号自动分题（本地规则，不调用 AI），选项、小问和阅读材料留在所属题内，标题、姓名/日期栏等不计入题目；编号像同一道题的小问时默认按一道题处理，没有题号的多题可选「用 AI 分题」；题号有误（如 OCR 认错）导致本地分错时，也可点「分得不对？用 AI 分题」。一道题分在几张纸上时，单题裁剪中点「下一段在另一张」暂存这一段，再拍下一张接着框选，各段按顺序上下拼成一张图识别（最多 4 段）。拍照时选择「自动分题」，由支持图片输入的模型识别照片中的每道题及其在原图上的位置。分题结果先在预览页确认：可选择/取消、编辑、在光标处拆分、合并、调整顺序、删除、撤销，照片题可在原图上调整区域；一道题接到下一页时，可在这道题（标为可能被截断的题和每页最后一题）上点「下一页接着这题」，拍下一页后把这道题在本页的部分放在下一页上方拼成一张图，再自动分题为下一批，本批移出这道题；文字题可点「AI 修正文字」删去混入的草稿、修正 OCR 错字，修正结果逐字标出删改，逐题接受后才替换原文（改动或新增数字的结果不采用）；确认后才逐题解析（照片按区域裁剪后与单题拍照走同一识别流程），按「导入前人工确认」直接入库或逐题校对。已选的题都带答案时还可选「按原样入库」：不调用 AI、不消耗额度，题目按草稿中的题干、答案、解析等字段直接保存。整批在「识别任务」中显示为「一批 N 题」，刷新、锁屏或关闭页面后都能找回；失败的题可单独重试，已完成的不会重复调用 AI 或重复入库。
- **📮 识别任务**：拍照或框选的题目上传后由服务器识别，任务和结果保存在数据库中，不依赖原页面连接。上传完成即可离开页面、锁屏或继续使用应用；页头「识别任务」入口显示识别中数量和未读结果，回到前台立即刷新，可继续校对、查看错题或重试失败任务。开启「导入前人工确认」时结果保存为待校对草稿，关闭时服务器识别后直接入库（判重、年级和卷别规则与手动保存一致），重复提交或重复确认不会重复入库。服务重启后已完成的结果仍可打开，处理中被中断的任务显示为失败并可重试；待校对和失败的任务会一直保留到处理，已保存的任务保留 7 天。
- **🎓 录入年级规则**：在「设置 → 通用」按账户选择固定年级或 AI 识别。固定模式使用指定年级学期，未指定时沿用账户当前年级；AI 模式根据题目内容判断，无法确定时保持未设置。图片、文字、框选批量与 Openclaw 录入统一生效，手工选择优先。直接录入未填年级时会补充一次 AI 识别并计入每日用量，重复题不重复识别；已有题目和备份恢复的年级不受影响。
- **🔁 重复题判定**：导入时比较题干相似度，超过阈值（默认 90%，可在设置中调整）的题目不会重复导入，而是在原题下记一次做错。
- **🆔 题目 ID**：每道题有 6 位 ID，可复制，也可在错题本中输入 ID 直接打开该题；打印的错题和试卷都标有「来源 ID」，方便做完后定位原题录入结果。

### 题目内容

- **∑ LaTeX 公式**：题目、答案和解析中的公式用 KaTeX 显示，支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`；编辑时可在「源代码 / 预览」之间切换。检测到公式语法错误时，详情页出现「修复 LaTeX」按钮，由 AI 只修复公式写法。
- **📝 重新生成解答**：详情页「重新生成完整解答」由 AI 重新生成答案和解析（覆盖前二次确认），知识点和错因保持不变。
- **🖼️ 题目配图**：识别时由 AI 用 SVG 重绘题目配图，详情页、打印和试卷都使用 SVG 配图；有配图的错题可在详情页设置「配图显示比例」（10%～200%，默认 100%）与「配图显示位置」（居左/居中/居右，默认居中），含配图的试卷也支持按题逐个调整或全卷统一调整配图比例与显示位置，保存后同步用于显示和打印，并随备份恢复。拍照原图可在「查看原题图片」中核对，也可替换或补充上传。
- **⭐ 难度星级**：导入时由 AI 参考《高思学校竞赛数学导引》的星级标准评定 1~5 星（一二星为课本及校内拔高，三四星为常规奥数，五星为竞赛压轴），可手动修改；4 星及以上默认归入 B 卷。
- **🏷️ 知识点标签**：错题本创建时选择学段（小学/初中/高中）和学科（创建后不可修改），小学支持数学、英语和语文；内置语文章节与知识点覆盖小学一年级至六年级及初高中。本错题本内的题目由 AI 从该学段、该学科的全部知识点中选择标签；支持自定义标签，单题或整本错题本可让 AI 重新识别知识点和难度。管理员可在「设置 → 用户管理 → 人教版课标知识点」上传 [cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy) 的 [topics.json](https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json)，导入「人教版课标体系」（以数学为主，也包含语文、英语、物理、历史、地理、道德与法治，约 2800 个知识点）；导入后创建错题本时可选择标签体系，与内置体系并存，创建后不可更改。

### 讲解与演示

- **🎬 SVG 动画讲解**：AI 按解题思路生成分步骤的 SVG 动画，打开页面或切换动画时停在首帧，点击播放后才开始；支持播放/暂停、拖动进度、重播和全屏；动画文字与界面语言一致，中英文版本分别保存，切换语言时自动显示对应版本。默认开启，可在「设置 → 通用」中关闭。
- **🔊 语音讲解**：点击播放器上的喇叭开启，画面等语音读完再进入下一步，语速可调。语音可选浏览器本地语音或云端 TTS（见[云端语音讲解](#-云端语音讲解)）；旧动画没有讲解稿时朗读画面字幕，也可点击「补充讲解稿」由 AI 只补写讲解稿，画面保持不变。
- **📐 GeoGebra 动态演示**：数学、物理题可由 AI 生成交互式 GeoGebra 图形。默认关闭，可在「设置 → 通用」中开启。
- 已生成的动画讲解和 GeoGebra 演示都可删除（需二次确认）。

### 复习与练习

- **🔄 举一反三**：基于错题生成同知识点的变式题（填空或解答题），可选难度；提交答案后自动判题（不要求过程且结论一致时本地判对，证明或说明理由题交给 AI 核验论证，其余情况由 AI 对照标准答案判定并给出依据），保存前可修改结果；每道错题暂存最近一次生成的变式题与解答，再次进入时直接显示，需要新题再点「重新生成」。
- **📈 掌握概率**：根据举一反三和试卷的作答历史，由 AI 评估每道题的已掌握概率。错题分为三种状态：没有举一反三记录的为「待复习」，有记录且掌握概率低于已掌握阈值的为「复习中」，达到阈值的为「已掌握」。阈值默认 50%，每个用户可在设置中单独调整。
- **📅 今日复习**：按 1、2、4、7、15、30 天的艾宾浩斯间隔安排每道错题的复习，做对进入下一轮间隔，做错从头开始。导航栏的「复习」页列出今天到期的错题（最早到期的在前），首页显示今日待复习数量。
- **🧾 错题试卷**：按错题本、知识点、题型和掌握情况随机抽题，可选择「举一反三」（AI 生成新题）或「原题直出」（直接使用原题，不消耗 AI 额度，立即可打印）；可打开「同时生成 A/B 卷」一次生成两份题目互不重复的平行卷；每道题可单独设置分值，试卷自动汇总总分，详情页可开启「按题型分大题」按选择题、填空题等分组排版；做完后可按题录入结果，结果计入原题的作答历史。
- **🖨️ 错题打印**：筛选后打印错题，可选打印题目文字或原图、答案、解析、知识点，调节图片比例以及全局/单题留白高度（单题留白自动保存），选择题选项按长度自动横排，可直接打印或保存为 PDF。

### 管理与统计

- **🔍 多维度筛选**：按掌握状态、时间范围、知识点、题型、年级学期、试卷等级等条件筛选，支持批量操作和两题相似度比较；选中的错题可导出为 JSON、Excel 或 Word（Excel 列与题库导入模板一致，可往返导入）。
- **📊 数据统计**：错题与练习的掌握率、趋势和学科分布，支持时间范围与学科筛选。错题列表支持用地址参数预设掌握状态（`?mastery=new|reviewing|mastered`）和知识点标签（`?tag=标签名`）筛选。
- **⏳ 后台任务**：页面右下角的按钮可查看识别、AI 生成、动画语音生成、批量标注、组卷等耗时事务的进度；离开页面后事务仍在服务器上继续。拍照识别的结果另在「识别任务」中持久保存。
- **💾 数据导入导出**：在「设置」中导出或导入数据备份，包含错题本、错题、系统及自定义标签、练习与作答记录、试卷、个人偏好和已合成的云端语音；标签按体系和父子路径还原，不同年级下的同名章节与知识点分别保留，题目恢复到具体标签节点。账户凭据和 AI 配置不在备份中。
- **🌗 深色模式**：顶部导航栏的主题按钮可在「自动（跟随系统）」「浅色」「深色」之间切换，默认自动。偏好按用户保存在账号中，换设备登录也保持一致。
- **🕒 应用时区**：默认北京时间，管理员可修改，日期显示与统计都按应用时区计算，详见 [时区说明](doc/TIME_ZONE.md)。
- **🔑 一次性初始化链接**：全新安装不再预置固定密码的管理员。服务首次启动时生成只能使用一次的初始化链接，打开后自行设置管理员邮箱和密码：桌面版、安卓单机版自动打开；飞牛OS 直接在安装向导中填写管理员邮箱和密码；Docker、npm、源码运行打印在启动日志中（也可在数据目录的 `config/setup-token` 中找到令牌）。从旧版本升级的实例保留原有账号。
- **🛡️ AI 数据授权**：每个账号首次使用前会看到授权说明，列出发送给第三方 AI 服务商的数据和当前服务商，同意后才会发送；不同意时 AI 功能不可用，其他功能照常使用，可在「设置 → 账户」中随时撤回。
- **🧭 安装向导**：管理员首次登录时进入向导：修改默认密码（仅旧版本的默认管理员需要）→ 配置 AI 渠道（推荐免费的 MiniMax Code）→ 创建第一个错题本，后两步可跳过；可在「设置 → 用户管理」中重新运行。已在使用的实例升级后不会自动弹出。
- **🔐 多用户与管理后台**：支持注册、登录，数据按用户隔离；新用户注册默认关闭（关闭时登录页不显示注册入口，改为提示联系管理员），管理员可在「设置 → 用户管理」中开启，并可限制每人每天的 AI 使用次数、查看今日调用次数和 token 用量；管理员可在「设置 → 用户管理」进入管理后台，查看使用统计，启用/禁用或删除用户；普通用户可在「设置 → 危险」中输入密码注销自己的账号，账号及全部数据随之永久删除（管理员不能自助注销）。登录和注册带失败次数限制，防止暴力破解密码。
- **📈 匿名遥测与使用协议**：管理员在初始化时同意[使用协议](doc/EULA.md)（飞牛OS 在安装向导中勾选），实例默认每 6 小时向错题本收集服务发送一批匿名的功能使用统计和错误指纹，不含用户或实例标识、IP、题目内容、AI 对话或错误原文；存量实例升级后默认不外发，管理员登录时可从提示横幅查看协议后开启。「设置 → 用户管理 → 隐私与遥测」可关闭外发、开启本地记录（只保存在本机，供排查问题）、改为自建收集服务，并查看本实例收集了什么；设置 `TELEMETRY_DISABLED=true` 强制全部关闭。协议升级后管理员需重新同意，期间暂停外发，普通用户不受影响。详见[隐私说明](doc/PRIVACY.md)与[设计](doc/TELEMETRY_DESIGN.md)。
- **🐞 调试日志**：遇到问题时，管理员在「设置 → 用户管理」中打开调试模式，复现问题后导出调试日志（JSON）发给作者。调试模式下记录包括 debug 级别在内的全部服务端日志和前端错误，导出时自动去除 API Key、密码和令牌；日志只保存在内存中，24 小时后自动关闭，服务重启后清空。
- **🔌 Openclaw 集成**：外部 Openclaw agent 可通过 `POST /api/openclaw/batch-upload` 批量上传题目图片，配置见[环境变量](#-环境变量)。

## 🚀 快速开始

按上手难度从易到难排列。全新安装没有默认账号：首次启动时会生成一次性初始化链接，打开后设置管理员邮箱和密码，再进入安装向导配置 AI 渠道、创建第一个错题本。桌面版、安卓单机版会自动打开该链接；Docker 用 `docker logs wrong-notebook 2>&1 | grep initialize` 查看；npm、源码运行打印在终端里。链接中的主机为 `localhost` 时，从其他设备访问需换成服务器地址（或设置 `NEXTAUTH_URL`）。尚未创建管理员时，登录页也会显示这些说明。

### 方式一：安装包（Windows / macOS / Linux / 飞牛OS / 安卓 / npm）

从[下载页](https://wrong-notebook.margrop.net/download/)（自动识别系统与架构）或 [Releases](https://github.com/margrop/wrong-notebook/releases) 下载对应安装包，安装后直接打开：

| 平台 | 安装包 |
| :--- | :--- |
| Windows | `WrongNotebook-Win-Setup-<版本>-x64.exe`（安装版）、`WrongNotebook-Win-Portable-<版本>-x64.exe`（免安装） |
| macOS | `WrongNotebook-Mac-<版本>-arm64.dmg`（Apple 芯片）、`WrongNotebook-Mac-<版本>-x64.dmg`（Intel） |
| Linux | `WrongNotebook-Linux-<版本>-<架构>.AppImage`、`.deb` |
| 飞牛OS | `WrongNotebook-FnOS-<版本>-x86.fpk`、`WrongNotebook-FnOS-<版本>-arm.fpk` |
| 安卓手机 / 平板（单机版） | `WrongNotebook-Android-Phone-<版本>.apk`（竖屏）、`WrongNotebook-Android-Tablet-<版本>.apk`（横竖屏自动旋转） |
| 安卓手机 / 平板（客户端） | `WrongNotebook-Android-Client-Phone-<版本>.apk`、`WrongNotebook-Android-Client-Tablet-<版本>.apk` |

Windows 的 [Code signing policy（代码签名政策）](doc/CODE_SIGNING.md)与[隐私说明](doc/PRIVACY.md)已公开。项目已通过 SignPath Foundation 审核，正在用测试证书接入，取得生产证书前发布的 Windows 安装包仍未签名。维护者接入步骤见 [Windows 签名配置](doc/WINDOWS_SIGNING.md)。

> **macOS 首次打开被拦截**：安装包只有本地自签名（ad-hoc），未经 Apple 公证。把应用拖入「应用程序」后双击，系统提示无法打开时，到「系统设置 → 隐私与安全性」点击「仍要打开」。若仍提示「已损坏」（旧版本安装包常见），在终端执行以下命令移除隔离属性并在本机重新签名，再打开即可：
>
> ```bash
> xattr -cr /Applications/WrongNotebook.app
> codesign --force --deep --sign - /Applications/WrongNotebook.app
> ```

也可以通过 npm 安装（Node.js 22 及以上）：

```bash
npm install -g wrong-notebook
wrong-notebook --port 3000
```

安卓单机版内置服务端，安装后直接使用，数据保存在本机（卸载 App 会删除数据；数据含 API Key，不参与系统备份，卸载或换机前请在设置中导出备份）；需要 Android 8.0 及以上的 64 位 ARM 设备。两个版本都由系统的 Android System WebView 显示界面，需要 WebView 111 及以上，版本过旧时页面顶部会提示升级（没有 Google Play 的手机可在手机自带的应用商店升级）。客户端版不内置服务端，首次打开时填写已部署的服务器地址（如 `http://192.168.1.10:3000`），可在「设置 → 关于」中更换服务器，需要 Android 7.0 及以上。两种 App 都支持拍照上传、导出文件和系统打印，可以同时安装。数据目录、默认账号、本地构建方法见 [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md)。

### 方式二：Docker 镜像部署（推荐用于服务器 / NAS）

每次发版都会把镜像发布到 GitHub Container Registry：`ghcr.io/margrop/wrong-notebook`，支持 `linux/amd64` 和 `linux/arm64`，可直接拉取，不需要源码。

| 镜像标签 | 说明 |
| --- | --- |
| `2026.10.20` 等精确版本 | 推荐，升级时可控 |
| `2026.10` | 当月最新版本 |
| `latest` | 最新正式版本 |

1. **准备目录和密钥**：

   ```bash
   mkdir -p wrong-notebook/data wrong-notebook/config
   cd wrong-notebook
   openssl rand -base64 32   # 生成的字符串用作 NEXTAUTH_SECRET
   ```

2. **启动容器**（任选一种）：

   ```bash
   docker run -d --name wrong-notebook \
     --restart always \
     -e NEXTAUTH_SECRET="上一步生成的密钥" \
     -e NEXTAUTH_URL="http://你的IP或域名:3000" \
     -p 3000:3000 \
     -v "$(pwd)/data:/app/data" \
     -v "$(pwd)/config:/app/config" \
     ghcr.io/margrop/wrong-notebook:latest
   ```

   或下载仓库中的 [`docker-compose.yml`](docker-compose.yml) 放到当前目录，修改 `NEXTAUTH_SECRET`（及 `NEXTAUTH_URL`）后执行 `docker compose up -d`。

3. **登录**：访问 `http://你的IP或域名:3000`。

4. **升级**：拉取新镜像并重建容器，数据保留在挂载目录中，启动时执行数据库迁移并增量补齐内置语文标签，保留已有标签 ID 和题目关联。升级前建议先备份 `data/` 目录。

   ```bash
   docker compose pull && docker compose up -d
   # 使用 docker run 时：docker pull 新镜像后 docker rm -f wrong-notebook，再执行上面的 docker run
   ```

数据保存在挂载的 `data/`（SQLite 数据库）和 `config/`（网页中保存的 AI 配置、云端语音缓存等）目录。设置页「关于」和 `/api/health` 显示当前运行的版本。HTTPS 部署见 [HTTPS 配置指南](doc/HTTPS_SETUP.md) 和 `docker-compose.https.yml`。

> 上游项目的镜像 `ghcr.io/wttwins/wrong-notebook` **不包含**本仓库新增的功能，请使用 `ghcr.io/margrop/wrong-notebook`。

### 方式三：本地源码运行

1. **环境准备**：Node.js 22 及以上（推荐 24）和 npm。
2. **克隆并安装依赖**：

   ```bash
   git clone https://github.com/margrop/wrong-notebook.git
   cd wrong-notebook
   npm ci
   cp .env.example .env   # 按「环境变量」一节填写
   ```

3. **初始化数据库**：创建表结构和管理员账户，再导入系统知识点（与 Docker 构建时相同）：

   ```bash
   npx prisma migrate dev
   npx prisma db seed
   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts
   ```

4. **启动开发服务器**：`npm run dev`，访问 `http://localhost:3000`。

### 方式四：从源码构建镜像

需要修改代码或使用未发布的改动时，可以自行构建。构建过程中会在镜像内运行全部测试，并完成生产构建：

```bash
docker build -t wrong-notebook:local .

docker run -d --name wrong-notebook \
  -e NEXTAUTH_SECRET="your_secret_key" \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/config:/app/config" \
  wrong-notebook:local
```

使用 `docker-compose.yml` 时，把其中的 `image` 改为 `wrong-notebook:local` 即可。

## ⚙️ AI 与语音配置

AI 配置在网页中修改，保存后立即生效，无需重启：

1. 管理员点击首页右上角的设置图标，打开「AI 设置」。
2. 选择提供商，填写 API Key、Base URL（或 Endpoint）、模型（或部署名称）。提供商下方附有官方接入文档，「API Key」「模型名称」旁附有获取说明和模型列表链接。
3. 点击「测试连接」检查文本与图片识别能力，失败时会显示服务商的原始报错；保存后配置写入 `config/app-config.json`，优先于 `.env`。
4. 同一页下方的「语音讲解」切换浏览器语音或云端语音；「提示词」页可自定义识别和举一反三的提示词模板。

AI 设置、提示词、连接测试和模型列表只对管理员开放；普通用户在「设置 → 通用」中只能修改自己的偏好。

计算题核对等价答案，证明和说明理由题检查必要论证；不要求过程且结论能直接比对时才本地判对，其他情况交给 AI 判定。

GeoGebra 的文字、不等式和标签参数按共用命令清单校验，重新生成时附带实际执行错误反馈。

应用统一保留输出协议、字段语言、年级范围及候选知识点约束，旧自定义模板遗漏变量时也会补齐。识别保留原题和学生作答原文，解析与错因分析跟随界面语言，学科、年级和知识点存储值不翻译；AI 返回的知识点会按候选清单过滤并去重，手工添加的标签不受影响。掌握度评估携带本次评估时间和练习间隔。

### 支持的 AI 提供商

国产大模型官方渠道通过各家的 OpenAI 兼容接口调用，只需填写 API Key，Base URL 和模型留空时使用下表默认值；使用国际站时改填国际站地址。

| 提供商 | 推荐方式 | 默认 Base URL | 默认模型 |
| :--- | :--- | :--- | :--- |
| MiniMax | [MiniMax 开放平台](https://platform.minimax.cn) | `https://api.minimax.cn/v1`（国际站 `https://api.minimax.io/v1`） | `MiniMax-M3.1-Flash` |
| MiniMax Code OAuth | **免费账号**，网页登录，见[下文](#minimax-code-oauth) | 固定接口 | `MiniMax-M3.1-Flash` |
| 智谱 GLM | [智谱开放平台](https://open.bigmodel.cn) | `https://open.bigmodel.cn/api/paas/v4`（国际站 `https://api.z.ai/api/paas/v4`） | `glm-5.3-flash` |
| DeepSeek | [DeepSeek 开放平台](https://platform.deepseek.com) | `https://api.deepseek.com` | `deepseek-v4-flash` |
| Kimi | [Kimi 开放平台](https://platform.kimi.com) | `https://api.moonshot.cn/v1`（国际站 `https://api.moonshot.ai/v1`） | `kimi-k3.1-pro` |
| 千问 Qwen | [阿里云百炼](https://bailian.console.aliyun.com)，推荐 Token Plan | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（按量付费 `https://dashscope.aliyuncs.com/compatible-mode/v1`） | `qwen3.8-max` |
| 阶跃星辰 StepFun | [阶跃星辰开放平台](https://platform.stepfun.com)，推荐 Step Plan | `https://api.stepfun.com/step_plan/v1`（按量付费 `https://api.stepfun.com/v1`，国际站 `https://api.stepfun.ai/v1`） | `step-5-preview` |
| 火山引擎 豆包 | [火山方舟](https://console.volcengine.com/ark)，按量付费 | `https://ark.cn-beijing.volces.com/api/v3`（国际站 `https://ark.ap-southeast.bytepluses.com/api/v3`） | `doubao-seed-evolving` |
| 火山引擎 Agent Plan | [Agent Plan](https://ark.volcengine.com/region:cn-beijing/docs/82379/2160841?lang=zh) 专属 Key，套餐含豆包语音合成 | `https://ark.cn-beijing.volces.com/api/plan/v3` | `doubao-seed-evolving` |
| 火山引擎 Coding Plan | [Coding Plan](https://www.volcengine.com/docs/82379/1928261)，方舟 API Key | `https://ark.cn-beijing.volces.com/api/coding/v3`（不要改成 `/api/v3`，否则不计入套餐） | `doubao-seed-evolving` |
| 火山引擎（免费试用） | 新用户**免费推理额度**，见[下文](#火山引擎免费试用) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-evolving` |
| Anthropic 及兼容接口 | [Claude Console](https://platform.claude.com/) | `https://api.anthropic.com`（不含 `/v1`） | `claude-sonnet-5-5` |
| Azure OpenAI | Azure 门户 → OpenAI 资源 → 密钥和终结点 | 填写资源 Endpoint 和部署名称 | 部署名称 |
| OpenAI 及兼容接口 | [OpenAI Platform](https://platform.openai.com/api-keys)，可添加多个配置并切换 | `https://api.openai.com/v1` | `gpt-6.1-sol` |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | 官方地址 | `gemini-2.5-flash`（推荐 `gemini-3.8-flash`） |

> **兼容接口**：OpenAI 提供商可接入任何 OpenAI API 格式的第三方服务（如硅基流动），Anthropic 提供商可接入兼容 Messages API 的服务；把 Base URL 改为服务商地址，模型填写对应平台的完整模型 ID。推理模型返回的思考内容会被自动忽略。

#### MiniMax Code OAuth

**支持免费版 MiniMax 账号**：用 MiniMax Code 账号网页登录，不需要 API Key，也不需要开通付费套餐。

- **每天自动签到**：登录后应用每天自动签到，领取 MiniMax Code 的签到积分（连续签到奖励更多），不用手动打开客户端。
- **消耗免费积分**：识题、解析、举一反三、判题等 AI 调用消耗的是账号的免费积分额度；剩余积分随时可在设置页查看。
- **默认模型 `MiniMax-M3.1-Flash`**：已实测可用，支持图片识别；也可选 `MiniMax-M3`、`MiniMax-M2.7` 等。

使用方法：在“设置 → AI 设置”中选择 MiniMax Code OAuth，点击“网页登录”，在打开的 MiniMax 页面完成授权即可；设置页会显示登录状态、剩余积分和今天是否已自动签到。

登录凭据保存在服务端配置目录的 `minimax-code.json`（与 `app-config.json` 同目录，不随数据备份导出），Access Token 到期前自动续期。登录后服务每小时检查一次，当天（北京时间）还没签到时自动领取 MiniMax Code 的签到积分，也可以在设置页关闭自动签到或手动立即签到。该渠道使用 MiniMax Code 桌面客户端的登录方式（OAuth 设备码授权），不是官方开放接口，MiniMax 可能随时调整或限制；请遵守 MiniMax 的服务条款。

#### 火山引擎（免费试用）

注册火山引擎即可获得每个模型的[免费推理额度](https://www.volcengine.com/docs/82379/1399514)（官方文档为每个模型 50 万 tokens）。在火山方舟控制台的「开通管理」中开启「安心体验模式」后，调用只消耗免费额度，额度接近用完时自动暂停，不会产生费用。选择「火山引擎（免费试用）」渠道并填写方舟的 API Key 即可；额度用完后如需继续使用，完成实名认证并改用「火山引擎 豆包」或对应的套餐渠道。

### 🔊 云端语音讲解

动画的语音讲解默认使用浏览器本地语音（免费，但较生硬）。管理员可在「设置 → AI 设置 → 语音讲解」改用云端 TTS 语音（声音自然，与真人无异）：

| 云端语音 | API Key | 默认模型 / 音色 |
| :--- | :--- | :--- |
| MiniMax（建议 M Plan） | 与 MiniMax 渠道共用 | `speech-2.8-hd` / `male-qn-jingying` |
| 千问（建议 Token Plan） | 与千问渠道共用 | `qwen-audio-3.0-tts-plus` / `longanlufeng` |
| 智谱 GLM-TTS（建议 GLM Coding Plan） | 与智谱 GLM 渠道共用 | `glm-tts` / `xiaochen` |
| 阶跃星辰（建议 Step Plan） | 与阶跃星辰渠道共用 | `stepaudio-2.5-tts` / `qingniandaxuesheng` |
| 火山引擎豆包语音（可免费试用，建议资源包） | 单独的豆包语音 API Key | `seed-tts-2.0` / `zh_male_yangguangqingnian_uranus_bigtts` |
| 火山引擎 Agent Plan（计入套餐额度） | 与 Agent Plan 渠道共用 | `seed-tts-2.0` / `zh_male_yangguangqingnian_uranus_bigtts` |
| OpenAI | 可单独填写，留空时用当前 OpenAI 配置 | `gpt-4o-mini-tts` / `cedar` |

- 默认音色为年轻男声，自然、清晰、略带科技感，不用播音腔；模型、音色和接口地址都可修改，各字段旁附有说明文档或音色列表链接，「保存并试听」会先保存再朗读一段示例。
- 服务端把合成结果统一到约 -15 LUFS 的响度，编码为 MP3 缓存，同一段讲解只合成一次；开启语音时一次合成整个动画的讲解并登记为后台任务，已生成语音的动画打开时默认开启语音讲解，已有动画可「重新生成语音」。
- 合成的语音随数据导出、导入备份；云端语音失败时自动改用浏览器语音。合成消耗语音服务商额度，不计入每人每日的 AI 次数。

各服务商的接口说明见 Wiki 的 [AI 配置 · 云端语音讲解](doc/wiki/AI-Configuration.md#云端语音讲解)。

### 模型要求

所选模型需要满足以下条件，否则部分功能无法使用或效果较差：

| 要求 | 用到的功能 | 说明 |
| :--- | :--- | :--- |
| **支持图片输入（多模态）** | 拍照/截图识别题目、照片自动分题、AI 重新生成配图、有原图时的重新生成解答 | 纯文本模型只能使用文字录入，识别图片会失败 |
| **能写准确的 SVG 代码** | 题目配图、举一反三和试卷新题的配图、SVG 动画讲解 | 这些「图片」都由模型输出 SVG 代码生成，**不调用图片生成模型**；模型的几何作图和 SVG 动画（SMIL）能力决定配图与动画的质量 |
| **较长的单次输出** | SVG 动画讲解、识别题目（含配图）、多题分题等 | 每次调用都直接按模型允许的最大输出请求（已知模型用官方上限，未知模型用 262144（256K），接口报超限时自动读出模型上限再试并记住），推理模型的思考过程也计入输出；模型的最大输出不足 16K 时，动画讲解容易生成失败。按 `max_tokens` 预扣额度的中转网关（如 NewAPI）需要账户余额足以覆盖预扣 |
| **严格遵循输出格式** | 所有 AI 功能 | 结果按 `<answer_text>`、`<svg_animation>` 等标签或 JSON 解析，格式不符会提示「AI 返回格式异常，可能模型不兼容」 |
| **规范的 LaTeX** | 题目、答案、解析 | 公式须能被 KaTeX 显示；出现语法错误时可用详情页的「修复 LaTeX」修正 |
| **较强的数学推理** | 解答、错因分析、难度星级、掌握概率评估 | 推理（思考）模型可以使用，思考内容会被自动忽略；思考耗时较长时，管理员可在「设置 → 通用」中调大「AI 分析超时时间」 |

## 🔧 环境变量

常用环境变量如下，完整列表见下方折叠表格和 [`.env.example`](.env.example)。AI 相关配置也可以登录后在网页中填写，网页中保存的配置优先。

| 环境变量 | 说明 |
| :--- | :--- |
| `NEXTAUTH_SECRET` | Session 加密密钥，生产环境必须设置，可用 `openssl rand -base64 32` 生成 |
| `NEXTAUTH_URL` | 部署后的访问地址，如 `http://your-domain:3000` |
| `DATABASE_URL` | SQLite 数据库路径；源码默认 `file:./dev.db`，Docker 默认 `file:/app/data/dev.db` |
| `AI_PROVIDER` | AI 提供商，默认 `minimax`，取值见完整列表 |
| `<提供商>_API_KEY` | 对应提供商的 API Key，如 `MINIMAX_API_KEY`、`QWEN_API_KEY`、`OPENAI_API_KEY` |
| `TTS_MODE` | 动画语音讲解的朗读方式，默认 `browser`（浏览器本地语音） |
| `ALLOW_REGISTRATION` | 是否开放注册，默认 `false` |
| `AI_DAILY_LIMIT` | 普通用户每天的 AI 次数，默认 `0`（不限制） |
| `AI_CONCURRENCY_LIMIT` | 同一模型同时进行的 AI 调用上限，默认 `5`，超出的排队 |

<details>
<summary><strong>完整环境变量列表</strong></summary>

**基础配置**

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | 数据库连接地址 | 源码 `file:./dev.db`；Docker `file:/app/data/dev.db` | SQLite 数据库路径 |
| `NEXTAUTH_SECRET` | Auth 密钥 | 无 | 用于加密 Session，生产环境必须设置，可用 `openssl rand -base64 32` 生成 |
| `NEXTAUTH_URL` | 访问地址 | 无 | 部署后的访问地址，如 `http://your-domain:3000` |
| `AUTH_TRUST_HOST` | 信任主机头 | Docker 镜像中为 `true` | 为 `true` 时根据请求自动推断访问地址，适合 Docker/反向代理 |
| `LOG_LEVEL` | 日志级别 | 开发 `debug` / 生产 `info` | 可选 `trace`、`debug`、`info`、`warn`、`error`、`fatal`，详见 [日志指南](doc/LOGGING_GUIDE.md) |
| `DEBUG_DB` | SQL 日志 | `false` | 为 `true` 时输出数据库查询日志 |
| `HTTP_PROXY` / `HTTPS_PROXY` | 代理 | 无 | 访问 AI 服务时使用的代理 |
| `TELEMETRY_DISABLED` | 关闭匿名遥测 | `false` | 为 `true` 时强制关闭本地记录、错误回报与外发，设置界面只读，适合演示站和内网合规场景 |
| `ALLOW_REGISTRATION` | 允许注册 | `false` | 为 `true` 时默认开放注册；管理员在「设置 → 用户管理」中保存的开关优先 |
| `AI_DAILY_LIMIT` | 每人每日 AI 次数 | `0`（不限制） | 普通用户每天可发起的 AI 操作次数，管理员不受限制；「设置 → 用户管理」中保存的值优先 |
| `AI_CONCURRENCY_LIMIT` | 同一模型 AI 并发上限 | `5` | 同一渠道、地址和模型同时进行的 AI 调用数量（1～100），超出的调用排队等待，避免服务商返回 429；「设置 → 用户管理」中保存的值优先 |
| `TTS_MODE` | 动画语音讲解的朗读方式 | `browser` | `browser` 为浏览器本地语音；`minimax`、`qwen`、`glm`、`stepfun`、`volcengine`、`volcengine-agent`、`openai` 为云端语音，复用对应渠道的 API Key（豆包语音使用 `VOLCENGINE_TTS_API_KEY`，OpenAI 使用当前激活的 OpenAI 配置）。「设置 → AI 设置 → 语音讲解」中保存的值优先 |

**AI 配置**（网页中保存的配置优先于环境变量）

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `AI_PROVIDER` | AI 提供商 | `minimax` | 可选 `minimax`、`minimax-code`、`glm`、`deepseek`、`kimi`、`qwen`、`stepfun`、`volcengine`、`volcengine-agent`、`volcengine-coding`、`volcengine-free`、`anthropic`、`azure`、`openai`、`gemini` |
| `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` / `MINIMAX_MODEL` | MiniMax | 地址 `https://api.minimax.cn/v1`，模型 `MiniMax-M3.1-Flash` | 地址和模型可留空 |
| `MINIMAX_CODE_MODEL` | MiniMax Code 模型 | `MiniMax-M3.1-Flash` | 账号在网页设置中登录，无需 API Key |
| `MINIMAX_CODE_AUTO_CHECKIN` | MiniMax Code 每日自动签到 | `true` | 设为 `false` 关闭 |
| `GLM_API_KEY` / `GLM_BASE_URL` / `GLM_MODEL` | 智谱 GLM | 地址 `https://open.bigmodel.cn/api/paas/v4`，模型 `glm-5.3-flash` | 地址和模型可留空 |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | DeepSeek | 地址 `https://api.deepseek.com`，模型 `deepseek-v4-flash` | 地址和模型可留空 |
| `KIMI_API_KEY` / `KIMI_BASE_URL` / `KIMI_MODEL` | Kimi | 地址 `https://api.moonshot.cn/v1`，模型 `kimi-k3.1-pro` | 地址和模型可留空 |
| `QWEN_API_KEY` / `QWEN_BASE_URL` / `QWEN_MODEL` | 千问 Qwen | 地址 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（百炼 Token Plan），模型 `qwen3.8-max` | 按量付费的 Key 改填 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `STEPFUN_API_KEY` / `STEPFUN_BASE_URL` / `STEPFUN_MODEL` | 阶跃星辰 StepFun | 地址 `https://api.stepfun.com/step_plan/v1`（Step Plan 套餐），模型 `step-5-preview` | 按量付费改填 `https://api.stepfun.com/v1`，国际站 `https://api.stepfun.ai/v1` |
| `VOLCENGINE_API_KEY` / `VOLCENGINE_BASE_URL` / `VOLCENGINE_MODEL` | 火山引擎 豆包 | 地址 `https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-evolving` | 按量付费；订阅 Agent Plan 等套餐时选择对应的套餐渠道；国际站 `https://ark.ap-southeast.bytepluses.com/api/v3` |
| `VOLCENGINE_AGENT_API_KEY` / `VOLCENGINE_AGENT_BASE_URL` / `VOLCENGINE_AGENT_MODEL` | 火山引擎 Agent Plan | 地址 `https://ark.cn-beijing.volces.com/api/plan/v3`，模型 `doubao-seed-evolving` | Agent Plan 管理页的专属 API Key；套餐含豆包语音合成 |
| `VOLCENGINE_CODING_API_KEY` / `VOLCENGINE_CODING_BASE_URL` / `VOLCENGINE_CODING_MODEL` | 火山引擎 Coding Plan | 地址 `https://ark.cn-beijing.volces.com/api/coding/v3`，模型 `doubao-seed-evolving` | 方舟 API Key；不要改成 `/api/v3`（不计入套餐）；套餐不含语音合成 |
| `VOLCENGINE_FREE_API_KEY` / `VOLCENGINE_FREE_BASE_URL` / `VOLCENGINE_FREE_MODEL` | 火山引擎（免费试用） | 地址 `https://ark.cn-beijing.volces.com/api/v3`，模型 `doubao-seed-evolving` | 新用户免费推理额度，开启「安心体验模式」后用完自动暂停 |
| `VOLCENGINE_TTS_API_KEY` | 豆包语音 API Key | 无 | 云端语音选择火山引擎豆包语音时使用，与火山方舟的 Key 不同 |
| `ANTHROPIC_API_KEY` | Anthropic API Key | 无 | 从 [Claude Console](https://platform.claude.com/) 获取 |
| `ANTHROPIC_BASE_URL` | API 地址 | `https://api.anthropic.com` | 兼容服务填写不含 `/v1` 的地址 |
| `ANTHROPIC_MODEL` | 模型 | `claude-sonnet-5-5` | 如 `claude-opus-5-5`、`claude-haiku-5-5` |
| `AZURE_OPENAI_API_KEY` | Azure API Key | 无 | 从 Azure 门户获取 |
| `AZURE_OPENAI_ENDPOINT` | Azure Endpoint | 无 | 如 `https://xxx.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | 部署名称 | 无 | Azure 中配置的部署名称 |
| `AZURE_OPENAI_API_VERSION` | API 版本 | `2024-02-15-preview` | |
| `AZURE_OPENAI_MODEL` | 模型名称 | `gpt-4o` | 仅用于显示 |
| `OPENAI_API_KEY` | OpenAI API Key | 无 | 从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 |
| `OPENAI_BASE_URL` | OpenAI API 地址 | `https://api.openai.com/v1` | 使用兼容服务时填写其地址 |
| `OPENAI_MODEL` | OpenAI 模型 | `gpt-6.1-sol` | 兼容服务填写对应平台的模型 ID |
| `GOOGLE_API_KEY` | Gemini API Key | 无 | 从 [Google AI Studio](https://aistudio.google.com/apikey) 获取 |
| `GEMINI_BASE_URL` | Gemini API 地址 | 官方地址 | 通常无需修改 |
| `GEMINI_MODEL` | Gemini 模型 | `gemini-2.5-flash` | 推荐 `gemini-3.8-flash` |

**Openclaw 集成**（可选）

| 环境变量 | 描述 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `OPENCLAW_API_URL` | Openclaw agent 地址 | 无 | 本地部署的 Openclaw agent 服务地址 |
| `OPENCLAW_API_KEY` | Openclaw API 密钥 | 无 | 调用 Openclaw agent 时使用 |
| `OPENCLAW_TIMEOUT` | 超时（毫秒） | `30000` | |
| `OPENCLAW_AUTH_MODE` | 认证方式 | `credentials` | `credentials`（用户名密码）或 `apikey` |
| `OPENCLAW_INTEGRATION_API_KEY` | 本系统 API 密钥 | 无 | 仅 `apikey` 模式需要，供 Openclaw 调用本系统，可用 `openssl rand -hex 32` 生成 |

新增环境变量时需同步更新 `.env.example`。

</details>

## 📚 更多

### PWA（添加到主屏幕）

可将应用添加到手机或平板主屏幕，全屏运行、点击图标直接打开，平板可横屏使用。

- **iPhone / iPad (Safari)**：点击底部 **分享** 按钮 → 选择 **"添加到主屏幕"**。
- **Android (Chrome)**：点击右上角 **菜单** → 选择 **"添加到主屏幕"** 或 **"安装应用"**；也可以安装[安卓 App](#方式一安装包windows--macos--linux--飞牛os--安卓--npm)。

通过 HTTPS（或 `localhost`）访问时会启用 Service Worker：缓存页面脚本、样式和图标以加快打开速度，断网时显示离线提示页。题目、统计等数据始终从服务器读取，不做离线缓存。

### 屏幕截图（需要 HTTPS）

屏幕截图依赖浏览器的安全上下文（HTTPS）。在 Docker 或局域网环境中使用时，请参考 **[HTTPS 配置指南](doc/HTTPS_SETUP.md)** 启用内置 HTTPS 支持。

### 技术栈

- **框架**：[Next.js 16](https://nextjs.org/)（App Router）+ [React 19](https://react.dev/) + TypeScript
- **数据库**：[SQLite](https://www.sqlite.org/)（via [Prisma 5](https://www.prisma.io/)）
- **样式**：[Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)（shadcn/ui 风格组件）
- **公式**：[KaTeX](https://katex.org/)（react-markdown + remark-math）
- **AI**：MiniMax / MiniMax Code（网页登录）/ 智谱 GLM / DeepSeek / Kimi / 千问 Qwen / 阶跃星辰 StepFun / 火山引擎豆包（含 Agent Plan、Coding Plan、免费试用）/ Anthropic（及兼容接口）/ Azure OpenAI / OpenAI（及兼容接口）/ Google Gemini
- **认证**：[NextAuth.js v4](https://next-auth.js.org/)
- **测试**：Vitest（单元、集成）、Playwright（E2E）

### 开发与测试

```bash
npm run lint                # ESLint（出现警告即失败）
npm run test:unit           # 单元测试
npm run test:integration    # 集成测试
npm test                    # 全部 Vitest 测试
npm run test:coverage       # 测试覆盖率（低于最低要求时失败）
npm run test:e2e            # 隔离应用、正式迁移测试库与本地模型服务，无需真实 API Key
bash scripts/ci.sh          # 完整 CI（Node.js 22+、Python 3，含生产构建）
```

GitHub 的 `main` 与 PR CI 还会使用正式 Dockerfile，在原生 amd64、arm64 环境中验证镜像内的测试和生产构建，检查通过后不推送镜像。`.dockerignore` 保留单元测试复用的 `e2e/support` 模块；浏览器用例和测试产物仍排除在构建上下文外。

E2E 启动器会在系统临时目录复制应用和依赖、执行正式迁移、生成测试账号并完成生产构建，随后使用本地固定模型响应运行浏览器用例。不会读取现有应用配置、复用开发服务器或访问外部模型。报告路径在命令结束时输出；可用 `npm run test:e2e -- --grep E2E-M01` 筛选用例。用例与运行边界见 [E2E 设计与验收](doc/E2E_MOCK_AI_TEST_DESIGN.md)。

修改 `prisma/schema.prisma` 后使用 `npx prisma migrate dev --name <名称>` 生成正式迁移并提交；迁移须兼容已有数据。更多开发约定见 [AGENTS.md](AGENTS.md)。

### 实用脚本

`scripts/` 目录下提供维护和调试脚本，例如：

- **重置密码**：`node scripts/reset-password.js <邮箱> <新密码>`
- **恢复默认管理员角色**：`node scripts/seed-admin.js`（只为已有的 `admin@localhost` 恢复管理员角色并启用；没有任何管理员时，重启服务会在日志中打印新的初始化链接）
- **重建系统知识点**：`npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/rebuild-system-tags.ts`（保留自定义标签和题目关联；生产环境操作前请先备份）
- **补齐语文知识点**：`npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-chinese-primary.ts`（与主课程数据共用来源，只增量补齐内置语文体系及更新课程排序，保留标签 ID、题目关联、自定义标签和其他体系；可重复执行）。Docker 和安装包启动时自动执行编译后的 `dist-scripts/scripts/seed-chinese-primary.js`，旧安装无需重建全部标签。
- **导入人教版课标知识点**：与「设置 → 用户管理 → 人教版课标知识点」相同的命令行方式。先下载 [topics.json](https://raw.githubusercontent.com/xiaoyang111222/cn-math-taxonomy/HEAD/data/topics.json) 到 `scripts/data/cn-math-taxonomy-topics.json`，再执行 `npx tsx scripts/seed-cnm-tags.ts`（也可把文件路径作为参数传入；作为独立的 `cnm` 标签体系增量导入，不影响内置体系和已有题目，可重复执行）。
- **检查数据库**：`node scripts/check-db-users.js`、`node scripts/check-db-data.js`

### 文档

使用、部署和常见问题见 [Wiki](https://github.com/margrop/wrong-notebook/wiki)（另有 [English](https://github.com/margrop/wrong-notebook/wiki/Home-en) 版）。专项文档：

| 文档 | 内容 |
| :--- | :--- |
| [INSTALL_PACKAGES.md](doc/INSTALL_PACKAGES.md) | npm、桌面版、飞牛OS、安卓安装包与构建 |
| [HTTPS_SETUP.md](doc/HTTPS_SETUP.md) | HTTPS 配置（屏幕截图需要） |
| [TIME_ZONE.md](doc/TIME_ZONE.md) | 应用时区 |
| [LOGGING_GUIDE.md](doc/LOGGING_GUIDE.md) | 日志 |
| [MARKDOWN_GUIDE.md](doc/MARKDOWN_GUIDE.md) | Markdown 与公式 |
| [TABLE_RECOGNITION.md](doc/TABLE_RECOGNITION.md) | 表格识别 |
| [PROJECT_OVERVIEW.md](doc/PROJECT_OVERVIEW.md)、[operational_flow.md](doc/operational_flow.md) | 项目结构与操作流程（部分内容早于本仓库新增功能） |
| [release-guide.md](doc/release-guide.md) | 版本发布 |
| [BRANCH_WORKFLOW.md](doc/BRANCH_WORKFLOW.md) | 公开主线与上传前检查 |
| [setup-wsl-network.md](doc/setup-wsl-network.md) | WSL 网络配置 |

## 💬 交流与贡献

使用中遇到问题、想分享用法或提建议，欢迎加入 QQ 群 **964325781**，或用 QQ 扫描下方二维码。Bug 和功能需求仍建议提交到 [Issues](https://github.com/margrop/wrong-notebook/issues)，方便跟踪处理；在群里发截图前请隐去孩子姓名、学校、账号和访问地址。

<img src="doc/images/qq-group.webp" alt="智能错题本用户交流 QQ 群二维码，群号 964325781" width="240">

也可以在 X 上关注作者 [@MargropMe](https://x.com/MargropMe)，获取更新动态或私信交流。

欢迎提交 Issue 和 Pull Request，请先阅读[贡献指南](CONTRIBUTING.md)和[行为准则](CODE_OF_CONDUCT.md)。提问和反馈方式见[获取帮助](SUPPORT.md)，安全漏洞请按[安全策略](SECURITY.md)私下报告。各正式版的改动见[更新日志](CHANGELOG.md)。

## 📄 许可证

[MIT License](LICENSE)

浏览器无法直接解码 HEIC/HEIF 照片时按需加载的转换组件 [heic-to](https://github.com/hoppergee/heic-to) 1.6.6 及其包含的 libheif、libde265 采用 LGPL-3.0，Emscripten 运行时代码采用 MIT/NCSA 双许可。第三方说明、完整许可证文本与对应源码和构建说明链接见 [`public/third-party-licenses/heic-to/`](public/third-party-licenses/heic-to/NOTICE.txt)，该目录随 Docker 镜像和各安装包一起分发，登录后也可在应用中访问 `/third-party-licenses/heic-to/NOTICE.txt`。

© 2026 margrop。本项目基于 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) 扩展，原项目代码版权归原作者所有。
