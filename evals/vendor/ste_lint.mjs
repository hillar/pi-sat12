/**
 * MIT License - Copyright (c) 2026 AminBlg
 * Ported from Python (evals/vendor/ste_lint.py) to JavaScript.
 * See evals/vendor/LICENSE for the full permission notice.
 */

import { readFileSync } from "node:fs";

const BANNED_MODALS = /\b(should|would|may|might|could)\b/gi;
const PERFECT = /\b(has|have|had)\s+been\b|\b(has|have)\s+\w+ed\b/gi;
const CONTRACTION = /\b\w+(n't|'ll|'re|'ve|'d)\b|\bit's\b|\byou're\b/gi;
const ING_CLAUSE = /,\s*(mak|allow|enabl|ensur|highlight|creat|provid|offer|help|reduc|improv|lead|caus|result)ing\b/gi;
const LATIN = /\b(e\.g\.|i\.e\.|etc\.?)(?=[\s,)]|$)/gi;
const SLOP = /\b(simply|seamlessly|effortlessly|robust|leverag\w*|utiliz\w*|comprehensive|powerful|blazingly|streamlin\w*|facilitat\w*|performant|plethora|myriad|delve|crucial|pivotal)\b/gi;
const TRAILING_COND = /\w[^.!?\n]{3,}\s\b(if|when)\b\s/i;
const ROTATION_SETS = [
	["check-verify", /\b(check|verify|confirm|validate|ensure)\w*\b/gi],
	["config-settings", /\b(config|configuration|settings)\b/gi],
];
const LIMITS = { procedural: 20, descriptive: 25 };

