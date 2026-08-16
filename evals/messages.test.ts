/**
 * Unit tests for message utilities (evals/messages.test.ts).
 *
 * Covers buildTechniqueUserMessage and formatTechniqueOutput.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTechniqueUserMessage, formatTechniqueOutput } from "../src/messages.ts";

test("buildTechniqueUserMessage formats context, evidence, directive, and dependencies", () => {
	const question = "What is the status of project X?";
	const evidence = "Source A says on track.";
	const depContexts = [
		{
			techniqueId: "quality",
			techniqueName: "Quality Check",
			outputText: '{"reliability": "High"}',
		},
	];

	const msg = buildTechniqueUserMessage(question, evidence, depContexts);

	assert.equal(msg.role, "user");
	assert.ok(msg.content.includes("## Analytic Question"));
	assert.ok(msg.content.includes(question));
	assert.ok(msg.content.includes("## Evidence / Context"));
	assert.ok(msg.content.includes(evidence));
	assert.ok(msg.content.includes("Evidence Reliability Directive (Admiralty Evaluation)"));
	assert.ok(msg.content.includes("## Prior Finding: Quality Check (quality)"));
	assert.ok(msg.content.includes('{"reliability": "High"}'));
});

test("buildTechniqueUserMessage omits evidence section when evidence is empty", () => {
	const question = "Simple query";
	const msg = buildTechniqueUserMessage(question, "", []);

	assert.ok(!msg.content.includes("## Evidence / Context"));
	assert.ok(!msg.content.includes("Evidence Reliability Directive"));
});

test("formatTechniqueOutput handles strings and JSON objects", () => {
	assert.equal(formatTechniqueOutput("already string"), "already string");
	const obj = { key: "value" };
	assert.equal(formatTechniqueOutput(obj), JSON.stringify(obj, null, 2));
});
