# SAT-12 quality prompt eval

Model: `b200/Qwen/Qwen3.6-27B`
Runs for each fixture: 1
Total generations: 2

| Fixture | First-attempt pass | Final pass | Mean attempts | Mean sources | Mean gaps | Top failure |
|---|---:|---:|---:|---:|---:|---|
| `notice_only` | 1/1 | 1/1 | 1.00 | 0.0 | 4.0 | — |
| `single_source` | 1/1 | 1/1 | 1.00 | 1.0 | 4.0 | — |

**Overall first-attempt pass: 2/2 (100.0%)**
**Overall final pass: 2/2 (100.0%)**

## Fixture intent

- `notice_only`: Degraded run with no live research. Must not force invented sources. Expect: passes with an empty or tiny sources array; reliability Low
- `single_source`: Credibility 1 trap. One source cannot be Confirmed. Expect: single source must not be credibility 1; gaps mention lack of corroboration

## Limits

- The run measures one model. The numbers do not carry to another provider.
- 1 runs for each cell give a rough rate, not a tight confidence interval.
- The failure classifier uses a regex. It can put a failure in the wrong bucket.
  It changes the report only. It never changes the validator.
- A first-attempt pass counts prompt quality. A final pass counts prompt quality plus the retry loop.
