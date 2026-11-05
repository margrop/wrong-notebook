/**
 * 使用协议正文（静态打进构建产物，standalone 构建与各安装包都带上）。
 * doc/EULA.md、doc/EULA.en.md 是文档副本，由单元测试检查两份内容一致；修改时两处同步
 */
export const EULA_TEXT = {
    zh: `# 错题本使用协议（管理员）

版本：v1 · 生效日期：2026-11-05

> 本协议是通用模板，不构成法律意见。重要部署请自行咨询法律专业人士。

本协议约束部署并运营错题本（wrong-notebook）实例的一方（下称“管理员”）。普通用户在实例中注册、登录和使用的流程不受本协议影响。

## 1. 软件许可

错题本是开源软件，按仓库中的 LICENSE（MIT 许可证）授权。本协议不限制 LICENSE 授予的任何权利；二者冲突时以 LICENSE 为准。

## 2. 知识产权

软件源码、名称与图标的权利归各自的权利人所有。实例中的题目、笔记、图片等内容归上传者或其权利人所有，维护者不主张任何权利。

## 3. 数据收集

错题本的匿名遥测分三层，均为实例级开关，由管理员在“设置 → 用户管理 → 隐私与遥测”中决定：

- **本地记录**（默认关闭）：功能使用统计与错误详情只保存在本实例的数据库中，供管理员排查问题，按保留天数自动删除。
- **错误回报**（默认开启，只在本地记录或外发开启时生效）：记录页面与接口的异常。
- **外发**（同意本协议后默认开启）：实例定期向错题本收集服务发送匿名的功能使用统计和错误指纹。

外发内容只有：应用版本、部署形态、事件名称及其枚举维度（如是否成功、所用 AI 服务商、耗时区间）、错误类别与 16 位错误指纹。**不包含**用户或实例标识、IP、邮箱、题目内容、OCR 文本、AI 对话、错误原文或堆栈。

收集服务托管在 Vercel，地址为 https://wrong-notebook-telemetry.margrop.net ，只按天保存聚合计数，保留约 400 天；源码公开，数据仅维护者可见。收集服务的应用代码不保存 IP，但托管平台的访问日志会按平台策略短期保留请求来源地址。管理员可以随时关闭外发，或改为指向自建的收集服务；环境变量 \`TELEMETRY_DISABLED=true\` 会强制关闭全部遥测。

## 4. 管理员的责任

管理员负责实例的部署、安全与合规，包括：妥善保管账号和 API Key；按适用法律告知本实例的用户实例会收集哪些数据、发往何处；在需要时取得用户同意；遵守所接入的 AI 服务商的条款。

## 5. 第三方服务

实例会按管理员的配置把题目内容发送给第三方 AI 服务商进行识别和解析。这些服务由第三方按其条款提供，与本项目维护者无关。

## 6. 免责声明

软件按“现状”提供，不附带任何明示或默示的保证，包括但不限于适销性、特定用途适用性和不侵权的保证。AI 生成的识别、解析与批改结果可能有误，需要使用者自行判断。

## 7. 责任限制

在适用法律允许的最大范围内，维护者和贡献者不对因使用或无法使用本软件而产生的任何直接、间接、附带或后果性损失承担责任，包括数据丢失和业务中断。

## 8. 终止

管理员停止使用并删除实例即终止本协议。违反本协议时，管理员依本协议获得的权利自动终止，但不影响 LICENSE 授予的权利。

## 9. 适用法律

本协议受管理员所在司法辖区的法律约束。任何条款被认定无效时，不影响其余条款的效力。

## 10. 协议变更

协议的实质内容（权利义务、数据收集范围、外发对象）变化时会升级版本。升级后，实例会暂停外发，管理员重新同意前无法进入管理功能；普通用户的使用不受影响。
`,
    en: `# Wrong Notebook Administrator Agreement

Version: v1 · Effective date: 2026-11-05

> This agreement is a general template and is not legal advice. Consult a legal professional for important deployments.

This agreement applies to the party that deploys and operates a Wrong Notebook (wrong-notebook) instance (the "administrator"). It does not change how ordinary users register, sign in or use an instance.

## 1. Software license

Wrong Notebook is open-source software licensed under the LICENSE file in its repository (MIT License). This agreement does not restrict any right granted by the LICENSE; where they conflict, the LICENSE prevails.

## 2. Intellectual property

Rights to the source code, name and icons belong to their respective owners. Questions, notes, images and other content in an instance belong to the uploaders or their rights holders; the maintainers claim no rights to them.

## 3. Data collection

Anonymous telemetry has three instance-level switches, controlled by the administrator under "Settings → User Management → Privacy & telemetry":

- **Local recording** (off by default): usage statistics and error details are stored only in this instance's database for troubleshooting and deleted automatically after the retention period.
- **Error reporting** (on by default, effective only when local recording or forwarding is on): records page and API errors.
- **Forwarding** (on by default after accepting this agreement): the instance periodically sends anonymous usage statistics and error fingerprints to the Wrong Notebook collection service.

Forwarded data contains only the app version, deployment platform, event names with enumerated dimensions (such as success, AI provider and duration range), error categories and 16-character error fingerprints. It **does not** contain user or instance identifiers, IP addresses, email addresses, question content, OCR text, AI conversations, error messages or stack traces.

The collection service is hosted on Vercel at https://wrong-notebook-telemetry.margrop.net . It stores only daily aggregated counts for about 400 days; its source code is public and its data is visible only to the maintainer. The service's application code does not store IP addresses, but the hosting platform's access logs keep request source addresses for a short period under the platform's policy. The administrator can turn forwarding off at any time or point it to a self-hosted collection service; the environment variable \`TELEMETRY_DISABLED=true\` forces all telemetry off.

## 4. Administrator responsibilities

The administrator is responsible for the deployment, security and compliance of the instance, including keeping accounts and API keys safe; informing the instance's users, as required by applicable law, what data the instance collects and where it is sent; obtaining user consent where required; and following the terms of the AI providers in use.

## 5. Third-party services

Depending on the administrator's configuration, the instance sends question content to third-party AI providers for recognition and analysis. These services are provided by third parties under their own terms and are unrelated to the project maintainers.

## 6. Disclaimer

The software is provided "as is", without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose and non-infringement. AI-generated recognition, analysis and grading may be wrong and must be reviewed by the user.

## 7. Limitation of liability

To the maximum extent permitted by applicable law, the maintainers and contributors are not liable for any direct, indirect, incidental or consequential damages arising from the use of or inability to use the software, including data loss and business interruption.

## 8. Termination

This agreement ends when the administrator stops using and deletes the instance. If the administrator breaches this agreement, rights granted under it terminate automatically; rights granted by the LICENSE are not affected.

## 9. Governing law

This agreement is governed by the laws of the administrator's jurisdiction. If any provision is held invalid, the remaining provisions stay in effect.

## 10. Changes

The version is raised when the substance of the agreement changes (rights and obligations, scope of data collection, or forwarding recipients). After an upgrade, the instance pauses forwarding and administrators cannot use admin features until they accept again; ordinary users are not affected.
`,
} as const;
