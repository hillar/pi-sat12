

import { mkdir, writeFile, rename, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function writeAtomicFile(filePath: string, content: string, encoding: BufferEncoding = "utf8"): Promise<void> {
	const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	await writeFile(tmpPath, content, encoding);
	await rename(tmpPath, filePath);
}
import type { TechniqueResult } from "./techniques/types.ts";
import type { AdversarialExchange } from "./adversarial.ts";
import type { SynthesisOutput } from "./synthesis.ts";
import type { AchOutput } from "./techniques/diagnostic/ach.ts";
import { ALL_TECHNIQUES } from "./techniques/index.ts";





type YamlValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| YamlValue[]
	| { [k: string]: YamlValue };

function yamlValue(v: YamlValue, indent = 0): string {
	const pad = "  ".repeat(indent);
	if (v == null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return String(v);
	if (typeof v === "string") {
		
		if (!v.includes("\n") && !v.includes(":") && !v.includes("#") && v.trim() === v) {
			return v || '""';
		}
		
		const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		return `"${escaped}"`;
	}
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		return v
			.map((item) => {
				if (typeof item === "object" && item !== null && !Array.isArray(item)) {
					const entries = Object.entries(item as Record<string, YamlValue>);
					if (entries.length === 0) return `${pad}- {}`;
					const [first, ...rest] = entries;
					const firstLine = `${pad}- ${first[0]}: ${yamlValue(first[1], indent + 1)}`;
					const restLines = rest.map(
						([k, val]) => `${pad}  ${k}: ${yamlValue(val, indent + 1)}`,
					);
					return [firstLine, ...restLines].join("\n");
				}
				return `${pad}- ${yamlValue(item, indent)}`;
			})
			.join("\n");
	}
	if (typeof v === "object") {
		const entries = Object.entries(v).filter(([, val]) => val != null);
		if (entries.length === 0) return "{}";
		return entries
			.map(([k, val]) => `${pad}${k}: ${yamlValue(val as YamlValue, indent + 1)}`)
			.join("\n");
	}
	return String(v);
}

function frontmatter(fields: Record<string, YamlValue>): string {
	const nonNull = Object.entries(fields).filter(([, v]) => v != null && v !== undefined);
	const lines = nonNull.map(([k, v]) => {
		if (Array.isArray(v)) {
			if (v.length === 0) return `${k}: []`;
			return `${k}:\n${yamlValue(v, 1)}`;
		}
		if (typeof v === "object" && v !== null) {
			return `${k}:\n${yamlValue(v, 1)}`;
		}
		return `${k}: ${yamlValue(v)}`;
	});
	return `---\n${lines.join("\n")}\n---\n`;
}





function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.slice(0, 60);
}





function formatTimestamp(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
		`-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}





export interface WebResource {
	id?: string;
	title: string;
	url: string;
}

export function extractWebResources(evidenceText: string | undefined): WebResource[] {
	if (!evidenceText) return [];
	const resources: WebResource[] = [];
	const seenUrls = new Set<string>();

	
	
	
	const blockRegex = /##\s*\[([^\]]+)\]\s*(.+?)\n[\s\S]*?- URL:\s*(https?:\/\/[^\s\n]+)/g;
	let match: RegExpExecArray | null;
	while ((match = blockRegex.exec(evidenceText)) !== null) {
		const [, id, title, url] = match;
		if (!seenUrls.has(url)) {
			seenUrls.add(url);
			resources.push({ id, title: title.trim(), url: url.trim() });
		}
	}

	
	if (resources.length === 0) {
		const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
		while ((match = linkRegex.exec(evidenceText)) !== null) {
			const [, title, url] = match;
			if (!seenUrls.has(url)) {
				seenUrls.add(url);
				resources.push({ title: title.trim(), url: url.trim() });
			}
		}
	}

	
	if (resources.length === 0) {
		const urlRegex = /(https?:\/\/[^\s\n<>()]+)/g;
		while ((match = urlRegex.exec(evidenceText)) !== null) {
			const url = match[1];
			if (!seenUrls.has(url)) {
				seenUrls.add(url);
				resources.push({ title: url, url });
			}
		}
	}

	return resources;
}





async function writeRootIndex(
	dir: string,
	question: string,
	synthesis: SynthesisOutput,
): Promise<void> {
	const fm = frontmatter({
		okf_version: "0.2",
		type: "Analysis",
		title: `SAT-12 Analysis`,
		description: question.slice(0, 200),
		generated: { by: "sat12/0.1", at: new Date().toISOString() },
		status: "stable",
	});
	const body = [
		`# SAT-12 Analysis`,
		"",
		`**Question:** ${question}`,
		"",
		`## Bottom-Line Assessment`,
		"",
		synthesis.bottom_line_assessment,
		"",
		`## Contents`,
		"",
		`- [Log](log.md)`,
		`- [Hypotheses](hypotheses/)`,
		`- [Evidence](evidence/)`,
		`- [Techniques](techniques/)`,
		`- [Adversarial](adversarial/)`,
		`- [Synthesis](synthesis/index.md)`,
	].join("\n");
	await writeAtomicFile(join(dir, "index.md"), fm + "\n" + body + "\n", "utf8");
}

