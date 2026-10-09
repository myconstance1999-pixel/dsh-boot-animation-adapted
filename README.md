# DSH boot animation — maintained adaptation

A third-party adaptation of [lxj5820/dsh-boot-animation](https://github.com/lxj5820/dsh-boot-animation), maintained by [myconstance1999-pixel](https://github.com/myconstance1999-pixel). Distribution version: `0.2.1-adapted.1`; plugin package: `dsh-boot-animation`; entry/config namespace: `boot-animation`. This is not an official DeepSeek release or an endorsed lxj5820 release.

The target is official Desktop/Electron source release [`dsh-v0.2.0-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2), commit `639ed015397290b3745d163aafe02ffee4aa3f84`. The selected npm `latest`/`next` channel version is a **release candidate**, not a final stable release. Other runtime versions are unverified. Official binary GUI behavior has not been verified.

The original startup/transition script and all three original MP4 files are unchanged. Defaults remain random selection from the three clips, `enterMode: tail`, `fadeMs: 2000`, and `sound: true` subject to the browser's autoplay policy. `enabled` and `showHint` default to true; `clickToEnter` defaults to false; no clips are disabled. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) for attribution and original-byte hashes.

## Changes in this adaptation

- The Host uses the modern volatile `Config` contract and read-only manifest/clip routes that leave the kernel's client carrier reachable. It has no media-rewrite endpoint and falls back to the kernel page if the startup source cannot be read.
- The client acknowledges readiness before optional settings wiring. Its `plugins.item` card uses `configForms`, binds the official page's `{state, mutate}` form, and submits one revision-fenced mutation without a second write path. Registrations are owned and disposed with their context.
- Two bounded repairs keep `Cache-Control: no-store` on an unsatisfiable Range response (`416`) and let a detached settings-card probe recognize decoded current-frame data without requiring a presented-frame callback. Decoded, refused, or timed-out probe results preserve known duration. Decoding metadata does not prove visible video pixels; these repairs do not establish a cause or fix for an earlier third-clip display anomaly.

## Startup boundary

The official shell shows its workspace window before returning Host boot injections. Its public preload has no video-ready or native visibility gate. A pure plugin therefore cannot eliminate the shell's earlier blank/loading interval or guarantee video in the first visible native frame. The private custom native-launcher behavior is separate work and is not included in this portable repository.

Sources: [Electron startup](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/src/main.ts), [preload](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/src/preload-app.ts), and [Web boot](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/web/src/main.ts).

## Install a release archive

Download the `.tgz` attached to a [repository release](https://github.com/myconstance1999-pixel/dsh-boot-animation-adapted/releases). In a matching official Desktop installation, open **Plugins → Add Plugin** and enter its absolute local path. The official manager accepts local `.tgz` files and applies its normal dependency, peer, and lifecycle checks; a local archive does not guarantee an offline install.

Alternatively, initialize that official Desktop once, fully quit it, and invoke **that application's bundled CLI**. On macOS its location is `<official-app>.app/Contents/Resources/runtime/cli/bin/dsh`. Replace the example paths below with absolute paths:

```sh
DESKTOP_BOOT_CLI="/absolute/path/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DESKTOP_BOOT_CLI" --version
"$DESKTOP_BOOT_CLI" plugin --profile desktop add "/absolute/path/dsh-boot-animation-0.2.1-adapted.1.tgz"
```

Confirm that the CLI belongs to the selected official Desktop and reports the target release. Do not use another `dsh` found on PATH, upgrade a frozen rc6 installation, or manually register a second `boot-animation` row. Preserve the Desktop profile's package manifest, lockfile, user patch, and enabled bundle order before installation. Reopen Desktop and check video display, handoff, usable UI, and normal quit.

To roll back, remove `dsh-boot-animation` through that same official Plugins page, or fully quit Desktop and use the same bundled entry:

```sh
"$DESKTOP_BOOT_CLI" plugin --profile desktop remove dsh-boot-animation
```

Reopen Desktop. Restore only the reviewed pre-install profile changes if removal alone does not return the intended configuration. [Official Desktop ownership instructions](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/apps/desktop/README.md) describe this reserved `desktop` profile and bundled CLI.

## Reproduce the local checks and archive

From the repository root:

```sh
node validation/first-load-offline.mjs
python3 build-package.py
```

The fixture covers 14 bounded checks with explicit service, schema, React, and DOM stubs. It does not boot a real runtime or verify Electron video decoding, sound, layout, live settings persistence, or native startup. The builder creates the portable release archive without dependency installation. No official application or profile is modified by these commands.
