# 智能错题本 Wiki

Smart Wrong Notebook（智能错题本）把拍照或文字录入的错题整理成可检索、可练习、可打印的题库，并结合实际作答历史跟踪掌握情况。

本 Wiki 面向 [margrop/wrong-notebook](https://github.com/margrop/wrong-notebook)，基于公开主线 [`93423c2`](https://github.com/margrop/wrong-notebook/commit/93423c2675b7965e688cb966f4f4cd78e2e636d2) 核对，更新日期为 2026-10-20。项目 fork 自 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook)，采用 MIT 许可证。English: [Wiki in English](Home-en).

![错题本的题目卡片、知识点和筛选入口](https://raw.githubusercontent.com/margrop/wrong-notebook/70b66950931f6f723083e3726fbc97f2f65d2ea8/doc/screenshots/notebook.png)

## 从这里开始

| 你想做什么 | 对应页面 |
| --- | --- |
| 在本机运行，完成首次登录 | [快速开始](Quick-Start) |
| 用 Docker 部署、启用 HTTPS 或升级 | [部署与升级](Deployment) |
| 配置 Gemini、OpenAI、Azure 或 Anthropic | [AI 模型配置](AI-Configuration) |
| 录入、整理、校对和检索错题 | [错题管理指南](User-Guide) |
| 举一反三、生成试卷、打印和回填结果 | [练习与组卷](Practice-and-Exams) |
| 调整偏好、应用时区和用户权限 | [设置与用户管理](Settings-and-Users) |
| 导出个人数据或备份整站 | [数据备份与恢复](Backup-and-Restore) |
| 从外部 Openclaw agent 批量导题 | [Openclaw 集成](Openclaw-Integration) |
| 了解代码结构、测试和贡献要求 | [开发与贡献](Development) |
| 排查登录、识别、公式或截图问题 | [常见问题](FAQ) |

## 主要能力

- 图片上传、剪贴板粘贴、文字录入、裁剪和多题框选；可先人工确认再保存。
- AI 识别题干、答案、解析、错因、学科、知识点与 1～5 星难度。
- 按题干相似度判重；重复录入时在原题下记录一次做错。
- Markdown、LaTeX、SVG 配图、SVG 动画讲解及可选的 GeoGebra 动态演示。
- 举一反三、错题组卷、作答历史、掌握概率、学习统计和打印导出。
- 多用户隔离、管理员设置、个人偏好与 Openclaw 批量导入。

## 推荐使用流程

1. [部署应用](Deployment)，用启动日志中的一次性初始化链接创建管理员账号。
2. [配置并测试 AI](AI-Configuration)，图片识别需要支持图片输入的模型。
3. 创建错题本，选定学段和学科，再[录入与校对题目](User-Guide)。
4. 通过[举一反三和试卷](Practice-and-Exams)复习，并回填作答结果。
5. 定期[导出个人数据并备份整站](Backup-and-Restore)。

## 项目入口

[源码](https://github.com/margrop/wrong-notebook) · [版本发布](https://github.com/margrop/wrong-notebook/releases) · [问题反馈](https://github.com/margrop/wrong-notebook/issues) · [项目介绍](https://blog.margrop.net/wrong-notebook-github-pages/)
