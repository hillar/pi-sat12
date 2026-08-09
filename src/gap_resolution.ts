

import { Type, type Static } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeStructured, checkAborted, isAbortError, type UsageAccumulator } from "./llm.ts";
import { gatherResearch } from "./research.ts";





export const GapQueriesSchema = Type.Object({
	queries: Type.Array(Type.String(), {
		description: "Focused search queries to address the most critical actionable gaps (1-2 queries).",
	}),
});

export type GapQueries = Static<typeof GapQueriesSchema>;





const GAP_QUERY_SYSTEM = `You are an expert intelligence research gap analyst.

Given a list of information gaps identified during prior analysis or research, generate focused search queries that will address the most important gaps — one query per actionable gap.

## Prioritize:
1. Gaps that would most materially change the analysis if resolved
2. Gaps about factual data, statistics, or reports likely findable via search
3. Gaps that multiple analytical conclusions depend on

Skip gaps that are inherently unanswerable (e.g. classified material, future predictions).

## Output Guidance

You MUST output a single JSON object with a "queries" field containing an array of 1 to 2 focused query strings. If no actionable gaps exist, return {"queries": []}.`;





export interface GapResolutionUpdateDetails {
	phase: "research";
	status: "gap_resolution_started" | "gap_queries_generated" | "gap_resolution_completed" | "gap_resolution_failed";
	queries?: string[];
	error?: string;
}

export async function resolveGaps(
	question: string,
	gaps: string[],
	signal: AbortSignal | undefined,
	onUpdate: ((details: GapResolutionUpdateDetails) => void) | undefined,
	ctx: ExtensionContext,
	usage: UsageAccumulator,
	maxIterations = 2,
): Promise<string | undefined> {
	if (!gaps || gaps.length === 0) return undefined;

	checkAborted(signal, ctx);
	onUpdate?.({ phase: "research", status: "gap_resolution_started" });

	const gapsText = gaps.slice(0, 5).map((g) => `- ${g}`).join("\n");
	const userMessage = `Analytic Question: ${question}\n\nInformation Gaps to Address:\n\n${gapsText}`;

	let queries: string[] = [];
	try {
		const model = ctx.model!;
		const { data, usage: callUsage, durationMs } = await completeStructured<GapQueries>(ctx, {
			model,
			systemPrompt: GAP_QUERY_SYSTEM,
			messages: [{ role: "user" as const, content: userMessage, timestamp: Date.now() }],
			schema: GapQueriesSchema,
			temperature: 0.1,
			signal,
		});
		usage.add(callUsage, model.id, (model as any).name || model.id, "primary", "research:gap_queries", durationMs);
		queries = data.queries.slice(0, maxIterations);
	} catch (err) {
		if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) {
			throw err;
		}
		onUpdate?.({
			phase: "research",
			status: "gap_resolution_failed",
			error: err instanceof Error ? err.message : String(err),
		});
		return undefined;
	}

	if (queries.length === 0) return undefined;

	onUpdate?.({ phase: "research", status: "gap_queries_generated", queries });

	const newEvidenceBlocks: string[] = [];
	for (let i = 0; i < queries.length; i++) {
		checkAborted(signal, ctx);
		const q = queries[i];
		try {
			const text = await gatherResearch(q, signal, undefined);
			if (text?.trim()) {
				newEvidenceBlocks.push(`### Gap Follow-up ${i + 1}: ${q}\n\n${text.trim()}`);
			}
		} catch {
			
		}
	}

	onUpdate?.({ phase: "research", status: "gap_resolution_completed" });

	if (newEvidenceBlocks.length === 0) return undefined;

	return [
		"## Gap Resolution Findings",
		"Additional targeted evidence gathered to address identified intelligence gaps:",
		"",
		...newEvidenceBlocks,
	].join("\n\n");
}
