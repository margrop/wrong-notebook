# Question Exchange Format JSON v1

This document defines the **Wrong Notebook Question Exchange Format JSON v1**: used for JSON file import/export, agent submissions, and interoperability with other projects.

- Implementation: `src/lib/question-format/` (pure-function library, works in browser and server)
- JSON Schema: `doc/schemas/questions-v1.schema.json` (draft 2020-12)
- Full example: `doc/schemas/questions-v1.example.json`

## Exporting from the Notebook

The error list's multi-select bar provides an export feature (`POST /api/error-items/export-questions`). The dialog offers three formats: **JSON / Excel / Word**. All formats are first returned by the server as Question Exchange JSON v1, then converted in the browser; no new server endpoint is added.

### JSON

A Question Exchange JSON v1 file with the most complete fields (including `material`, `figureSvg`, `images`, `extensions`), suitable for backing up question content or importing into other systems.

- Only error items belonging to the current user are exported; ids not owned by the user are silently ignored.
- Optional "Include original images": when enabled, if `originalImageUrl` is a base64 inline image with prefix `data:image/png|jpeg|webp`, it is placed into the `images` field.
- Questions with empty question text are skipped; the skipped count is returned in the `X-Export-Skipped` response header.
- The export result can be parsed directly by `parseQuestionFile`, achieving a round-trip.

### Excel

An `.xlsx` file (single sheet "题目") whose columns exactly match the question bank import template `TEMPLATE_COLUMNS` (question text, options A–D, answer, analysis, knowledge points, difficulty, question type, subject, grade and semester, source, section, label), so it can be re-imported directly via Question Bank Import:

- Trailing option lines like "A．xxx" in the question text are split into the option columns and joined back on import.
- Question types are written as Chinese display names (the importer maps them back to standard keys via its alias table); knowledge points are joined with "、"; difficulty is written as a 1–5 number.
- Images are not written to Excel (the importer does not support an image column either).
- The header row is frozen and bold; column widths are adjusted per content type.

### Word

A `.docx` file, suitable for printing as an exam paper:

- The document title can be customized (defaults to "Wrong Questions Export yyyy-MM-dd").
- Questions are grouped by section (or by question type display name when no section, or not grouped at all); group headings are written as "第X大题 …" with continuous numbering.
- Optional "Include answers and analysis" (enabled by default): placed in an "参考答案" section at the end, written as "N. 答案：… 解析：…" so the importer can fill them back by question number.
- Optional "Include original images": images are scaled proportionally to a width limit; webp is not written.
- LaTeX formulas ($…$, $$…$$) are kept as-is; `figureSvg` is not exported; Markdown bold/italic markers are preserved verbatim.

**Difference from full backup**: the question exchange format contains only question content (question text, answer, analysis, knowledge points, difficulty, etc.) and does not include practice records, review schedules, exam papers, user preferences, or other data. For a full backup, use "Settings → Data Management → Export Data".

## Design Principles

- **Forward compatible**: the parser is lenient and ignores unknown fields; adding fields does not bump the version, only breaking changes do.
- **Locatable errors**: questions are validated individually; a bad question does not block the rest. `errors` carries the 0-based question index plus a stable English error code (e.g. `TEXT_REQUIRED`, `TEXT_TOO_LONG`, `INVALID_DIFFICULTY`).
- **Lenient parsing**: a root array is treated as the `questions` array; missing `format`/`version` falls back to v1 with warnings; a `version` greater than 1 yields a warning while known fields are still parsed.

## File Structure

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "exportedAt": "2025-11-04T10:30:00.000Z",
  "generator": "my-app",
  "questions": [ /* see table below */ ]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| format | string | yes | Always `wrong-notebook-questions` |
| version | number | yes | Currently `1` |
| exportedAt | string | no | ISO 8601 export timestamp |
| generator | string | no | Generator identifier (app name or version) |
| questions | Question[] | yes | Question array, up to 5000 items |

## Question Fields

Field names match the batch-draft convention (`answer` / `analysis` / `knowledgePoints` / `difficultyStars` / `wrongAnswer`). Everything except `text` is optional.

| Field | Type | Limit | Description |
| --- | --- | --- | --- |
| text | string | 20000 | Question stem (required; non-empty after trimming) |
| material | string | 20000 | Shared material / passage |
| section | string | 500 | Section / big-question title |
| label | string | 20 | Original question number or label |
| answer | string | 20000 | Answer |
| analysis | string | 50000 | Solution analysis |
| knowledgePoints | string[] | 100 items, 200 each | Knowledge point tags; a delimited string is also accepted on parse |
| difficultyStars | integer | 1-5 | Difficulty in stars; numeric strings (e.g. `"3"`) are also accepted |
| wrongAnswer | string | 20000 | Student's wrong answer |
| subject | string | 100 | Subject name or key (e.g. `"数学"` or `"math"`) |
| gradeSemester | string | 100 | Grade and semester |
| source | string | 200 | Source (e.g. `"2025 期中"`) |
| questionType | string | 100 | Question type (kept as-is) |
| figureSvg | string | 100000 | Figure SVG markup (same as `MAX_FIGURE_SVG_LENGTH` when saving questions) |
| images | { dataUrl: string, alt?: string }[] | 10 items, ~5MB chars each | Embedded images; only `data:image/png|jpeg|webp;base64` allowed |
| extensions | Record<string, unknown> | — | Third-party extension fields, preserved as-is |

