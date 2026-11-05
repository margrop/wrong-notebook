# Privacy policy

[简体中文](PRIVACY.md) · Updated: November 5, 2026 · [Web version](https://wrong-notebook.margrop.net/en/privacy/)

## Scope and storage

wrong-notebook is self-hostable study software. Desktop editions run the server locally. The operator of each Docker, npm, fnOS or source deployment manages that instance's data. Android clients connect to the instance chosen by the user. Who can access data depends on the deployment and its operator.

An instance stores account information, password hashes, question text and images, answers, practice and exam records, and preferences needed for its features. Databases, uploaded files, server logs and configuration are stored in that instance's data or configuration directories; see the [installer guide](INSTALL_PACKAGES.md) for platform paths. Browser diagnostic logs may include page URLs, browser identifiers, errors and operation context and are sent to the same instance's server. They are not automatically sent to the project maintainer's servers; only the anonymous statistics described under "Anonymous telemetry" are sent to the maintainer.

AI API keys and endpoints, and credentials for a MiniMax Code account that the user chooses to connect, are stored in the instance configuration. MiniMax Code access and refresh tokens, account details and check-in results are stored in `minimax-code.json` in the configuration directory. Protect access to your instance, configuration and backups.

## Anonymous telemetry

Telemetry is an instance-level setting controlled by the administrator; ordinary users cannot opt out individually:

- **Forwarding**: on by default after the administrator accepts the [agreement](EULA.en.md) during initialization or in the installer wizard; off by default on instances upgraded from older versions. About every 6 hours the instance sends a batch to the Wrong Notebook collection service (`https://wrong-notebook-telemetry.margrop.net`, hosted on Vercel, [source code public](https://github.com/margrop/wrong-notebook-telemetry)) containing only the app version, deployment platform (such as Docker or fnOS), event names with enumerated dimensions (such as page category, success, AI provider, duration range and count range), error categories and 16-character error fingerprints. It **does not** contain user or instance identifiers, IP addresses, email addresses, cookies, question content, OCR text, AI conversations, error messages, stack traces or page paths. The collection service stores only daily aggregated counts, deletes them after about 400 days, and its data is visible only to the maintainer; its application code does not store IP addresses, but the hosting platform's access logs keep request source addresses for a short period under the platform's policy.
- **Local recording** (off by default): usage statistics and sanitized error details (error message, stack trace, page path without IDs, browser family) are stored only in this instance's database, deleted after the retention period (30 days by default) and never forwarded.
- **Error reporting**: effective only when forwarding or local recording is on.

Administrators can turn forwarding off at any time under "Settings → User Management → Privacy & telemetry", see what the instance collected, clear it immediately, or point it to a self-hosted collection service; the environment variable `TELEMETRY_DISABLED=true` forces all telemetry off. Telemetry data is not included in backups.

## Third-party services

- AI recognition, explanations, exercises and animations send the question content, images, answers or prompts needed for the task to the AI provider and endpoint configured by the administrator. Before first use, each account sees an "AI data sharing" notice listing the data sent and the current provider, and **nothing is sent until the user agrees**. If the user declines, AI features are unavailable (mastery is estimated by rules instead) and everything else keeps working. Consent can be withdrawn any time under Settings → Account; withdrawing does not affect data already sent to the provider.
- Cloud speech sends narration text to the configured speech provider. Browser speech uses browser-provided capabilities; processing depends on the browser and selected voice.
- After the user signs in to MiniMax Code, login, token refresh and AI requests connect to MiniMax. Automatic check-in also periodically sends authenticated check-in requests. Connecting an account is optional, and the user can sign out in Settings.
- Opening download, documentation, community or author links visits the corresponding websites. The website and packages are hosted by services including GitHub Pages and GitHub Releases, which process access requests under their own policies. The website uses 51.la and Google Analytics to count visits; the app itself contains no such analytics code.
- When Windows SignPath signing is enabled, CI submits installer files and build provenance, not a running instance's user database, questions or credentials.

Request retention and processing are governed by the selected service's terms. Common policies include [Google](https://policies.google.com/privacy), [OpenAI](https://openai.com/policies/privacy-policy/), [Anthropic](https://www.anthropic.com/legal/privacy), [Microsoft](https://privacy.microsoft.com/privacystatement), and [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Consult the relevant provider for other AI channels and custom endpoints. [SignPath's privacy policy](https://about.signpath.io/privacy-policy) applies to signing applications and services.

## Data management and contact

Users can delete questions and study records and export their personal data. Regular users can also delete their account under Settings → Danger Zone by entering their password, which permanently deletes the account and all of its data (administrator accounts cannot delete themselves). Instance administrators manage accounts, databases, uploads, logs and backups. Uninstalling a desktop app does not automatically delete its data directory; uninstalling standalone Android deletes its private data. Deleting instance data does not delete exported backups or requests already received by third parties; manage those separately with their respective operators.

Do not enter personal study material into the shared demo. Contact your instance administrator for privacy requests about a self-hosted deployment. Contact the software maintainer through project [Issues](https://github.com/margrop/wrong-notebook/issues); use the [security reporting channel](../SECURITY.md) for sensitive account, credential or vulnerability information instead of posting it publicly.
