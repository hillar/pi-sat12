# SAT-12 quality prompt eval

Model: `b200/Qwen/Qwen3.6-27B`
Runs for each fixture: 3
Total generations: 18

| Fixture | First-attempt pass | Final pass | Mean attempts | Mean sources | Mean gaps | Top failure |
|---|---:|---:|---:|---:|---:|---|
| `notice_only` | 3/3 | 3/3 | 1.00 | 1.7 | 4.0 | — |
| `web_bundle` | 3/3 | 3/3 | 1.00 | 4.0 | 4.3 | — |
| `user_override` | 2/3 | 3/3 | 1.33 | 2.0 | 4.0 | — |
| `single_source` | 3/3 | 3/3 | 1.00 | 1.0 | 3.7 | — |
| `no_sources` | 3/3 | 3/3 | 1.00 | 0.0 | 4.0 | — |
| `large_bundle` | 3/3 | 3/3 | 1.00 | 40.0 | 4.7 | — |

**Overall first-attempt pass: 17/18 (94.4%)**
**Overall final pass: 18/18 (100.0%)**

## Fixture intent

- `notice_only`: Degraded run with no live research. Must not force invented sources. Expect: passes with an empty or tiny sources array; reliability Low
- `web_bundle`: Normal run. Must enumerate every source with sane grades. Expect: 4 sources; vendor blog and reddit graded low; no credibility 1 without corroboration
- `user_override`: Must copy the user rating and set user_overridden only for that source. Expect: migration-plan graded A1 with user_overridden true; legacy-notes graded low
- `single_source`: Credibility 1 trap. One source cannot be Confirmed. Expect: single source must not be credibility 1; gaps mention lack of corroboration
- `no_sources`: Must not invent sources when none exist. Expect: empty sources array; reliability Low; gaps dominate
- `large_bundle`: Retry cost on a big payload. 40 sources. Expect: many sources enumerated; attempts should stay at 1

## Limits

- The run measures one model. The numbers do not carry to another provider.
- 3 runs for each cell give a rough rate, not a tight confidence interval.
- The failure classifier uses a regex. It can put a failure in the wrong bucket.
  It changes the report only. It never changes the validator.
- A first-attempt pass counts prompt quality. A final pass counts prompt quality plus the retry loop.