export interface ExecutionTimings {
	startTime?: string;
	totalDurationMs?: number;
	researchDurationMs?: number;
	techniquesDurationMs?: number;
	adversarialDurationMs?: number;
	synthesisDurationMs?: number;
}

function formatModelMetricsTable(usage?: import("./llm.ts").UsageAccumulator): string {
	if (!usage || !usage.byModel || Object.keys(usage.byModel).length === 0) {
		if (usage?.total) {
			const t = usage.total;
			return [
				`| Total Input Tokens (Sent) | Total Output Tokens (Gen) | Total Combined Tokens |`,
				`|---|---|---|`,
				`| ${t.input.toLocaleString()} | ${t.output.toLocaleString()} | ${t.totalTokens.toLocaleString()} |`,
			].join("\n");
		}
		return "_No model token usage recorded._";
	}

	const rows = Object.values(usage.byModel).map((m) => {
		const roleLabel =
			m.role === "primary"
				? "Primary Model"
				: m.role === "challenger"
				? "Challenger Model"
				: m.role === "secondary"
				? "Secondary Model"
				: "Model";
		const durSec = m.durationMs > 0 ? (m.durationMs / 1000).toFixed(1) + "s" : "N/A";
		const outSpeed = m.durationMs > 0 ? (m.outputTokens / (m.durationMs / 1000)).toFixed(1) + " tok/s" : "N/A";
		const totSpeed = m.durationMs > 0 ? (m.totalTokens / (m.durationMs / 1000)).toFixed(1) + " tok/s" : "N/A";

		return `| **${roleLabel}** | \`${m.modelId}\` | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${m.totalTokens.toLocaleString()} | ${durSec} | ${outSpeed} | ${totSpeed} | ${m.calls} |`;
	});

	return [
		`| Model Role | Model ID | Tokens Sent (Input) | Tokens Gen (Output) | Total Tokens | Duration | Gen Speed | Overall Speed | Calls |`,
		`|---|---|---|---|---|---|---|---|---|`,
		...rows,
	].join("\n");
}

async function writeLogPage(
	dir: string,
	question: string,
	techniqueResults: Record<string, TechniqueResult>,
	adversarialExchanges: Record<string, AdversarialExchange>,
	evidenceText?: string,
	timings?: ExecutionTimings,
	usage?: import("./llm.ts").UsageAccumulator,
): Promise<void> {
	const succeeded = Object.values(techniqueResults).filter((r) => r.status === "success").length;
	const adversarialCount = Object.keys(adversarialExchanges).length;
	const webResources = extractWebResources(evidenceText);

	const fmtSec = (ms?: number) => (ms != null ? `${(ms / 1000).toFixed(1)}s` : "N/A");

	const fm = frontmatter({
		type: "Log",
		title: "Analysis Execution Log",
		generated: { by: "sat12/0.1", at: timings?.startTime || new Date().toISOString() },
		status: "stable",
	});

	const techniqueLines = ALL_TECHNIQUES.map((t) => {
		const r = techniqueResults[t.id];
		const durationStr = r?.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
		const status = r?.status === "success" ? "✓ Success" : r?.status === "failed" ? "✗ Failed" : "— Not Run";
		return `| ${t.name} | Layer ${t.layer} | ${status} | ${durationStr} |`;
	});

	const sourcesLines = webResources.length > 0
		? webResources.map((r, i) => `${i + 1}. ${r.id ? `**[${r.id}]** ` : ""}[${r.title}](${r.url})`).join("\n")
		: "_No external web sources gathered or research was skipped._";

	const modelMetricsTable = formatModelMetricsTable(usage);

	const body = [
		`# Analysis Execution Log`,
		"",
		`**Question:** ${question}`,
		`**Timestamp:** ${timings?.startTime || new Date().toISOString()}`,
		"",
		`## Execution Timings`,
		"",
		`| Execution Phase | Duration | Details |`,
		`|---|---|---|`,
		`| **Total Pipeline Duration** | **${fmtSec(timings?.totalDurationMs)}** | Complete execution |`,
		`| Web Research Phase | ${fmtSec(timings?.researchDurationMs)} | ${webResources.length} sources gathered |`,
		`| 12-Technique Execution | ${fmtSec(timings?.techniquesDurationMs)} | ${succeeded}/${ALL_TECHNIQUES.length} succeeded |`,
		`| Adversarial Critique | ${fmtSec(timings?.adversarialDurationMs)} | ${adversarialCount} critique cycles |`,
		`| Cross-Technique Synthesis | ${fmtSec(timings?.synthesisDurationMs)} | Consolidated assessment |`,
		"",
		`## Model Token & Velocity Metrics`,
		"",
		modelMetricsTable,
		"",
		`## Gathered Web Sources (${webResources.length})`,
		"",
		sourcesLines,
		"",
		`## Technique Execution Breakdown`,
		"",
		`| Technique | Layer | Status | Duration |`,
		`|---|---|---|---|`,
		...techniqueLines,
	].join("\n");

	await writeAtomicFile(join(dir, "log.md"), fm + "\n" + body + "\n", "utf8");
}

