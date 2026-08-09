

import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";





function mdToHtml(md: string): string {
	if (!md) return "";

	
	let text = md.replace(/^---[\s\S]*?---\n?/, "").trim();

	
	text = text.replace(/```(\w*)\s*\n([\s\S]*?)\n```/g, (_m, lang, code) => {
		const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
	});

	
	text = text.replace(/^### (.*$)/gim, "<h3>$1</h3>");
	text = text.replace(/^## (.*$)/gim, "<h2>$1</h2>");
	text = text.replace(/^# (.*$)/gim, "<h1>$1</h1>");

	
	text = text.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

	
	text = text.replace(/^\|(.+)\|$/gim, (_line, content) => {
		const cells = content.split("|").map((c: string) => c.trim());
		if (cells.every((c: string) => /^:?-+:?$/.test(c))) {
			return "<!--table-header-sep-->";
		}
		const cellHtml = cells.map((c: string) => `<td>${inlineFormat(c)}</td>`).join("");
		return `<tr>${cellHtml}</tr>`;
	});

	
	text = text.replace(/(?:<tr>.*?<\/tr>\s*)+/g, (match) => {
		const clean = match.replace(/<!--table-header-sep-->\s*/g, "");
		return `<table class="report-table">${clean}</table>`;
	});

	
	text = inlineFormat(text);

	
	text = text.replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>");
	text = text.replace(/(?:<li>.*?<\/li>\s*)+/g, (match) => `<ul>${match}</ul>`);

	
	const blocks = text.split(/\n{2,}/).map((block) => {
		const trimmed = block.trim();
		if (/^<(h[1-6]|ul|ol|pre|table|blockquote)/i.test(trimmed)) {
			return trimmed;
		}
		if (trimmed) return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
		return "";
	});

	return blocks.join("\n\n");
}

function inlineFormat(text: string): string {
	return text
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="#$2">$1</a>');
}





const STYLES = `
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface-border: #334155;
  --text: #f8fafc;
  --text-muted: #94a3b8;
  --primary: #38bdf8;
  --primary-hover: #0284c7;
  --accent: #a855f7;
  --success: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f8fafc;
    --surface: #ffffff;
    --surface-border: #e2e8f0;
    --text: #0f172a;
    --text-muted: #64748b;
    --primary: #0284c7;
    --primary-hover: #0369a1;
    --accent: #7e22ce;
    --success: #16a34a;
    --warning: #d97706;
    --danger: #dc2626;
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 2rem 1rem;
}
.container { max-width: 1000px; margin: 0 auto; }
header {
  border-bottom: 2px solid var(--surface-border);
  padding-bottom: 1.5rem;
  margin-bottom: 2rem;
}
h1 { font-size: 2.25rem; margin-bottom: 0.5rem; color: var(--text); }
h2 { font-size: 1.5rem; margin: 2rem 0 1rem; color: var(--primary); border-bottom: 1px solid var(--surface-border); padding-bottom: 0.5rem; }
h3 { font-size: 1.2rem; margin: 1.5rem 0 0.5rem; color: var(--text); }
p { margin-bottom: 1rem; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }

.badge {
  display: inline-block;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 9999px;
  background: var(--surface-border);
  color: var(--text);
}
.badge-success { background: rgba(34, 197, 94, 0.2); color: var(--success); }
.badge-warning { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
.badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); }

.card {
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: 0.5rem;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.bottom-line-card {
  background: var(--surface);
  border-left: 4px solid var(--primary);
}

table.report-table {
  width: 100%;
  border-collapse: collapse;
  margin: 1rem 0;
  font-size: 0.9rem;
}
table.report-table th, table.report-table td {
  border: 1px solid var(--surface-border);
  padding: 0.6rem 0.8rem;
  text-align: left;
}
table.report-table th { background: var(--surface-border); }

ul { margin-left: 1.5rem; margin-bottom: 1rem; }
li { margin-bottom: 0.4rem; }

details {
  background: var(--surface);
  border: 1px solid var(--surface-border);
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
}
summary {
  font-weight: 600;
  cursor: pointer;
  color: var(--primary);
}
details[open] summary { margin-bottom: 1rem; border-bottom: 1px solid var(--surface-border); padding-bottom: 0.5rem; }

pre {
  background: #000;
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  font-size: 0.85rem;
  margin: 1rem 0;
}
blockquote {
  border-left: 3px solid var(--primary);
  padding-left: 1rem;
  margin: 1rem 0;
  font-style: italic;
  color: var(--text-muted);
}
.meta-line { color: var(--text-muted); font-size: 0.875rem; margin-top: 0.5rem; }
`;





export async function renderReport(okfDir: string): Promise<string> {
	const readSafe = async (relPath: string): Promise<string> => {
		try {
			return await readFile(join(okfDir, relPath), "utf8");
		} catch {
			return "";
		}
	};

	const indexMd = await readSafe("index.md");
	const synthesisMd = await readSafe("synthesis/index.md");
	const logMd = await readSafe("log.md");
	const supportingMd = await readSafe("evidence/supporting.md");
	const contradictingMd = await readSafe("evidence/contradicting.md");
	const gapsMd = await readSafe("evidence/gaps.md");
	const sourcesMd = await readSafe("evidence/sources.md");

	
	let hypothesesHtml = "";
	try {
		const files = await readdir(join(okfDir, "hypotheses"));
		for (const f of files) {
			if (f.endsWith(".md")) {
				const content = await readFile(join(okfDir, "hypotheses", f), "utf8");
				hypothesesHtml += `<div class="card">${mdToHtml(content)}</div>\n`;
			}
		}
	} catch {}

	
	let techniquesHtml = "";
	try {
		const files = await readdir(join(okfDir, "techniques"));
		for (const f of files.sort()) {
			if (f.endsWith(".md")) {
				const content = await readFile(join(okfDir, "techniques", f), "utf8");
				const name = f.replace(".md", "").toUpperCase();
				techniquesHtml += `
<details>
  <summary>${name} Technique Output</summary>
  ${mdToHtml(content)}
</details>\n`;
			}
		}
	} catch {}

	
	let adversarialHtml = "";
	try {
		const files = await readdir(join(okfDir, "adversarial"));
		for (const f of files.sort()) {
			if (f.endsWith(".md")) {
				const content = await readFile(join(okfDir, "adversarial", f), "utf8");
				const name = f.replace("-critique.md", "").toUpperCase();
				adversarialHtml += `
<details>
  <summary>Adversarial Critique: ${name}</summary>
  ${mdToHtml(content)}
</details>\n`;
			}
		}
	} catch {}

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SAT-12 Executive Analysis Report</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="container">
    <header>
      <span class="badge badge-success">OKF v0.2 Validated</span>
      ${mdToHtml(indexMd)}
    </header>

    <section id="synthesis">
      <h2>Synthesis & Bottom-Line Assessment</h2>
      <div class="card bottom-line-card">
        ${mdToHtml(synthesisMd)}
      </div>
    </section>

    ${
			hypothesesHtml
				? `
    <section id="hypotheses">
      <h2>Competing Hypotheses (ACH)</h2>
      ${hypothesesHtml}
    </section>`
				: ""
		}

    <section id="evidence">
      <h2>Evidence & Web Resources</h2>
      ${supportingMd ? `<div class="card"><h3>Supporting Evidence</h3>${mdToHtml(supportingMd)}</div>` : ""}
      ${contradictingMd ? `<div class="card"><h3>Contradicting Evidence</h3>${mdToHtml(contradictingMd)}</div>` : ""}
      ${gapsMd ? `<div class="card"><h3>Intelligence Gaps</h3>${mdToHtml(gapsMd)}</div>` : ""}
      ${sourcesMd ? `<div class="card"><h3>Gathered Web Sources</h3>${mdToHtml(sourcesMd)}</div>` : ""}
    </section>

    ${
			techniquesHtml
				? `
    <section id="techniques">
      <h2>12 CIA Tradecraft Techniques</h2>
      ${techniquesHtml}
    </section>`
				: ""
		}

    ${
			adversarialHtml
				? `
    <section id="adversarial">
      <h2>Adversarial Critique & Rebuttal</h2>
      ${adversarialHtml}
    </section>`
				: ""
		}

    ${
			logMd
				? `
    <section id="log">
      <h2>Execution Log</h2>
      <div class="card">${mdToHtml(logMd)}</div>
    </section>`
				: ""
		}
  </div>
</body>
</html>
`;

	const reportPath = join(okfDir, "report.html");
	const tmpPath = `${reportPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	await writeFile(tmpPath, html, "utf8");
	await rename(tmpPath, reportPath);
	return reportPath;
}
