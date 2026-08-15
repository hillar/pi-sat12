import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveModel, UsageAccumulator, isAbortError } from "../llm.ts";
import { runSingleTechnique } from "../techniques/runner.ts";
import { qualityTechnique } from "../techniques/diagnostic/quality.ts";
import { QUALITY_FIXTURES, type EvalFixture } from "../../evals/fixtures.ts";
import type { TechniqueResult } from "../techniques/types.ts";

export const Params = Type.Object({
	n: Type.Optional(
		Type.Integer({
			description: "Repetitions for each fixture. A pass rate needs more than one run.",
			minimum: 1,
			maximum: 50,
			default: 10,
		}),
	),
	fixtures: Type.Optional(
		Type.String({
			description:
				"Comma-separated fixture ids to run. Omit to run all. Ids: notice_only, web_bundle, user_override, single_source, no_sources, large_bundle.",
		}),
	),
	model: Type.Optional(
		Type.String({
			description: "Model id to evaluate. Default: the active Pi model.",
		}),
	),
	results_dir: Type.Optional(
		Type.String({
			description: "Directory for the result files. Default: evals/results/<timestamp>.",
		}),
	),
	resume: Type.Optional(
		Type.Boolean({
			description: "Skip a cell when its raw file exists. Default: true.",
		}),
	),
});

export type Params = Static<typeof Params>;

export interface EvalProgress {
	phase: "eval";
	status: string;
	message?: string;
	cell?: string;
}

/**
 * Bucket a validation error by the rule that produced it.
 * The eval classifies with a regex. The validator messages stay unchanged,
 * because those messages go back to the model during a retry.
 */
export function classifyFailure(error: string | undefined): string {
	if (!error) return "none";
	const patterns: Array<[string, RegExp]> = [
		["missing_sources", /'sources' array is missing or empty/i],
		["admiralty_code_mismatch", /admiralty_code .* but reliability\/credibility/i],
		["duplicate_source_id", /Duplicate source_id/i],
		["self_corroboration", /cannot corroborate itself/i],
		["unknown_corroborator", /not present in the sources list/i],
		["override_code_mismatch", /user_overridden to/i],
		["uncorroborated_confirmed", /credibility "1"/i],
		["schema_validation", /Schema validation failed/i],
		["json_parse", /JSON parse error|contained no JSON/i],
	];
	for (const [name, pattern] of patterns) {
		if (pattern.test(error)) return name;
	}
	return "other";
}

interface CellRecord {
	fixture: string;
	run: number;
	ok: boolean;
	attempts: number | null;
	first_attempt_pass: boolean;
	failing_rule: string;
	sources_count: number | null;
	gaps_count: number | null;
	reliability: string | null;
	duration_ms: number;
	error?: string;
	/** Rule that fired on each failed attempt before a later attempt passed. */
	retry_causes?: string[];
}

