/**
 * Unit tests for LLM utilities (evals/llm-util.test.ts).
 *
 * Covers UsageAccumulator, mergeUsage, isAbortError, and checkAborted.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	UsageAccumulator,
	mergeUsage,
	isAbortError,
	checkAborted,
} from "../src/llm.ts";

test("UsageAccumulator merges totals and tracks stats by model and phase", () => {
	const acc = new UsageAccumulator();
	const u1 = {
		input: 100,
		output: 50,
		cacheRead: 10,
		cacheWrite: 5,
		totalTokens: 150,
		cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
	};

	acc.add(u1, "m1", "Model 1", "primary", "phase1", 200);

	assert.equal(acc.total.input, 100);
	assert.equal(acc.total.output, 50);
	assert.equal(acc.total.totalTokens, 150);

	assert.ok(acc.byModel["m1"]);
	assert.equal(acc.byModel["m1"].inputTokens, 100);
	assert.equal(acc.byModel["m1"].outputTokens, 50);
	assert.equal(acc.byModel["m1"].calls, 1);
	assert.equal(acc.byModel["m1"].durationMs, 200);

	assert.ok(acc.byPhase["phase1"]);
	assert.equal(acc.byPhase["phase1"].input, 100);
});

test("UsageAccumulator falls back to input + output if totalTokens is missing", () => {
	const acc = new UsageAccumulator();
	const uNoTotal = {
		input: 200,
		output: 100,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};

	acc.add(uNoTotal, "m2", "Model 2", "challenger", "phase2", 300);

	assert.equal(acc.byModel["m2"].totalTokens, 300);
});

test("UsageAccumulator safely handles undefined usage", () => {
	const acc = new UsageAccumulator();
	acc.add(undefined);
	assert.equal(acc.total.input, 0);
	assert.equal(acc.total.totalTokens, 0);
});

test("mergeUsage correctly sums token and cost counts", () => {
	const a = {
		input: 10,
		output: 20,
		cacheRead: 1,
		cacheWrite: 2,
		totalTokens: 30,
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
	};
	const b = {
		input: 5,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 10,
		cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 1 },
	};

	const merged = mergeUsage(a, b);
	assert.equal(merged.input, 15);
	assert.equal(merged.output, 25);
	assert.equal(merged.totalTokens, 40);
	assert.equal(merged.cost.total, 4);
});

test("isAbortError detects abort errors reliably", () => {
	assert.equal(isAbortError(null), false);
	assert.equal(isAbortError(new Error("regular error")), false);
	assert.equal(isAbortError(new DOMException("aborted", "AbortError")), true);
	assert.equal(isAbortError(new Error("Analysis aborted by user")), true);
	assert.equal(isAbortError({ message: "something was aborted" }), false);
});

test("checkAborted throws DOMException when signal is aborted", () => {
	const controller = new AbortController();
	assert.doesNotThrow(() => checkAborted(controller.signal));

	controller.abort();
	assert.throws(
		() => checkAborted(controller.signal),
		(err: unknown) => err instanceof DOMException && err.name === "AbortError",
	);
});
