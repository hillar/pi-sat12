/**
 * Unit tests for TypeBox output schemas (evals/schema.test.ts).
 *
 * Verifies schema validation behavior for Synthesis and Quality outputs.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Value } from "typebox/value";
import { SynthesisOutputSchema } from "../src/synthesis.ts";
import { QualityOutputSchema } from "../src/techniques/diagnostic/quality.ts";

test("SynthesisOutputSchema validates valid outputs and rejects missing required fields", () => {
	const validSynthesis = {
		bottom_line_assessment: "Clear finding.",
		convergent_judgments: [
			{
				judgment: "Convergence A",
				supporting_techniques: ["quality"],
				confidence: "High",
			},
		],
		divergent_signals: [],
		highest_confidence_assessments: ["Solid finding"],
		remaining_uncertainties: ["Unknown X"],
		intelligence_gaps: ["Gap Y"],
		recommended_next_steps: ["Step Z"],
	};

	assert.equal(Value.Check(SynthesisOutputSchema, validSynthesis), true);

	const invalidSynthesis = { ...validSynthesis, convergent_judgments: undefined };
	assert.equal(Value.Check(SynthesisOutputSchema, invalidSynthesis), false);
});

test("QualityOutputSchema validates valid outputs and enforces structure", () => {
	const validQuality = {
		reliability: "High",
		gaps: ["Gap 1"],
		assessment: "Quality assessment",
		recommendations: ["Rec 1"],
		sources: [
			{
				source_id: "a.md",
				admiralty_code: "B2",
				reliability: "B",
				credibility: "2",
				rationale: "Reason.",
			},
		],
	};

	assert.equal(Value.Check(QualityOutputSchema, validQuality), true);

	// Invalid enum value for reliability
	const invalidQuality = { ...validQuality, reliability: "SuperHigh" };
	assert.equal(Value.Check(QualityOutputSchema, invalidQuality), false);
});
