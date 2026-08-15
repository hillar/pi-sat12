

import { Type, type Static } from "typebox";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	completeStructured,
	StringEnum,
	checkAborted,
	isAbortError,
	type UsageAccumulator,
} from "./llm.ts";
import type { TechniqueResult } from "./techniques/types.ts";
import { ALL_TECHNIQUES } from "./techniques/index.ts";





export const CritiqueOutputSchema = Type.Object({
	challenges: Type.Array(
		Type.Object({
			challenge: Type.String(),
			severity: StringEnum(["High", "Moderate", "Low"] as const),
		}),
	),
	agreements: Type.Array(Type.String()),
	alternative_interpretations: Type.Array(Type.String()),
	evidence_gaps: Type.Array(Type.String()),
	overall_severity: StringEnum(["High", "Moderate", "Low"] as const),
});

export const RebuttalOutputSchema = Type.Object({
	accepted_challenges: Type.Array(Type.String()),
	rejected_challenges: Type.Array(
		Type.Object({
			challenge: Type.String(),
			reason: Type.String(),
		}),
	),
	revised_conclusions: Type.String(),
	revised_confidence: StringEnum(["Higher", "Same", "Lower"] as const),
});

export const AdjudicationOutputSchema = Type.Object({
	convergence_analysis: Type.String(),
	novel_insights: Type.Array(Type.String()),
	confidence_delta: Type.Number({ minimum: -1, maximum: 1 }),
	adjudication_summary: Type.String(),
});

export type CritiqueOutput = Static<typeof CritiqueOutputSchema>;
export type RebuttalOutput = Static<typeof RebuttalOutputSchema>;
export type AdjudicationOutput = Static<typeof AdjudicationOutputSchema>;





export interface AdversarialExchange {
	techniqueId: string;
	techniqueName: string;
	rounds: number;
	critique: CritiqueOutput;
	rebuttal: RebuttalOutput;
	adjudication?: AdjudicationOutput;
}





export interface AdversarialUpdateDetails {
	phase: "adversarial";
	techniqueId: string;
	step: "critique" | "rebuttal" | "adjudication" | "completed" | "failed";
	round: number;
	error?: string;
}

export type AdversarialOnUpdate = (details: AdversarialUpdateDetails) => void;





const CRITIQUE_SYSTEM_PROMPT = `You are a rigorous peer reviewer of intelligence analysis.

You have been given the output of a structured analytic technique applied to a question. Your task is to critically evaluate the analysis with the goal of strengthening it.

## Your Approach

1. **Identify Agreements**: What did the analyst get right? What conclusions are well-supported?
2. **Challenge Weaknesses**: Where is the reasoning weak, evidence insufficient, or conclusions premature?
3. **Offer Alternatives**: What alternative interpretations of the evidence exist?
4. **Find Gaps**: What evidence was overlooked or unavailable?
5. **Assess Severity**: How significant are your challenges? Could they change the conclusions?

## Rules
- Be specific — reference particular claims, evidence, or reasoning steps
- Be constructive — the goal is better analysis, not scoring points
- Distinguish between methodological issues and substantive disagreements
- Consider cognitive biases the analyst may have fallen into
- Don't manufacture disagreement where the analysis is sound

## Output Requirements

You MUST output a single JSON object and nothing else. No preamble, no explanation, no markdown prose before or after. The JSON must match the schema provided.

## Output Guidance

Produce a JSON object with:
- **challenges**: Array of specific challenges, each with a "challenge" string and "severity" ("High", "Moderate", or "Low").
- **agreements**: List of points where you agree with the analysis.
- **alternative_interpretations**: Different ways to read the evidence.
- **evidence_gaps**: Missing evidence the analysis didn't address.
- **overall_severity**: Overall severity of the critique — "High", "Moderate", or "Low".`;

