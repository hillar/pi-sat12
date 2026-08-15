

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	completeStructured,
	checkAborted,
	isAbortError,
	TechniqueValidationError,
	type UsageAccumulator,
} from "../llm.ts";
import { buildTechniqueUserMessage, formatTechniqueOutput } from "../messages.ts";
import type { TechniqueDefinition, TechniqueResult, SemanticCheckContext } from "./types.ts";
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
		// tokens can be null. Do not treat null as zero used. That would give too
		// large a budget. Use the safe default instead.
		if (tokens == null) return FALLBACK_MAX_CHARS_PER_DEP;
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
	semanticContext?: SemanticCheckContext,
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

	const trimmedEvidence = evidenceText?.trim() ?? "";
	const effectiveContext: SemanticCheckContext = {
		...semanticContext,
		hasEvidence: trimmedEvidence.length > 0,
		evidenceLength: trimmedEvidence.length,
	};

	try {
		const { data, usage: callUsage, durationMs, attempts, retryErrors } = await completeStructured(ctx, {
			model,
			systemPrompt: technique.systemPrompt,
			messages,
			schema: technique.outputSchema,
			temperature: technique.temperature,
			signal,
			semanticCheck: technique.semanticCheck
				? (d) => technique.semanticCheck!(d, effectiveContext)
				: undefined,
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
			attempts,
			retryErrors,
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
			return {
				id: technique.id,
				status: "failed",
				error: errMsg,
				durationMs: Date.now() - t0,
				attempts: err instanceof TechniqueValidationError ? err.attempts : undefined,
			};
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
	options?: { userOverrides?: Record<string, string> },
): Promise<Record<string, TechniqueResult>> {
	const results: Record<string, TechniqueResult> = { ...initialResults };
	const layers = buildLayers(ALL_TECHNIQUES);
	const semanticContext: SemanticCheckContext = { userOverrides: options?.userOverrides };

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
					semanticContext,
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

/**
 * Run one technique alone. Do not use a dependency chain.
 * /sat12_research uses this to make a Layer 0 result. The result seeds a session.
 */
export async function runSingleTechnique(
	technique: TechniqueDefinition,
	question: string,
	evidenceText: string | undefined,
	ctx: ExtensionContext,
	model: NonNullable<ExtensionContext["model"]>,
	signal: AbortSignal | undefined,
	onUpdate: RunnerOnUpdate | undefined,
	usage: UsageAccumulator,
	options?: { userOverrides?: Record<string, string> },
): Promise<TechniqueResult> {
	return runOneTechnique(
		technique,
		question,
		evidenceText,
		{},
		ctx,
		model,
		signal,
		onUpdate,
		usage,
		true,
		{ userOverrides: options?.userOverrides },
	);
}