/** Pull the report numbers out of one technique result. */
function summarise(fixture: EvalFixture, run: number, result: TechniqueResult): CellRecord {
	const ok = result.status === "success";
	const output = (result.output ?? {}) as {
		sources?: unknown[];
		gaps?: unknown[];
		reliability?: string;
	};
	return {
		fixture: fixture.id,
		run,
		ok,
		attempts: result.attempts ?? null,
		first_attempt_pass: ok && result.attempts === 1,
		failing_rule: ok ? "none" : classifyFailure(result.error),
		sources_count: ok && Array.isArray(output.sources) ? output.sources.length : ok ? 0 : null,
		gaps_count: ok && Array.isArray(output.gaps) ? output.gaps.length : null,
		reliability: ok ? (output.reliability ?? null) : null,
		duration_ms: result.durationMs ?? 0,
		error: ok ? undefined : result.error,
		retry_causes:
			result.retryErrors && result.retryErrors.length > 0
				? result.retryErrors.map((e) => `${classifyFailure(e)}: ${e.slice(0, 160)}`)
				: undefined,
	};
}

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Build the human-readable report. */
export function buildReport(
	records: CellRecord[],
	modelLabel: string,
	n: number,
): string {
	const fixtureIds = [...new Set(records.map((r) => r.fixture))];
	const lines: string[] = [
		"# SAT-12 quality prompt eval",
		"",
		`Model: \`${modelLabel}\``,
		`Runs for each fixture: ${n}`,
		`Total generations: ${records.length}`,
		"",
		"| Fixture | First-attempt pass | Final pass | Mean attempts | Mean sources | Mean gaps | Top failure |",
		"|---|---:|---:|---:|---:|---:|---|",
	];

	for (const id of fixtureIds) {
		const rows = records.filter((r) => r.fixture === id);
		const firstPass = rows.filter((r) => r.first_attempt_pass).length;
		const finalPass = rows.filter((r) => r.ok).length;
		const failures = rows.filter((r) => !r.ok).map((r) => r.failing_rule);
		const counts = new Map<string, number>();
		for (const f of failures) counts.set(f, (counts.get(f) ?? 0) + 1);
		const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
		const sourceCounts = rows.filter((r) => r.sources_count != null).map((r) => r.sources_count as number);
		const gapCounts = rows.filter((r) => r.gaps_count != null).map((r) => r.gaps_count as number);
		const attempts = rows.filter((r) => r.attempts != null).map((r) => r.attempts as number);

		lines.push(
			`| \`${id}\` | ${firstPass}/${rows.length} | ${finalPass}/${rows.length} | ` +
				`${mean(attempts).toFixed(2)} | ${mean(sourceCounts).toFixed(1)} | ${mean(gapCounts).toFixed(1)} | ` +
				`${top ? `${top[0]} (${top[1]})` : "—"} |`,
		);
	}

	// Show why a run needed a retry. A retry that later passed hides the cause
	// in the pass rate, so list the causes on their own.
	const retryCauses = new Map<string, number>();
	for (const record of records) {
		for (const cause of record.retry_causes ?? []) {
			const rule = cause.split(":")[0];
			retryCauses.set(rule, (retryCauses.get(rule) ?? 0) + 1);
		}
	}
	if (retryCauses.size > 0) {
		lines.push("", "### Retry causes", "", "| Rule | Times |", "|---|---:|");
		for (const [rule, count] of [...retryCauses.entries()].sort((a, b) => b[1] - a[1])) {
			lines.push(`| \`${rule}\` | ${count} |`);
		}
	}

	const allFirst = records.filter((r) => r.first_attempt_pass).length;
	const allFinal = records.filter((r) => r.ok).length;
	lines.push(
		"",
		`**Overall first-attempt pass: ${allFirst}/${records.length} ` +
			`(${((100 * allFirst) / Math.max(1, records.length)).toFixed(1)}%)**`,
		`**Overall final pass: ${allFinal}/${records.length} ` +
			`(${((100 * allFinal) / Math.max(1, records.length)).toFixed(1)}%)**`,
		"",
		"## Fixture intent",
		"",
	);
	for (const id of fixtureIds) {
		const fixture = QUALITY_FIXTURES.find((f) => f.id === id);
		if (fixture) lines.push(`- \`${id}\`: ${fixture.intent} Expect: ${fixture.expect}`);
	}
	lines.push(
		"",
		"## Limits",
		"",
		"- The run measures one model. The numbers do not carry to another provider.",
		`- ${n} runs for each cell give a rough rate, not a tight confidence interval.`,
		"- The failure classifier uses a regex. It can put a failure in the wrong bucket.",
		"  It changes the report only. It never changes the validator.",
		"- A first-attempt pass counts prompt quality. A final pass counts prompt quality plus the retry loop.",
	);
	return lines.join("\n") + "\n";
}

