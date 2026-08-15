# SAT-12 quality prompt eval

Model: `b200/Qwen/Qwen3.6-27B`
Runs for each fixture: 10
Total generations: 10

| Fixture | First-attempt pass | Final pass | Mean attempts | Mean sources | Mean gaps | Top failure |
|---|---:|---:|---:|---:|---:|---|
| `user_override` | 8/10 | 10/10 | 1.20 | 2.0 | 4.1 | — |

### Retry causes

| Rule | Times |
|---|---:|
| `override_code_mismatch` | 2 |

**Overall first-attempt pass: 8/10 (80.0%)**
**Overall final pass: 10/10 (100.0%)**

## Fixture intent

- `user_override`: Must copy the user rating and set user_overridden only for that source. Expect: migration-plan graded A1 with user_overridden true; legacy-notes graded low

## Limits

- The run measures one model. The numbers do not carry to another provider.
- 10 runs for each cell give a rough rate, not a tight confidence interval.
- The failure classifier uses a regex. It can put a failure in the wrong bucket.
  It changes the report only. It never changes the validator.
- A first-attempt pass counts prompt quality. A final pass counts prompt quality plus the retry loop.