async function writeHypotheses(
	dir: string,
	achResult: TechniqueResult | undefined,
): Promise<void> {
	await mkdir(join(dir, "hypotheses"), { recursive: true });

	if (!achResult || achResult.status !== "success" || !achResult.output) {
		
		const fm = frontmatter({ type: "Hypothesis", title: "No ACH output", status: "stable" });
		await writeAtomicFile(
			join(dir, "hypotheses", "index.md"),
			fm + "\n_ACH technique did not produce output._\n",
			"utf8",
		);
		return;
	}

	const ach = achResult.output as AchOutput;
	for (const hyp of ach.hypotheses) {
		const s = slug(hyp.text);
		const score = ach.inconsistency_scores.find((sc) => sc.id === hyp.id);
		const isLeading = ach.leading_hypothesis.includes(hyp.text) ||
			ach.leading_hypothesis.toLowerCase().includes(hyp.id.toLowerCase());

		const fm = frontmatter({
			type: "Hypothesis",
			title: hyp.text.slice(0, 120),
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			context: {
				hypothesis_id: hyp.id,
				inconsistency_score: score?.score ?? null,
				is_leading: isLeading,
			},
			sources: [{ resource: "techniques/ach.md" }],
		});

		const body = [
			`# ${hyp.id}: ${hyp.text}`,
			"",
			`**Inconsistency score:** ${score?.score ?? "N/A"}`,
			`**Status:** ${isLeading ? "Leading hypothesis" : "Competing hypothesis"}`,
			"",
			`## ACH Analysis`,
			"",
			ach.analysis,
		].join("\n");

		await writeAtomicFile(join(dir, "hypotheses", `${s || hyp.id}.md`), fm + "\n" + body + "\n", "utf8");
	}
}