const REBUTTAL_SYSTEM_PROMPT = `You are an intelligence analyst defending your work while remaining intellectually honest.

You've received a critique of your analysis. You must respond to each challenge:

1. **Accept Valid Points**: If a challenge is valid, acknowledge it and explain how it changes your conclusions
2. **Rebut Invalid Points**: If a challenge is mistaken, explain why with specific evidence
3. **Revise Conclusions**: Produce updated conclusions incorporating any accepted challenges

## Rules
- Be honest — concede points that have merit
- Be specific — reference the evidence that supports your position
- Don't be defensive for its own sake — the goal is accurate analysis
- Distinguish between challenges that affect conclusions and those that don't

## Output Requirements

You MUST output a single JSON object and nothing else. No preamble, no explanation, no markdown prose before or after. The JSON must match the schema provided.

## Output Guidance

Produce a JSON object with:
- **accepted_challenges**: List of challenge strings you accept as valid.
- **rejected_challenges**: Array of objects with "challenge" (the challenge text) and "reason" (why you reject it).
- **revised_conclusions**: Updated conclusions incorporating any accepted challenges.
- **revised_confidence**: Whether your confidence is now "Higher", "Same", or "Lower" than before the critique.`;

const ADJUDICATION_SYSTEM_PROMPT = `You are an impartial judge evaluating a debate between two intelligence analysts.

You've seen the original analysis, a critique, and a rebuttal. Your task is to render a fair judgment.

1. **Convergence Analysis**: Where do the primary analyst and critic converge? Where do they genuinely diverge?
2. **Novel Insights**: What did the critique/rebuttal process reveal that wasn't in the original analysis?
3. **Confidence Delta**: How should overall confidence in the analysis change, on a scale from -1 (much lower) to +1 (much higher)?
4. **Summary**: Produce an integrated assessment.

## Rules
- Base judgments on evidence quality and reasoning strength, not authority
- Genuine uncertainty is a valid conclusion — don't force resolution
- Consider whether the debate revealed new insights neither side initially had

## Output Requirements

You MUST output a single JSON object and nothing else. No preamble, no explanation, no markdown prose before or after. The JSON must match the schema provided.

## Output Guidance

Produce a JSON object with:
- **convergence_analysis**: Narrative of where primary and challenger agree/disagree.
- **novel_insights**: List of insights the debate process revealed.
- **confidence_delta**: Number from -1 to +1.
- **adjudication_summary**: The integrated final assessment.`;






function formatForAdversarial(
	techniqueId: string,
	techniqueName: string,
	output: unknown,
): string {
	return [
		`**Technique:** ${techniqueName} (${techniqueId})`,
		"",
		"**Output:**",
		"```json",
		JSON.stringify(output, null, 2),
		"```",
	].join("\n");
}

function buildCritiqueMessage(
	question: string,
	evidenceText: string | undefined,
	techniqueId: string,
	techniqueName: string,
	output: unknown,
): string {
	const parts: string[] = [`## Original Question\n\n${question}`];
	if (evidenceText?.trim()) parts.push(`## Evidence\n\n${evidenceText.trim()}`);
	parts.push(
		`## Analysis to Critique\n\n${formatForAdversarial(techniqueId, techniqueName, output)}`,
	);
	return parts.join("\n\n");
}

function buildRebuttalMessage(
	question: string,
	evidenceText: string | undefined,
	techniqueId: string,
	techniqueName: string,
	output: unknown,
	critique: CritiqueOutput,
): string {
	const parts: string[] = [`## Original Question\n\n${question}`];
	if (evidenceText?.trim()) parts.push(`## Evidence\n\n${evidenceText.trim()}`);
	parts.push(
		`## Your Original Analysis\n\n${formatForAdversarial(techniqueId, techniqueName, output)}`,
	);
	parts.push(
		`## Critique Received\n\n\`\`\`json\n${JSON.stringify(critique, null, 2)}\n\`\`\``,
	);
	return parts.join("\n\n");
}

