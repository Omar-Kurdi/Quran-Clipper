# QuranClipper — working agreement

Two codebases in one repo: the Next.js studio in `src/`, and the Python
alignment sidecar in `asr-service/` it talks to over HTTP. `scripts/` holds the
aligner's evaluation harness.

## Verification

`npm run verify` is the fast tier: typecheck, lint, unit tests, and the
alignment rules. Seconds, and it needs no audio, no model and no GPU.

- A change is not complete until the applicable verification has actually been
  run against the current working tree.
- Never state that typecheck, lint, tests, Skylos or any other check passed
  unless that command really ran and its output supports the claim. Expecting
  a result is not the same as having one.
- When verification fails, fix the underlying cause. Do not work around the
  check, loosen it, or narrow its scope to make it green.
- Report what ran and how each one came out: passed, failed, or not applicable.

## Tests

- Never weaken, delete, disable, skip or rewrite a test to make a change pass.
  A failing test is a finding, not an obstacle.
- When fixing a bug, add a regression test for it where practical.
- Do not add tests that assert nothing in order to move a number.
- Do not introduce a coverage-percentage gate unless we decide to, explicitly.

## Skylos

`npm run verify:skylos` is its own gate, separate from `npm run verify` and
reported separately -- never folded into a single "verification passed". It
takes about 50 seconds, which is why it is not in the fast tier. Run it before
calling a change done.

`.skylos/baseline.portable.json` records what this repo already had;
`.skylos/accepted.txt` lists the few findings the baseline cannot capture, each
with its reason. The gate scans the whole tree and reports only what is outside
both. `.skylos/baseline.json` is rebuilt from the portable copy on every run and
is gitignored -- edit the portable one, never the generated one.

- Never suppress, ignore or baseline a NEW finding to get a green run. That is
  the one thing this gate exists to prevent.
- Investigate every new finding, and fix the ones that are real defects.
- Pre-existing or deliberately accepted findings may stay in the baseline, with
  the rationale recorded. Regenerate the baseline only on purpose.
- Dependency findings (`SKY-SCA-*`) are advisory and do not fail the gate; they
  are printed every run so they stay visible.
- Dead-code findings on TypeScript are in the baseline because Skylos does not
  resolve same-file call sites and reports called helpers as unused. Treat a
  new one as suspect and verify the call sites before acting on it.
- Do not add `--diff` or `--diff-base` to the gate. Both were measured here:
  `--diff` does not filter at all, and `--diff-base` only sees committed diffs,
  so it passed a probe containing eval() and a hardcoded credential.
- Do not claim Skylos passed unless Skylos actually ran.

## Alignment and ASR

`./gauge.sh` scores the aligner against every ground-truth file in `scripts/`
and runs the reported-case suite. It needs recordings and a loaded model, so it
runs neither in CI nor as part of `npm run verify`.

- Any change that can affect alignment behaviour — `asr-service/app/`,
  `src/lib/forcedAligner.ts`, the segmentation rules — must also pass
  `./gauge.sh` where practical. The fast tier does not stand in for it.
- Ground truth and the reported cases must both agree. A change that improves
  one while breaking the other is not an improvement; see `docs/ALIGNMENT.md`.
- Never change application behaviour to make an alignment check pass.

## Finishing

- Review the final `git diff` before calling a task done. Everything in it
  should be something the task asked for.
- No unrelated cleanup, reformatting or refactoring.
- State plainly what was verified and what was not.

## CI

`.github/workflows/verify.yml` runs the fast tier and the Skylos gate on every
push to main and every pull request. It does not run `./gauge.sh`, which needs
audio, a gated checkpoint and a GPU -- that stays local, and a change to the
aligner is not finished because CI is green.