## Error Codes and Warning Codes

### Error codes (errors)

`index` is the 0-based question index; `index = -1` means a **whole-file error** (not a per-question problem).

| Code | Description |
| --- | --- |
| `QUESTIONS_REQUIRED` (index=-1) | Object root but `questions` is missing or not an array |
| `INVALID_QUESTION_SHAPE` (index=-1) | Root input is not an object or array at all |
| `INVALID_QUESTION_SHAPE` (index≥0) | Question is not an object, or a field has a completely wrong type |
| `TEXT_REQUIRED` | Question stem is empty (nothing left after trimming) |
| `TEXT_TOO_LONG` | Stem exceeds 20000 characters |
| `MATERIAL_TOO_LONG` | Material exceeds 20000 characters |
| `SECTION_TOO_LONG` | Section title exceeds 500 characters |
| `LABEL_TOO_LONG` | Label exceeds 20 characters |
| `ANSWER_TOO_LONG` | Answer exceeds 20000 characters |
| `ANALYSIS_TOO_LONG` | Analysis exceeds 50000 characters |
| `INVALID_DIFFICULTY` | Difficulty is not an integer 1-5 (numeric strings included) |
| `WRONG_ANSWER_TOO_LONG` | Wrong answer exceeds 20000 characters |
| `SUBJECT_TOO_LONG` | Subject exceeds 100 characters |
| `GRADE_SEMESTER_TOO_LONG` | Grade/semester exceeds 100 characters |
| `SOURCE_TOO_LONG` | Source exceeds 200 characters |
| `QUESTION_TYPE_TOO_LONG` | Question type exceeds 100 characters |
| `KNOWLEDGE_POINT_TOO_LONG` | Single knowledge point exceeds 200 characters |
| `TOO_MANY_KNOWLEDGE_POINTS` | More than 100 knowledge points |
| `INVALID_IMAGE_DATA_URL` | Image dataUrl lacks the `data:image/png|jpeg|webp;base64` prefix |
| `IMAGE_TOO_LARGE` | Single image dataUrl exceeds ~5MB characters (5242880) |
| `TOO_MANY_IMAGES` | More than 10 images |
| `FIGURE_SVG_TOO_LONG` | Figure SVG exceeds 100000 characters |

### Warning codes (warnings)

| Code | Description |
| --- | --- |
| `MISSING_FORMAT` | Root object lacks the `format` field |
| `UNKNOWN_FORMAT` | `format` is present but not `wrong-notebook-questions` |
| `MISSING_VERSION` | Root object lacks the `version` field |
| `UNSUPPORTED_VERSION` | `version` is greater than 1 (known fields are still parsed) |
| `TOO_MANY_QUESTIONS` | More than 5000 questions, truncated |

## Lenient Rules

- A root array is treated as `questions`, with `MISSING_FORMAT` and `MISSING_VERSION` warnings.
- Missing `format` or `version` falls back to v1 with the corresponding warning; a `format` that does not match yields `UNKNOWN_FORMAT`; a `version` greater than 1 yields `UNSUPPORTED_VERSION` while known fields are still parsed.
- Object root with `questions` missing or not an array returns `errors=[{index:-1, reason:'QUESTIONS_REQUIRED'}]` (index=-1 means a whole-file error).
- A completely unrecognized root input (neither object nor array) returns `errors=[{index:-1, reason:'INVALID_QUESTION_SHAPE'}]`.
- Unknown fields are ignored; empty strings are treated as missing and omitted from the result.
- More than 5000 questions are truncated with a `TOO_MANY_QUESTIONS` warning.
- Invalid questions are reported in `errors` (0-based index); the rest are returned as usual.

## Versioning Policy

- **Adding fields does not bump the version**: the parser ignores unknown fields, so old files keep importing in newer software.
- **Only breaking changes bump the version**: removing/renaming fields, changing field semantics, or tightening required constraints. When bumping, keep the ability to parse the previous version.
- Current version: `1`.

## Examples

Minimal example (stem only):

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "questions": [
    { "text": "Compute: 3^2 + 4^2 = ____." }
  ]
}
```

Full example (all fields) see `doc/schemas/questions-v1.example.json`:

```json
{
  "format": "wrong-notebook-questions",
  "version": 1,
  "questions": [
    {
      "text": "Read the material and answer the question.",
      "material": "A shop purchased a batch of goods...",
      "section": "III. Solutions",
      "label": "21",
      "answer": "Each item sells for 120 yuan.",
      "analysis": "Cost 100 yuan, 20% profit margin, price = 100 x (1 + 20%) = 120 yuan.",
      "knowledgePoints": ["linear-equation", "profit"],
      "difficultyStars": 3,
      "wrongAnswer": "Each item sells for 130 yuan.",
      "subject": "math",
      "gradeSemester": "Grade 7, First Semester",
      "source": "2025 midterm",
      "questionType": "solution"
    }
  ]
}
```