async function writeEvidence(
	dir: string,
	techniqueResults: Record<string, TechniqueResult>,
	evidenceText?: string,
): Promise<void> {
	await mkdir(join(dir, "evidence"), { recursive: true });

	const webResources = extractWebResources(evidenceText);
	const webSourcesSection = webResources.length > 0
		? "\n\n## Web Resources & Links\n\n" +
			webResources.map((r) => `- ${r.id ? `**[${r.id}]** ` : ""}[${r.title}](${r.url})`).join("\n")
		: "";

	
	const ach = techniqueResults["ach"]?.output as AchOutput | undefined;
	const leadingId = ach?.leading_hypothesis
		? ach.hypotheses.find((h) =>
				ach.leading_hypothesis.includes(h.text) ||
				ach.leading_hypothesis.toLowerCase().includes(h.id.toLowerCase()),
			)?.id
		: undefined;

	const supporting = ach?.matrix
		?.filter((c) => c.hypothesis_id === leadingId && c.rating === "Consistent")
		.map((c) => `- **${c.evidence_id}**: ${c.explanation}`)
		.join("\n");

	const contradicting = ach?.matrix
		?.filter((c) => c.hypothesis_id === leadingId && c.rating === "Inconsistent")
		.map((c) => `- **${c.evidence_id}**: ${c.explanation}`)
		.join("\n");

	const quality = techniqueResults["quality"]?.output as
		| { gaps?: string[] }
		| undefined;
	const gapsList = quality?.gaps?.map((g) => `- ${g}`).join("\n") ?? "";

	const fmEv = (title: string) =>
		frontmatter({
			type: "Evidence",
			title,
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			sources: [{ resource: "techniques/ach.md" }, { resource: "techniques/quality.md" }],
		});

	await writeAtomicFile(
		join(dir, "evidence", "supporting.md"),
		fmEv("Supporting Evidence") +
			"\n# Supporting Evidence\n\n" +
			(supporting || "_No supporting evidence identified._") +
			webSourcesSection +
			"\n",
		"utf8",
	);

	await writeAtomicFile(
		join(dir, "evidence", "contradicting.md"),
		fmEv("Contradicting Evidence") +
			"\n# Contradicting Evidence\n\n" +
			(contradicting || "_No contradicting evidence identified._") +
			webSourcesSection +
			"\n",
		"utf8",
	);

	await writeAtomicFile(
		join(dir, "evidence", "gaps.md"),
		frontmatter({
			type: "Evidence",
			title: "Intelligence Gaps",
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			sources: [{ resource: "techniques/quality.md" }],
		}) +
			"\n# Intelligence Gaps\n\n" +
			(gapsList || "_No gaps identified._") +
			"\n",
		"utf8",
	);

	const sourcesBody = webResources.length > 0
		? [
				"# Web Resources & Sources",
				"",
				"The following external web sources were gathered and evaluated during the research phase:",
				"",
				...webResources.map((r) => `- **[${r.id ?? "Web"}]** [${r.title}](${r.url}) — ${r.url}`),
			].join("\n")
		: "# Web Resources & Sources\n\n_No external web sources gathered or research was skipped._";

	await writeAtomicFile(
		join(dir, "evidence", "sources.md"),
		frontmatter({
			type: "Evidence",
			title: "Web Resources & Sources",
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
		}) + "\n" + sourcesBody + "\n",
		"utf8",
	);
}

async function writeTechniquePages(
	dir: string,
	techniqueResults: Record<string, TechniqueResult>,
): Promise<void> {
	await mkdir(join(dir, "techniques"), { recursive: true });

	for (const tech of ALL_TECHNIQUES) {
		const result = techniqueResults[tech.id];
		const depLinks = tech.dependencies.map((dep) => `- [${dep}](${dep}.md)`).join("\n");

		const fm = frontmatter({
			type: "Finding",
			title: tech.name,
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			context: {
				technique_id: tech.id,
				category: tech.category,
				layer: tech.layer,
				status: result?.status ?? "not_run",
				duration_ms: result?.durationMs ?? null,
			},
			sources: tech.dependencies.map((dep) => ({ resource: `techniques/${dep}.md` })),
		});

		let body: string;
		if (!result || result.status !== "success") {
			body = [
				`# ${tech.name}`,
				"",
				`**Status:** ${result?.status ?? "not run"}`,
				result?.error ? `**Error:** ${result.error}` : "",
			]
				.filter(Boolean)
				.join("\n");
		} else {
			body = [
				`# ${tech.name}`,
				"",
				`**Category:** ${tech.category} | **Layer:** ${tech.layer}`,
				tech.dependencies.length
					? `\n**Dependencies:**\n${depLinks}`
					: "",
				"",
				`## Output`,
				"",
				"```json",
				JSON.stringify(result.output, null, 2),
				"```",
			]
				.filter((l) => l !== null)
				.join("\n");
		}

		await writeAtomicFile(
			join(dir, "techniques", `${tech.id}.md`),
			fm + "\n" + body + "\n",
			"utf8",
		);
	}
}

