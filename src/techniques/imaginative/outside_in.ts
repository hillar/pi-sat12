

import { Type, type Static } from "typebox";
import { StringEnum } from "../../llm.ts";
import type { TechniqueDefinition } from "../types.ts";

export const OutsideInOutputSchema = Type.Object({
	reference_classes: Type.Array(
		Type.Object({
			class: Type.String(),
			base_rate: Type.String(),
			applicability: StringEnum(["High", "Medium", "Low"] as const),
			adjustment: Type.String(),
		}),
	),
	forecast: Type.String(),
});

export type OutsideInOutput = Static<typeof OutsideInOutputSchema>;

const SYSTEM_PROMPT = `You are an expert intelligence analyst applying the Outside-In Thinking technique from the CIA Tradecraft Primer.

## Your Role

Apply reference class forecasting to the analytic question. Outside-In thinking deliberately counters the "inside view" bias — the tendency to focus on the unique features of the current situation and ignore base rates from comparable cases. By identifying how similar situations have resolved historically, you provide a statistical anchor for the analysis.

## Method

1. **Identify Reference Classes**: Identify 2-4 reference classes — sets of comparable historical cases — that are relevant to the analytic question. A reference class should be a category of situations sharing key structural features with the current case.

2. **Estimate Base Rate**: For each reference class, estimate the base rate of relevant outcomes. How have comparable situations typically resolved? What percentage resulted in outcome X versus outcome Y?

3. **Assess Applicability**: Rate how applicable this reference class is to the current situation:
   - High: strong structural similarities
   - Medium: moderate similarities with important differences
   - Low: weak similarities, used only as a rough anchor

4. **Adjust for Specific Features**: Identify features of the current case that differ from the reference class average. Explain how these features should adjust the base rate forecast upward or downward.

5. **Synthesise a Forecast**: Combine the reference class base rates with the case-specific adjustments to produce an overall forecast: what does the outside view suggest is the most likely outcome?

## Output Guidance

Produce a JSON object with:
- **reference_classes**: Array of 2-4 reference class objects, each with:
  - **class**: Name and description of the reference class.
  - **base_rate**: The historical base rate for the relevant outcome.
  - **applicability**: "High", "Medium", or "Low".
  - **adjustment**: How the current case differs and how that adjusts the forecast.
- **forecast**: The overall outside-view forecast synthesising all reference classes and adjustments.`;

export const outsideInTechnique: TechniqueDefinition = {
	id: "outside_in",
	name: "Outside-In Thinking",
	category: "imaginative",
	layer: 4,
	dependencies: ["assumptions", "ach"],
	temperature: 0.9,
	systemPrompt: SYSTEM_PROMPT,
	outputSchema: OutsideInOutputSchema,
};
