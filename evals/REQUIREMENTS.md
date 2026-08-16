# Requirements

Each requirement is testable. Each requirement traces to a test inside `evals/`.
Use the requirement ID in the change message when you change code.

## Admiralty validation rules

| ID | Requirement | Test in evals/admiralty.test.ts | Eval fixture |
|---|---|---|---|
| REQ-ADM-1 | The `admiralty_code` must equal the reliability letter plus the credibility number. | `admiralty_code that disagrees with the fields fails` | web_bundle |
| REQ-ADM-2 | Each `source_id` must appear exactly once in the sources list. | `a duplicate source_id fails` | large_bundle |
| REQ-ADM-3 | Each `corroborated_by` id must exist in the sources list. A source must not list itself. | `corroborated_by an unknown id fails`, `corroborated_by itself fails` | web_bundle |
| REQ-ADM-4 | Credibility "1" (Confirmed) needs at least one corroborating source or a valid user override. | `unverified user_overridden cannot claim credibility 1`, `credibility 1 passes with a corroborating source` | single_source |
| REQ-ADM-5 | An unverified `user_overridden` flag must not fail validation. | `unverified user_overridden at credibility 3 passes` | notice_only |
| REQ-ADM-6 | When a real user override exists, the emitted code must match it. | `real override with a mismatched code fails`, `a directory-prefix override covers a file below it` | user_override |

## Quality evidence gate

| ID | Requirement | Test in evals/quality.test.ts | Eval fixture |
|---|---|---|---|
| REQ-Q-1 | Long evidence must produce a non-empty sources list. | `long evidence with no sources fails` | web_bundle, large_bundle |
| REQ-Q-2 | Short or missing evidence must not force a sources list. | `short notice-only evidence does not require sources`, `no evidence does not require sources` | notice_only |
| REQ-Q-3 | A context with only `hasEvidence` keeps the strict rule. | `a context without evidenceLength keeps the strict rule` | none |
| REQ-Q-4 | The quality check must run the Admiralty rules on the emitted sources. | `the Admiralty rules still run through the quality check` | all fixtures |
| REQ-Q-5 | The quality field `assessment` and each source `rationale` allow no more than 1 blocking STE violation per field; modals and perfect tense are allowed. | `assessment with excessive STE violations fails`, `source rationale with excessive STE violations fails` | none |

## Eval behavior

| ID | Requirement | Test | Eval fixture |
|---|---|---|---|
| REQ-EV-1 | The eval runs each fixture N times and reports the first-attempt pass rate. | manual run | all fixtures |
| REQ-EV-2 | The eval resumes by skipping a cell whose raw file already exists. | manual run | all fixtures |
| REQ-EV-3 | The eval classifies a failure by the rule that produced it and lists retry causes. | `classifyFailure` via unit run | all fixtures |
| REQ-EV-4 | The eval writes `RESULTS.md`, `results.json`, and one raw file per cell. | manual run | all fixtures |
| REQ-EV-5 | The prompt STE lint runs in JavaScript without a Python runtime. | `evals/ste-lint.test.ts` | none |
| REQ-EV-6 | The LLM usage accumulator and abort utilities function correctly. | `evals/llm-util.test.ts` | none |
| REQ-EV-7 | The message builder formats prompt context, evidence, and Admiralty instructions. | `evals/messages.test.ts` | none |
| REQ-EV-8 | Session creation, status formatting, and persistence operate as specified. | `evals/session.test.ts` | none |
| REQ-EV-9 | Web resource extraction parses block, markdown, and raw URL formats. | `evals/okf-extract.test.ts` | none |
| REQ-EV-10 | The OKF writer generates complete analysis bundles and updates the index. | `evals/okf.test.ts` | none |
| REQ-EV-11 | The executive report renderer transforms markdown safely to HTML. | `evals/render.test.ts` | none |
| REQ-EV-12 | TypeBox schemas validate synthesis and quality outputs correctly. | `evals/schema.test.ts` | none |
| REQ-EV-13 | The settings writer parses keys and persists settings under the user config directory. | `evals/config.test.ts` | none |
| REQ-EV-14 | Code outline extraction and local file scanning behave per spec across language types. | `evals/local-evidence.test.ts` | none |
| REQ-EV-15 | Local directory evidence produces ranked passages, code outlines, and Admiralty headers. | `evals/local-evidence.test.ts` | none |
| REQ-EV-16 | Prior workspace intelligence and research notices format properly. | `evals/local-evidence.test.ts` | none |

## Synthesis summary

| ID | Requirement | Test | Eval fixture |
|---|---|---|---|
| REQ-SYN-1 | The synthesis bottom-line assessment allows no more than 1 blocking STE violation; modals and perfect tense are allowed. | `evals/ste-lint.test.ts` | none |

## Model behavior (prompt level)

The model owns these. The eval measures them. The validator cannot enforce some of them.

| ID | Requirement | Eval fixture | Expect |
|---|---|---|---|
| REQ-MD-1 | The model must not invent sources when none exist. | no_sources | empty sources array |
| REQ-MD-2 | The model must copy a user-supplied rating and mark `user_overridden` only for that source. | user_override | migration-plan graded A1 with flag true |
| REQ-MD-3 | The model must not grade a single source credibility "1". | single_source | no credibility 1 |
| REQ-MD-4 | The model must enumerate every source in a large bundle. | large_bundle | many sources, attempts at 1 |

## Conventions

- Add one requirement per behavior change. Give it a new ID.
- State the requirement in one sentence.
- Trace the requirement to a test or an eval fixture.
- Record the requirement ID in the change message.
- Delete or change a requirement only with a test change.
