/**
 * Unit tests for extractWebResources (evals/okf-extract.test.ts).
 *
 * Verifies web source extraction from evidence blocks, markdown links, and raw URLs.
 *
 * Run: node --test 'evals/*.test.ts'
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWebResources } from "../src/okf.ts";

test("extractWebResources parses block format with IDs and URLs", () => {
	const evidence = `
## [source-1] Article Title
Some content here.
- URL: https://example.com/article-1

## [source-2] Second Article
Other content.
- URL: https://example.com/article-2
`;

	const res = extractWebResources(evidence);
	assert.equal(res.length, 2);
	assert.equal(res[0].id, "source-1");
	assert.equal(res[0].title, "Article Title");
	assert.equal(res[0].url, "https://example.com/article-1");
});

test("extractWebResources falls back to markdown links when blocks absent", () => {
	const evidence = "Check [Link One](https://example.com/one) and [Link Two](https://example.com/two).";
	const res = extractWebResources(evidence);
	assert.equal(res.length, 2);
	assert.equal(res[0].title, "Link One");
	assert.equal(res[0].url, "https://example.com/one");
});

test("extractWebResources falls back to raw URLs when markdown links absent", () => {
	const evidence = "Refer to https://example.com/raw1 and https://example.com/raw2.";
	const res = extractWebResources(evidence);
	assert.equal(res.length, 2);
	assert.equal(res[0].title, "https://example.com/raw1");
	assert.equal(res[0].url, "https://example.com/raw1");
});

test("extractWebResources deduplicates URLs and handles empty input", () => {
	assert.deepEqual(extractWebResources(""), []);
	assert.deepEqual(extractWebResources(undefined), []);

	const duplicateEvidence = `
[Title A](https://example.com/same)
[Title B](https://example.com/same)
`;
	const res = extractWebResources(duplicateEvidence);
	assert.equal(res.length, 1);
});