async function writeAdversarialPages(
	dir: string,
	adversarialExchanges: Record<string, AdversarialExchange>,
): Promise<void> {
	await mkdir(join(dir, "adversarial"), { recursive: true });

	for (const [id, exchange] of Object.entries(adversarialExchanges)) {
		const fm = frontmatter({
			type: "Critique",
			title: `Adversarial Critique: ${exchange.techniqueName}`,
			status: "stable",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			context: {
				technique_id: id,
				rounds: exchange.rounds,
				overall_severity: exchange.critique.overall_severity,
				revised_confidence: exchange.rebuttal.revised_confidence,
				accepted_challenges: exchange.rebuttal.accepted_challenges.length,
			},
			sources: [{ resource: `techniques/${id}.md` }],
		});

		const body = [
			`# Adversarial Critique: ${exchange.techniqueName}`,
			"",
			`**Rounds:** ${exchange.rounds}`,
			`**Overall severity:** ${exchange.critique.overall_severity}`,
			`**Revised confidence:** ${exchange.rebuttal.revised_confidence}`,
			"",
			`## Critique`,
			"",
			`**Agreements:** ${exchange.critique.agreements.join("; ") || "None"}`,
			"",
			"**Challenges:**",
			...exchange.critique.challenges.map((c) => `- [${c.severity}] ${c.challenge}`),
			"",
			`**Alternative interpretations:**`,
			...exchange.critique.alternative_interpretations.map((i) => `- ${i}`),
			"",
			`**Evidence gaps:**`,
			...exchange.critique.evidence_gaps.map((g) => `- ${g}`),
			"",
			`## Rebuttal`,
			"",
			`**Accepted challenges:**`,
			...exchange.rebuttal.accepted_challenges.map((c) => `- ${c}`),
			"",
			`**Rejected challenges:**`,
			...exchange.rebuttal.rejected_challenges.map((c) => `- ${c.challenge}: ${c.reason}`),
			"",
			`**Revised conclusions:** ${exchange.rebuttal.revised_conclusions}`,
		];

		if (exchange.adjudication) {
			body.push(
				"",
				`## Adjudication`,
				"",
				exchange.adjudication.convergence_analysis,
				"",
				`**Novel insights:**`,
				...exchange.adjudication.novel_insights.map((i) => `- ${i}`),
				"",
				`**Confidence delta:** ${exchange.adjudication.confidence_delta > 0 ? "+" : ""}${exchange.adjudication.confidence_delta}`,
				"",
				exchange.adjudication.adjudication_summary,
			);
		}

		await writeAtomicFile(
			join(dir, "adversarial", `${id}-critique.md`),
			fm + "\n" + body.join("\n") + "\n",
			"utf8",
		);
	}
}

async function writeSynthesisPage(
	dir: string,
	question: string,
	synthesis: SynthesisOutput,
): Promise<void> {
	await mkdir(join(dir, "synthesis"), { recursive: true });

	const techniqueRefs = [
		...new Set([
			...synthesis.convergent_judgments.flatMap((j) => j.supporting_techniques),
			...synthesis.divergent_signals.flatMap((s) => [
				...s.techniques_in_favor,
				...s.techniques_against,
			]),
		]),
	].map((id) => ({ resource: `techniques/${id}.md` }));

	const fm = frontmatter({
		type: "Synthesis",
		title: "Synthesis Report",
		description: synthesis.bottom_line_assessment.slice(0, 200),
		status: "stable",
		generated: { by: "sat12/0.1", at: new Date().toISOString() },
		sources: techniqueRefs,
	});

	const body = [
		`# Synthesis Report`,
		"",
		`**Question:** ${question}`,
		"",
		`## Bottom-Line Assessment`,
		"",
		synthesis.bottom_line_assessment,
		"",
		`## Convergent Judgments`,
		"",
		...(synthesis.convergent_judgments.length
			? synthesis.convergent_judgments.flatMap((j) => [
					`### ${j.judgment}`,
					`**Confidence:** ${j.confidence} | **Techniques:** ${j.supporting_techniques.join(", ")}`,
					"",
				])
			: ["_No convergent judgments identified._"]),
		`## Divergent Signals`,
		"",
		...(synthesis.divergent_signals.length
			? synthesis.divergent_signals.flatMap((s) => [
					`### ${s.signal}`,
					`**In favor:** ${s.techniques_in_favor.join(", ")} | **Against:** ${s.techniques_against.join(", ")}`,
					"",
					s.explanation,
					"",
				])
			: ["_No divergent signals identified._"]),
		`## Highest-Confidence Assessments`,
		"",
		...synthesis.highest_confidence_assessments.map((a) => `- ${a}`),
		"",
		`## Remaining Uncertainties`,
		"",
		...synthesis.remaining_uncertainties.map((u) => `- ${u}`),
		"",
		`## Intelligence Gaps`,
		"",
		...synthesis.intelligence_gaps.map((g) => `- ${g}`),
		"",
		`## Recommended Next Steps`,
		"",
		...synthesis.recommended_next_steps.map((s) => `- ${s}`),
	].join("\n");

	await writeAtomicFile(join(dir, "synthesis", "index.md"), fm + "\n" + body + "\n", "utf8");
}





