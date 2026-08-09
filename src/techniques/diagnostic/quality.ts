

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";
import { validateAdmiraltySemantics, type InfoCredibility } from "../../admiralty.ts";





export const QualityOutputSchema = Type.Object({
	reliability: StringEnum(["High", "Medium", "Low"] as const, {
		description: "Overall reliability of the available evidence.",
	}),
	sources: Type.Optional(
		Type.Array(
			Type.Object({
				source_id: Type.String({ description: "Source document or file identifier" }),
				admiralty_code: Type.String({ description: "Admiralty evaluation code (e.g. 'A1', 'B2', 'C3')" }),
				reliability: StringEnum(["A", "B", "C", "D", "E", "F"] as const),
				credibility: StringEnum(["1", "2", "3", "4", "5", "6"] as const),
				rationale: Type.String({ description: "Brief justification for this Admiralty grade" }),
				user_overridden: Type.Optional(Type.Boolean({ description: "True if overridden by user" })),
			}),
		),
	),
	gaps: Type.Array(Type.String(), {
		description: "Critical information gaps that limit confidence in the analysis.",
	}),
	assessment: Type.String({
		description:
			"Narrative assessment of evidence quality — provenance, corroboration, deception indicators, and how quality affects analytic confidence.",
	}),
	recommendations: Type.Array(Type.String(), {
		description:
			"Specific collection or research recommendations that would most reduce uncertainty.",
	}),
});

export type QualityOutput = Static<typeof QualityOutputSchema>;

function checkQualitySemantics(data: unknown): string | null {
	const d = data as QualityOutput;
	if (d.sources && Array.isArray(d.sources)) {
		return validateAdmiraltySemantics(
			d.sources.map((s) => ({
				source_id: s.source_id,
				credibility: s.credibility as InfoCredibility,
				user_overridden: s.user_overridden,
			})),
		);
	}
	return null;
}







const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Quality of Information Check technique from the CIA Tradecraft Primer.

## Your Role

Your task is to systematically evaluate the accuracy, completeness, and reliability of all information sources related to the analytic question. This is not about whether you agree with the information, but about its quality: provenance, corroboration, potential for deception, and gaps that could undermine analytic confidence.

## Method

Follow these steps from the Tradecraft Primer:

1. **Systematic Review**: Examine ALL sources for accuracy and reliability. Consider the provenance, track record, and potential biases of each source.

2. **Identify Critical Sources**: Determine which sources are most critical to the current analytic line. Which pieces of information, if wrong, would fundamentally change the assessment?

3. **Check Corroboration**: Assess whether critical reporting is sufficiently corroborated by independent sources. Single-source reporting on key judgments is a vulnerability.

4. **Reexamine Dismissed Information**: Review information that was previously set aside or discounted. Does it deserve reconsideration in light of new context?

5. **Caveat Ambiguity**: Identify information that is ambiguous or subject to multiple interpretations. Has it been properly caveated in the analysis?

6. **Assess Deception and Denial**: Consider the possibility that sources have been manipulated, that adversaries are conducting denial and deception operations, or that sources have incentives to mislead.

7. **Identify Gaps**: What critical information is missing? What collection requirements would most reduce uncertainty?

## Key Questions to Address

- Which sources are most reliable? Least reliable? Why?
- Is there sufficient corroboration for critical judgments?
- What information has been dismissed or downplayed? Should it be reconsidered?
- Are there signs of deception, denial, or source manipulation?
- What are the most significant intelligence gaps?
- How would better information change the assessment?

## Output Guidance

Produce a JSON object with exactly these four fields:

- **reliability**: Your overall verdict on evidence quality — "High", "Medium", or "Low".
- **gaps**: Array of strings, each describing a critical information gap that limits confidence. Be specific about what is missing and why it matters.
- **assessment**: A single narrative string covering: which sources are reliable and why, corroboration status of key claims, any signs of deception or manipulation, and how the overall evidence quality affects analytic confidence.
- **recommendations**: Array of strings, each a concrete recommendation for what additional evidence or collection would most reduce uncertainty.

Be thorough but concise. Focus on quality issues that genuinely affect analytic confidence.`;





export const qualityTechnique: TechniqueDefinition = {
	id: "quality",
	name: "Quality of Information Check",
	category: "diagnostic",
	layer: 0,
	dependencies: [],
	temperature: 0.3,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: QualityOutputSchema,
	semanticCheck: checkQualitySemantics,
};
