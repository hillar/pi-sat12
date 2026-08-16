import { Type, type Static } from "typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "../llm.ts";
import { resolveAdversarialModels, UsageAccumulator, checkAborted, isAbortError } from "../llm.ts";
import { gatherResearch } from "../research.ts";
import { resolveGaps } from "../gap_resolution.ts";
import { runTechniqueLayers } from "../techniques/runner.ts";
import { runAdversarialCycle } from "../adversarial.ts";
import { synthesize } from "../synthesis.ts";
import { writeOKF } from "../okf.ts";
import { renderReport } from "../report/render.ts";
import {
	loadSession,
	saveSession,
	createInitialSession,
	EVIDENCE_MAX_AGE_MS,
	type SessionState,
} from "../session.ts";
import { loadSat12Config } from "../config.ts";





export const Params = Type.Object({
	question: Type.String({
		description: "The analytical question or intelligence problem to investigate.",
		minLength: 1,
		maxLength: 50000,
	}),
	evidence: Type.Optional(
		Type.String({
			description:
				"Background evidence text (up to 500,000 chars). If omitted and research_enabled is true, pi-webaio gathers evidence automatically.",
			maxLength: 500000,
		}),
	),
	evidence_dir: Type.Optional(
		Type.String({
			description:
				"Optional path to a local folder containing context documents, code, or evidence dossiers.",
		}),
	),
	source_ratings: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description:
				"Optional map of source identifiers to Admiralty ratings (e.g. {'docs/spec.md': 'A1', 'report.txt': 'B2'}). Overrides auto-ranking.",
		}),
	),
	research_enabled: Type.Optional(
		Type.Boolean({
			description: "Gather evidence via pi-webaio before analysis. Default: true.",
		}),
	),
	primary_model: Type.Optional(
		Type.String({
			description: "Optional model ID for primary technique analysis (e.g. 'claude-3-7-sonnet', 'gpt-4o'). Default: currently selected Pi model.",
		}),
	),
	challenger_model: Type.Optional(
		Type.String({
			description: "Optional model ID for adversarial challenger/critic (e.g. 'gpt-4o', 'claude-3-7-sonnet'). Default: primary_model.",
		}),
	),
	investigator_model: Type.Optional(
		Type.String({
			description: "Optional model ID for trident mode investigator (e.g. 'gemini-2.5-pro'). Default: challenger_model or primary_model.",
		}),
	),
	gap_resolution_enabled: Type.Optional(
		Type.Boolean({
			description: "Run gap-driven follow-up research for identified intelligence gaps. Default: true.",
		}),
	),
	adversarial_enabled: Type.Optional(
		Type.Boolean({
			description: "Run adversarial critique/rebuttal cycle. Default: true.",
		}),
	),
	adversarial_mode: Type.Optional(
		StringEnum(["dual", "trident"] as const, {
			description:
				"Adversarial mode. 'dual' = critique + rebuttal. 'trident' = adds adjudication. Default: 'dual'.",
		}),
	),
	adversarial_rounds: Type.Optional(
		Type.Integer({
			description: "Number of adversarial rounds per technique. Default: 2.",
			minimum: 1,
			maximum: 5,
		}),
	),
	continueOnPartialResults: Type.Optional(
		Type.Boolean({
			description:
				"If true, continue on technique failure without prompting. Default: false.",
		}),
	),
	resume: Type.Optional(
		Type.Boolean({
			description:
				"If true and a previous session exists for this question, resume execution from the last completed phase/technique. Default: true.",
		}),
	),
	session_id: Type.Optional(
		Type.String({
			description: "Optional custom session ID to resume or save pipeline state to.",
		}),
	),
	rerun_technique: Type.Optional(
		Type.String({
			description:
				"ID of a single technique to invalidate and re-run against an existing analysis (e.g. 'quality', 'ach', 'red_team'). Automatically re-synthesizes and updates the report.",
		}),
	),
});

