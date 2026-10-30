# Code signing policy

[简体中文](CODE_SIGNING.md)

## Current status

The project is applying for the SignPath Foundation open-source code signing service and has not yet been approved. Windows installers from `v2026.10.30` and earlier remain unsigned. This page does not claim that a certificate or signing authorization has already been granted. Check a specific file's Windows Properties → Digital Signatures and its signature validation result.

Once approved and enabled, the signing acknowledgement will be:

> Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Maintainers and approval

- Committers and reviewers: [margrop](https://github.com/margrop). External contributions are reviewed by the maintainer through pull requests.
- Signing approver: [margrop](https://github.com/margrop). Each production signing request requires the maintainer's manual approval in SignPath. The API token may submit requests but must not approve them.
- Members who can change release code or approve signatures must enable multi-factor authentication on both GitHub and SignPath.

## Signing scope and build origin

The Windows installer `WrongNotebook-Win-Setup-<version>-x64.exe` and portable package `WrongNotebook-Win-Portable-<version>-x64.exe` are built on GitHub-hosted runners from the public [margrop/wrong-notebook](https://github.com/margrop/wrong-notebook) repository. The project is derived from [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) and preserves its license and attribution.

Only workflows for the public `main` branch and version tags may submit signing requests. SignPath must verify the GitHub build origin, enforce the product name `WrongNotebook`, and require matching product versions for both files. This integration signs the two package files; it does not re-sign embedded Electron, Prisma or other upstream binaries.

After downloading the signed files, the workflow checks their names, count, product names, product versions, trusted Authenticode signatures and timestamps. Only then are they uploaded using the existing `package-desktop-windows-x64` artifact name. Release checksums are calculated from the final signed files. A signing failure stops publication without falling back to unsigned files.

## Privacy

See the [privacy policy](PRIVACY.en.md) for question images, study records, account data and AI credentials. Self-hosted data remains on the user's selected instance. AI requests, cloud speech, MiniMax Code login and automatic check-in connect to the third-party services configured by the user or administrator.

The signing service receives build artifacts and provenance information, not an instance's study database or runtime configuration. See the [setup guide](WINDOWS_SIGNING.md) and the Foundation's [Code of conduct](https://signpath.org/terms).
