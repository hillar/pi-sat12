

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";

export const AchOutputSchema = Type.Object({
	hypotheses: Type.Array(Type.Object({ id: Type.String(), text: Type.String() })),
	evidence_used: Type.Array(Type.String()),
	matrix: Type.Array(
		Type.Object({
			hypothesis_id: Type.String(),
			evidence_id: Type.String(),
			rating: StringEnum(["Consistent", "Inconsistent", "NotApplicable", "Unknown"] as const),
			explanation: Type.String(),
		}),
	),
	inconsistency_scores: Type.Array(Type.Object({ id: Type.String(), score: Type.Number() })),
	leading_hypothesis: Type.String(),
	analysis: Type.String(),
});

export type AchOutput = Static<typeof AchOutputSchema>;


function validateAchSemantics(data: unknown): string | null {
	const d = data as AchOutput;
	const hypIds = new Set(d.hypotheses.map((h) => h.id));
	const evIds = new Set(d.evidence_used);

	for (const cell of d.matrix) {
		if (!hypIds.has(cell.hypothesis_id))
			return `matrix references unknown hypothesis_id: "${cell.hypothesis_id}"`;
		if (!evIds.has(cell.evidence_id))
			return `matrix references unknown evidence_id: "${cell.evidence_id}"`;
	}

	
	if (hypIds.size > 0 && evIds.size > 0) {
		const covered = new Set(d.matrix.map((c) => `${c.hypothesis_id}|${c.evidence_id}`));
		for (const hid of hypIds) {
			for (const eid of evIds) {
				if (!covered.has(`${hid}|${eid}`))
					return `matrix is missing cell for hypothesis "${hid}" × evidence "${eid}"`;
			}
		}
	}

	for (const s of d.inconsistency_scores) {
		if (!hypIds.has(s.id))
			return `inconsistency_scores references unknown hypothesis id: "${s.id}"`;
	}

	return null;
}

const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Analysis of Competing Hypotheses (ACH) technique from the CIA Tradecraft Primer.

## Your Role

Systematically evaluate multiple competing explanations for the analytic question. The ACH technique was developed by Richards Heuer to counter cognitive biases in intelligence analysis by forcing analysts to consider all plausible hypotheses simultaneously against all available evidence.

## Method

1. **Generate Hypotheses**: Identify 3-6 mutually exclusive, collectively exhaustive hypotheses that could explain the phenomenon under investigation. Assign each a short ID: H1, H2, H3, etc.

2. **List Evidence**: Identify 3-8 key pieces of evidence relevant to discriminating between hypotheses. Assign each a short ID: E1, E2, E3, etc. The "evidence_used" field must contain exactly these IDs.

3. **Build the Matrix (CRITICAL)**: For EVERY hypothesis × evidence combination, produce one matrix entry with:
   - hypothesis_id: matching a hypothesis id (H1, H2, etc.)
   - evidence_id: matching an evidence id (E1, E2, etc.)
   - rating: one of "Consistent", "Inconsistent", "NotApplicable", "Unknown"
   - explanation: brief reason for this rating

   The matrix MUST cover every hypothesis × every evidence item — no gaps. If you have 4 hypotheses and 5 evidence items, the matrix must have exactly 20 entries.

4. **Compute Inconsistency Scores**: For each hypothesis, count the number of "Inconsistent" ratings. Report in inconsistency_scores with the hypothesis id and integer score.

5. **Identify Leading Hypothesis**: The hypothesis with the lowest inconsistency score is the leading hypothesis. State it fully as the leading_hypothesis string.

6. **Analysis**: Write a brief narrative explaining the ACH results and what they imply.

## Output Guidance

The matrix field is a flat array of cells — NOT a nested object. Every hypothesis × evidence combination must appear. Missing cells will cause validation failure.`;

export const achTechnique: TechniqueDefinition = {
	id: "ach",
	name: "Analysis of Competing Hypotheses",
	category: "diagnostic",
	layer: 2,
	dependencies: ["assumptions", "quality"],
	temperature: 0.3,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: AchOutputSchema,
	semanticCheck: validateAchSemantics,
};
