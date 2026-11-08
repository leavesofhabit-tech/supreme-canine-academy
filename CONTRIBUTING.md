# Contributing

Keep changes focused on a clear user problem. Describe the trigger, the expected result, the actual result, and how the change was verified. For security defects, follow [SECURITY.md](SECURITY.md) and use private reporting.

## Local setup

Use Node.js 24 and npm. A clean checkout includes the sanitized review corpus; building or testing does not require a separate private knowledge library, a cloud account, or cloud credentials.

```sh
npm ci
npm test
npm run build
npm run smoke:browser
```

The browser smoke command needs an installed Chrome or Edge browser. Set `BROWSER_PATH` to its executable if automatic discovery cannot find it. On Windows PowerShell, use `npm.cmd` if the shell's script policy prevents `npm` from running.

For development, run `npm run dev` and open the loopback URL printed by the server. Keep `package-lock.json` with intentional dependency changes; use a fresh `npm ci` to verify them.

## Behavioral changes

- Add a regression for a shared or bug-prone behavior, using the existing Node test patterns. A focused run such as `node --test tests/input-language.test.mjs` is useful while iterating; run the full test and build commands before submitting.
- Exercise the actual affected browser flow. For layout changes, inspect small phones, tablets, and desktop widths, keyboard navigation, visible focus, and reduced-motion behavior. Use synthetic profiles in screenshots.
- Preserve existing profile storage keys, or provide and test a backward-compatible migration. A failed save must preserve the previous data and report the error clearly.
- Keep hosted functionality disabled by default. Preserve authentication, per-question consent, source eligibility, and citation boundaries. Keep private/API responses outside the service-worker cache. Follow the [free-access policy](FREE-ACCESS.md) when proposing services or integrations.
- Keep source IDs and citations stable. Retrieval improvements must retain safety referrals and abstain when the library does not support an answer. Avoid invented lessons, inferred profile facts, fabricated ratings, or unsupported progress metrics.

Before committing, run `git diff --check` and review the diff for unrelated files. A fresh-clone test/build should leave tracked files unchanged. Generated builds and dependencies do not belong in source commits.

## Training and care content

Use the content-correction issue form to identify the public record ID, a short relevant passage, the proposed correction, and supporting source evidence. Prefer primary references with a precise section or page. Explain uncertainty and the boundary between source-supported information and an editorial proposal.

Keep draft/review labels and safety context intact. Automated tests and Schema.org validation do not establish veterinary validation, training outcomes, or search-result eligibility. Do not copy full copyrighted works, private provenance collections, or material you lack permission to publish.

The [application code license](LICENSE) and the [separate content and brand notice](CONTENT-LICENSE.md) have distinct scopes. Read them before submitting third-party text, images, or other assets.

## Pull requests

Lead with the concrete problem and resulting behavior. Include the relevant issue or record IDs, the changes needed to understand the fix, and actual verification results. For UI changes, include a useful screenshot with synthetic data. State any remaining limitation accurately.

Never include passwords, authentication tokens, private keys, real pet or person identifiers, client information, or veterinary records in issues, pull requests, logs, test fixtures, or screenshots.
