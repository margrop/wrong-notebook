# 隐私说明

[English](PRIVACY.en.md) · 更新日期：2026 年 10 月 30 日

## 适用范围与存储

wrong-notebook 是可自托管的错题本软件。桌面版在本机运行服务端；Docker、npm、飞牛OS 和源码部署的数据由相应实例的运营者管理；安卓客户端连接用户指定的实例。请按实际部署方式了解谁可以访问该实例的数据。

实例会保存使用功能所需的账号信息、密码哈希、题目文字与图片、答案、练习和试卷记录，以及个人偏好。数据库、上传文件、服务日志及配置保存在该实例的数据或配置目录；各平台路径见[安装包说明](INSTALL_PACKAGES.md)。浏览器诊断日志可能包含页面地址、浏览器标识、错误信息和操作上下文，并发送到同一实例的服务端。它们不会因此自动发送到项目维护者的服务器。

AI API Key、服务地址，以及用户主动连接 MiniMax Code 后的登录凭据保存在实例配置中。MiniMax Code 的 access token、refresh token、账号资料和签到结果保存在配置目录的 `minimax-code.json`。请妥善管理实例访问权限、配置和备份。

## 第三方服务

- 使用 AI 识别、解答、生成练习、动画等功能时，会将任务所需的题目、图片、答案或提示词发送给管理员配置的 AI 服务商及接口。是否使用这些功能和服务由用户及管理员选择。
- 使用云端语音时，讲解文字会发送给所配置的语音服务商；浏览器语音使用浏览器提供的能力，其处理方式取决于浏览器和所选声音。
- 主动登录 MiniMax Code 后，登录、令牌刷新与 AI 请求会连接 MiniMax 服务；自动签到功能也会定期向 MiniMax 发送该账号的签到请求。不使用该集成时无需连接账号，可在设置中退出登录。
- 打开下载、文档、社区或作者链接时，浏览器会访问对应网站。官网和安装包由 GitHub Pages、GitHub Releases 等服务托管，这些网站按各自政策处理访问请求。
- 如果启用 Windows 的 SignPath 签名，CI 仅提交安装包及构建来源信息，不提交运行实例的用户数据库、题目或凭据。

第三方对请求的保存、使用和处理以所选服务的条款为准。常见服务的隐私说明：[Google](https://policies.google.com/privacy)、[OpenAI](https://openai.com/policies/privacy-policy/)、[Anthropic](https://www.anthropic.com/legal/privacy)、[Microsoft](https://privacy.microsoft.com/privacystatement)、[GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)；其他 AI 渠道及自定义接口请参阅对应服务商的隐私政策。[SignPath 隐私政策](https://about.signpath.io/privacy-policy)适用于代码签名申请与服务。

## 数据管理与联系

用户可在实例中删除题目和学习记录、导出个人数据；实例管理员负责账号、数据库、上传文件、日志及备份的保管和清理。卸载桌面版不会自动删除数据目录；安卓单机版卸载会删除其私有数据目录。删除实例中的数据不等于删除已导出的备份或第三方已收到的请求，应分别向相应运营者处理。

使用共享演示站时，不应录入个人学习资料。自托管实例的隐私请求请联系该实例管理员。软件本身的问题可通过项目 [Issues](https://github.com/margrop/wrong-notebook/issues) 联系维护者；涉及密钥、账号或漏洞的内容请使用[安全报告渠道](../SECURITY.md)，不要公开个人资料或凭据。
