/**
 * Rule tests for validateAdmiraltySemantics.
 *
 * These tests need no npm install. admiralty.ts imports only node:fs/promises
 * and node:path.
 *
 * Run: node --test evals/
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	validateAdmiraltySemantics,
	type AdmiraltySourceEntry,
} from "../src/admiralty.ts";

/** Build one source entry. Fill the required fields with valid defaults. */
function source(over: Partial<AdmiraltySourceEntry> = {}): AdmiraltySourceEntry {
	return {
		source_id: "a.md",
		admiralty_code: "B2",
		reliability: "B",
		credibility: "2",
		...over,
	};
}

/** Assert that the validator accepts the sources. */
function assertPass(sources: AdmiraltySourceEntry[], opts?: { userOverrides?: Record<string, string> }) {
	const result = validateAdmiraltySemantics(sources, opts);
	assert.equal(result, null, `expected pass, got: ${result}`);
}

/** Assert that the validator rejects the sources. Match part of the message. */
function assertFail(
	sources: AdmiraltySourceEntry[],
	expected: RegExp,
	opts?: { userOverrides?: Record<string, string> },
) {
	const result = validateAdmiraltySemantics(sources, opts);
	assert.notEqual(result, null, "expected a failure, got pass");
	assert.match(result as string, expected);
}

// ---------------------------------------------------------------------------
// Rule 5 downgrade. An unverified user_overridden flag must not fail.
// The model cannot see the user ratings for web sources.
// ---------------------------------------------------------------------------

test("unverified user_overridden at credibility 3 passes", () => {
	assertPass([source({ admiralty_code: "B3", credibility: "3", user_overridden: true })], {});
});

// ---------------------------------------------------------------------------
// Rule 4 anti-bypass. A false flag must still not reach credibility "1".
// This is the protection that lets Rule 5 be non-fatal.
// ---------------------------------------------------------------------------

test("unverified user_overridden cannot claim credibility 1", () => {
	assertFail(
		[source({ admiralty_code: "B1", credibility: "1", user_overridden: true })],
		/credibility "1"/,
		{},
	);
});

// ---------------------------------------------------------------------------
// Rule 6. A real override must match the emitted code.
// ---------------------------------------------------------------------------

test("real override with a mismatched code fails", () => {
	assertFail(
		[source({ admiralty_code: "C4", reliability: "C", credibility: "4", user_overridden: true })],
		/user_overridden to "A1"/,
		{ userOverrides: { "a.md": "A1" } },
	);
});

test("real override with a matching code allows credibility 1", () => {
	assertPass(
		[source({ admiralty_code: "A1", reliability: "A", credibility: "1", user_overridden: true })],
		{ userOverrides: { "a.md": "A1" } },
	);
});

test("a directory-prefix override covers a file below it", () => {
	assertPass(
		[
			source({
				source_id: "docs/a.md",
				admiralty_code: "A1",
				reliability: "A",
				credibility: "1",
				user_overridden: true,
			}),
		],
		{ userOverrides: { docs: "A1" } },
	);
});

// ---------------------------------------------------------------------------
// Rule 4. Real corroboration allows credibility "1".
// ---------------------------------------------------------------------------

test("credibility 1 passes with a corroborating source", () => {
	assertPass([
		source({ admiralty_code: "B1", credibility: "1", corroborated_by: ["b.md"] }),
		source({ source_id: "b.md" }),
	]);
});

// ---------------------------------------------------------------------------
// Rule 1. admiralty_code must equal reliability plus credibility.
// ---------------------------------------------------------------------------

test("admiralty_code that disagrees with the fields fails", () => {
	assertFail([source({ admiralty_code: "B2", reliability: "C", credibility: "2" })], /imply "C2"/);
});

// ---------------------------------------------------------------------------
// Rule 3. corroborated_by must name a source in the list. No self-reference.
// ---------------------------------------------------------------------------

test("corroborated_by an unknown id fails", () => {
	assertFail(
		[source({ admiralty_code: "B1", credibility: "1", corroborated_by: ["ghost.md"] })],
		/not present in the sources list/,
	);
});

test("corroborated_by itself fails", () => {
	assertFail(
		[source({ admiralty_code: "B1", credibility: "1", corroborated_by: ["a.md"] })],
		/cannot corroborate itself/,
	);
});

// ---------------------------------------------------------------------------
// Rule 2. Each source_id must appear once.
// ---------------------------------------------------------------------------

test("a duplicate source_id fails", () => {
	assertFail(
		[source(), source({ admiralty_code: "B3", credibility: "3" })],
		/Duplicate source_id/,
	);
});