export function stripCode(text) {
	let t = text.replace(/```.*?```/gs, " ");
	t = t.replace(/`[^`\n]+`/g, " CODESPAN ");
	t = t.replace(/^#+\s.*$/gm, " ");
	t = t.replace(/https?:\/\/\S+/g, " URL ");
	return t;
}

export function sentences(text) {
	const cleaned = text.replace(/^\s*([-*]|\d+\.)\s+/gm, "");
	const parts = cleaned.split(/(?<=[.!?:])\s+/);
	return parts
		.map((p) => p.trim())
		.filter((p) => p.split(/\s+/).filter(Boolean).length >= 2);
}

function countMatches(text, regex) {
	const matches = text.match(regex);
	return matches ? matches.length : 0;
}

export function lint(text, textType = "descriptive") {
	const body = stripCode(text);
	const sents = sentences(body);
	const limit = LIMITS[textType] ?? 25;
	const counts = {};

	const lengths = sents.map((s) => s.split(/\s+/).filter(Boolean).length);
	counts.sentence_over_limit = lengths.filter((n) => n > limit).length;
	counts.contraction = countMatches(body, CONTRACTION);
	counts.banned_modal = countMatches(body, BANNED_MODALS);
	counts.perfect_tense = countMatches(body, PERFECT);
	counts.ing_clause = countMatches(body, ING_CLAUSE);
	counts.semicolon = (body.match(/;/g) || []).length;
	counts.latin_abbrev = countMatches(body, LATIN);
	counts.slop_word = countMatches(body, SLOP);
	counts.trailing_condition = sents.filter(
		(s) => TRAILING_COND.test(s) && !/^(if|when)\b/i.test(s),
	).length;

	let rotation = 0;
	for (const [, rx] of ROTATION_SETS) {
		const stems = new Set();
		for (const m of body.matchAll(rx)) {
			const stem = m[1].toLowerCase().replace(/s+$/, "");
			stems.add(stem);
		}
		if (stems.size > 1) {
			rotation += stems.size - 1;
		}
	}
	counts.synonym_rotation = rotation;

	const wordList = body.split(/\s+/).filter(Boolean);
	const words = Math.max(1, wordList.length);
	const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

	const sumLengths = lengths.reduce((sum, n) => sum + n, 0);
	const meanSent = lengths.length > 0 ? sumLengths / lengths.length : 0;
	const maxSent = lengths.length > 0 ? Math.max(...lengths) : 0;

	return {
		type: textType,
		words,
		sentences: sents.length,
		mean_sentence_words: Number((Math.round(meanSent * 10) / 10).toFixed(1)),
		longest_sentence_words: maxSent,
		violations: counts,
		violations_total: total,
		violations_per_100w: Number((Math.round((100.0 * total) / words * 100) / 100).toFixed(2)),
	};
}

export const SLOP_FIXTURE = `Leveraging our robust retry mechanism, failed uploads are automatically
reattempted, ensuring data integrity is maintained throughout the entire process which has
been designed from the ground up to gracefully handle even the most challenging network
interruptions. You should verify your credentials; it's also worth checking the settings,
e.g. the timeout config. Contact support if the problem persists.`;

export const CLEAN_FIXTURE = `The system retries a failed upload automatically. This process keeps the data correct.

If failures continue, make sure that your credentials are correct. If the problem continues, contact support.`;

/**
 * Violation categories that trigger a retry on synthesis bottom_line_assessment.
 * Banned modals, perfect tense, and -ing clauses are allowed to preserve analytic hedging.
 */
export const SUMMARY_BLOCKING = [
	"sentence_over_limit",
	"contraction",
	"latin_abbrev",
	"slop_word",
	"semicolon",
	"trailing_condition",
	"synonym_rotation",
];

export function lintSummary(text, budget = 1, label = "the bottom_line_assessment") {
	if (!text || typeof text !== "string") return null;
	const res = lint(text, "procedural");
	const activeCounts = SUMMARY_BLOCKING.map((k) => ({
		key: k,
		count: res.violations[k] || 0,
	})).filter((v) => v.count > 0);

	const totalBlocking = activeCounts.reduce((sum, v) => sum + v.count, 0);
	if (totalBlocking <= budget) return null;

	const breakdown = activeCounts.map((v) => `${v.key}=${v.count}`).join(", ");
	return (
		`${label} has ${totalBlocking} STE style violation(s) (${breakdown}). ` +
		`The maximum allowed budget is ${budget}. Rewrite ${label} to use short sentences (<=20 words), ` +
		`no contractions, no latin abbreviations (e.g./i.e./etc), no semicolons, no buzzwords/slop, and consistent terminology.`
	);
}

export function selfTest() {
	const slop = lint(SLOP_FIXTURE, "procedural");
	const clean = lint(CLEAN_FIXTURE, "procedural");

	if (slop.violations.sentence_over_limit < 1) throw new Error(`slop sentence_over_limit ${slop.violations.sentence_over_limit}`);
	if (slop.violations.banned_modal < 1) throw new Error(`slop banned_modal ${slop.violations.banned_modal}`);
	if (slop.violations.contraction < 1) throw new Error(`slop contraction ${slop.violations.contraction}`);
	if (slop.violations.perfect_tense < 1) throw new Error(`slop perfect_tense ${slop.violations.perfect_tense}`);
	if (slop.violations.ing_clause < 1) throw new Error(`slop ing_clause ${slop.violations.ing_clause}`);
	if (slop.violations.semicolon !== 1) throw new Error(`slop semicolon ${slop.violations.semicolon}`);
	if (slop.violations.latin_abbrev < 1) throw new Error(`slop latin_abbrev ${slop.violations.latin_abbrev}`);
	if (slop.violations.slop_word < 2) throw new Error(`slop slop_word ${slop.violations.slop_word}`);
	if (slop.violations.trailing_condition < 1) throw new Error(`slop trailing_condition ${slop.violations.trailing_condition}`);
	if (slop.violations.synonym_rotation < 1) throw new Error(`slop synonym_rotation ${slop.violations.synonym_rotation}`);
	if (clean.violations_total !== 0) throw new Error(`clean violations_total ${clean.violations_total}`);

	console.log(`self-test OK: ${slop.violations_total} violations in slop fixture, 0 in clean`);
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes("--self-test")) {
		selfTest();
		return;
	}
	let textType = "descriptive";
	if (args.includes("--type")) {
		textType = args[args.indexOf("--type") + 1] || "descriptive";
	}
	const src = args[args.length - 1];
	const text = src === "-" || !src ? readFileSync(0, "utf8") : readFileSync(src, "utf8");
	console.log(JSON.stringify(lint(text, textType), null, 2));
}

if (process.argv[1] && process.argv[1].endsWith("ste_lint.mjs")) {
	main();
}