export type Params = Static<typeof Params>;





export type ProgressDetails =
	| { phase: "research"; status: string; reason?: string; url?: string; queries?: string[]; message?: string }
	| { phase: "technique"; techniqueId?: string; techniqueName?: string; layer?: number; layerName?: string; totalLayers?: number; status: string; error?: string; durationMs?: number; message?: string }
	| { phase: "adversarial"; techniqueId: string; step: string; round: number; error?: string; message?: string }
	| { phase: "synthesis"; status: string; error?: string; message?: string }
	| { phase: "writing"; status: string; path?: string; message?: string }
	| { phase: "paused"; status: string; message?: string }
	| { phase: "cancelled"; status: string; message?: string };

function formatProgressMessage(d: any): string {
	if (d.message) return d.message;
	if (d.phase === "research") {
		if (d.status === "started") return "Phase 0: Gathering web research...";
		if (d.status === "searching") return "Searching web sources...";
		if (d.status === "reading") return `Reading ${d.url || "source"}...`;
		if (d.status === "gap_resolution_started") return "Performing gap resolution search...";
		if (d.status === "gap_queries_generated") return `Generated gap queries: ${d.queries?.join(", ") || ""}`;
		if (d.status === "gap_resolution_completed") return "Gap resolution completed.";
		if (d.status === "completed") return "Research completed.";
		if (d.status === "skipped") return "Research skipped (no evidence required or found).";
	}
	if (d.phase === "technique") {
		if (d.status === "layer_started") return `Layer ${typeof d.layer === "number" ? d.layer + 1 : "?"}/${d.totalLayers || 6}: ${d.layerName || "Processing"}...`;
		if (d.status === "started") return `Running technique: ${d.techniqueName || d.techniqueId}...`;
		if (d.status === "completed") return `Completed technique: ${d.techniqueName || d.techniqueId}${d.durationMs ? ` (${(d.durationMs / 1000).toFixed(1)}s)` : ""}`;
		if (d.status === "failed") return `Failed technique: ${d.techniqueName || d.techniqueId} - ${d.error}`;
	}
	if (d.phase === "adversarial") {
		if (d.step === "critique") return `Adversarial Critique: ${d.techniqueId} (Round ${d.round + 1})`;
		if (d.step === "rebuttal") return `Adversarial Rebuttal: ${d.techniqueId} (Round ${d.round + 1})`;
		if (d.step === "adjudication") return `Adversarial Adjudication: ${d.techniqueId} (Round ${d.round + 1})`;
		if (d.step === "completed") return `Adversarial cycle completed for ${d.techniqueId}`;
	}
	if (d.phase === "synthesis") {
		if (d.status === "started") return "Synthesizing findings across all 12 techniques...";
		if (d.status === "completed") return "Cross-technique synthesis complete.";
	}
	if (d.phase === "writing") {
		if (d.status === "started") return "Writing OKF wiki bundle & HTML report...";
		if (d.status === "completed") return `OKF bundle written to ${d.path || "disk"}.`;
	}
	return `Phase: ${d.phase || "processing"}...`;
}

function formatSummaryTokenMetrics(usage: UsageAccumulator): string {
	if (!usage || !usage.byModel || Object.keys(usage.byModel).length === 0) {
		const t = usage.total;
		return `**Token Usage:** ${t.input.toLocaleString()} sent, ${t.output.toLocaleString()} generated (${t.totalTokens.toLocaleString()} total)`;
	}

	const rows = Object.values(usage.byModel).map((m) => {
		const roleLabel =
			m.role === "primary" ? "Primary" : m.role === "challenger" ? "Challenger" : "Secondary";
		const outSpeed = m.durationMs > 0 ? (m.outputTokens / (m.durationMs / 1000)).toFixed(1) + " tok/s" : "N/A";
		const totSpeed = m.durationMs > 0 ? (m.totalTokens / (m.durationMs / 1000)).toFixed(1) + " tok/s" : "N/A";
		return `| **${roleLabel}** | \`${m.modelId}\` | ${m.inputTokens.toLocaleString()} | ${m.outputTokens.toLocaleString()} | ${outSpeed} | ${totSpeed} |`;
	});

	return [
		"### Model Token & Velocity Metrics",
		"",
		"| Model Role | Model ID | Sent (Input) | Gen (Output) | Gen Speed | Total Speed |",
		"|---|---|---|---|---|---|",
		...rows,
	].join("\n");
}





