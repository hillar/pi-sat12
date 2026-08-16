/**
 * Unit tests for config utilities (evals/config.test.ts).
 *
 * Verifies setSat12Setting key normalization, bool/enum parsing, and file persistence.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setSat12Setting, loadSat12Config } from "../src/config.ts";

test("setSat12Setting normalizes keys, parses values, and persists to user config dir", async () => {
	const tmpHome = await mkdtemp(join(tmpdir(), "sat12-config-home-"));
	const originalHome = process.env.HOME;
	process.env.HOME = tmpHome;

	try {
		// Model setting key aliases
		const r1 = await setSat12Setting("primary", "gpt-4o");
		assert.equal(r1.normalizedKey, "primary_model");
		assert.equal(r1.normalizedValue, "gpt-4o");

		const r2 = await setSat12Setting("challenger_model", "claude-3-5-sonnet");
		assert.equal(r2.normalizedKey, "challenger_model");
		assert.equal(r2.normalizedValue, "claude-3-5-sonnet");

		// Boolean flags parsing ("true" / "on")
		const r3 = await setSat12Setting("adversarial_enabled", "on");
		assert.equal(r3.normalizedKey, "adversarial_enabled");
		assert.equal(r3.normalizedValue, true);

		const r4 = await setSat12Setting("research_enabled", "false");
		assert.equal(r4.normalizedKey, "research_enabled");
		assert.equal(r4.normalizedValue, false);

		// Enum mode parsing
		const r5 = await setSat12Setting("adversarial_mode", "trident");
		assert.equal(r5.normalizedKey, "adversarial_mode");
		assert.equal(r5.normalizedValue, "trident");

		// Unknown setting throws error
		await assert.rejects(
			async () => await setSat12Setting("unknown_key", "val"),
			/Unknown setting key 'unknown_key'/,
		);

		// Verify round-trip loadSat12Config reflects all saved values
		const loaded = await loadSat12Config();
		assert.equal(loaded.primary_model, "gpt-4o");
		assert.equal(loaded.challenger_model, "claude-3-5-sonnet");
		assert.equal(loaded.adversarial_enabled, true);
		assert.equal(loaded.research_enabled, false);
		assert.equal(loaded.adversarial_mode, "trident");
	} finally {
		process.env.HOME = originalHome;
		await rm(tmpHome, { recursive: true, force: true });
	}
});
