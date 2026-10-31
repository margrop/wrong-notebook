# Smart Wrong Notebook Wiki

Smart Wrong Notebook turns mistakes captured by photo or typed as text into a searchable, practicable and printable question bank, and tracks mastery from the student's actual answer history.

This Wiki covers [margrop/wrong-notebook](https://github.com/margrop/wrong-notebook). It is the English edition of the [Chinese Wiki](Home), checked against release [v2026.10.31](https://github.com/margrop/wrong-notebook/releases/tag/v2026.10.31) ([`7ebab6b`](https://github.com/margrop/wrong-notebook/commit/7ebab6b61eeae6e16b4acba4411dba58bd016d30)) and last updated on 2026-10-31. The project is forked from [wttwins/wrong-notebook](https://github.com/wttwins/wrong-notebook) and released under the MIT License.

![Question cards, knowledge points and filters in a notebook](https://raw.githubusercontent.com/margrop/wrong-notebook/a5f816515e3dc31dcdb90c9fa456baed12eef94d/doc/screenshots/en/notebook.png)

## Start here

| What you want to do | Page |
| --- | --- |
| Run it locally and sign in for the first time | [Quick Start](Quick-Start-en) |
| Deploy with Docker or installers (desktop, fnOS, Android, npm), enable HTTPS or upgrade | [Deployment and Upgrades](Deployment-en) |
| Configure MiniMax, GLM, DeepSeek, Kimi, Qwen, StepFun, Volcengine, Anthropic, Azure, OpenAI or Gemini, plus cloud voices | [AI Configuration](AI-Configuration-en) |
| Add, organize, review and search questions | [User Guide](User-Guide-en) |
| Similar-question practice, exam papers, printing and recording results | [Practice and Exams](Practice-and-Exams-en) |
| Preferences, the app time zone and user permissions | [Settings and Users](Settings-and-Users-en) |
| Export personal data or back up the whole site | [Backup and Restore](Backup-and-Restore-en) |
| Batch-import questions from an external Openclaw agent | [Openclaw Integration](Openclaw-Integration-en) |
| Code structure, tests and contribution rules | [Development](Development-en) |
| Sign in after a fresh install; troubleshoot recognition, formulas or screenshots | [FAQ](FAQ-en) |

## Key features

- Image upload, clipboard paste, text input, cropping and multi-question selection; optionally review before saving.
- AI recognizes the question, answer, analysis, mistake cause, subject, knowledge points and a 1–5 star difficulty.
- Duplicate detection by question similarity; a repeated import records another wrong attempt on the original question.
- Markdown, LaTeX, SVG figures, SVG animated explanations with voice narration and optional GeoGebra interactive demos.
- Similar-question practice with AI grading, daily review, exam papers built from mistakes, answer history, mastery probability, statistics and print export.
- Per-user data isolation, daily AI limits, admin settings, personal preferences and Openclaw batch import.
- Fresh installs set up the admin with a one-time setup link (the install wizard on fnOS) instead of a fixed default password, then the setup wizard helps configure AI and create a notebook.

## Recommended workflow

1. [Deploy the app](Deployment-en) and create the admin account: the desktop and standalone Android apps open the setup page automatically, fnOS asks in the install wizard, and Docker and npm use the one-time setup link from the startup log.
2. [Configure and test the AI](AI-Configuration-en); image recognition needs a model that accepts image input.
3. Create a notebook with its school stage and subject, then [add and review questions](User-Guide-en).
4. Review with [similar questions and exam papers](Practice-and-Exams-en), and record the results.
5. Regularly [export personal data and back up the site](Backup-and-Restore-en).

## Project links

[Source code](https://github.com/margrop/wrong-notebook) · [Releases](https://github.com/margrop/wrong-notebook/releases) · [Issues](https://github.com/margrop/wrong-notebook/issues) · [Project page](https://blog.margrop.net/wrong-notebook-github-pages/en/)
