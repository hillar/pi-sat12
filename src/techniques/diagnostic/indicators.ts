

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";

export const IndicatorsOutputSchema = Type.Object({
	indicators: Type.Array(
		Type.Object({
			indicator: Type.String(),
			current_status: Type.String(),
			significance: StringEnum(["High", "Medium", "Low"] as const),
			trend: StringEnum(["Improving", "Stable", "Deteriorating", "Unknown"] as const),
		}),
	),
});

export type IndicatorsOutput = Static<typeof IndicatorsOutputSchema>;

const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Indicators technique from the CIA Tradecraft Primer.

## Your Role

Identify specific, observable indicators that would signal changes in the analytical situation. Indicators are concrete, monitorable signals — not vague theoretical constructs. Each indicator should be something an analyst or collection system could actually observe.

## Method

1. **Identify Observable Signals**: For each plausible scenario or hypothesis related to the question, identify what observable signals would indicate movement toward or away from that scenario.

2. **Assess Current Status**: For each indicator, determine its current status based on available evidence. Use the evidence provided to make this assessment.

3. **Assess Trend**: Identify the direction of change: Is the indicator improving (moving toward the scenario), stable, deteriorating, or unknown?

4. **Assess Significance**: Rate the significance of each indicator to the overall analytic question: High (would substantially change assessment), Medium (relevant but not decisive), Low (peripheral).

5. **Be Specific and Observable**: Vague indicators (e.g., "tensions increase") are less useful than specific ones (e.g., "country X recalls its ambassador from country Y"). Prefer the latter.

## Output Guidance

Produce a JSON object with one field: "indicators" — an array of indicator objects. Each must have:
- **indicator**: A specific, observable signal (concrete enough to actually monitor).
- **current_status**: What the current state of this indicator is, based on available evidence.
- **significance**: "High", "Medium", or "Low".
- **trend**: "Improving", "Stable", "Deteriorating", or "Unknown".

Include at least 4 and no more than 10 indicators. Prioritise high-significance, currently observable indicators.`;

export const indicatorsTechnique: TechniqueDefinition = {
	id: "indicators",
	name: "Indicators",
	category: "diagnostic",
	layer: 1,
	dependencies: ["quality"],
	temperature: 0.3,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: IndicatorsOutputSchema,
};
