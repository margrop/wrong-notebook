# User Guide

## Create a notebook

When creating a notebook, choose its school stage (primary, junior high or senior high) and subject. They decide which knowledge-point library the AI uses and cannot be changed later, so keep separate notebooks per stage and subject.

Primary school offers math, English and Chinese. The built-in Chinese library includes chapters and knowledge points for grades 1–6, junior high and senior high. After upgrading Docker or an installation package, startup fills in missing built-in Chinese tags while preserving existing tag IDs, question links, custom tags and other tag systems.

After an administrator imports the PEP curriculum knowledge points (see [Settings and Users](Settings-and-Users-en)), a **Tag system** option appears when creating a notebook. It coexists with the built-in system and cannot be changed after creation; AI recognition and knowledge-point filters only use tags from the notebook's tag system.

The notebook list shows only each name and question count; click one to open its detail page, where you can rename or delete it. Only an empty notebook can be deleted, so move or delete its questions first.

## Add questions

| Entry | When to use |
| --- | --- |
| Image upload, drag and drop, camera | Paper tests, workbooks and existing question images |
| Clipboard paste | Copied screenshots or images, with `Ctrl/⌘+V` |
| Screenshot | The browser supports screen sharing and the page runs in a secure context |
| AI solve | You already have the question text; Markdown and LaTeX are supported |
| Direct entry | Manually record a known question, answer and analysis |

Images can be cropped first. While cropping or selecting several questions, zoom with the mouse wheel, a two-finger pinch or the buttons at the top right (100%–500%; click the percentage to reset). When one image contains several questions, select them all for a batch import. Keep the full question, any required figure and the student's work, and avoid blurry images or cut-off conditions.

After enabling "Review before import" in "Settings → General", you can correct the recognition on the review page before saving. The AI may misread numbers, symbols and figure relationships, so check against the original before saving.

## Duplicate detection

On import, the question text is compared with the current user's existing questions across all notebooks. The default threshold is 90% and can be changed in your general settings.

- When the similarity is **strictly greater** than the threshold, the existing question is returned and a wrong attempt is recorded on it.
- A similarity equal to the threshold does not count as exceeding it.
- Similarity is the character edit similarity of the normalized question text; it does not mean the math is the same.
- Records from repeated imports feed into later mastery evaluation; check the original question's answer history when needed.

Notebooks also offer a two-question similarity comparison to help decide whether the threshold suits your questions. If only a few characters of numbers or conditions differ, the similarity may still be high, so judge by the meaning of the question.

## Question details

Each question shows its text, answer, analysis, knowledge points, difficulty, semester and paper level, plus the original photo.

| Information or action | Notes |
| --- | --- |
| 6-character question ID | Copy it and locate the question by ID in a notebook; shown as the source ID in printouts |
| 1–5 star difficulty | Rated by the AI with reference to competition-math difficulty; can be changed manually |
| Grade/semester | Click **Edit grade/semester** to change and save it; review also offers a selector, and loading the profile preserves manual edits |
| Paper level | When not set, 1–3 stars default to the "Paper A" group and 4–5 stars to the "Paper B" group; a manual choice takes priority. Customize groups in **Settings → General → Paper Groups**: rename defaults, add custom groups (e.g. Unit Test, Midterm, Final), deactivate or delete custom groups |
| Knowledge points | Tags from the matching stage and subject; re-recognize one question or a whole notebook |
| Regenerate full solution | Generates a new answer and analysis; asks for confirmation before overwriting |
| Fix LaTeX | Appears when formula syntax issues are detected, letting the AI correct the formulas |
| Original image | View, replace or add it to check the recognition |

Unrated questions are not assigned a paper level by the default rule alone. Regenerating the full solution keeps the knowledge points and mistake information.

![Question text, knowledge points, difficulty and question info](https://raw.githubusercontent.com/margrop/wrong-notebook/a5f816515e3dc31dcdb90c9fa456baed12eef94d/doc/screenshots/en/question-detail.png)

Choose a fixed grade or AI recognition for new questions under **Settings → General**. Manual choices take priority; see [Settings and Users](Settings-and-Users-en).

## Figures and animated explanations

- **SVG figures**: static SVG generated by the AI from the question, used on the detail page, in practice and in printouts; the original image can still be viewed separately.
- **Figure display scale and alignment**: saved mistakes with a figure show this setting on the details page. Enter a percentage or drag the slider to preview, from 10–200% (default 100%), and choose an alignment (left / center / right, default center); exam papers with figures also allow adjusting scale and alignment per question or uniformly across the exam. Click **Save** to apply it after reload and in printouts. **Reset to 100%** restores the default scale; save again to keep it. Enlarged figures fit the available width and keep their aspect ratio. Backups retain the scale and alignment; existing questions and older backups default to 100% and center. **Image Scale** in print preview controls the original photo; enable **Question Text** to print the figure.
- **SVG animated explanations**: the animation stays paused on the first frame when opened or changed; click Play to start. Step-by-step demonstrations of the solution with pause, seeking, replay and full screen; enabled by default in personal settings. Click the speaker icon in the player to turn on voice narration (off by default and remembered once on). Each step is read aloud (by the browser's speech synthesis by default; when an admin turns on cloud voice, the server synthesizes it so every device hears the same voice), the animation waits for the narration before moving on (it pauses on the complete current step and highlights the frame border while waiting), and the speed cycles between 0.75× and 1.5×. Older animations without a narration script read the subtitles at the bottom of the picture. Click **Add narration** above the animation to have AI write a script for the existing picture without regenerating the animation (counts as one animated-explanation AI use). When a script exists, the button reads **Rewrite narration**. With cloud voice on, turning on narration for the first time synthesizes the whole animation's voice at once, and **Regenerate voice** above the animation synthesizes it again; both appear in background tasks with progress (they use the speech provider's quota, not the AI daily limit). Animations whose cloud voice has been generated open with narration on. Animation text follows the interface language; Chinese and English versions are generated and saved separately, and switching the language shows the matching version automatically.
- **GeoGebra interactive demos**: interactive figures for math and physics questions; disabled by default in personal settings.

Generated animations and GeoGebra demos can be deleted after confirmation. Check generated figures and solutions manually, especially geometric positions, counting steps and conclusions.

## Filters and batch actions

Filter by mastery status, knowledge point, time, grade and semester, or paper level, then act on the results in bulk or print them. Before deleting, confirm the filters and selection; [back up your data](Backup-and-Restore-en) when it must be kept long term.

## Markdown and formulas

Questions, answers and analysis support Markdown, and formulas are rendered with KaTeX:

```text
Inline: $a^2+b^2=c^2$ or \(a^2+b^2=c^2\)
Display: $$\frac{a}{b}$$ or \[\frac{a}{b}\]
```

While editing you can switch between source and preview. For complex tables and formulas, see the [Markdown guide](https://github.com/margrop/wrong-notebook/blob/main/doc/MARKDOWN_GUIDE.md) and the [table recognition notes](https://github.com/margrop/wrong-notebook/blob/main/doc/TABLE_RECOGNITION.md).

Next: [Practice and Exams](Practice-and-Exams-en).
