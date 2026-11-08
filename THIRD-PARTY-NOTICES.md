# Third-party software notices

The browser bundle includes the following packages, pinned by `package-lock.json`:

- Firebase JavaScript SDK `firebase@12.15.0` and bundled modules `@firebase/app@0.15.0`, `@firebase/auth@1.13.3`, `@firebase/app-check@0.12.0`, `@firebase/functions@0.13.5`, `@firebase/util@1.15.1`, `@firebase/component@0.7.3`, and `@firebase/logger@0.5.1`: Apache License 2.0. Copyright holders include Google LLC and Firebase contributors. See `licenses/Apache-2.0.txt`.
- `idb@7.1.1`: ISC License. Copyright (c) 2016 Jake Archibald. See `licenses/ISC-idb.txt`.

`esbuild` is a build-time dependency and is not included in the browser runtime bundle. The Firebase SDK package manifest identifies its license as Apache-2.0; each bundled `@firebase` module is also Apache-2.0.
