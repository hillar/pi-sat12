/**
 * Unit tests for session utilities (evals/session.test.ts).
 *
 * Covers session creation, formatting, and file persistence.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	createInitialSession,
	formatSessionStatus,
	saveSession,
	loadSession,
	findLatestSession,
	type SessionState,
} from "../src/session.ts";

test("createInitialSession creates valid session state with stable hash ID", () => {
	const q1 = "  Is the target ACTIVE?  ";
	const s1 = createInitialSession(q1, "evidence text");

	assert.equal(s1.status, "in_progress");
	assert.equal(s1.evidenceText, "evidence text");
	assert.ok(s1.id.length === 16);

	// Case and whitespace invariant hashing
	const s2 = createInitialSession("is the target active?");
	assert.equal(s1.id, s2.id);
});

test("formatSessionStatus includes status breakdown and next action for all statuses", () => {
	const baseSession: SessionState = {
		id: "1234567890abcdef",
		question: "Test question",
		status: "in_progress",
		techniqueResults: {
			quality: { status: "success", durationMs: 100 },
			ach: { status: "failed", error: "OOM" },
		},
		adversarialExchanges: {},
		createdAt: "2026-08-16T00:00:00.000Z",
		updatedAt: "2026-08-16T00:01:00.000Z",
	};

	const inProgressText = formatSessionStatus(baseSession);
	assert.ok(inProgressText.includes("`IN_PROGRESS`"));
	assert.ok(inProgressText.includes("1/12 (2 attempted)"));

	const pausedText = formatSessionStatus({ ...baseSession, status: "paused" });
	assert.ok(pausedText.includes("`/sat12_continue` to resume execution"));

	const cancelledText = formatSessionStatus({ ...baseSession, status: "cancelled" });
	assert.ok(cancelledText.includes("Session abandoned by user"));

	const completedText = formatSessionStatus({
		...baseSession,
		status: "completed",
		synthesis: {
			bottom_line_assessment: "Test assessment.",
			convergent_judgments: [],
			divergent_signals: [],
			highest_confidence_assessments: [],
			remaining_uncertainties: [],
			intelligence_gaps: [],
			recommended_next_steps: [],
		},
	});
	assert.ok(completedText.includes("Run `/sat12_report`"));
	assert.ok(completedText.includes("Synthesis Assessment:** Completed"));

	const failedText = formatSessionStatus({
		...baseSession,
		status: "failed",
		statusReason: "Timeout",
	});
	assert.ok(failedText.includes("Failed: Timeout"));
});

test("saveSession, loadSession, and findLatestSession operate correctly on disk", async () => {
	const tmpCwd = await mkdtemp(join(tmpdir(), "sat12-session-test-"));
	try {
		const session1 = createInitialSession("Question 1");
		session1.updatedAt = "2026-08-16T10:00:00.000Z";

		await saveSession(tmpCwd, session1);

		const loaded = await loadSession(tmpCwd, "Question 1");
		assert.ok(loaded);
		assert.equal(loaded?.id, session1.id);
		assert.equal(loaded?.question, session1.question);

		// Non-existent session returns null
		const missing = await loadSession(tmpCwd, "Unknown Question");
		assert.equal(missing, null);

		// Save a second session with a later timestamp
		const session2 = createInitialSession("Question 2");
		session2.updatedAt = "2026-08-16T12:00:00.000Z";
		await saveSession(tmpCwd, session2);

		const latest = await findLatestSession(tmpCwd);
		assert.ok(latest);
		assert.equal(latest?.id, session2.id);
		assert.equal(latest?.question, session2.question);
	} finally {
		await rm(tmpCwd, { recursive: true, force: true });
	}
});
