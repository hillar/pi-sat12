/**
 * Integration tests for writeOKF and updateWorkspaceIndex (evals/okf.test.ts).
 *
 * Verifies that the full OKF bundle structure is created and index updated.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeOKF, updateWorkspaceIndex } from "../src/okf.ts";
import type { SynthesisOutput } from "../src/synthesis.ts";

const mockSynthesis: SynthesisOutput = {
	bottom_line_assessment: "The target system is fully operational.",
	convergent_judgments: [
		{
			judgment: "System is online.",
			supporting_techniques: ["quality", "ach"],
			confidence: "High",
		},
	],
	divergent_signals: [],
	highest_confidence_assessments: ["Operational readiness is 100%."],
	remaining_uncertainties: ["Future load limits."],
	intelligence_gaps: ["No long-term test data."],
	recommended_next_steps: ["Monitor memory usage."],
};

test("writeOKF creates complete bundle and updates workspace index", async () => {
	const tmpCwd = await mkdtemp(join(tmpdir(), "sat12-okf-test-"));
	try {
		const question = "Is the system ready for production deployment?";
		const techniqueResults = {
			quality: {
				status: "success" as const,
				durationMs: 150,
				output: {
					reliability: "High",
					gaps: ["No long-term test data."],
					assessment: "The source data is valid.",
					recommendations: [],
					sources: [
						{
							source_id: "docs/spec.md",
							admiralty_code: "A1",
							reliability: "A",
							credibility: "1",
							rationale: "Official specification.",
						},
					],
				},
			},
			ach: {
				status: "success" as const,
				durationMs: 200,
				output: {
					hypotheses: [{ id: "H1", text: "System is ready" }],
					inconsistency_scores: [{ id: "H1", score: 0 }],
					leading_hypothesis: "H1: System is ready",
					analysis: "Zero inconsistencies found.",
					matrix: [],
				},
			},
		};

		const outputDir = await writeOKF(
			question,
			techniqueResults,
			{},
			mockSynthesis,
			tmpCwd,
			"## [source-1] Spec Doc\n- URL: https://example.com/spec",
		);

		assert.ok(outputDir.startsWith(tmpCwd));

		// Root index check
		const rootIndex = await readFile(join(outputDir, "index.md"), "utf8");
		assert.ok(rootIndex.includes("SAT-12 Analysis"));
		assert.ok(rootIndex.includes(mockSynthesis.bottom_line_assessment));

		// Log page check
		const logMd = await readFile(join(outputDir, "log.md"), "utf8");
		assert.ok(logMd.includes("Execution Timings"));
		assert.ok(logMd.includes("https://example.com/spec"));

		// Hypotheses check
		const hypFiles = await readdir(join(outputDir, "hypotheses"));
		assert.ok(hypFiles.some((f) => f.includes("h1") || f.includes("system-is-ready")));

		// Evidence check
		const sourcesMd = await readFile(join(outputDir, "evidence", "sources.md"), "utf8");
		assert.ok(sourcesMd.includes("Source Reliability Evaluation (Admiralty)"));
		assert.ok(sourcesMd.includes("docs/spec.md"));

		// Workspace index update
		const workspaceIndex = await readFile(join(tmpCwd, "index.md"), "utf8");
		assert.ok(workspaceIndex.includes("SAT-12 Intelligence Analysis Repository"));
		assert.ok(workspaceIndex.includes(question));
	} finally {
		await rm(tmpCwd, { recursive: true, force: true });
	}
});

test("updateWorkspaceIndex handles empty directories gracefully", async () => {
	const tmpCwd = await mkdtemp(join(tmpdir(), "sat12-okf-empty-test-"));
	try {
		const indexPath = await updateWorkspaceIndex(tmpCwd);
		assert.equal(indexPath, join(tmpCwd, "index.md"));
	} finally {
		await rm(tmpCwd, { recursive: true, force: true });
	}
});
