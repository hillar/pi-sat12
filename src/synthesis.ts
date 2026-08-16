

import { Type, type Static } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	completeStructured,
	StringEnum,
	checkAborted,
	type UsageAccumulator,
} from "./llm.ts";
import type { TechniqueResult } from "./techniques/types.ts";
import type { AdversarialExchange } from "./adversarial.ts";
import { ALL_TECHNIQUES } from "./techniques/index.ts";
import { lintSummary } from "../evals/vendor/ste_lint.mjs";





export const SynthesisOutputSchema = Type.Object({
	bottom_line_assessment: Type.String(),
	convergent_judgments: Type.Array(
		Type.Object({
			judgment: Type.String(),
			supporting_techniques: Type.Array(Type.String()),
			confidence: StringEnum(["High", "Moderate", "Low"] as const),
		}),
	),
	divergent_signals: Type.Array(
		Type.Object({
			signal: Type.String(),
			techniques_in_favor: Type.Array(Type.String()),
			techniques_against: Type.Array(Type.String()),
			explanation: Type.String(),
		}),
	),
	highest_confidence_assessments: Type.Array(Type.String()),
	remaining_uncertainties: Type.Array(Type.String()),
	intelligence_gaps: Type.Array(Type.String()),
	recommended_next_steps: Type.Array(Type.String()),
});

export type SynthesisOutput = Static<typeof SynthesisOutputSchema>;





const SYNTHESIS_SYSTEM_PROMPT = `You are an expert intelligence analyst producing a Synthesis Report that integrates findings from multiple structured analytic techniques.

## Your Role

You have been provided the results of several structured analytic techniques applied to the same question. Your task is to integrate these findings into a coherent, actionable assessment. The synthesis should be MORE than a summary — it should identify patterns across techniques, highlight where techniques agree (convergent judgments) and where they conflict (divergent signals), and produce a clear bottom-line assessment.

## Method

1. **Review All Technique Results**: Carefully examine the output from each technique applied. Understand what each technique was designed to reveal and what it actually found.

2. **Extract Key Findings**: For each technique, identify the 1-3 most important findings.

3. **Identify Convergence**: Where do multiple techniques point to the same conclusion? Convergent judgments — findings reinforced by different analytical approaches — deserve higher confidence. A finding that 8 or more of the 12 techniques support qualifies as convergent.

4. **Identify Divergence**: Where do techniques produce conflicting signals? Don't resolve tensions prematurely; explain what the disagreement reveals about the problem.

5. **Assess Overall Confidence**: Which conclusions have the strongest support across techniques? Where does uncertainty persist?

6. **Identify Remaining Gaps**: After all this analysis, what critical questions remain unanswered?

7. **Produce the Bottom-Line Assessment**: Write a clear, concise answer to the original question that is:
   - Direct and unambiguous
   - Properly caveated (reflecting confidence levels)
   - Actionable for decision-makers
   - Informed by ALL the techniques applied

## Adversarial Analysis Integration

If adversarial critique/rebuttal data is provided, incorporate it:
- Weight convergent findings more heavily where both primary analyst and challenger agree
- Flag unresolved disagreements as genuine analytical uncertainties
- Note conclusions that were revised after accepted critique challenges

## Output Guidance

Produce a JSON object with exactly these fields:
- **bottom_line_assessment**: The clear, concise answer to the original question. Decision-makers may only read this — make it count.
- **convergent_judgments**: Array of judgments supported by multiple techniques. Each with "judgment", "supporting_techniques" (array of technique ids), and "confidence" ("High", "Moderate", or "Low").
- **divergent_signals**: Array of signals where techniques conflict. Each with "signal", "techniques_in_favor" (ids), "techniques_against" (ids), and "explanation".
- **highest_confidence_assessments**: Array of the most solid, well-supported conclusions.
- **remaining_uncertainties**: Array of key unknowns that persist despite the analysis.
- **intelligence_gaps**: Array of missing information that would most improve the analysis.
- **recommended_next_steps**: Array of actionable recommendations for decision-makers.`;





function formatTechniqueResultsForSynthesis(
	techniqueResults: Record<string, TechniqueResult>,
	adversarialExchanges: Record<string, AdversarialExchange>,
): string {
	const parts: string[] = [`Today's date is ${new Date().toISOString().slice(0, 10)}.\n`];

	parts.push("## Technique Results\n");
	for (const technique of ALL_TECHNIQUES) {
		const result = techniqueResults[technique.id];
		if (!result || result.status !== "success" || result.output == null) continue;

		parts.push(`### ${technique.name} (${technique.id})\n`);
		parts.push("```json");
		parts.push(JSON.stringify(result.output, null, 2));
		parts.push("```\n");

		const exchange = adversarialExchanges[technique.id];
		if (exchange) {
			parts.push(`**Adversarial critique severity:** ${exchange.critique.overall_severity}`);
			parts.push(
				`**Accepted challenges:** ${exchange.rebuttal.accepted_challenges.length}`,
			);
			if (exchange.rebuttal.revised_conclusions) {
				parts.push(`**Revised conclusions:** ${exchange.rebuttal.revised_conclusions}`);
			}
			if (exchange.adjudication) {
				parts.push(
					`**Adjudication delta:** ${exchange.adjudication.confidence_delta > 0 ? "+" : ""}${exchange.adjudication.confidence_delta}`,
				);
			}
			parts.push("");
		}
	}

	return parts.join("\n");
}





export interface SynthesisUpdateDetails {
	phase: "synthesis";
	status: "started" | "completed" | "failed";
	error?: string;
}

export async function synthesize(
	question: string,
	techniqueResults: Record<string, TechniqueResult>,
	adversarialExchanges: Record<string, AdversarialExchange>,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	onUpdate: ((details: SynthesisUpdateDetails) => void) | undefined,
	usage: UsageAccumulator,
): Promise<SynthesisOutput> {
	checkAborted(signal);
	onUpdate?.({ phase: "synthesis", status: "started" });

	const content = formatTechniqueResultsForSynthesis(techniqueResults, adversarialExchanges);
	const questionHeader = `## Analytic Question\n\n${question}\n\n`;

	const model = ctx.model!;
	const { data, usage: callUsage, durationMs } = await completeStructured<SynthesisOutput>(ctx, {
		model,
		systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
		messages: [
			{
				role: "user" as const,
				content: questionHeader + content,
				timestamp: Date.now(),
			},
		],
		schema: SynthesisOutputSchema,
		temperature: 0.3,
		signal,
		semanticCheck: (d) => lintSummary(d.bottom_line_assessment),
	});
	usage.add(callUsage, model.id, (model as any).name || model.id, "primary", "synthesis", durationMs);

	onUpdate?.({ phase: "synthesis", status: "completed" });
	return data;
}
