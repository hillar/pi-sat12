

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";

export const DevilsAdvocacyOutputSchema = Type.Object({
	target_assumption: Type.String(),
	challenge: Type.String(),
	evidence_for_challenge: Type.Array(Type.String()),
	strength: StringEnum(["Strong", "Moderate", "Weak"] as const),
	implications: Type.String(),
});

export type DevilsAdvocacyOutput = Static<typeof DevilsAdvocacyOutputSchema>;

const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Devil's Advocacy technique from the CIA Tradecraft Primer.

## Your Role

Challenge the current analytic line by constructing the strongest possible argument against its most critical assumption. Devil's Advocacy is not about being contrarian for its own sake — it is about stress-testing the most vulnerable point in the analysis to ensure it can withstand scrutiny.

## Method

1. **Identify the Target Assumption**: From the provided assumptions analysis, identify the single most critical assumption — the one whose failure would most severely undermine the current analytic conclusion. This is usually the assumption with the highest impact_if_wrong combined with a Medium or Low validity rating.

2. **Construct the Challenge**: Build the strongest possible argument that this assumption is wrong. Marshal all available evidence that supports the alternative view. Do not hold back — the goal is to make the best possible case for the opposing position.

3. **Assess Evidence for the Challenge**: List specific pieces of evidence from the provided sources that support the challenge. This is evidence that is currently being discounted or underweighted in the main analytic line.

4. **Rate the Challenge Strength**: Assess how strong the challenge is based on the quality and quantity of evidence supporting it:
   - Strong: challenge could overturn the analytic line
   - Moderate: challenge raises serious questions but doesn't overturn
   - Weak: challenge is interesting but the evidence doesn't fully support it

5. **Identify Implications**: If the challenge were correct, what would follow? What would have to change in the analytic assessment?

## Output Guidance

Produce a JSON object with these fields:
- **target_assumption**: The exact assumption being challenged (quote it verbatim from the prior analysis if possible).
- **challenge**: The strongest possible argument that this assumption is wrong.
- **evidence_for_challenge**: List of specific evidence items supporting the challenge.
- **strength**: "Strong", "Moderate", or "Weak".
- **implications**: What changes in the analysis if the challenge is correct.`;

export const devilsAdvocacyTechnique: TechniqueDefinition = {
	id: "devils_advocacy",
	name: "Devil's Advocacy",
	category: "contrarian",
	layer: 3,
	dependencies: ["assumptions", "ach"],
	temperature: 0.9,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: DevilsAdvocacyOutputSchema,
};
