/**
 * Unit tests for local directory evidence and prior workspace intelligence.
 *
 * Covers extractCodeOutline, listLocalFiles, gatherLocalDirectoryEvidence,
 * loadPriorWorkspaceIntelligence, and attachResearchNotice.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	extractCodeOutline,
	listLocalFiles,
	gatherLocalDirectoryEvidence,
} from "../src/local_evidence.ts";
import {
	loadPriorWorkspaceIntelligence,
	attachResearchNotice,
} from "../src/research.ts";

test("extractCodeOutline extracts TypeScript headers, imports, exports, and comments", () => {
	const tsCode = `
import { readFile } from "node:fs/promises";
import type { Config } from "./config.ts";

// Top-level line comment
/* Block comment start
   Block comment end */

export interface User {
	id: string;
	name: string;
}

export class UserService {
	async getUser(id: string): Promise<User> {
		return { id, name: "Alice" };
	}
}

export async function processUser(u: User): Promise<void> {
	console.log(u);
}
`;

	const outline = extractCodeOutline(tsCode, ".ts");

	assert.ok(outline.includes('import { readFile } from "node:fs/promises";'));
	assert.ok(outline.includes("// Top-level line comment"));
	assert.ok(outline.includes("Block comment start"));
	assert.ok(outline.includes("export interface User { ... }"));
	assert.ok(outline.includes("export class UserService { ... }"));
	assert.ok(outline.includes("export async function processUser(u: User): Promise<void> { ... }"));
	assert.ok(!outline.includes('return { id, name: "Alice" };'));
});

test("extractCodeOutline extracts JavaScript functions, arrows, and variables", () => {
	const jsCode = `
const fs = require("fs");
// Comment
function calculate(x) {
	return x * 2;
}
const arrowFn = (a, b) => {
	return a + b;
};
`;

	const outline = extractCodeOutline(jsCode, ".js");

	assert.ok(outline.includes('const fs = require("fs");'));
	assert.ok(outline.includes("// Comment"));
	assert.ok(outline.includes("function calculate(x) { ... }"));
	assert.ok(outline.includes("const arrowFn = (a, b) => { ... }"));
});

test("extractCodeOutline extracts Python defs, classes, docstrings, and imports", () => {
	const pyCode = `
import os
from path import join

# Helper function
"""
Docstring module
"""

class DataProcessor:
    def __init__(self, name):
        self.name = name

def run_pipeline(data):
    print(data)
`;

	const outline = extractCodeOutline(pyCode, ".py");

	assert.ok(outline.includes("import os"));
	assert.ok(outline.includes("from path import join"));
	assert.ok(outline.includes("# Helper function"));
	assert.ok(outline.includes('"""'));
	assert.ok(outline.includes("class DataProcessor:"));
	assert.ok(outline.includes("def run_pipeline(data):"));
	assert.ok(outline.includes("print(data)"));
});

test("extractCodeOutline captures Go type/struct/package/import but drops func (current regex gap)", () => {
	const goCode = `
package main

import (
	"fmt"
)

// User struct definition
type User struct {
	ID string
}

func main() {
	fmt.Println("Hello")
}

