# Agent instructions

Guidance for coding agents and reviewers working in this repository.

## Code Review Rules

For Codex and any reviewer of a pull request here. Report each finding with
the file and line, what is wrong, and the smallest fix; skip what a formatter
would catch.

- Repeated code: flag logic, constants or markup that repeat something already
  in the repository, even under another name, and point to the existing one.
- Shared modules: when the same helper now lives in two places, ask for it to
  live in one shared module and be imported from both.
- Generated filler: flag abstractions with one user, wrappers that only
  forward, defensive checks for states that cannot happen, comments that
  restate the code, unused imports, exports or parameters, and stub or
  placeholder code presented as finished.
- Documentation: when behaviour, configuration, commands or public interfaces
  change, check that the README, docs and code comments describing them change
  in the same pull request; flag anything stale or contradicting.
- Tests: where the repository has tests, new logic should come with a test
  that fails without it.
