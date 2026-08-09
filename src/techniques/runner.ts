

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completeStructured, checkAborted, isAbortError, type UsageAccumulator } from "../llm.ts";
import { buildTechniqueUserMessage, formatTechniqueOutput } from "../messages.ts";
import type { TechniqueDefinition, TechniqueResult } from "./types.ts";
import { buildLayers, ALL_TECHNIQUES } from "./index.ts";





export interface RunnerUpdateDetails {
	phase: "technique";
	techniqueId: string;
	techniqueName: string;
	status: "started" | "completed" | "failed";
	error?: string;
}

export type RunnerOnUpdate = (details: RunnerUpdateDetails) => void;






function formatDep(id: string, result: TechniqueResult, maxChars: number): string {
	if (result.status !== "success" || result.output == null) {
		return `[${id}: failed — ${result.error ?? "unknown error"}]`;
	}
	const full = formatTechniqueOutput(result.output);
	return full.length <= maxChars ? full : full.slice(0, maxChars) + "\n…[truncated]";
}






const CONTEXT_HEADROOM_FRACTION = 0.4; 
const CHARS_PER_TOKEN = 4; 
const FALLBACK_MAX_CHARS_PER_DEP = 8000;

function perDepBudget(ctx: ExtensionContext, depCount: number): number {
	if (depCount === 0) return 0;
	try {
		const usage = ctx.getContextUsage?.();
		if (!usage) return FALLBACK_MAX_CHARS_PER_DEP;
		const { contextWindow, tokens } = usage;
		const remaining = Math.max(0, contextWindow - tokens);
		const headroom = remaining * CONTEXT_HEADROOM_FRACTION;
		const charsPerDep = Math.floor((headroom * CHARS_PER_TOKEN) / depCount);
		return Math.max(2000, charsPerDep); 
	} catch {
		return FALLBACK_MAX_CHARS_PER_DEP;
	}
}





async function runOneTechnique(
	technique: TechniqueDefinition,
	question: string,
	evidenceText: string | undefined,
	priorResults: Record<string, TechniqueResult>,
	ctx: ExtensionContext,
	model: NonNullable<ExtensionContext["model"]>,
	signal: AbortSignal | undefined,
	onUpdate: RunnerOnUpdate | undefined,
	usage: UsageAccumulator,
	continueOnPartialResults: boolean,
): Promise<TechniqueResult> {
	
	if (priorResults[technique.id]?.status === "success" && priorResults[technique.id]?.output != null) {
		onUpdate?.({
			phase: "technique",
			techniqueId: technique.id,
			techniqueName: technique.name,
			status: "completed",
		});
		return priorResults[technique.id];
	}

	checkAborted(signal, ctx);
	onUpdate?.({
		phase: "technique",
		techniqueId: technique.id,
		techniqueName: technique.name,
		status: "started",
	});

	const t0 = Date.now();

	
	const budget = perDepBudget(ctx, technique.dependencies.length);
	const depContexts = technique.dependencies
		.filter((depId) => priorResults[depId]?.status === "success")
		.map((depId) => {
			const depTech = ALL_TECHNIQUES.find((t) => t.id === depId);
			return {
				techniqueId: depId,
				techniqueName: depTech?.name ?? depId,
				outputText: formatDep(depId, priorResults[depId]!, budget),
			};
		});

	const messages = [buildTechniqueUserMessage(question, evidenceText, depContexts)];

	try {
		const { data, usage: callUsage, durationMs } = await completeStructured(ctx, {
			model,
			systemPrompt: technique.systemPrompt,
			messages,
			schema: technique.outputSchema,
			temperature: technique.temperature,
			signal,
			semanticCheck: technique.semanticCheck,
		});
		usage.add(callUsage, model.id, (model as any).name || model.id, "primary", `technique:${technique.id}`, durationMs);

		onUpdate?.({
			phase: "technique",
			techniqueId: technique.id,
			techniqueName: technique.name,
			status: "completed",
		});

		return {
			id: technique.id,
			status: "success",
			output: data,
			durationMs: Date.now() - t0,
		};
	} catch (err) {
		if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) {
			throw err;
		}

		const errMsg = err instanceof Error ? err.message : String(err);

		if (continueOnPartialResults) {
			onUpdate?.({
				phase: "technique",
				techniqueId: technique.id,
				techniqueName: technique.name,
				status: "failed",
				error: errMsg,
			});
			return { id: technique.id, status: "failed", error: errMsg, durationMs: Date.now() - t0 };
		}

		
		throw err;
	}
}






export async function runTechniqueLayers(
	question: string,
	evidenceText: string | undefined,
	ctx: ExtensionContext,
	model: NonNullable<ExtensionContext["model"]>,
	signal: AbortSignal | undefined,
	onUpdate: RunnerOnUpdate | undefined,
	usage: UsageAccumulator,
	continueOnPartialResults: boolean,
	initialResults?: Record<string, TechniqueResult>,
	onResult?: (id: string, result: TechniqueResult) => void,
): Promise<Record<string, TechniqueResult>> {
	const results: Record<string, TechniqueResult> = { ...initialResults };
	const layers = buildLayers(ALL_TECHNIQUES);

	for (const layer of layers) {
		checkAborted(signal, ctx);

		const layerResults = await Promise.all(
			layer.map((technique) =>
				runOneTechnique(
					technique,
					question,
					evidenceText,
					results,
					ctx,
					model,
					signal,
					onUpdate,
					usage,
					continueOnPartialResults,
				),
			),
		);

		for (const r of layerResults) {
			results[r.id] = r;
			onResult?.(r.id, r);
		}
	}

	return results;
}
