# Privacy policy

[简体中文](PRIVACY.md) · Updated: October 30, 2026

## Scope and storage

wrong-notebook is self-hostable study software. Desktop editions run the server locally. The operator of each Docker, npm, fnOS or source deployment manages that instance's data. Android clients connect to the instance chosen by the user. Who can access data depends on the deployment and its operator.

An instance stores account information, password hashes, question text and images, answers, practice and exam records, and preferences needed for its features. Databases, uploaded files, server logs and configuration are stored in that instance's data or configuration directories; see the [installer guide](INSTALL_PACKAGES.md) for platform paths. Browser diagnostic logs may include page URLs, browser identifiers, errors and operation context and are sent to the same instance's server. They are not automatically sent to the project maintainer's servers.

AI API keys and endpoints, and credentials for a MiniMax Code account that the user chooses to connect, are stored in the instance configuration. MiniMax Code access and refresh tokens, account details and check-in results are stored in `minimax-code.json` in the configuration directory. Protect access to your instance, configuration and backups.

## Third-party services

- AI recognition, explanations, exercises and animations send the question content, images, answers or prompts needed for the task to the AI provider and endpoint configured by the administrator. Users and administrators choose whether to use these features and services.
- Cloud speech sends narration text to the configured speech provider. Browser speech uses browser-provided capabilities; processing depends on the browser and selected voice.
- After the user signs in to MiniMax Code, login, token refresh and AI requests connect to MiniMax. Automatic check-in also periodically sends authenticated check-in requests. Connecting an account is optional, and the user can sign out in Settings.
- Opening download, documentation, community or author links visits the corresponding websites. The website and packages are hosted by services including GitHub Pages and GitHub Releases, which process access requests under their own policies.
- When Windows SignPath signing is enabled, CI submits installer files and build provenance, not a running instance's user database, questions or credentials.

Request retention and processing are governed by the selected service's terms. Common policies include [Google](https://policies.google.com/privacy), [OpenAI](https://openai.com/policies/privacy-policy/), [Anthropic](https://www.anthropic.com/legal/privacy), [Microsoft](https://privacy.microsoft.com/privacystatement), and [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Consult the relevant provider for other AI channels and custom endpoints. [SignPath's privacy policy](https://about.signpath.io/privacy-policy) applies to signing applications and services.

## Data management and contact

Users can delete questions and study records and export their personal data. Instance administrators manage accounts, databases, uploads, logs and backups. Uninstalling a desktop app does not automatically delete its data directory; uninstalling standalone Android deletes its private data. Deleting instance data does not delete exported backups or requests already received by third parties; manage those separately with their respective operators.

Do not enter personal study material into the shared demo. Contact your instance administrator for privacy requests about a self-hosted deployment. Contact the software maintainer through project [Issues](https://github.com/margrop/wrong-notebook/issues); use the [security reporting channel](../SECURITY.md) for sensitive account, credential or vulnerability information instead of posting it publicly.