func (u *User) GetID() string {
	return u.ID
}
`;

	const outline = extractCodeOutline(goCode, ".go");

	assert.ok(outline.includes("package main"));
	assert.ok(outline.includes("import ("));
	assert.ok(outline.includes("// User struct definition"));
	assert.ok(outline.includes("type User struct { ... }"));
	// func is not matched by the current regex word lists
	assert.ok(!outline.includes("func main()"));
	assert.ok(!outline.includes("func (u *User) GetID()"));
});

test("extractCodeOutline falls back to first 50 lines for short code with few outline lines", () => {
	const opaqueCode = `line1\nline2\nline3\nline4\nline5`;
	const outline = extractCodeOutline(opaqueCode, ".txt");
	assert.ok(outline.includes("line1"));
	assert.ok(outline.includes("line5"));
});

test("listLocalFiles recursively scans supported extensions and applies exclusions", async () => {
	const tmpDir = await mkdtemp(join(tmpdir(), "sat12-listfiles-test-"));
	try {
		await writeFile(join(tmpDir, "valid.ts"), "export const x = 1;", "utf8");
		await writeFile(join(tmpDir, "readme.md"), "# Readme", "utf8");
		await writeFile(join(tmpDir, "ignored.bin"), "binary data", "utf8");
		await writeFile(join(tmpDir, ".env"), "SECRET=123", "utf8");
		await writeFile(join(tmpDir, "credentials.json"), "{}", "utf8");

		await mkdir(join(tmpDir, "node_modules"), { recursive: true });
		await writeFile(join(tmpDir, "node_modules", "dep.ts"), "export const y = 2;", "utf8");

		await mkdir(join(tmpDir, "sub"), { recursive: true });
		await writeFile(join(tmpDir, "sub", "helper.py"), "def help(): pass", "utf8");

		const files = await listLocalFiles(tmpDir);
		const relPaths = files.map((f) => f.relativePath);

		assert.ok(relPaths.includes("valid.ts"));
		assert.ok(relPaths.includes("readme.md"));
		assert.ok(relPaths.includes(join("sub", "helper.py")));

		// Excluded files
		assert.ok(!relPaths.includes("ignored.bin"));
		assert.ok(!relPaths.includes(".env"));
		assert.ok(!relPaths.includes("credentials.json"));
		assert.ok(!relPaths.some((p) => p.includes("node_modules")));
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
});

test("gatherLocalDirectoryEvidence extracts query-relevant passages and code outlines", async () => {
	const tmpDir = await mkdtemp(join(tmpdir(), "sat12-gatherev-test-"));
	try {
		// Non-existent dir returns undefined
		const missing = await gatherLocalDirectoryEvidence(join(tmpDir, "nonexistent"), "query");
		assert.equal(missing, undefined);

		// Empty dir returns undefined
		const empty = await gatherLocalDirectoryEvidence(tmpDir, "query");
		assert.equal(empty, undefined);

		// Populate with doc and code
		await writeFile(join(tmpDir, "doc.md"), "# Deployment\n\nThe target system is deployed in production.", "utf8");
		await writeFile(join(tmpDir, "app.ts"), "export class AppService {\n  run() {}\n}", "utf8");

		// Add sources.json with defaultLocalRating
		const manifest = {
			defaultLocalRating: { reliability: "A", credibility: "1" },
		};
		await writeFile(join(tmpDir, "sources.json"), JSON.stringify(manifest), "utf8");

		const evidence = await gatherLocalDirectoryEvidence(tmpDir, "deployment production target");
		assert.ok(evidence);
		assert.ok(evidence.includes("## Local Directory Evidence"));
		assert.ok(evidence.includes("Top Query-Relevant Document Passages"));
		assert.ok(evidence.includes("`doc.md`"));
		assert.ok(evidence.includes("Structural Code Architecture & Interface Outlines"));
		assert.ok(evidence.includes("`app.ts`"));
		assert.ok(evidence.includes("A1 (Completely Reliable / Confirmed by Other Sources)"));

		// With user overrides
		const overriddenEvidence = await gatherLocalDirectoryEvidence(
			tmpDir,
			"deployment",
			undefined,
			undefined,
			{ [join("doc.md")]: "B2" },
		);
		assert.ok(overriddenEvidence?.includes("[User Override]"));
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
});

test("loadPriorWorkspaceIntelligence and attachResearchNotice format prior workspace data and notices", async () => {
	const tmpCwd = await mkdtemp(join(tmpdir(), "sat12-research-intel-test-"));
	try {
		// No analysis-* dirs -> undefined
		const noIntel = await loadPriorWorkspaceIntelligence(tmpCwd);
		assert.equal(noIntel, undefined);

		// Create an analysis bundle dir
		const analysisDir = join(tmpCwd, "analysis-20260816-120000");
		await mkdir(join(analysisDir, "evidence"), { recursive: true });

		const rootIndexContent = `# SAT-12 Analysis\n\n**Question:** Is system secure?\n\n## Bottom-Line Assessment\n\nSystem is secure.`;
		await writeFile(join(analysisDir, "index.md"), rootIndexContent, "utf8");

		const gapsContent = `# Intelligence Gaps\n\n- Gap 1: Need audit logs.`;
		await writeFile(join(analysisDir, "evidence", "gaps.md"), gapsContent, "utf8");

		const intel = await loadPriorWorkspaceIntelligence(tmpCwd);
		assert.ok(intel);
		assert.ok(intel.includes("## Prior Workspace Intelligence"));
		assert.ok(intel.includes("Is system secure?"));
		assert.ok(intel.includes("System is secure."));
		assert.ok(intel.includes("Need audit logs."));

		// attachResearchNotice
		assert.equal(attachResearchNotice(undefined, "no network"), undefined);
		const noticeResult = attachResearchNotice("prior evidence", "Rate limit HTTP 429");
		assert.ok(noticeResult);
		assert.ok(noticeResult.includes("Rate limit HTTP 429"));
		assert.ok(noticeResult.includes("prior evidence"));
	} finally {
		await rm(tmpCwd, { recursive: true, force: true });
	}
});
