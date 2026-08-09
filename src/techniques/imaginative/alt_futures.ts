

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";

export const AltFuturesOutputSchema = Type.Object({
	futures: Type.Array(
		Type.Object({
			title: Type.String(),
			narrative: Type.String(),
			probability: StringEnum(["High", "Medium", "Low"] as const),
			key_drivers: Type.Array(Type.String()),
			indicators: Type.Array(Type.String()),
		}),
	),
	dominant_future: Type.String(),
});

export type AltFuturesOutput = Static<typeof AltFuturesOutputSchema>;

const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Alternative Futures technique from the CIA Tradecraft Primer.

## Your Role

Generate a set of plausible future scenarios that span the realistic outcome space for the analytic question. Alternative Futures analysis deliberately avoids single-point forecasting by requiring analysts to construct multiple distinct, internally coherent scenarios — including some that challenge the leading hypothesis.

## Method

1. **Generate Distinct Futures**: Produce 3-5 distinct future scenarios. Each scenario should represent a different combination of key driver variables. Scenarios must be:
   - Internally coherent: no contradictions within the scenario
   - Mutually distinguishable: each represents genuinely different outcome space
   - Evidence-grounded: derivable from the current evidence base

2. **Anchor in Evidence**: Each scenario must be derivable from the current evidence base — not purely speculative.

3. **Assess Probability**: Rate the current probability of each scenario: High (most likely), Medium (plausible), Low (unlikely but possible). Probabilities reflect individual plausibility, not a distribution.

4. **Identify Key Drivers**: For each scenario, identify the 2-3 key driver variables that most strongly determine whether this scenario materialises.

5. **Identify Indicators**: For each scenario, list 2-3 specific observable indicators that would signal movement toward this scenario.

6. **Identify the Dominant Future**: After considering all scenarios, identify which single future you consider most likely and briefly explain why.

## Output Guidance

Produce a JSON object with:
- **futures**: Array of 3-5 future scenario objects, each with:
  - **title**: Short descriptive title for this scenario (4-8 words).
  - **narrative**: 2-4 sentence description of how this future unfolds.
  - **probability**: "High", "Medium", or "Low".
  - **key_drivers**: List of 2-3 key driver variables.
  - **indicators**: List of 2-3 observable indicators signalling this scenario.
- **dominant_future**: Which scenario is most likely and why.`;

export const altFuturesTechnique: TechniqueDefinition = {
	id: "alt_futures",
	name: "Alternative Futures",
	category: "imaginative",
	layer: 5,
	dependencies: ["assumptions", "ach", "outside_in"],
	temperature: 0.9,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: AltFuturesOutputSchema,
};
