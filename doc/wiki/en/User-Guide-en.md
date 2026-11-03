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

Images can be cropped first. While cropping or selecting several questions, zoom with the mouse wheel, a two-finger pinch or the buttons at the top right (100%–500%; click the percentage to reset). When one image contains several questions, choose **Auto split** to let AI find each question (see "Multiple questions" below), or **Draw boxes** to select them for a batch import. Keep the full question, any required figure and the student's work, and avoid blurry images or cut-off conditions.

On phones there are three separate entries: **Take photo** opens the camera directly (if the device has no camera you are asked to use the album or a file instead); **Photo album** picks from your photos; **Choose file** accepts any file type, for photos that do not show up in the album (some systems do not treat HEIC/HEIF as images). After selection the real format is detected from the file content: HEIC/HEIF photos are converted to JPEG and rotated upright before cropping, and no extra decoder is downloaded when the browser can decode them itself. Damaged files or files that are not images show a specific reason.

When one question spans two or more sheets, frame the first part in single-question crop and tap **Rest is on another sheet**; that part is saved above the upload area. Take or choose the next photo, frame the continuing part and tap **Join … parts and recognize**: the parts are scaled to the same width and joined top to bottom into one image. A question can have up to 4 parts; while parts are saved you can also start recognition or discard them from the saved-parts panel, and cropping offers only the single-question mode.

The crop preview uses a thumbnail; after you confirm, the crop is taken from the original. Output is limited by a 4096 px long edge, about 4.9 megapixels and 1.5 MB together, with JPEG quality at 0.8 or above, so small text, formulas and figures stay sharp.

After enabling "Review before import" in "Settings → General", you can correct the recognition on the review page before saving. The AI may misread numbers, symbols and figure relationships, so check against the original before saving.

### Multiple questions

You do not need to paste or crop questions one at a time:

- **Text**: paste a whole worksheet into **AI solve**. Below the box you see "N numbered questions detected" as you type (local rules based on question numbers, no AI call). Tap **Preview N questions** to open the preview, or **Solve as one question** to keep a single question. Options (A–D) and sub-questions ((1)(2), ①②) stay with their question; reading passages become shared material placed before the related questions; titles, name/date lines and notes such as "9 questions in total" are left out and can be restored from **Not counted as questions**. Numbers right after a question stem, such as 1) 2) or "answer the following questions:", may be sub-questions of one question, so they are kept together by default; choose **Split into N questions anyway** if they really are separate. A batch holds up to 60 questions (extra ones are listed as not counted) and up to 20,000 characters of text. For several questions without numbers, use **Split with AI**: one AI call finds the boundaries, and the question text is always taken from what you pasted. When wrong numbers (for example from OCR) make the local split go wrong, **Split wrong? Split with AI** is also shown below the detection notice.
- **Photo**: after choosing a photo, switch the crop window to **Auto split**, optionally crop to the worksheet (the whole photo by default), and tap **Find questions**. This needs an AI model with image input. The photo is recognized on the server, so you can leave the page. Questions the model cannot locate reliably are marked **Not located**, left unselected and need to be marked on the photo; blurry or partial photos show a warning. **Single question** and **Draw boxes** remain available.

The preview shows "N questions found · N selected". Each question starts collapsed; open it to edit, split at the cursor, merge with the previous question, move it or delete it, with select-all and undo at the top. Photo questions are outlined with numbered boxes on the original; use **Adjust area** to reframe one (a question can have several areas, such as a stem and a figure in different columns). The text shown for photo questions only helps you recognize them; each question is recognized again from its area after you start.

When a question continues from this page onto the next, tap **Continues on next page** on it (shown for questions marked as possibly cut off and for the last question on each page) and take or choose the next page. The app scales this question's part of the page to match the next page's width, places it above the whole next page in one image and sends it to AI auto split as the next batch; the question is moved out of this batch (you can undo) and appears whole in the next batch. A "Page 2 is being split" notice with a link appears at the top; solve and import the rest of this batch as usual, then open the next batch to confirm. If the last question of the next batch continues again, repeat. The next batch uses the same notebook, and the split counts as one AI use. If the next batch splits the question in two, use **Merge with previous** to join them.

When text questions come from OCR or contain scratch work, tap **AI fix text (N)** at the top to fix the selected questions, or **AI fix text** inside an opened question to fix just that one. The AI only removes scratch work, working and crossed-out text and fixes OCR typos such as look-alike characters and punctuation; numbers, formulas, units and question numbers stay as they are, and nothing is added. Parts it is unsure about are listed under **Not sure, kept as is**. Each result appears as an **AI suggested fix** with removed text struck out and changes highlighted; **Accept fix** replaces the question text and **Keep original** discards the suggestion, or use **Accept all** for several questions. Results that change or add numbers are discarded and those questions keep their original text. Suggestions are saved with the preview; editing the question text by hand discards its suggestion. If suggestions are still pending when you start, you are reminded and those questions are solved with their original text. Each fix request counts as one AI use. Changes are saved to the server automatically, so refreshing, locking the phone or opening it on another device shows the same preview; if two pages edit at once, the later save is told and loads the latest version.

Start with the button at the bottom: with **Review before import** off it reads **Solve and import N questions** and saves each question when solved; with it on it reads **Solve N questions, review later**, and you **Review** each one (saving returns to the batch) or choose **Import the other N as recognized**. The batch appears as "Batch of N questions" under Recognition tasks with counts of imported, duplicate, to-review and failed questions; percentages are stage estimates. Failed questions can be retried individually or together; finished questions are never solved or imported twice.

### Recognition tasks

Once the upload finishes, recognition continues on the server. The page shows a status card instead of a full-screen overlay, so you can leave the page, lock your phone or keep adding questions. The **Recognition** entry in the header shows how many tasks are running and the number of unread results, and refreshes as soon as you return to the app.

| Status | Meaning and actions |
| --- | --- |
| Recognizing | The server is calling the AI; the percentage is a per-stage estimate |
| Ready for review | The result when review before import is on. **Continue review** opens the review page; reloading, another tab or another device opens the same result without recognizing again |
| Saving / Saved | Saved tasks offer **View question**; duplicates are recorded in the existing question's practice history |
| Failed | Shows the reason and offers **Retry**. If a recognition result already exists, only the save is retried without calling the AI again. Tasks interrupted by a server restart also show as failed |

Drafts awaiting review and failed tasks are kept until you handle or discard them; saved tasks are kept for 7 days. Each task card lists the actual time spent reading, converting, cropping, compressing, receiving, recognizing and saving.

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
