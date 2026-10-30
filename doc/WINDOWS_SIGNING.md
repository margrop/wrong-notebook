# Windows 安装包签名（SignPath）

当前为申请与接入准备阶段，未取得 SignPath Foundation 的证书授权；现有 Windows 包仍未签名。[Code signing policy](CODE_SIGNING.md) 和[隐私说明](PRIVACY.md)是申请材料的一部分。

## 申请与项目设置

1. 在 [SignPath Foundation](https://signpath.org/apply) 提交开源项目申请，提供公开仓库、官网、下载页、代码签名政策、隐私说明、可核实的使用情况和维护者联系信息。
2. 收到账号邮件并获批后，完成账号验证与多因素认证。为公开仓库配置 GitHub.com Trusted Build System；如需 GitHub App，仅授权 `margrop/wrong-notebook`。
3. 创建或使用获批的项目，例如 `wrong-notebook`，将 [windows-installers.xml](../packaging/signpath/windows-installers.xml) 导入为 `windows-installers` Artifact Configuration。上传的 GitHub Artifact 是 ZIP，根元素必须为 `zip-file`。
4. 创建生产签名策略，例如 `release-signing`：使用基金会批准的生产证书，限制到本仓库、GitHub 托管 Runner、公开 `main` 和版本标签，要求维护者逐次人工批准。不得自动批准，不使用测试证书发布正式附件。
5. 为签名请求创建仅有提交权限的 API Token。不要把维护者的账号密码或批准权限交给 CI。

基金会是否接受项目、是否授权证书及其审批时长由基金会决定，提交申请不等于获批。

## GitHub Actions 配置

在仓库 Settings → Secrets and variables → Actions 中配置。以下为 CI 配置，不属于应用运行时 `.env`：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | SignPath 提交者 Token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | 账号的 Organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | 获批项目 slug，例如 `wrong-notebook` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 生产策略 slug，例如 `release-signing` |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Artifact Configuration slug，例如 `windows-installers` |
| Variable | `SIGNPATH_ENABLED` | 全部获批、配置完成后才设为 `true`；未设置时保持原有未签名构建 |

## 发布过程

沿用原来的 `v*` 标签触发 Packages 工作流；也可从公开 `main` 手动运行。其他分支的手动试构建不提交生产签名。npm、macOS、Linux、飞牛OS、安卓和 Release 创建逻辑保持原样。

Windows Runner 仍先生成安装版和免安装版。启用签名后：

1. 检查两个文件的 `ProductName=WrongNotebook` 和一致的 `ProductVersion`。
2. 上传仅含这两个 EXE 的 `unsigned-windows-x64` 中间产物，供 SignPath 核验构建来源。它不会被 Release 的 `package-*` 规则下载。
3. 提交请求并等待维护者在 SignPath 批准，最多等待 30 分钟；超时或拒绝会使 Windows Job 失败。
4. 下载并验证完整文件集合、产品元数据、可信 Authenticode 签名和时间戳，验证通过后覆盖原路径。
5. 继续上传 `package-desktop-windows-x64`；原有汇总 Job 从最终文件生成 `SHA256SUMS.txt` 并上传到 Release。

启用后缺少配置、签名失败、文件缺失、版本不符或无可信签名时均停止发布，不使用 `continue-on-error`，也不自动退回未签名附件。已有正式版附件不会因接入而被重新上传或更换。

## 验证

首次启用后先从公开 `main` 手动运行 Packages，在 SignPath 批准请求，确认两个 EXE 均能通过 Windows 验证，再按现有版本发布流程打标签：

```powershell
Get-AuthenticodeSignature .\WrongNotebook-Win-Setup-<版本>-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
Get-AuthenticodeSignature .\WrongNotebook-Win-Portable-<版本>-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
```

签名应为 `Valid`，并核对发布者及时间戳。还应核对 Release 的校验和与实际下载文件一致。签名不保证立即消除所有 SmartScreen 提示，Windows 的信誉判断还取决于文件和证书信誉。

CI 的 `Windows Signature Validation` 使用 Windows Runner 自带的真实签名程序验证正常路径、缺失文件、多余文件、未签名内容和签名后篡改，失败场景还会确认原始文件未被部分覆盖；这些测试不需要 SignPath Token，不能替代首次真实签名验收。

参考：[SignPath GitHub Actions 集成](https://docs.signpath.io/trusted-build-systems/github)、[基金会条件](https://signpath.org/terms)。