function buildAdjudicationMessage(
	question: string,
	evidenceText: string | undefined,
	techniqueId: string,
	techniqueName: string,
	output: unknown,
	critique: CritiqueOutput,
	rebuttal: RebuttalOutput,
): string {
	const parts: string[] = [`## Original Question\n\n${question}`];
	if (evidenceText?.trim()) parts.push(`## Evidence\n\n${evidenceText.trim()}`);
	parts.push(
		`## Primary Analysis\n\n${formatForAdversarial(techniqueId, techniqueName, output)}`,
	);
	parts.push(`## Critique\n\n\`\`\`json\n${JSON.stringify(critique, null, 2)}\n\`\`\``);
	parts.push(`## Rebuttal\n\n\`\`\`json\n${JSON.stringify(rebuttal, null, 2)}\n\`\`\``);
	return parts.join("\n\n");
}





async function critiqueOneTechnique(
	techniqueId: string,
	techniqueName: string,
	output: unknown,
	question: string,
	evidenceText: string | undefined,
	mode: "dual" | "trident",
	rounds: number,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate: AdversarialOnUpdate | undefined,
	usage: UsageAccumulator,
	models?: { primaryModel: Model<any>; challengerModel?: Model<any>; investigatorModel?: Model<any> },
): Promise<AdversarialExchange> {
	const primaryModel = models?.primaryModel || ctx.model!;
	const challengerModel = models?.challengerModel || primaryModel;
	const investigatorModel = models?.investigatorModel || challengerModel;

	let lastCritique!: CritiqueOutput;
	let lastRebuttal!: RebuttalOutput;
	let lastAdjudication: AdjudicationOutput | undefined;

	for (let round = 0; round < rounds; round++) {
		checkAborted(signal, ctx);

		
		onUpdate?.({ phase: "adversarial", techniqueId, step: "critique", round });
		let critiqueResult;
		try {
			critiqueResult = await completeStructured<CritiqueOutput>(ctx, {
				model: challengerModel,
				systemPrompt: CRITIQUE_SYSTEM_PROMPT,
				messages: [
					{
						role: "user" as const,
						content: buildCritiqueMessage(
							question,
							evidenceText,
							techniqueId,
							techniqueName,
							output,
						),
						timestamp: Date.now(),
					},
				],
				schema: CritiqueOutputSchema,
				temperature: 0.8,
				signal,
			});
		} catch (err) {
			if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) throw err;
			if (challengerModel.id !== primaryModel.id) {
				console.warn(`Challenger model '${challengerModel.id}' failed critique for '${techniqueId}' — falling back to primary model '${primaryModel.id}'`);
				critiqueResult = await completeStructured<CritiqueOutput>(ctx, {
					model: primaryModel,
					systemPrompt: CRITIQUE_SYSTEM_PROMPT,
					messages: [
						{
							role: "user" as const,
							content: buildCritiqueMessage(
								question,
								evidenceText,
								techniqueId,
								techniqueName,
								output,
							),
							timestamp: Date.now(),
						},
					],
					schema: CritiqueOutputSchema,
					temperature: 0.7,
					signal,
				});
			} else {
				throw err;
			}
		}
		usage.add(critiqueResult.usage, challengerModel.id, (challengerModel as any).name || challengerModel.id, "challenger", `adversarial:critique:${techniqueId}`, critiqueResult.durationMs);
		lastCritique = critiqueResult.data;

		
		checkAborted(signal, ctx);
		onUpdate?.({ phase: "adversarial", techniqueId, step: "rebuttal", round });
		const rebuttalResult = await completeStructured<RebuttalOutput>(ctx, {
			model: primaryModel,
			systemPrompt: REBUTTAL_SYSTEM_PROMPT,
			messages: [
				{
					role: "user" as const,
					content: buildRebuttalMessage(
						question,
						evidenceText,
						techniqueId,
						techniqueName,
						output,
						lastCritique,
					),
					timestamp: Date.now(),
				},
			],
			schema: RebuttalOutputSchema,
			temperature: 0.8,
			signal,
		});
		usage.add(rebuttalResult.usage, primaryModel.id, (primaryModel as any).name || primaryModel.id, "primary", `adversarial:rebuttal:${techniqueId}`, rebuttalResult.durationMs);
		lastRebuttal = rebuttalResult.data;

		
		if (mode === "trident") {
			checkAborted(signal, ctx);
			onUpdate?.({ phase: "adversarial", techniqueId, step: "adjudication", round });

			let adjResult;
			try {
				adjResult = await completeStructured<AdjudicationOutput>(ctx, {
					model: investigatorModel,
					systemPrompt: ADJUDICATION_SYSTEM_PROMPT,
					messages: [
						{
							role: "user" as const,
							content: buildAdjudicationMessage(
								question,
								evidenceText,
								techniqueId,
								techniqueName,
								output,
								lastCritique,
								lastRebuttal,
							),
							timestamp: Date.now(),
						},
					],
					schema: AdjudicationOutputSchema,
					temperature: 0.7,
					signal,
				});
			} catch (err) {
				if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) throw err;
				if (investigatorModel.id !== primaryModel.id) {
					console.warn(`Investigator model '${investigatorModel.id}' failed adjudication for '${techniqueId}' — falling back to primary model '${primaryModel.id}'`);
					adjResult = await completeStructured<AdjudicationOutput>(ctx, {
						model: primaryModel,
						systemPrompt: ADJUDICATION_SYSTEM_PROMPT,
						messages: [
							{
								role: "user" as const,
								content: buildAdjudicationMessage(
									question,
									evidenceText,
									techniqueId,
									techniqueName,
									output,
									lastCritique,
									lastRebuttal,
								),
								timestamp: Date.now(),
							},
						],
						schema: AdjudicationOutputSchema,
						temperature: 0.7,
						signal,
					});
				} else {
					throw err;
				}
			}
			usage.add(adjResult.usage, investigatorModel.id, (investigatorModel as any).name || investigatorModel.id, "secondary", `adversarial:adjudication:${techniqueId}`, adjResult.durationMs);
			lastAdjudication = adjResult.data;
		}
	}

	onUpdate?.({ phase: "adversarial", techniqueId, step: "completed", round: rounds - 1 });

	return {
		techniqueId,
		techniqueName,
		rounds,
		critique: lastCritique,
		rebuttal: lastRebuttal,
		adjudication: lastAdjudication,
	};
}





