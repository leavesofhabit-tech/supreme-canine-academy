# Security policy

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/leavesofhabit-tech/supreme-canine-academy/security/advisories/new) for suspected security defects. Keep exploit details and sensitive information out of public issues and pull requests. If private reporting is unavailable, contact the repository maintainer through an available private channel before sharing details publicly.

Include the affected version or commit, the relevant file or route, concise reproduction steps, expected and actual behavior, and the potential impact. Provide a minimal example using synthetic data. Do not send passwords, tokens, private keys, real pet or person identifiers, or private training/veterinary records.

Security fixes target the latest `main` branch. Older snapshots may need to be updated to receive a fix.

## Dependency maintenance

The root manifest narrowly overrides `@firebase/firestore@4.16.0`'s `@grpc/grpc-js` dependency to `1.13.7`, a patched release for [GHSA-m9gg-hp2v-232j](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j) and [GHSA-f596-whhp-79r4](https://github.com/grpc/grpc-node/security/advisories/GHSA-f596-whhp-79r4), including the [remaining error-disclosure fixes in 1.13.7](https://github.com/grpc/grpc-node/releases/tag/%40grpc%2Fgrpc-js%401.13.7). The Firebase umbrella package otherwise resolves an affected `~1.9.0` version. Keep the override until upstream includes a patched dependency; review it when upgrading Firebase.

The current browser application imports Firebase App, Auth, App Check, and Functions. It does not import the Node Firestore/gRPC client. The override removes the known vulnerable package from contributor installs without changing that browser bundle. This override is outside Firestore's declared dependency range; if a future feature uses Node Firestore, test that integration explicitly before enabling it. It does not configure or validate the separate, disabled `backend/functions` prototype.

Run `npm ci` and `npm audit --audit-level=high` before release. CI checks the root application's locked dependency tree as well as tests, build, and browser smoke. An audit is a check against currently published advisories, not a guarantee that all defects have been found.

## Relevant boundaries

The default application uses the bundled review library and browser-local dog profiles. Hosted authentication and retrieval are disabled unless explicitly configured. Reports concerning script injection, unintended data transmission, profile isolation, unsafe caching, authentication/authorization bypass, or corpus-eligibility bypass are relevant to this project.

Dog-training or care-content corrections belong in the content-correction issue form with the public record ID and supporting evidence. Use synthetic examples and preserve the source's review status and safety context.

Public repository access does not grant access to a hosting account, database, private corpus, or any user's browser storage. Reproduce issues in your own local checkout and test profiles; do not access or change other users' data or a live service without authorization.
