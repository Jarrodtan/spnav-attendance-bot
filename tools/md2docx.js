// Minimal Markdown -> .docx for the bot guides (headings, paragraphs, lists, tables, code blocks, quotes)
// Usage: npm run guides   (rebuilds guides-for-google-docs/ from docs/*.md)
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType
} = require("docx");

const [, , input, output, title] = process.argv;
const lines = fs.readFileSync(input, "utf8").replace(/\r\n/g, "\n").split("\n");

const FONT = "Arial", MONO = "Consolas";
const PAGE_W = 11906, MARGIN = 1134, CONTENT_W = PAGE_W - MARGIN * 2; // A4, 2 cm margins

// Inline: **bold**, _italic_ / *italic*, `code`
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\b_[^_]+_\b|\*[^*\s][^*]*\*)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, ...base }));
    const t = m[0];
    if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, ...base }));
    else if (t.startsWith("`")) out.push(new TextRun({ text: t.slice(1, -1), font: MONO, shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" }, ...base }));
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true, font: FONT, ...base }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, ...base }));
  return out.length ? out : [new TextRun({ text: "", font: FONT })];
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
function table(rows) {
  const data = rows.filter(r => !/^\|\s*-/.test(r)).map(r => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
  const cols = data[0].length;
  const widths = Array(cols).fill(Math.floor(CONTENT_W / cols));
  widths[cols - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: data.map((row, ri) => new TableRow({
      tableHeader: ri === 0,
      children: row.map((c, ci) => new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        shading: ri === 0 ? { type: ShadingType.CLEAR, fill: "DCE6F2", color: "auto" } : undefined,
        borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: runs(c, ri === 0 ? { bold: true } : {}) })]
      }))
    }))
  });
}

const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, font: FONT })] })];
let i = 0, listInstance = 0;
while (i < lines.length) {
  const line = lines[i];
  if (/^```/.test(line)) { // code block -> shaded monospace box
    const code = [];
    for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
    i++;
    code.forEach((c, k) => children.push(new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
      spacing: { before: k === 0 ? 120 : 0, after: k === code.length - 1 ? 120 : 0 },
      indent: { left: 200, right: 200 },
      children: [new TextRun({ text: c || " ", font: MONO, size: 19 })]
    })));
    continue;
  }
  if (/^\|/.test(line)) {
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
    children.push(table(rows), new Paragraph({ children: [] }));
    continue;
  }
  i++;
  if (/^#{1}\s/.test(line) && children.length === 1) continue; // drop the file's own H1 (title used instead)
  if (/^###\s*SP Navigators Attendance Bot/.test(line)) continue;
  let m;
  if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
    const level = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][m[1].length - 1];
    listInstance++; // numbered lists restart at 1 under each heading
    children.push(new Paragraph({ heading: level, children: runs(m[2]) }));
  } else if (/^---\s*$/.test(line)) {
    children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 1 } }, children: [] }));
  } else if ((m = line.match(/^(\s*)[-*]\s+(?:\[ \]\s+)?(.*)/))) {
    children.push(new Paragraph({ numbering: { reference: "bullets", level: m[1].length >= 2 ? 1 : 0 }, children: runs(m[2]) }));
  } else if ((m = line.match(/^\s*\d+\.\s+(.*)/))) {
    children.push(new Paragraph({ numbering: { reference: "numbers", level: 0, instance: listInstance }, children: runs(m[1]) }));
  } else if ((m = line.match(/^>\s?(.*)/))) {
    children.push(new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: "FFF8E1", color: "auto" },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: "F2C744", space: 6 } },
      children: runs(m[1])
    }));
  } else if (line.trim()) {
    children.push(new Paragraph({ children: runs(line) }));
  }
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", run: { size: 40, bold: true, color: "1F3864" }, paragraph: { spacing: { after: 240 } } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 30, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 300, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: "2E5597" }, paragraph: { spacing: { before: 220, after: 80 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 270 } } } }
      ] },
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }
      ] }
    ]
  },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    children
  }]
});

Packer.toBuffer(doc).then(b => { fs.writeFileSync(output, b); console.log("wrote", output); });