export function formatSat12HelpText(): string {
	return `## SAT-12 Structured Analysis Tool Usage

Structured Analysis of Competing Hypotheses (SACH) 12-Technique Intelligence Pipeline

### Primary Tool: \`sat12_analyze\`
Parameters:
- \`question\` (string, required): The analytical question or intelligence problem to investigate.
- \`evidence\` (string, optional): Background evidence text (up to 500k chars).
- \`evidence_dir\` (string, optional): Path to a local folder containing context documents, code, or evidence dossiers.
- \`source_ratings\` (object, optional): Map of file/folder paths to Admiralty codes (e.g. \`{ "docs/quantum": "A1", "leak.txt": "E4" }\`). Overrides auto-ranking.
- \`research_enabled\` (boolean, default: true): Auto-gather evidence via pi-webaio.
- \`primary_model\` (string, optional): Primary technique execution model.
- \`challenger_model\` (string, optional): Adversarial challenger model.
- \`investigator_model\` (string, optional): Trident mode debate model.
- \`adversarial_enabled\` (boolean, default: true): Enable multi-model critique cycle.
- \`adversarial_mode\` ("dual" | "trident", default: "dual"): Adversarial debate structure.
- \`adversarial_rounds\` (integer 1-5, default: 2): Rounds per technique.
- \`gap_resolution_enabled\` (boolean, default: true): Run follow-up research for identified gaps.
- \`continueOnPartialResults\` (boolean, default: false): Continue on technique failure.
- \`resume\` (boolean, default: true): Resume execution from checkpoint.
- \`session_id\` (string, optional): Custom session ID for persistence.
- \`rerun_technique\` (string, optional): Invalidate and re-run a single technique (e.g., 'quality', 'ach', 'red_team').

### Output Storage & Locations
- **OKF Bundles & Reports**: Saved automatically in timestamped folders (\`analysis-YYYYMMDD-HHMMSS/\`) inside the current working directory (\`cwd\`).
- **Workspace Index (\`index.md\`)**: Automatically updated with OKF \`type: Index\` frontmatter, indexing all analysis bundles and bottom-line assessments in the directory.
- **Prior Workspace Context**: Stage 0 research automatically inspects \`index.md\` and prior bundles to incorporate past findings and unresolved intelligence gaps.
- **Targeting Custom Directories**: To save outputs in a specific directory, \`cd\` into your desired folder before running \`/sat12\`.
- **Session Checkpoints**: Persisted in \`.pi/sat12-sessions/{id}.json\` inside the workspace root.

### 12 Analytical Techniques (Pipeline Execution Order)
**Diagnostic Techniques**
- \`quality\` (Layer 0) — Quality of Information Check
- \`assumptions\` (Layer 1) — Key Assumptions Check
- \`indicators\` (Layer 1) — Indicators & Signposts
- \`ach\` (Layer 2) — Analysis of Competing Hypotheses

**Contrarian Techniques**
- \`devils_advocacy\` (Layer 3) — Devil's Advocacy
- \`team_ab\` (Layer 3) — Team A / Team B Analysis
- \`high_impact\` (Layer 3) — High-Impact / Low-Probability Analysis
- \`what_if\` (Layer 3) — "What If?" Analysis

**Imaginative Techniques**
- \`brainstorming\` (Layer 4) — Structured Brainstorming
- \`outside_in\` (Layer 4) — Outside-In Thinking
- \`red_team\` (Layer 5) — Red Team Analysis
- \`alt_futures\` (Layer 5) — Alternative Futures Analysis

### Available Slash Commands
- \`/sat12 <question>\` — Execute SAT-12 analysis on a question
- \`/sat12_research <question> [@dir] [--no-quality]\` — Gather web research, run Layer 0 Quality of Information Check, and seed a resumable session
- \`/sat12_status\` — View current or latest session status & progress
- \`/sat12_stop\` — Pause running session & save checkpoint
- \`/sat12_continue\` — Resume paused or interrupted session
- \`/sat12_cancel\` — Cancel active session (abandon)
- \`/sat12_set [key] [value]\` — Configure persistent defaults
- \`/sat12_report [dir]\` — Re-render HTML executive report
- \`/sat12_help\` — Show full extension help reference`;
}

