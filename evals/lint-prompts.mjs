/**
 * Rank every system prompt by mechanical STE violations.
 *
 * The script imports each technique module, reads the real prompt string, and
 * pipes it through the vendored ste_lint.py. It ranks the prompts by
 * violations for each 100 words. Use the ranking to choose which prompts to
 * rewrite, instead of choosing by opinion.
 *
 * Run: node evals/lint-prompts.mjs
 *      node evals/lint-prompts.mjs --json
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINTER = join(HERE, "vendor", "ste_lint.py");

/**
 * Every prompt in the project.
 * `module` is the file to import. `exports` names the prompt constants.
 * The technique files hold the prompt on the exported technique object.
 */
const PROMPT_SOURCES = [
	{ id: "quality", module: "../src/techniques/diagnostic/quality.ts", pick: (m) => m.qualityTechnique.systemPrompt },
	{ id: "assumptions", module: "../src/techniques/diagnostic/assumptions.ts", pick: (m) => m.assumptionsTechnique.systemPrompt },
	{ id: "indicators", module: "../src/techniques/diagnostic/indicators.ts", pick: (m) => m.indicatorsTechnique.systemPrompt },
	{ id: "ach", module: "../src/techniques/diagnostic/ach.ts", pick: (m) => m.achTechnique.systemPrompt },
	{ id: "devils_advocacy", module: "../src/techniques/contrarian/devils_advocacy.ts", pick: (m) => m.devilsAdvocacyTechnique.systemPrompt },
	{ id: "team_ab", module: "../src/techniques/contrarian/team_ab.ts", pick: (m) => m.teamAbTechnique.systemPrompt },
	{ id: "high_impact", module: "../src/techniques/contrarian/high_impact.ts", pick: (m) => m.highImpactTechnique.systemPrompt },
	{ id: "what_if", module: "../src/techniques/contrarian/what_if.ts", pick: (m) => m.whatIfTechnique.systemPrompt },
	{ id: "brainstorming", module: "../src/techniques/imaginative/brainstorming.ts", pick: (m) => m.brainstormingTechnique.systemPrompt },
	{ id: "outside_in", module: "../src/techniques/imaginative/outside_in.ts", pick: (m) => m.outsideInTechnique.systemPrompt },
	{ id: "red_team", module: "../src/techniques/imaginative/red_team.ts", pick: (m) => m.redTeamTechnique.systemPrompt },
	{ id: "alt_futures", module: "../src/techniques/imaginative/alt_futures.ts", pick: (m) => m.altFuturesTechnique.systemPrompt },
];

/** Run the vendored linter over one text. */
function lint(text, type) {
	const raw = execFileSync("python3", [LINTER, "--type", type, "-"], {
		input: text,
		encoding: "utf8",
	});
	return JSON.parse(raw);
}

/** Load every prompt. Skip a module that does not expose one. */
async function loadPrompts() {
	const prompts = [];
	for (const source of PROMPT_SOURCES) {
		try {
			const module = await import(source.module);
			const text = source.pick(module);
			if (typeof text === "string" && text.trim()) {
				prompts.push({ id: source.id, text });
			} else {
				console.error(`skip ${source.id}: no prompt string found`);
			}
		} catch (error) {
			console.error(`skip ${source.id}: ${error.message}`);
		}
	}
	return prompts;
}

function main() {
	const asJson = process.argv.includes("--json");
	loadPrompts().then((prompts) => {
		// A system prompt gives instructions, so score it as procedural.
		const rows = prompts
			.map(({ id, text }) => {
				const result = lint(text, "procedural");
				return {
					id,
					words: result.words,
					per100w: result.violations_per_100w,
					total: result.violations_total,
					longest: result.longest_sentence_words,
					mean: result.mean_sentence_words,
					top: Object.entries(result.violations)
						.filter(([, n]) => n > 0)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 3)
						.map(([name, n]) => `${name}=${n}`)
						.join(" "),
				};
			})
			.sort((a, b) => b.per100w - a.per100w);

		if (asJson) {
			console.log(JSON.stringify(rows, null, 2));
			return;
		}

		console.log("Prompt STE violation ranking (worst first)");
		console.log("Scored as procedural: the 20-word sentence limit applies.\n");
		console.log(
			"rank  prompt            words  viol/100w  total  longest  mean  top violations",
		);
		rows.forEach((row, index) => {
			console.log(
				String(index + 1).padEnd(6) +
					row.id.padEnd(18) +
					String(row.words).padEnd(7) +
					String(row.per100w).padEnd(11) +
					String(row.total).padEnd(7) +
					String(row.longest).padEnd(9) +
					String(row.mean).padEnd(6) +
					row.top,
			);
		});
		const mean = rows.reduce((sum, r) => sum + r.per100w, 0) / rows.length;
		console.log(`\nmean viol/100w across ${rows.length} prompts: ${mean.toFixed(2)}`);
	});
}

main();
