# TOOLS.md — FileBot

## The gap this closes (2026-08-20)

OpenClaw has no built-in document-generation tool — the only native
`*_generate` tools are `image_generate`, `video_generate`, and
`music_generate`. Checked directly against the installed OpenClaw tool
catalog, not assumed. That means, before this file existed, you had no
actual way to produce a Word/Excel/PowerPoint file — and a check of every
real session you've ever had confirmed exactly that: zero tool calls,
ever. This file is the fix: a concrete recipe using your existing `exec`
tool, not a new native tool.

## Libraries available to you

Three pure-JS npm packages are installed at
`/home/OpenMT/OpenMT/filebot-tools/node_modules/` (already `npm install`'d
— don't try to install them yourself, they're there):

- **Word** → [`docx`](https://docx.js.org/) — build a `Document`, `Packer.toBuffer()`, write it.
- **Excel** → [`exceljs`](https://github.com/exceljs/exceljs) — `Workbook`/`Worksheet`, `wb.xlsx.writeFile(path)`.
- **PowerPoint** → [`pptxgenjs`](https://gitbrent.github.io/PptxGenJS/) — `addSlide()`, `addText()`/`addTable()`/`addImage()`, `pres.writeFile({fileName})`.

## The recipe

1. Write a small, single-purpose Node.js script that builds the requested
   file, **inside `/home/OpenMT/OpenMT/filebot-tools/`** (so its
   `require("docx")` etc. resolve against that directory's
   `node_modules` — they won't resolve from anywhere else). Name it
   something disposable, e.g. `job-<job id>.js` — it's scratch, not
   something to keep around.
2. Have the script save its output to
   `~/.openclaw/media/tool-document-generation/<short-slug>---<uuid>.<ext>`
   (create the directory first if it doesn't exist, mode `0700` — mirror
   PictureBot's own `tool-image-generation` convention exactly, both for
   consistency and because the Work Registry daemon already knows how to
   look for a `MEDIA:` reference in this shape). Generate the uuid however
   is convenient (e.g. `require("crypto").randomUUID()`).
3. Run it: `node /home/OpenMT/OpenMT/filebot-tools/job-<job id>.js`.
4. **Verify before calling it done** — this is your own Definition of
   Done in `AGENTS.md`, not optional: confirm the file exists and is a
   real, non-empty file (`fs.statSync(path).size > 0` is a minimal check;
   for extra confidence you can re-open it with the same library — e.g.
   load the `.xlsx` back with `exceljs` and check the expected sheet/row
   count — before telling anyone it's ready).
5. Delete the scratch script once you're done with it — it's not the
   deliverable, the generated file is.
6. In your final reply, include a line `MEDIA:<absolute path to the
   generated file>` — that's what makes OpenClaw actually attach it to
   the Discord message. Without this line, the file exists on disk but
   nobody sees it.

## A worked example (Word)

```js
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const fs = require("fs");
const crypto = require("crypto");

const doc = new Document({
  sections: [{
    children: [
      new Paragraph({ text: "Report Title", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun("Body text goes here.")] }),
    ],
  }],
});

const dir = "/home/OpenMT/.openclaw/media/tool-document-generation";
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const outPath = `${dir}/report---${crypto.randomUUID()}.docx`;

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log("MEDIA:" + outPath); // the script's own stdout — you still put the real MEDIA: line in your chat reply
});
```

Excel and PowerPoint follow the same shape: build the content with the
library's own object model, write to the same media directory, print
(and then reply with) the `MEDIA:` line.

## Formulas staying live (Excel)

Your own Definition of Done says formulas must remain live formulas, not
just their computed values. In `exceljs`, set a cell's `.value` to
`{ formula: "SUM(A1:A10)" }` (not a plain number) when the source data
called for a formula — don't pre-compute it yourself and drop in a static
number.