export const sat12Analyze = {
	name: "sat12_analyze",
	label: "SAT-12 Structured Analysis Pipeline",
	description:
		"Runs a full Structured Analysis of Competing Hypotheses (SACH) pipeline using 12 CIA Tradecraft Primer techniques, adversarial critique/rebuttal, synthesis, and OKF output. Returns a path to the analysis bundle.",
	promptSnippet:
		"sat12_analyze(question, evidence?) — full 12-technique structured intelligence analysis",
	promptGuidelines: [
		"Use sat12_analyze for complex analytical questions requiring structured, rigorous reasoning.",
		"sat12_analyze is long-running (several minutes). Do not abort unless the user explicitly requests it.",
		"Pass evidence as plain text if you have it; otherwise rely on research_enabled (default true).",
		"The output is an OKF directory bundle. Report the path to the user when complete.",
	],
	parameters: Params,
	executionMode: "sequential" as const,

	async execute(
		_toolCallId: string,
		params: Params,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<ProgressDetails> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<ProgressDetails>> {
		const qLower = params.question.trim().toLowerCase();
		if (qLower === "--help" || qLower === "-h" || qLower === "-?" || qLower === "help") {
			const usageText = formatSat12HelpText();
			return {
				content: [{ type: "text", text: usageText }],
				details: { phase: "synthesis", status: "completed", message: "Help displayed" },
			};
		}

		const persistentConfig = await loadSat12Config();
		const mergedParams = {
			...params,
			primary_model: params.primary_model || persistentConfig.primary_model,
			challenger_model: params.challenger_model || persistentConfig.challenger_model,
			investigator_model: params.investigator_model || persistentConfig.investigator_model,
			adversarial_enabled: params.adversarial_enabled ?? persistentConfig.adversarial_enabled,
			adversarial_mode: params.adversarial_mode ?? persistentConfig.adversarial_mode,
			research_enabled: params.research_enabled ?? persistentConfig.research_enabled,
			gap_resolution_enabled: params.gap_resolution_enabled ?? persistentConfig.gap_resolution_enabled,
			is_explicit_primary: Boolean(params.primary_model),
			is_explicit_challenger: Boolean(params.challenger_model),
			is_explicit_investigator: Boolean(params.investigator_model),
		};

		const advResolution = resolveAdversarialModels(ctx, mergedParams);
		if (advResolution.error) {
			return {
				content: [{ type: "text", text: `Error: ${advResolution.error}` }],
				details: { phase: "technique", techniqueId: "init", techniqueName: "init", status: "failed", error: advResolution.error },
			};
		}
		const model = advResolution.primaryModel;

		if (advResolution.notifications.length > 0 && typeof ctx.ui?.notify === "function") {
			for (const note of advResolution.notifications) {
				ctx.ui.notify(note, "info");
			}
		}

		const usage = new UsageAccumulator();
		const continueOnPartial = params.continueOnPartialResults ?? false;
		const adversarialEnabled = params.adversarial_enabled ?? true;
		const adversarialMode = params.adversarial_mode ?? "dual";
		const adversarialRounds = params.adversarial_rounds ?? 2;
		const researchEnabled = params.research_enabled ?? true;
		const gapResolutionEnabled = params.gap_resolution_enabled ?? true;
		const allowResume = params.resume ?? true;

		const emit = (details: ProgressDetails) => {
			const message = formatProgressMessage(details);
			const fullDetails = { ...details, message };
			onUpdate?.({
				content: [{ type: "text", text: message }],
				details: fullDetails as any,
			});
		};

		
		let session: SessionState | null = allowResume
			? await loadSession(ctx.cwd, params.question, params.session_id)
			: null;

		if (!session) {
			session = createInitialSession(params.question, params.evidence, params.session_id);
		}

		
		if (session.status === "completed" && session.outputPath && !params.rerun_technique) {
			const reportHtmlPath = session.reportHtmlPath || (await renderReport(session.outputPath));
			return {
				content: [
					{
						type: "text",
						text: `## SAT-12 Analysis Already Complete\n\n**Question:** ${params.question}\n**OKF Directory:** \`${session.outputPath}\`\n**Report:** \`${reportHtmlPath}\`\n\n### Bottom-Line Assessment\n\n${session.synthesis?.bottom_line_assessment ?? ""}`,
					},
				],
				details: { phase: "writing", status: "completed", path: session.outputPath },
				usage: usage.total,
			};
		}

		
		if (params.rerun_technique) {
			const tid = params.rerun_technique;
			delete session.techniqueResults[tid];
			delete session.adversarialExchanges[tid];
			delete session.synthesis;
			delete session.reportHtmlPath;
		}

		session.status = "in_progress";
		session.statusReason = undefined;
		await saveSession(ctx.cwd, session);

		const pipelineStartTime = Date.now();

		try {
			
			const researchStart = Date.now();

			// Drop stale saved evidence and its Layer 0 quality result. A fresh full run
			// then gathers evidence again. Apply this only to a bare seed.
			// Do not apply it to a run that stopped part way. Keep that finished work.
			if (
				researchEnabled &&
				!params.evidence &&
				session.evidenceText &&
				session.evidenceGatheredAt
			) {
				const age = Date.now() - new Date(session.evidenceGatheredAt).getTime();
				const techniqueIds = Object.keys(session.techniqueResults);
				const isBareSeed =
					!session.synthesis &&
					!session.outputPath &&
					techniqueIds.every((id) => id === "quality");
				if (age > EVIDENCE_MAX_AGE_MS && isBareSeed) {
					session.evidenceText = undefined;
					session.evidenceGatheredAt = undefined;
					delete session.techniqueResults.quality;
					await saveSession(ctx.cwd, session);
				}
			}

			let evidenceText = session.evidenceText || params.evidence;
			if (researchEnabled && !evidenceText) {
				const gathered = await gatherResearch(
					params.question,
					signal,
					(details) => emit(details),
					ctx,
					params.evidence_dir,
					params.source_ratings,
				);
				if (gathered) {
					evidenceText = gathered;
					session.evidenceText = evidenceText;
					session.evidenceGatheredAt = new Date().toISOString();
					await saveSession(ctx.cwd, session);
				}
			}

			
			if (gapResolutionEnabled && researchEnabled && evidenceText && !evidenceText.includes("## Gap Resolution Findings")) {
				// Use structured gaps from a saved or finished Layer 0 quality result first.
				// If none exist, read the gaps from the evidence markdown.
				// If that also fails, use one generic gap.
				const qualityGaps = (session.techniqueResults.quality?.status === "success"
					? (session.techniqueResults.quality.output as { gaps?: unknown } | undefined)?.gaps
					: undefined);
				let initialGaps: string[];
				if (Array.isArray(qualityGaps) && qualityGaps.length > 0) {
					initialGaps = qualityGaps.filter((g): g is string => typeof g === "string" && g.trim().length > 0);
				} else {
					const gapMatches = evidenceText.match(/## Gaps[\s\S]*?(?=\n## |$)/i);
					initialGaps = gapMatches
						? gapMatches[0].split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim())
						: [`Primary technical data and verified metrics for ${params.question}`];
				}

				if (initialGaps.length > 0) {
					const gapFindings = await resolveGaps(
						params.question,
						initialGaps,
						signal,
						(details) => emit(details),
						ctx,
						usage,
					);
					if (gapFindings) {
						evidenceText = `${evidenceText}\n\n${gapFindings}`;
						session.evidenceText = evidenceText;
						await saveSession(ctx.cwd, session);
					}
				}
			}
			const researchDurationMs = Date.now() - researchStart;

			
			checkAborted(signal, ctx);
			const techStart = Date.now();
			let techniqueResults: Record<string, { status: string; output?: unknown; error?: string; durationMs?: number }>;
			try {
				techniqueResults = await runTechniqueLayers(
					params.question,
					evidenceText,
					ctx,
					model,
					signal,
					(details) => emit(details),
					usage,
					continueOnPartial,
					session.techniqueResults as any,
					(id, res) => {
						session!.techniqueResults[id] = res as any;
						saveSession(ctx.cwd, session!);
					},
					{ userOverrides: params.source_ratings },
				);
				session.techniqueResults = techniqueResults as any;
				await saveSession(ctx.cwd, session);
			} catch (err) {
				if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) throw err;
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Technique phase failed: ${msg}` }],
					details: { phase: "technique", techniqueId: "unknown", techniqueName: "unknown", status: "failed", error: msg },
					usage: usage.total,
				};
			}
			const techniquesDurationMs = Date.now() - techStart;

			
			checkAborted(signal, ctx);
			const advStart = Date.now();
			let adversarialExchanges: Record<string, import("../adversarial.ts").AdversarialExchange> = session.adversarialExchanges || {};
			if (adversarialEnabled) {
				try {
					adversarialExchanges = await runAdversarialCycle(
						techniqueResults as any,
						params.question,
						evidenceText,
						adversarialMode,
						adversarialRounds,
						ctx,
						signal,
						(details) => emit(details),
						usage,
						session.adversarialExchanges,
						(id, exchange) => {
							session!.adversarialExchanges[id] = exchange;
							saveSession(ctx.cwd, session!);
						},
						{
							primaryModel: advResolution.primaryModel,
							challengerModel: advResolution.challengerModel,
							investigatorModel: advResolution.investigatorModel,
						},
					);
					session.adversarialExchanges = adversarialExchanges;
					await saveSession(ctx.cwd, session);
				} catch (err) {
					if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) throw err;
					
					if (!continueOnPartial) throw err;
				}
			}
			const adversarialDurationMs = Date.now() - advStart;

			
			checkAborted(signal, ctx);
			const synthStart = Date.now();
			let synthOutput: import("../synthesis.ts").SynthesisOutput;
			if (session.synthesis) {
				synthOutput = session.synthesis;
			} else {
				try {
					synthOutput = await synthesize(
						params.question,
						techniqueResults as any,
						adversarialExchanges,
						ctx,
						signal,
						(details) => emit(details),
						usage,
					);
					session.synthesis = synthOutput;
					await saveSession(ctx.cwd, session);
				} catch (err) {
					if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) throw err;
					const msg = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Synthesis failed: ${msg}` }],
						details: { phase: "synthesis", status: "failed", error: msg },
						usage: usage.total,
					};
				}
			}
			const synthesisDurationMs = Date.now() - synthStart;
			const totalDurationMs = Date.now() - pipelineStartTime;

			
			checkAborted(signal, ctx);
			emit({ phase: "writing", status: "started" });
			let outputPath: string;
			let reportHtmlPath: string | undefined;
			try {
				outputPath = session.outputPath || (await writeOKF(
					params.question,
					techniqueResults as any,
					adversarialExchanges,
					synthOutput,
					ctx.cwd,
					evidenceText,
					{
						startTime: new Date(pipelineStartTime).toISOString(),
						totalDurationMs,
						researchDurationMs,
						techniquesDurationMs,
						adversarialDurationMs,
						synthesisDurationMs,
					},
					usage,
				));
				session.outputPath = outputPath;

				reportHtmlPath = session.reportHtmlPath || (await renderReport(outputPath));
				session.reportHtmlPath = reportHtmlPath;

				await saveSession(ctx.cwd, session);
			} catch (err) {
				if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) throw err;
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `OKF write or report render failed: ${msg}` }],
					details: { phase: "writing", status: "failed" },
					usage: usage.total,
				};
			}
			emit({ phase: "writing", status: "completed", path: outputPath });

			
			session.status = "completed";
			await saveSession(ctx.cwd, session);

			
			const succeeded = Object.values(techniqueResults).filter((r) => r.status === "success").length;
			const total = Object.keys(techniqueResults).length;
			const advCount = Object.keys(adversarialExchanges).length;

			const metricsSummary = formatSummaryTokenMetrics(usage);

			const report = [
				`## SAT-12 Analysis Complete`,
				"",
				`**Question:** ${params.question}`,
				"",
				`**Techniques:** ${succeeded}/${total} succeeded`,
				`**Adversarial exchanges:** ${advCount}`,
				`**Total Time:** ${(totalDurationMs / 1000).toFixed(1)}s`,
				"",
				metricsSummary,
				"",
				`### Bottom-Line Assessment`,
				"",
				synthOutput.bottom_line_assessment,
				"",
				synthOutput.highest_confidence_assessments.length
					? `### Highest-Confidence Assessments\n\n${synthOutput.highest_confidence_assessments.map((a) => `- ${a}`).join("\n")}`
					: "",
				"",
				`### Output Bundle & Report`,
				"",
				`**OKF Wiki Directory:** \`${outputPath}\``,
				reportHtmlPath ? `**HTML Executive Report:** \`${reportHtmlPath}\`` : "",
			]
				.filter((l) => l !== null)
				.join("\n");

			return {
				content: [{ type: "text", text: report }],
				details: { phase: "writing", status: "completed", path: outputPath },
				usage: usage.total,
			};
		} catch (err) {
			if (isAbortError(err) || signal?.aborted || ctx?.signal?.aborted) {
				// /sat12_stop writes "paused" to its own copy on disk. This function
				// holds a different copy in memory, so re-read the file to learn
				// whether the user paused or cancelled.
				const onDisk = await loadSession(ctx.cwd, params.question, params.session_id);
				const isPause = onDisk?.status === "paused";
				session.status = isPause ? "paused" : "cancelled";
				await saveSession(ctx.cwd, session);

				if (isPause) {
					return {
						content: [
							{
								type: "text",
								text: "ANALYSIS PAUSED BY USER: SAT-12 analysis paused at current checkpoint. Progress saved. Do NOT retry automatically. Inform the user they can resume anytime with /sat12_continue.",
							},
						],
						details: { phase: "paused", status: "paused" },
						usage: usage.total,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: "ANALYSIS CANCELLED BY USER: The user explicitly cancelled this SAT-12 analysis session. Do NOT retry, do NOT call sat12_analyze again, and do NOT propose leaner configurations. Simply acknowledge the cancellation to the user and wait for further instructions.",
						},
					],
					details: { phase: "cancelled", status: "cancelled" },
					usage: usage.total,
				};
			}

			session.status = "failed";
			session.statusReason = err instanceof Error ? err.message : String(err);
			await saveSession(ctx.cwd, session);
			throw err;
		}
	},
};