export async function runAdversarialCycle(
	techniqueResults: Record<string, TechniqueResult>,
	question: string,
	evidenceText: string | undefined,
	mode: "dual" | "trident",
	rounds: number,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate: AdversarialOnUpdate | undefined,
	usage: UsageAccumulator,
	initialExchanges?: Record<string, AdversarialExchange>,
	onExchange?: (id: string, exchange: AdversarialExchange) => void,
	models?: { primaryModel: Model<any>; challengerModel?: Model<any>; investigatorModel?: Model<any> },
): Promise<Record<string, AdversarialExchange>> {
	
	const eligible = Object.entries(techniqueResults).filter(
		([, r]) => r.status === "success" && r.output != null,
	);

	
	const result: Record<string, AdversarialExchange> = { ...initialExchanges };

	for (const [id, res] of eligible) {
		checkAborted(signal, ctx);

		
		if (result[id]) {
			onUpdate?.({ phase: "adversarial", techniqueId: id, step: "completed", round: rounds - 1 });
			continue;
		}

		const techDef = ALL_TECHNIQUES.find((t) => t.id === id);
		const name = techDef?.name ?? id;
		try {
			const exchange = await critiqueOneTechnique(
				id,
				name,
				res.output,
				question,
				evidenceText,
				mode,
				rounds,
				ctx,
				signal,
				onUpdate,
				usage,
				models,
			);
			result[id] = exchange;
			onExchange?.(id, exchange);
		} catch (err) {
			if (isAbortError(err) || signal?.aborted || ctx.signal?.aborted) {
				throw err;
			}
			console.error(`Adversarial critique failed for ${id}:`, err);
			onUpdate?.({
				phase: "adversarial",
				techniqueId: id,
				step: "failed",
				round: 0,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return result;
}
