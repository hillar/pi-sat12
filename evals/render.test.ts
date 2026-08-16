/**
 * Unit tests for report renderer (evals/render.test.ts).
 *
 * Verifies that markdown files in an OKF directory render to HTML safely.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderReport } from "../src/report/render.ts";

test("renderReport transforms markdown files into HTML and writes report.html", async () => {
	const tmpOkf = await mkdtemp(join(tmpdir(), "sat12-render-test-"));
	try {
		await writeFile(join(tmpOkf, "index.md"), "# Main Index\n\n**Question:** Test Q?", "utf8");
		await mkdir(join(tmpOkf, "synthesis"), { recursive: true });
		await writeFile(
			join(tmpOkf, "synthesis", "index.md"),
			"# Bottom Line\n\nSystem status is **nominal** & safe.",
			"utf8",
		);

		const reportPath = await renderReport(tmpOkf);
		assert.equal(reportPath, join(tmpOkf, "report.html"));

		const html = await readFile(reportPath, "utf8");
		assert.ok(html.includes("<!DOCTYPE html>"));
		assert.ok(html.includes("<h1>Main Index</h1>"));
		assert.ok(html.includes("<strong>nominal</strong> & safe."));
		assert.ok(html.includes("SAT-12 Executive Analysis Report"));
	} finally {
		await rm(tmpOkf, { recursive: true, force: true });
	}
});

test("renderReport tolerates missing optional markdown files", async () => {
	const tmpEmpty = await mkdtemp(join(tmpdir(), "sat12-render-empty-"));
	try {
		const reportPath = await renderReport(tmpEmpty);
		const html = await readFile(reportPath, "utf8");
		assert.ok(html.includes("<!DOCTYPE html>"));
	} finally {
		await rm(tmpEmpty, { recursive: true, force: true });
	}
});
