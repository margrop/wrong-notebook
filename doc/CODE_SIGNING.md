# Code signing policy（代码签名政策）

[English](CODE_SIGNING.en.md)

## 当前状态

项目正在申请 SignPath Foundation 的开源代码签名服务，尚未获批。`v2026.10.30` 及此前发布的 Windows 安装包仍未签名；本页不表示已获得证书或签名授权。是否已签名应以具体文件的 Windows「属性 → 数字签名」及签名验证结果为准。

获批并启用后的签名致谢为：

> Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## 维护与批准职责

- 代码提交者与审阅者：[margrop](https://github.com/margrop)。外部贡献通过 Pull Request 交由维护者审阅。
- 签名批准者：[margrop](https://github.com/margrop)。每次生产签名请求都必须由维护者在 SignPath 人工批准，API Token 只授予提交请求的权限。
- 能修改发布代码或批准签名的成员必须在 GitHub 和 SignPath 启用多因素认证。

## 签名范围与构建来源

Windows 安装版 `WrongNotebook-Win-Setup-<版本>-x64.exe` 和免安装版 `WrongNotebook-Win-Portable-<版本>-x64.exe` 由公开仓库 [margrop/wrong-notebook](https://github.com/margrop/wrong-notebook) 的 GitHub 托管 Runner 构建。项目基于 [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) 开发，保留上游许可证与来源说明。

仅公开 `main` 分支及版本标签的工作流可提交签名请求。SignPath 必须核验 GitHub 构建来源，并将产品名限制为 `WrongNotebook`，两个文件的产品版本必须一致。此接入签署上述两个安装包，不重新签署包内 Electron、Prisma 或其他上游二进制文件。

签名文件下载后，工作流检查文件名、数量、产品名称、产品版本、可信 Authenticode 签名和时间戳。全部通过后才上传原有 `package-desktop-windows-x64` 附件，并从最终签名文件计算 Release 校验和。签名失败时停止发布，不回退到未签名文件。

## 隐私

题目图片、学习记录、账号资料与 AI 凭据的处理方式见[隐私说明](PRIVACY.md)。自托管数据保存在用户所选的实例中；使用 AI、云端语音或 MiniMax Code 登录、自动签到时，会按用户或管理员的配置连接相应第三方服务。

签名服务仅接收构建产物和构建来源信息，不接收实例的学习数据库或运行时配置。接入步骤见 [Windows 签名配置](WINDOWS_SIGNING.md)，基金会要求见 [Code of conduct](https://signpath.org/terms)。
