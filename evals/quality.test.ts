/**
 * Evidence-gate tests for the quality technique semantic check.
 *
 * These tests need `npm install`. quality.ts imports llm.ts, which imports
 * @earendil-works/pi-ai.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityTechnique } from "../src/techniques/diagnostic/quality.ts";
import type { SemanticCheckContext } from "../src/techniques/types.ts";

/** Length that the gate treats as long enough to hold real sources. */
const LONG = 50000;
/** Length of a research-failure notice. The gate must not require sources here. */
const SHORT = 700;

/** Build a valid quality output. Add sources only when the test needs them. */
function output(sources?: unknown[]) {
	return {
		reliability: "Medium",
		gaps: ["one gap"],
		assessment: "an assessment",
		recommendations: ["one recommendation"],
		...(sources ? { sources } : {}),
	};
}

/** One valid source entry. */
const oneSource = {
	source_id: "docs/a.md",
	admiralty_code: "B2",
	reliability: "B",
	credibility: "2",
	rationale: "a reason",
};

function check(data: unknown, context: SemanticCheckContext): string | null {
	return qualityTechnique.semanticCheck!(data, context);
}

test("short notice-only evidence does not require sources", () => {
	const result = check(output(), { hasEvidence: true, evidenceLength: SHORT });
	assert.equal(result, null, `expected pass, got: ${result}`);
});

test("long evidence with no sources fails", () => {
	const result = check(output(), { hasEvidence: true, evidenceLength: LONG });
	assert.notEqual(result, null, "expected a failure, got pass");
	assert.match(result as string, /'sources' array is missing or empty/);
});

test("long evidence with sources passes", () => {
	const result = check(output([oneSource]), { hasEvidence: true, evidenceLength: LONG });
	assert.equal(result, null, `expected pass, got: ${result}`);
});

test("no evidence does not require sources", () => {
	const result = check(output(), { hasEvidence: false, evidenceLength: 0 });
	assert.equal(result, null, `expected pass, got: ${result}`);
});

test("a context without evidenceLength keeps the strict rule", () => {
	// Back-compat. An older caller supplies hasEvidence only.
	const result = check(output(), { hasEvidence: true });
	assert.notEqual(result, null, "expected a failure, got pass");
	assert.match(result as string, /'sources' array is missing or empty/);
});

test("the Admiralty rules still run through the quality check", () => {
	// A duplicate source_id must fail here too, not only in admiralty.test.ts.
	const result = check(output([oneSource, oneSource]), {
		hasEvidence: true,
		evidenceLength: LONG,
	});
	assert.notEqual(result, null, "expected a failure, got pass");
	assert.match(result as string, /Duplicate source_id/);
});
