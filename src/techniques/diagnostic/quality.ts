

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition, SemanticCheckContext } from "../types.ts";
import { validateAdmiraltySemantics, type InfoCredibility, type SourceReliability } from "../../admiralty.ts";





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
				corroborated_by: Type.Optional(
					Type.Array(Type.String(), {
						description:
							"source_id values of OTHER sources in this list that independently report the same key information. Required to justify a credibility of '1'.",
					}),
				),
				user_overridden: Type.Optional(Type.Boolean({ description: "True only if the user explicitly supplied a rating for this source" })),
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

/**
 * Least evidence length that must hold real sources.
 * Short evidence is often only a research-failure notice. An empty source list is
 * a correct answer in that case, so do not fail it.
 */
const MIN_EVIDENCE_CHARS_FOR_SOURCES = 2000;

function checkQualitySemantics(data: unknown, context?: SemanticCheckContext): string | null {
	const d = data as QualityOutput;
	const hasSources = Array.isArray(d.sources) && d.sources.length > 0;

	// REQ-Q-3: A context with only hasEvidence keeps the strict rule.
	// REQ-Q-2: Short or missing evidence does not force a sources list.
	// REQ-Q-1: Long evidence must produce a non-empty sources list.
	// Require a source list only when the evidence is long enough to hold sources.
	const evidenceLength =
		context?.evidenceLength ?? (context?.hasEvidence ? MIN_EVIDENCE_CHARS_FOR_SOURCES : 0);
	if (evidenceLength >= MIN_EVIDENCE_CHARS_FOR_SOURCES && !hasSources) {
		return "The evidence contains identifiable sources but the 'sources' array is missing or empty. List every source that you can identify, each with an Admiralty rating.";
	}

	if (hasSources) {
		// REQ-Q-4: The quality check must run the Admiralty rules on the emitted sources.
		return validateAdmiraltySemantics(
			d.sources!.map((s) => ({
				source_id: s.source_id,
				admiralty_code: s.admiralty_code,
				reliability: s.reliability as SourceReliability | undefined,
				credibility: s.credibility as InfoCredibility,
				corroborated_by: s.corroborated_by,
				user_overridden: s.user_overridden,
			})),
			{ userOverrides: context?.userOverrides },
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

Produce a JSON object with these five fields:

- **reliability**: Your verdict on evidence quality. Use "High", "Medium", or "Low".
- **sources**: An array of source grades. List every source that you can identify in the evidence. For each source give these fields:
  - **source_id**: A stable id. Use the file path, URL, or [tag] from the evidence.
  - **reliability** (A–F) and **credibility** (1–6). Also give **admiralty_code**. The code must equal the reliability letter and the credibility number together. Example: reliability "B" and credibility "2" make "B2".
  - **rationale**: One line. State why you chose the grade.
  - **corroborated_by**: The source_id values of OTHER sources in this list that report the same key information on their own. Use credibility "1" (Confirmed) only when you list at least one such source here. A single source cannot be "1".
  - **user_overridden**: Set true only for a source that the user rated. Do not set it to avoid the corroboration rule.
- **gaps**: An array of strings. Each string states one critical gap that limits confidence. State what is missing. State why it matters.
- **assessment**: One narrative string. State which sources are reliable and why. State the corroboration of key claims. State any signs of deception or manipulation. State how the evidence quality changes analytic confidence.
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