export const sat12Eval = {
	name: "sat12_eval",
	label: "SAT-12 Prompt Eval",
	description:
		"Measures how well the quality technique prompt and its validator work together. Runs each evidence fixture N times, records first-attempt pass rate, attempts used, and the rule that failed. Writes a resumable result bundle.",
	promptSnippet:
		"sat12_eval(n, fixtures?) — measure the quality prompt pass rate against evidence fixtures",
	promptGuidelines: [
		"Use sat12_eval before and after changing a technique prompt or a validator rule.",
		"sat12_eval is long-running. It makes n x fixtures model calls.",
		"Report the first-attempt pass rate to the user. That number tracks prompt quality.",
	],
	parameters: Params,
	executionMode: "sequential" as const,

	async execute(
		_toolCallId: string,
		params: Params,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<EvalProgress> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<EvalProgress>> {
		const n = params.n ?? 10;
		const resume = params.resume ?? true;

		const resolution = resolveModel(ctx, params.model);
		if (!resolution.model) {
			return {
				content: [{ type: "text", text: `Error: ${resolution.error}` }],
				details: { phase: "eval", status: "failed" },
			};
		}
		const model = resolution.model;
		const modelLabel = `${model.provider}/${model.id}`;

		const selected = params.fixtures
			? params.fixtures.split(",").map((s) => s.trim()).filter(Boolean)
			: null;
		const fixtures = selected
			? QUALITY_FIXTURES.filter((f) => selected.includes(f.id))
			: QUALITY_FIXTURES;

		if (fixtures.length === 0) {
			return {
				content: [{ type: "text", text: "Error: no fixture matched the ids given." }],
				details: { phase: "eval", status: "failed" },
			};
		}

		const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const resultsDir = params.results_dir
			? params.results_dir
			: join(ctx.cwd || process.cwd(), "evals", "results", stamp);
		const rawDir = join(resultsDir, "raw");
		await mkdir(rawDir, { recursive: true });

		const usage = new UsageAccumulator();
		const records: CellRecord[] = [];
		const total = fixtures.length * n;
		let index = 0;

		for (const fixture of fixtures) {
			for (let run = 1; run <= n; run++) {
				index++;
				const cellName = `${fixture.id}__${run}`;
				const cellPath = join(rawDir, `${cellName}.json`);

				if (resume) {
					try {
						const existing = await readFile(cellPath, "utf8");
						records.push(JSON.parse(existing) as CellRecord);
						onUpdate?.({
							content: [{ type: "text", text: `[${index}/${total}] skip ${cellName}` }],
							details: { phase: "eval", status: "skipped", cell: cellName },
						});
						continue;
					} catch {
						// No cached cell. Run it.
					}
				}

				onUpdate?.({
					content: [{ type: "text", text: `[${index}/${total}] run ${cellName}` }],
					details: { phase: "eval", status: "running", cell: cellName },
				});

				let result: TechniqueResult;
				try {
					result = await runSingleTechnique(
						qualityTechnique,
						fixture.question,
						fixture.evidence,
						ctx,
						model,
						signal,
						undefined,
						usage,
						{ userOverrides: fixture.userOverrides },
					);
				} catch (err) {
					if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) {
						throw err;
					}
					result = {
						id: qualityTechnique.id,
						status: "failed",
						error: err instanceof Error ? err.message : String(err),
					};
				}

				const record = summarise(fixture, run, result);
				records.push(record);
				await writeFile(cellPath, JSON.stringify(record, null, 2) + "\n", "utf8");
			}
		}

		const report = buildReport(records, modelLabel, n);
		await writeFile(join(resultsDir, "RESULTS.md"), report, "utf8");
		await writeFile(
			join(resultsDir, "results.json"),
			JSON.stringify(
				{
					generated: new Date().toISOString(),
					model: modelLabel,
					runs_per_fixture: n,
					records,
					usage: usage.total,
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		return {
			content: [{ type: "text", text: `${report}\nResult bundle: \`${resultsDir}\`` }],
			details: { phase: "eval", status: "completed" },
			usage: usage.total,
		};
	},
};
