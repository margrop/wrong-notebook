# Windows 安装包签名（SignPath）

项目已于 2026 年 10 月通过 SignPath Foundation 开源计划审核。当前阶段：用 SignPath 提供的自签名测试证书调试流程；基金会复核接入配置后订购生产证书并导入组织，之后才启用正式签名。现有 Windows 包仍未签名。[Code signing policy](CODE_SIGNING.md) 和[隐私说明](PRIVACY.md)是申请材料的一部分。

## 账号与项目设置

1. **账号与邀请**：SignPath 会发两封邮件——OSS 组织邀请，以及 CI 用户邮箱确认，顺序不定。必须先注册 SignPath 账号（启用多因素认证），用该账号接受组织邀请，**然后**才确认 CI 用户邮箱；邀请未接受时确认无法完成。
2. **Trusted Build System**：在组织中为公开仓库启用 GitHub.com Trusted Build System；如需 GitHub App，仅授权 `margrop/wrong-notebook`。
3. **项目与 Artifact Configuration**：创建项目 `wrong-notebook`，将 [windows-installers.xml](../packaging/signpath/windows-installers.xml) 导入为 `windows-installers` Artifact Configuration。GitHub 上传的 Artifact 总是 ZIP，根元素必须为 `zip-file`（参考 [Artifact Configuration](https://about.signpath.io/documentation/artifact-configuration/)）。
4. **测试签名策略**：使用组织自带的测试证书策略（通常为 `test-signing`），关联 GitHub Trusted Build System，可设为自动批准，仅用于调试。
5. **生产签名策略**：生产证书导入后创建 `release-signing`：使用基金会签发的生产证书，限制到本仓库、GitHub 托管 Runner、公开 `main` 和版本标签，要求维护者逐次人工批准。不得自动批准，不使用测试证书发布正式附件。
6. **API Token**：CI 用户只授予提交请求的权限（Submitter），把它的 API Token 存为 GitHub Secret。不要把维护者账号或批准权限交给 CI。

## GitHub Actions 配置

在仓库 Settings → Secrets and variables → Actions 中配置。以下为 CI 配置，不属于应用运行时 `.env`：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | SignPath 提交者 Token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | 账号的 Organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | 获批项目 slug，例如 `wrong-notebook` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 生产策略 slug，例如 `release-signing`（生产证书到位后配置） |
| Variable | `SIGNPATH_TEST_SIGNING_POLICY_SLUG` | 测试策略 slug；未设置时为 `test-signing` |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Artifact Configuration slug，例如 `windows-installers` |
| Variable | `SIGNPATH_ENABLED` | 生产证书到位、首次验收通过后才设为 `true`；未设置时保持原有未签名构建 |

## 测试证书试签

不需要 `SIGNPATH_ENABLED`，也不需要生产策略 slug。配置 Token、Organization ID、项目 slug 和 Artifact Configuration slug 后，在 Actions → Packages → Run workflow 中选择 `main` 分支、`windows_signing` 选 `test`：

1. 构建、检查元数据并上传 `unsigned-windows-x64`，向测试策略提交请求。
2. 下载签名文件，验证文件集合、产品元数据和 Authenticode 签名。测试证书的根不受信任，状态为 `UnknownError` 属正常；未签名或哈希不符仍会失败。不检查时间戳。
3. 签名文件上传为 `test-signed-windows-x64`（保留 7 天）供下载核对，**不替换** `package-desktop-windows-x64` 中的未签名安装包。

`workflow_dispatch` 不会创建 Release，测试运行不影响任何已发布附件。试签成功后回复 SignPath 支持邮件，请基金会复核配置并订购生产证书。

## 发布过程

以下为 `SIGNPATH_ENABLED=true` 后的生产签名。沿用原来的 `v*` 标签触发 Packages 工作流；也可从公开 `main` 手动运行。其他分支的手动试构建不提交生产签名。npm、macOS、Linux、飞牛OS、安卓和 Release 创建逻辑保持原样。

Windows Runner 仍先生成安装版和免安装版。启用签名后：

1. 检查两个文件的 `ProductName=WrongNotebook` 和一致的 `ProductVersion`。
2. 上传仅含这两个 EXE 的 `unsigned-windows-x64` 中间产物，供 SignPath 核验构建来源。它不会被 Release 的 `package-*` 规则下载。
3. 提交请求并等待维护者在 SignPath 批准，最多等待 30 分钟；超时或拒绝会使 Windows Job 失败。
4. 下载并验证完整文件集合、产品元数据、可信 Authenticode 签名和时间戳，验证通过后覆盖原路径。
5. 继续上传 `package-desktop-windows-x64`；原有汇总 Job 从最终文件生成 `SHA256SUMS.txt` 并上传到 Release。

启用后缺少配置、签名失败、文件缺失、版本不符或无可信签名时均停止发布，不使用 `continue-on-error`，也不自动退回未签名附件。已有正式版附件不会因接入而被重新上传或更换。

## 验证

生产证书导入、`release-signing` 配置完成并设置 `SIGNPATH_ENABLED=true` 后，先从公开 `main` 手动运行 Packages（`windows_signing` 保持 `auto`），在 SignPath 批准请求，确认两个 EXE 均能通过 Windows 验证，再按现有版本发布流程打标签：

```powershell
Get-AuthenticodeSignature .\WrongNotebook-Win-Setup-<版本>-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
Get-AuthenticodeSignature .\WrongNotebook-Win-Portable-<版本>-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
```

签名应为 `Valid`，并核对发布者及时间戳。还应核对 Release 的校验和与实际下载文件一致。签名不保证立即消除所有 SmartScreen 提示，Windows 的信誉判断还取决于文件和证书信誉。

CI 的 `Windows Signature Validation` 使用 Windows Runner 自带的真实签名程序验证正常路径、缺失文件、多余文件、未签名内容和签名后篡改，并用临时自签名证书验证测试证书模式（生产模式拒绝、测试模式接受且不覆盖发布文件）；失败场景还会确认原始文件未被部分覆盖；这些测试不需要 SignPath Token，不能替代首次真实签名验收。

参考：[SignPath GitHub Actions 集成](https://docs.signpath.io/trusted-build-systems/github)、[基金会条件](https://signpath.org/terms)。
