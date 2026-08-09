import { readdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { sat12Analyze } from "./tools/sat12-analyze.ts";
import { sat12StressTest } from "./tools/sat12-stress-test.ts";
import { resolveModel } from "./llm.ts";
import { setSat12Setting, loadSat12Config } from "./config.ts";
import { renderReport } from "./report/render.ts";
import { findLatestSession, saveSession, formatSessionStatus } from "./session.ts";
import { gatherResearch } from "./research.ts";
import { updateWorkspaceIndex } from "./okf.ts";

export function parseCommandArgs(input: string): {
	question: string;
	evidenceDir?: string;
	sourceRatings?: Record<string, string>;
} {
	let text = input.trim();
	let evidenceDir: string | undefined;
	const sourceRatings: Record<string, string> = {};


	const dirRatingMatch = text.match(/\s+--dir-rating(?:=|\s+)("?[A-F][1-6]"?|\'?[A-F][1-6]\'?)/i);
	let dirRating: string | undefined;
	if (dirRatingMatch) {
		dirRating = dirRatingMatch[1].replace(/^["']|["']$/g, "").toUpperCase();
		text = text.replace(dirRatingMatch[0], "").trim();
	}


	const ratingMatches = Array.from(text.matchAll(/\s+--(?:source-)?rating(?:=|\s+)("?[^"\s]+=[A-F][1-6]"?|\'?[^\'\s]+=[A-F][1-6]\'?)/gi));
	for (const m of ratingMatches) {
		const rawPair = m[1].replace(/^["']|["']$/g, "");
		const [srcPath, code] = rawPair.split("=");
		if (srcPath && code) {
			sourceRatings[srcPath.trim()] = code.trim().toUpperCase();
		}
		text = text.replace(m[0], "").trim();
	}


	const dirFlagMatch = text.match(/\s+--dir(?:=|\s+)("[^"]+"|\'[^\']+\'|\S+)/i);
	if (dirFlagMatch) {
		evidenceDir = dirFlagMatch[1].replace(/^["']|["']$/g, "");
		text = text.replace(dirFlagMatch[0], "").trim();
	} else {

		const atMatch = text.match(/\s+@("[^"]+"|\'[^\']+\'|\S+)/);
		if (atMatch) {
			evidenceDir = atMatch[1].replace(/^["']|["']$/g, "");
			text = text.replace(atMatch[0], "").trim();
		}
	}

	if (evidenceDir) {
		evidenceDir = evidenceDir.replace(/[?.,;]+$/, "");
		if (dirRating) {
			sourceRatings[evidenceDir] = dirRating;
		}
	}

	return {
		question: text,
		evidenceDir,
		sourceRatings: Object.keys(sourceRatings).length > 0 ? sourceRatings : undefined,
	};
}

export function formatSat12Help(): string {
	return `## SAT-12 Structured Analysis Extension

Structured Analysis of 12-Technique Intelligence Pipeline

### Slash Commands
- \`/sat12 <question> [@directory|--dir <path>] [--dir-rating <A1-F6>]\` — Start new 12-technique analysis with optional local folder evidence & folder Admiralty rank
- \`/sat12_research <question>\` (or \`/sat12 research <q>\`) — Gather standalone web research via pi-webaio
- \`/sat12_status\` (or \`/sat12 status\`) — View active or latest session status & progress
- \`/sat12_stop\` (or \`/sat12 stop\`) — Pause running session & save checkpoint
- \`/sat12_continue\` (or \`/sat12 continue\`) — Resume paused or interrupted session
- \`/sat12_cancel\` (or \`/sat12 cancel\`) — Cancel active session (abandon)
- \`/sat12_set [key] [value]\` — View or set persistent model & pipeline settings
- \`/sat12_report [dir]\` — Re-render HTML executive report from an OKF bundle
- \`/sat12_help\` (or \`/sat12 --help\` | \`-h\` | \`-?\` | \`help\`) — Display this help reference

### Source Evaluation & Admiralty Ratings
SAT12 automatically assigns 2-axis Admiralty ratings (A1 to F6) to all evidence sources:
- **Source Reliability (A–F)**: A (Completely Reliable) → F (Cannot Be Judged)
- **Information Credibility (1–6)**: 1 (Confirmed) → 6 (Cannot Be Judged)

#### Folder Presets & Overrides:
- **Directory Presets**: Place a \`sources.json\` file in target directories (\`@docs/quantum/sources.json\`) or \`.sat12/sources.json\` to define folder-wide default ratings (\`defaultLocalRating\`) or subfolder glob patterns.
- **Folder Rank Flag**: Pass \`--dir-rating "A1"\` to rank the entire target evidence directory.
- **Specific Path Override**: Pass \`--source-rating "spec.md=A1"\` or \`--source-rating "docs/quantum/leaks=D4"\` in \`/sat12\` commands.
- **Tool Parameter Override**: Pass \`source_ratings: { "docs/quantum": "A1", "leak.txt": "E4" }\` in \`sat12_analyze\`.

### Command Line & TUI Usage Examples
- **TUI with directory & folder rank:** \`/sat12 Assess quantum supply chain @docs/quantum --dir-rating "A1"\`
- **TUI with specific file override:** \`/sat12 Assess software risks @src/crypto --source-rating "src/crypto/legacy=E4"\`
- **Non-interactive Terminal (Print Mode):** \`pi -p "/sat12 Analyze quantum bottlenecks @docs/quantum --dir-rating B2"\`
- **Non-interactive Terminal (JSON Mode):** \`pi --mode json -p "sat12_analyze question='Assess risks' evidence_dir='./dossiers/geo' source_ratings={'./dossiers/geo':'A1'}"\`

### Persistent Settings (\`/sat12_set\`)
- \`primary\`: Primary model for technique execution (e.g., \`anthropic/claude-3-7-sonnet\`)
- \`challenger\`: Adversarial challenger model (e.g., \`openai/gpt-4o\`)
- \`investigator\`: Trident mode 3-way debate model (e.g., \`google/gemini-2.5-pro\`)
- \`adversarial_enabled\`: \`true\` | \`false\` (run multi-model critique cycles)
- \`adversarial_mode\`: \`dual\` (primary vs challenger) | \`trident\` (+ investigator)
- \`research_enabled\`: \`true\` | \`false\` (auto-gather web research via MCP)
- \`gap_resolution_enabled\`: \`true\` | \`false\` (targeted follow-up research for intelligence gaps)

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

### Tool Parameters (\`sat12_analyze\`)
- \`question\` (string, required): Analytical or intelligence question to investigate
- \`evidence\` (string, optional): Background text (up to 500k chars)
- \`evidence_dir\` (string, optional): Path to a local folder containing context documents, code, or evidence dossiers
- \`research_enabled\` (boolean, default: true): Gather evidence via pi-webaio
- \`primary_model\` / \`challenger_model\` / \`investigator_model\` (string): Overrides
- \`adversarial_enabled\` (boolean, default: true): Run critique & rebuttal cycle
- \`adversarial_mode\` ("dual" | "trident", default: "dual"): Debate structure
- \`adversarial_rounds\` (integer, 1-5, default: 2): Debate rounds per technique
- \`gap_resolution_enabled\` (boolean, default: true): Targeted research for gaps
- \`continueOnPartialResults\` (boolean, default: false): Continue on technique failure
- \`resume\` (boolean, default: true): Resume existing session from last completed phase
- \`session_id\` (string, optional): Custom session ID for persistence
- \`rerun_technique\` (string, optional): Invalidate & re-run a single technique (e.g. \`quality\`, \`ach\`, \`red_team\`)`;
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool(sat12Analyze);
	pi.registerTool(sat12StressTest);

	let activeSat12Controller: AbortController | undefined;

	const handleHelpCommand = async (_args: string, ctx: ExtensionCommandContext) => {
		const helpText = formatSat12Help();
		console.log("\n" + helpText + "\n");
		ctx.ui.notify("Displayed SAT-12 help reference", "info");
	};

	const handleStatusCommand = async (_args: string, ctx: ExtensionCommandContext) => {
		const cwd = ctx.cwd || process.cwd();
		const session = await findLatestSession(cwd);
		if (!session) {
			ctx.ui.notify("No SAT-12 session found in current workspace", "warning");
			console.log("\nNo SAT-12 session found in current workspace.\n");
			return;
		}
		const statusText = formatSessionStatus(session);
		console.log("\n" + statusText + "\n");
		ctx.ui.notify(
			`SAT-12 Status: ${session.status.toUpperCase()} (${Object.keys(session.techniqueResults || {}).length}/12 techniques)`,
			"info",
		);
	};

	const handleCancelCommand = async (_args: string, ctx: ExtensionCommandContext) => {
		const cwd = ctx.cwd || process.cwd();
		const session = await findLatestSession(cwd);
		if (session && session.status === "in_progress") {
			session.status = "cancelled";
			await saveSession(cwd, session);
		}
		activeSat12Controller?.abort();
		activeSat12Controller = undefined;
		if (typeof ctx.abort === "function") {
			ctx.abort();
		}
		ctx.ui.notify("Cancelled active SAT-12 session (abandoned)", "info");
	};

	const handleResearchCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const question = args.trim();
		if (!question) {
			ctx.ui.notify("Usage: /sat12_research <question>", "warning");
			return;
		}

		ctx.ui.notify(`Gathering web research via pi-webaio for: "${question}"`, "info");
		try {
			const controller = new AbortController();
			const evidenceText = await gatherResearch(
				question,
				controller.signal,
				(update) => {
					if (update.status === "searching") {
						ctx.ui.notify("Searching web sources via pi-webaio...", "info");
					} else if (update.status === "reading") {
						ctx.ui.notify("Reading web evidence bundle...", "info");
					} else if (update.status === "failed") {
						ctx.ui.notify(`Research warning: ${update.reason}`, "warning");
					} else if (update.status === "skipped") {
						ctx.ui.notify(`Research skipped: ${update.reason}`, "info");
					}
				},
				ctx as any,
			);

			if (!evidenceText) {
				ctx.ui.notify("No research evidence gathered or pi-webaio unavailable", "warning");
				console.log("\nNo research evidence gathered or pi-webaio unavailable.\n");
				return;
			}

			console.log("\n--- GATHERED RESEARCH EVIDENCE ---\n");
			console.log(evidenceText);
			console.log("\n----------------------------------\n");
			ctx.ui.notify("Web research complete. Output displayed in console.", "info");
		} catch (err: any) {
			ctx.ui.notify(`Research failed: ${err?.message || err}`, "error");
		}
	};

	const handleCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const parsed = parseCommandArgs(args);
		const question = parsed.question;
		const lower = question.toLowerCase();

		if (lower === "help" || lower === "--help" || lower === "-h" || lower === "-?") {
			return handleHelpCommand(args, ctx);
		}
		if (lower === "status") {
			return handleStatusCommand(args, ctx);
		}
		if (lower === "cancel") {
			return handleCancelCommand(args, ctx);
		}
		if (lower === "stop") {
			return handleStopCommand(args, ctx);
		}
		if (lower === "continue") {
			return handleContinueCommand(args, ctx);
		}
		if (lower.startsWith("research ") || lower === "research") {
			const query = question.replace(/^research\s*/i, "");
			return handleResearchCommand(query, ctx);
		}

		if (!question) {
			ctx.ui.notify("Usage: /sat12 <question> [@directory|--dir <path>]", "warning");
			return;
		}

		if (typeof pi.sendUserMessage === "function") {
			const dirSuffix = parsed.evidenceDir ? ` with evidence_dir: ${parsed.evidenceDir}` : "";
			pi.sendUserMessage(`Perform sat12_analyze on: ${question}${dirSuffix}`);
			return;
		}

		activeSat12Controller = new AbortController();
		try {
			const result = await sat12Analyze.execute(
				`cmd:${Date.now()}`,
				{
					question,
					evidence_dir: parsed.evidenceDir,
					source_ratings: parsed.sourceRatings,
					research_enabled: true,
					adversarial_enabled: true,
					continueOnPartialResults: true,
				},
				activeSat12Controller.signal,
				(update: any) => {
					if (update.details?.message) {
						ctx.ui.notify(update.details.message);
					}
				},
				ctx as any,
			);

			if (result.content?.[0]?.type === "text") {
				const reportText = result.content[0].text;
				console.log("\n" + reportText + "\n");
				if (typeof ctx.ui?.notify === "function") {
					ctx.ui.notify("SAT-12 analysis complete");
				}
			}
		} catch (err: any) {
			if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
				ctx.ui.notify("SAT-12 analysis cancelled", "info");
			} else {
				ctx.ui.notify(`SAT-12 analysis failed: ${err?.message || err}`, "error");
			}
		} finally {
			activeSat12Controller = undefined;
		}
	};

	const handleSetCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const parts = args.trim().split(/\s+/).filter(Boolean);

		const validKeys = [
			"primary",
			"primary_model",
			"challenger",
			"challenger_model",
			"investigator",
			"investigator_model",
			"adversarial_enabled",
			"adversarial_mode",
			"research_enabled",
			"gap_resolution_enabled",
		];


		if (parts.length >= 2) {
			const [keyInput, ...valParts] = parts;
			const k = keyInput.toLowerCase();
			if (!validKeys.includes(k)) {
				ctx.ui.notify(
					`Unknown setting key '${keyInput}'. Valid keys: primary, challenger, investigator, adversarial_enabled, adversarial_mode, research_enabled, gap_resolution_enabled`,
					"warning",
				);
				return;
			}
			let val = valParts.join(" ");


			if (k === "primary" || k === "primary_model" || k === "challenger" || k === "challenger_model" || k === "investigator" || k === "investigator_model") {
				const resolution = resolveModel(ctx as any, val);
				if (resolution.error) {
					ctx.ui.notify(resolution.error, "error");
					return;
				}
				val = `${resolution.model.provider}/${resolution.model.id}`;
			}

			try {
				const res = await setSat12Setting(k, val);
				ctx.ui.notify(`Set ${res.normalizedKey} = '${res.normalizedValue}'`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Failed to set config: ${err?.message || err}`, "error");
			}
			return;
		}


		let key: string | undefined;
		if (parts.length === 1) {
			const k = parts[0].toLowerCase();
			if (validKeys.includes(k)) {
				key = k;
			} else {
				ctx.ui.notify(
					`Unknown setting key '${parts[0]}'. Valid keys: primary, challenger, investigator, adversarial_enabled, adversarial_mode, research_enabled, gap_resolution_enabled`,
					"warning",
				);
				return;
			}
		}

		if (!key) {
			const selectedKey = await ctx.ui.select("Select setting to configure:", [
				"primary (model)",
				"challenger (model)",
				"investigator (model)",
				"adversarial_enabled (boolean)",
				"adversarial_mode (dual|trident)",
				"research_enabled (boolean)",
				"gap_resolution_enabled (boolean)",
			]);
			if (!selectedKey) return;
			key = selectedKey.split(" ")[0];
		}

		const isModelKey = ["primary", "primary_model", "challenger", "challenger_model", "investigator", "investigator_model"].includes(key);
		const isBoolKey = ["adversarial_enabled", "research_enabled", "gap_resolution_enabled"].includes(key);
		const isEnumKey = key === "adversarial_mode";

		let valToSet: string | undefined;

		if (isModelKey) {
			const availableModels = ctx.modelRegistry ? ctx.modelRegistry.getAvailable() : [];
			if (availableModels.length === 0) {
				ctx.ui.notify("No configured models available in Pi. Run 'pi provider add' to configure models.", "error");
				return;
			}
			const choices = availableModels.map((m) => `${m.provider}/${m.id}`);
			valToSet = await ctx.ui.select(`Select model for ${key}:`, choices);
		} else if (isBoolKey) {
			valToSet = await ctx.ui.select(`Set ${key}:`, ["true", "false"]);
		} else if (isEnumKey) {
			valToSet = await ctx.ui.select(`Set ${key}:`, ["dual", "trident"]);
		}

		if (!valToSet) return;

		try {
			const res = await setSat12Setting(key, valToSet);
			ctx.ui.notify(`Set ${res.normalizedKey} = '${res.normalizedValue}'`, "info");
		} catch (err: any) {
			ctx.ui.notify(`Failed to set config: ${err?.message || err}`, "error");
		}
	};

	const handleReportCommand = async (args: string, ctx: ExtensionCommandContext) => {
		let targetDir = args.trim();
		const cwd = ctx.cwd || process.cwd();

		if (!targetDir) {
			try {
				const entries = await readdir(cwd, { withFileTypes: true });
				const dirs = entries
					.filter((e) => e.isDirectory() && e.name.startsWith("analysis-"))
					.map((e) => e.name)
					.sort()
					.reverse();
				if (dirs.length === 0) {
					ctx.ui.notify("No analysis-* directory found in workspace. Usage: /sat12_report [dir]", "warning");
					return;
				}
				targetDir = join(cwd, dirs[0]);
			} catch (err) {
				ctx.ui.notify(`Failed to find analysis directory: ${err}`, "error");
				return;
			}
		} else if (!isAbsolute(targetDir)) {
			targetDir = join(cwd, targetDir);
		}

		try {
			const reportPath = await renderReport(targetDir);
			await updateWorkspaceIndex(cwd);
			ctx.ui.notify(`Re-rendered HTML report at ${reportPath}`, "info");
		} catch (err: any) {
			ctx.ui.notify(`Failed to render report: ${err?.message || err}`, "error");
		}
	};

	const handleStopCommand = async (_args: string, ctx: ExtensionCommandContext) => {
		const cwd = ctx.cwd || process.cwd();
		const session = await findLatestSession(cwd);
		if (session && session.status === "in_progress") {
			session.status = "paused";
			await saveSession(cwd, session);
		}
		activeSat12Controller?.abort();
		activeSat12Controller = undefined;
		if (typeof ctx.abort === "function") {
			ctx.abort();
		}
		ctx.ui.notify("Paused active SAT-12 analysis. Progress saved. Run /sat12_continue to resume.", "info");
	};

	const handleContinueCommand = async (args: string, ctx: ExtensionCommandContext) => {
		const cwd = ctx.cwd || process.cwd();
		const session = await findLatestSession(cwd);

		if (!session) {
			ctx.ui.notify("No SAT-12 session found to resume. Run /sat12 <question> to start.", "warning");
			return;
		}

		if (session.status === "completed" && session.outputPath) {
			ctx.ui.notify(`SAT-12 session already completed. Report at ${session.reportHtmlPath || session.outputPath}`, "info");
			return;
		}

		session.status = "in_progress";
		await saveSession(cwd, session);

		const prompt = `Resume sat12_analyze on: ${session.question}`;
		if (typeof pi.sendUserMessage === "function") {
			pi.sendUserMessage(prompt);
			ctx.ui.notify(`Resuming SAT-12 analysis: "${session.question}"`, "info");
			return;
		}

		activeSat12Controller = new AbortController();
		try {
			const result = await sat12Analyze.execute(
				`cmd:${Date.now()}`,
				{ question: session.question, resume: true, research_enabled: true, adversarial_enabled: true, continueOnPartialResults: true },
				activeSat12Controller.signal,
				(update: any) => {
					if (update.details?.message) {
						ctx.ui.notify(update.details.message);
					}
				},
				ctx as any,
			);

			if (result.content?.[0]?.type === "text") {
				const reportText = result.content[0].text;
				console.log("\n" + reportText + "\n");
				if (typeof ctx.ui?.notify === "function") {
					ctx.ui.notify("SAT-12 analysis complete");
				}
			}
		} catch (err: any) {
			if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
				ctx.ui.notify("SAT-12 analysis cancelled/paused", "info");
			} else {
				ctx.ui.notify(`SAT-12 analysis failed: ${err?.message || err}`, "error");
			}
		} finally {
			activeSat12Controller = undefined;
		}
	};

	pi.registerCommand("sat12_analyze", {
		description: "Run SAT-12 structured analysis pipeline on a question",
		handler: handleCommand,
	});

	pi.registerCommand("sat12", {
		description: "Run SAT-12 structured analysis pipeline on a question",
		handler: handleCommand,
	});

	pi.registerCommand("sat12_set", {
		description: "Configure persistent default models for SAT-12 roles (primary, challenger, investigator)",
		handler: handleSetCommand,
	});

	pi.registerCommand("sat12_report", {
		description: "Re-render HTML executive report from an existing OKF bundle directory",
		handler: handleReportCommand,
	});

	pi.registerCommand("sat12_help", {
		description: "Display help reference for SAT-12 commands, settings, and parameters",
		handler: handleHelpCommand,
	});

	pi.registerCommand("sat12_research", {
		description: "Gather standalone web research via pi-webaio MCP server",
		handler: handleResearchCommand,
	});

	pi.registerCommand("sat12_status", {
		description: "Display status of current or latest SAT-12 analysis session",
		handler: handleStatusCommand,
	});

	pi.registerCommand("sat12_cancel", {
		description: "Cancel currently running SAT-12 analysis session (abandon)",
		handler: handleCancelCommand,
	});

	pi.registerCommand("sat12_stop", {
		description: "Pause currently running SAT-12 analysis session (can resume with /sat12_continue)",
		handler: handleStopCommand,
	});

	pi.registerCommand("sat12_continue", {
		description: "Resume paused or interrupted SAT-12 analysis session",
		handler: handleContinueCommand,
	});
}
