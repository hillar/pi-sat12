/**
 * Evidence fixtures for the quality technique eval.
 *
 * Each fixture comes from a real failure mode, not from imagination:
 * - notice_only reproduces the degraded run when pi-webaio is absent.
 * - single_source is the credibility "1" trap.
 * - no_sources tests whether the model invents sources.
 * - user_override tests whether the model copies a user rating.
 * - large_bundle measures the retry cost on a big payload.
 */

export interface EvalFixture {
	id: string;
	/** What this fixture tries to break. */
	intent: string;
	question: string;
	evidence: string;
	/** Source ratings that the user supplied on the command line. */
	userOverrides?: Record<string, string>;
	/** Expectation for the report. The eval does not fail on this. */
	expect: string;
}

const RESEARCH_NOTICE = `> ⚠️ **Research Notice: Live Web Search Unsuccessful**
> Live web research could not retrieve fresh external data (pi-webaio MCP server unavailable (package not installed or failed to start)).
> Analysis is proceeding based on prior workspace intelligence and user-provided context.
> **Analytical Directive:** Factor this limitation into Quality of Information Check (\`quality\`), consider source timeliness in Key Assumptions (\`assumptions\`), and log missing live data as an Unresolved Intelligence Gap.

Context provided`;

const WEB_BUNDLE = `# External Web Research & Evidence

## Gathered Web Sources

1. **[S1]** [NIST post-quantum standardisation status](https://www.nist.gov/pqc/status) — https://www.nist.gov/pqc/status
2. **[S2]** [ArXiv: lattice attack cost models](https://arxiv.org/abs/2401.00001) — https://arxiv.org/abs/2401.00001
3. **[S3]** [Vendor blog: our chip is quantum safe](https://example-vendor.com/blog/quantum) — https://example-vendor.com/blog/quantum
4. **[S4]** [Reddit thread on migration timelines](https://reddit.com/r/crypto/comments/abc) — https://reddit.com/r/crypto/comments/abc

### [S1] NIST post-quantum standardisation status
NIST published the first three post-quantum standards in August 2024. The agency recommends that operators begin migration planning now. NIST states that it will publish further guidance on hybrid modes.

### [S2] ArXiv: lattice attack cost models
The authors model the cost of lattice reduction attacks. They conclude that current parameter sets retain a large security margin. The paper is a preprint and has not completed peer review.

### [S3] Vendor blog: our chip is quantum safe
The vendor claims its accelerator makes any deployment "fully quantum safe". The post gives no parameter sets, no benchmarks, and no third-party review. The vendor sells the product described.

### [S4] Reddit thread on migration timelines
Several anonymous users report internal migration deadlines between 2027 and 2030. None of the users identify their employer. One comment contradicts the other three.`;

const LOCAL_DIR_EVIDENCE = `## Local Directory Evidence (@docs/crypto)
Query-aware evidence gathered from target local directory \`/repo/docs/crypto\` (3 files scanned):

### Top Query-Relevant Document Passages (Ranked via Okapi BM25)
- **[Local File: \`docs/crypto/migration-plan.md\` | BM25 Score: 8.42 | Admiralty: A1 (Completely Reliable / Confirmed by Other Sources) [User Override]]**
> The migration plan sets a hard cutover date of 2027-01-01. The security team signed off on 2025-03-14. Two independent reviewers confirmed the parameter choices.
- **[Local File: \`docs/crypto/legacy-notes.txt\` | BM25 Score: 3.10 | Admiralty: B2 (Usually Reliable / Probably True)]**
> These notes are undated. The author is unknown. The notes claim the old cipher suite is "probably fine for another decade".`;

const SINGLE_SOURCE = `# External Web Research & Evidence

## Gathered Web Sources

1. **[S1]** [Internal incident report 2026-04](https://intranet.example.com/ir/2026-04) — https://intranet.example.com/ir/2026-04

### [S1] Internal incident report 2026-04
The report states that the outage began at 02:14 UTC and lasted 47 minutes. The report names the root cause as an expired certificate. No other source covers this incident. The report is the only record available.`;

const NO_SOURCES = `The analyst asked a general question about organisational risk appetite.

No documents, URLs, files, or named references were supplied with this request. The request contains only the question itself and this note.`;

/** Build a large bundle by repeating a section with distinct source ids. */
function buildLargeBundle(): string {
	const header = "# External Web Research & Evidence\n\n## Gathered Web Sources\n\n";
	const listed: string[] = [];
	const bodies: string[] = [];
	for (let i = 1; i <= 40; i++) {
		listed.push(`${i}. **[S${i}]** [Report ${i} on grid resilience](https://example.org/r/${i}) — https://example.org/r/${i}`);
		bodies.push(
			`### [S${i}] Report ${i} on grid resilience\n` +
				`This report covers substation ${i}. It records load figures for the last four quarters. ` +
				`The publisher is a regional operator. The figures agree with the national dataset for three of the four quarters. ` +
				`The report notes one measurement gap in the second quarter. The author lists no conflict of interest. ` +
				`The data collection method follows the standard national template used across all operators in the region.\n`,
		);
	}
	return header + listed.join("\n") + "\n\n" + bodies.join("\n");
}

export const QUALITY_FIXTURES: EvalFixture[] = [
	{
		id: "notice_only",
		intent: "Degraded run with no live research. Must not force invented sources.",
		question: "Does the code follow pi extension good practices?",
		evidence: RESEARCH_NOTICE,
		expect: "passes with an empty or tiny sources array; reliability Low",
	},
	{
		id: "web_bundle",
		intent: "Normal run. Must enumerate every source with sane grades.",
		question: "How urgent is post-quantum cryptography migration?",
		evidence: WEB_BUNDLE,
		expect: "4 sources; vendor blog and reddit graded low; no credibility 1 without corroboration",
	},
	// REQ-MD-2: The model must copy a user-supplied rating and mark user_overridden only for that source.
	{
		id: "user_override",
		intent: "Must copy the user rating and set user_overridden only for that source.",
		question: "Is the crypto migration plan credible?",
		evidence: LOCAL_DIR_EVIDENCE,
		userOverrides: { "docs/crypto/migration-plan.md": "A1" },
		expect: "migration-plan graded A1 with user_overridden true; legacy-notes graded low",
	},
	// REQ-MD-3: The model must not grade a single source credibility "1".
	{
		id: "single_source",
		intent: "Credibility 1 trap. One source cannot be Confirmed.",
		question: "What caused the April 2026 outage?",
		evidence: SINGLE_SOURCE,
		expect: "single source must not be credibility 1; gaps mention lack of corroboration",
	},
	// REQ-MD-1: The model must not invent sources when none exist.
	{
		id: "no_sources",
		intent: "Must not invent sources when none exist.",
		question: "What is our organisational risk appetite?",
		evidence: NO_SOURCES,
		expect: "empty sources array; reliability Low; gaps dominate",
	},
	// REQ-MD-4: The model must enumerate every source in a large bundle.
	{
		id: "large_bundle",
		intent: "Retry cost on a big payload. 40 sources.",
		question: "How resilient is the regional grid?",
		evidence: buildLargeBundle(),
		expect: "many sources enumerated; attempts should stay at 1",
	},
];
