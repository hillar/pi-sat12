/**
 * Unit tests for the JS port of the STE linter (evals/vendor/ste_lint.mjs).
 *
 * Verifies that the JS linter enforces the same STE rules as the original Python script.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { lint, lintSummary, SLOP_FIXTURE, CLEAN_FIXTURE } from "./vendor/ste_lint.mjs";

test("ste_lint flags all mechanical violations in the slop fixture", () => {
	const slop = lint(SLOP_FIXTURE, "procedural");
	assert.ok(slop.violations.sentence_over_limit >= 1, "expected sentence_over_limit");
	assert.ok(slop.violations.banned_modal >= 1, "expected banned_modal");
	assert.ok(slop.violations.contraction >= 1, "expected contraction");
	assert.ok(slop.violations.perfect_tense >= 1, "expected perfect_tense");
	assert.ok(slop.violations.ing_clause >= 1, "expected ing_clause");
	assert.equal(slop.violations.semicolon, 1, "expected semicolon === 1");
	assert.ok(slop.violations.latin_abbrev >= 1, "expected latin_abbrev");
	assert.ok(slop.violations.slop_word >= 2, "expected slop_word");
	assert.ok(slop.violations.trailing_condition >= 1, "expected trailing_condition");
	assert.ok(slop.violations.synonym_rotation >= 1, "expected synonym_rotation");
	assert.ok(slop.violations_total > 0, "slop total should be positive");
});

test("ste_lint finds zero violations in clean STE text", () => {
	const clean = lint(CLEAN_FIXTURE, "procedural");
	assert.equal(clean.violations_total, 0, "clean text should have 0 violations");
});

test("ste_lint strips code spans and blocks before counting", () => {
	const textWithCode = "Check `https://example.com` and ```javascript\nconst x = should;\n``` before continuing.";
	const result = lint(textWithCode, "descriptive");
	// Code blocks/spans/urls are stripped, so banned modal inside code block is ignored
	assert.equal(result.violations.banned_modal, 0, "banned modal inside code block should be ignored");
});

test("lintSummary allows modals and perfect tense for analytic hedging", () => {
	// Text with modals ("may", "could") and perfect tense ("has been") but clean otherwise
	const hedgedSummary = "The operator may migrate the system next year. Two independent teams could confirm the parameter choices. The security team has been notified.";
	const err = lintSummary(hedgedSummary, 1);
	assert.equal(err, null, `hedged summary should pass, got: ${err}`);
});

test("lintSummary rejects summaries exceeding the blocking violation budget", () => {
	// 2 blocking violations: semicolon (1) + slop word 'robust' (1) = 2 total blocking > budget 1
	const badSummary = "The migration plan is robust; it sets a cutover date.";
	const err = lintSummary(badSummary, 1);
	assert.notEqual(err, null, "expected rejection for 2 blocking violations");
	assert.match(err as string, /bottom_line_assessment has 2 STE style violation/);
});
