# Contributing

Thanks for helping improve Kinoir.

## Before opening a pull request

1. Discuss large behavioural or storage-format changes in an issue first.
2. Do not commit personal libraries, watch history, media, API keys, generated
   previews, downloaded models, or optional application bundles.
3. Keep local-first and library-grounding behaviour intact.
4. Add or update tests for parsing, persistence, security boundaries, and
   regressions.
5. Run:

   ```sh
   npm ci
   npm run check
   npm test
   ```

## Code style

- Prefer small ES modules and platform APIs over new runtime dependencies.
- Escape user and metadata text before inserting HTML.
- Revalidate filesystem paths and privileged actions in the Electron main
  process or local server; renderer checks are not security boundaries.
- Keep Kinoir Air read-only unless a narrowly scoped feature is explicitly
  designed and reviewed.
- Preserve existing library and Continue Watching data during migrations.

## Testing media features

Use synthetic files in a temporary directory. Never add copyrighted media or a
real `library.json` fixture to the repository.
