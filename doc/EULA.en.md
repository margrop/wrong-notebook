# Wrong Notebook Administrator Agreement

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

The collection service is hosted on Vercel at https://wrong-notebook-telemetry.margrop.net . It stores only daily aggregated counts for about 400 days; its source code is public and its data is visible only to the maintainer. The service's application code does not store IP addresses, but the hosting platform's access logs keep request source addresses for a short period under the platform's policy. The administrator can turn forwarding off at any time or point it to a self-hosted collection service; the environment variable `TELEMETRY_DISABLED=true` forces all telemetry off.

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