export async function updateWorkspaceIndex(cwd: string): Promise<string> {
	try {
		const entries = await readdir(cwd, { withFileTypes: true });
		const analysisDirs = entries
			.filter((e) => e.isDirectory() && e.name.startsWith("analysis-"))
			.map((e) => e.name)
			.sort()
			.reverse();

		if (analysisDirs.length === 0) {
			return join(cwd, "index.md");
		}

		interface BundleSummary {
			dirName: string;
			question: string;
			bottomLine: string;
			hasHtmlReport: boolean;
		}

		const summaries: BundleSummary[] = [];

		for (const dirName of analysisDirs) {
			const rootIndexPath = join(cwd, dirName, "index.md");
			const htmlReportPath = join(cwd, dirName, "index.html");
			let question = "Unknown Question";
			let bottomLine = "No assessment available.";
			let hasHtmlReport = false;

			try {
				const content = await readFile(rootIndexPath, "utf8");
				const qMatch = content.match(/\*\*Question:\*\*\s*(.+?)(?:\n|$)/);
				if (qMatch) {
					question = qMatch[1].trim();
				}
				const blMatch = content.match(/## Bottom-Line Assessment\s*\n+([\s\S]+?)(?=\n\n## |$)/);
				if (blMatch) {
					bottomLine = blMatch[1].trim().slice(0, 300);
					if (blMatch[1].trim().length > 300) {
						bottomLine += "...";
					}
				}
			} catch {
				
			}

			try {
				await readFile(htmlReportPath, "utf8");
				hasHtmlReport = true;
			} catch {
				hasHtmlReport = false;
			}

			summaries.push({
				dirName,
				question,
				bottomLine: bottomLine.replace(/\n+/g, " "),
				hasHtmlReport,
			});
		}

		const fm = frontmatter({
			okf_version: "0.2",
			type: "Index",
			title: "SAT-12 Intelligence Analysis Repository",
			description: "Index of all SAT-12 structured analysis bundles in this workspace.",
			generated: { by: "sat12/0.1", at: new Date().toISOString() },
			status: "stable",
		});

		const rows = summaries.map((s) => {
			const okfLink = `[OKF Bundle](${s.dirName}/index.md)`;
			const htmlLink = s.hasHtmlReport ? `[HTML Report](${s.dirName}/index.html)` : "—";
			return `| \`${s.dirName}\` | ${s.question.replace(/\|/g, "\\|")} | ${s.bottomLine.replace(/\|/g, "\\|")} | ${okfLink} | ${htmlLink} |`;
		});

		const body = [
			"# SAT-12 Intelligence Analysis Repository",
			"",
			"This directory contains Open Knowledge Format (OKF) structured analysis bundles generated by SAT-12.",
			"",
			"## Analysis Bundles",
			"",
			"| Directory | Question | Bottom-Line Assessment | OKF Bundle | Executive Report |",
			"|---|---|---|---|---|",
			...rows,
		].join("\n");

		const indexPath = join(cwd, "index.md");
		await writeAtomicFile(indexPath, fm + "\n" + body + "\n", "utf8");
		return indexPath;
	} catch (err) {
		console.error("Failed to update workspace index.md:", err);
		return join(cwd, "index.md");
	}
}

export async function writeOKF(
	question: string,
	techniqueResults: Record<string, TechniqueResult>,
	adversarialExchanges: Record<string, AdversarialExchange>,
	synthesis: SynthesisOutput,
	cwd: string,
	evidenceText?: string,
	timings?: ExecutionTimings,
	usage?: import("./llm.ts").UsageAccumulator,
): Promise<string> {
	const dirName = `analysis-${formatTimestamp(new Date())}`;
	const outputDir = join(cwd, dirName);

	await mkdir(outputDir, { recursive: true });

	
	await writeRootIndex(outputDir, question, synthesis);
	await writeLogPage(outputDir, question, techniqueResults, adversarialExchanges, evidenceText, timings, usage);
	await writeHypotheses(outputDir, techniqueResults["ach"]);
	await writeEvidence(outputDir, techniqueResults, evidenceText);
	await writeTechniquePages(outputDir, techniqueResults);
	await writeAdversarialPages(outputDir, adversarialExchanges);
	await writeSynthesisPage(outputDir, question, synthesis);

	await updateWorkspaceIndex(cwd);

	return outputDir;
}
