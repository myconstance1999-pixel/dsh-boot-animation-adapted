// dsh-boot-animation — official DSH Desktop (Electron) 0.2.0-rc.2 Host half.
// Based on upstream b8bfa8d9f879f14917033a7135e3964776865cad.
// Preserve the original boot screen, transitions and media bytes. Clip routes
// are read-only; settings are declared as volatile Config fields.

import { readdir, stat, open } from 'node:fs/promises'
import { createReadStream, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { basename, extname, join, resolve, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'

/**
 * Absolute path of the pre-boot screen source.
 *
 * The script is read per index render rather than once at module load. Reading it
 * at load time would pin the served script to whatever the file held when the
 * process started, so editing a label or the exit fade would require restarting
 * dsh — the one operation this plugin's whole design tries to avoid asking for.
 */
const BOOT_SCREEN_PATH = fileURLToPath(new URL('./src/boot-screen.js', import.meta.url))

/** Video container extensions the pool accepts, in discovery order. */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov'])

/** Route prefix both the manifest and the clip bytes live under. */
const ROUTE = '/plugins/dsh-boot-animation'

// Defaults and validation apply to the supplied profile configuration.
const DEFAULT_SETTINGS = {
  /**
   * Whether the screen is injected at all. Off restores DSH's own boot page: the
   * rows are simply not added, so no overlay, no clip request and no script run.
   */
  enabled: true,
  /** How long the dissolve into the app takes. */
  fadeMs: 2000,
  /** When the hand-off happens: see ENTER_MODES. */
  enterMode: 'tail',
  /** Clip file names excluded from the pool by the user. */
  disabledClips: [],
  /**
   * Whether the clip may make a sound at all.
   *
   * On, the screen tries to play unmuted and offers its sound button as the
   * gesture the audio policy asks for. Off, the screen is silenced for good: no
   * unmuted attempt, no sound button and no way to re-enable audio from the
   * overlay. Defaults to on so an existing profile behaves exactly as before.
   */
  sound: true,
  /**
   * Whether a pointer press enters immediately.
   *
   * The screen normally spends the first press unlocking audio (Chromium grants
   * sound only to a gesture, and the entering gesture cannot also be the unlock)
   * and the second press leaving. On, the first press leaves — the shortcut a
   * user wants once the clip has no sound to offer, or when they simply do not
   * care to hear it.
   */
  clickToEnter: false,
  /**
   * Whether the bottom hint line is drawn.
   *
   * Off leaves the title and the progress bar in place and only hides the
   * sentence that says what a press does, for a screen judged to be better
   * without instructions on it.
   */
  showHint: true,
}

/** The accepted `enterMode` values, in the order the browser card presents them. */
const ENTER_MODES = ['tail', 'end', 'click']

// The patch entry id supplies the settings namespace: boot-animation.
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SETTINGS.enabled).volatile(),
  fadeMs: z.number().min(300).max(5000).default(DEFAULT_SETTINGS.fadeMs).volatile(),
  enterMode: z.union([...ENTER_MODES]).default(DEFAULT_SETTINGS.enterMode).volatile(),
  disabledClips: z.array(z.string()).default([]).volatile(),
  sound: z.boolean().default(DEFAULT_SETTINGS.sound).volatile(),
  clickToEnter: z.boolean().default(DEFAULT_SETTINGS.clickToEnter).volatile(),
  showHint: z.boolean().default(DEFAULT_SETTINGS.showHint).volatile(),
})

/** Read the latest snapshot of a volatile field, or a supplied plain value. */
function readField(config, key) {
  const value = config?.[key]
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    ? value.get() : value
}

/** Package name the loader mounts this row as. */
export const name = 'dsh-boot-animation'

/** Services this half consumes. */
export const inject = ['webServer']

/** The clip directory, resolved from this module rather than the process cwd. */
const assetDir = fileURLToPath(new URL('./assets/videos', import.meta.url))

/** MIME type served for one clip. */
function contentType(file) {
  switch (extname(file).toLowerCase()) {
    case '.webm': return 'video/webm'
    case '.mov': return 'video/quicktime'
    default: return 'video/mp4'
  }
}

/**
 * Whether the movie box precedes the media data.
 *
 * A player cannot decode a frame until it has read `moov`, so a file whose
 * `moov` sits at the end must be fetched almost in full before anything appears
 * — the usual reason a clip shows nothing but black for a while. This is reported
 * to the browser card for inspection. This candidate never rewrites media.
 *
 * The header window is 64 KiB because the order of the first two boxes is NOT the
 * answer: all three clips in this pool carry a ~21 KiB `uuid` metadata box before
 * the media data, so a 1 KiB read saw `ftyp, uuid` and returned no verdict at all.
 * @param absolute - resolved clip path.
 * @returns true when `moov` comes first, false when `mdat` does, undefined when
 *   neither box is found within the header window.
 */
async function readFaststart(absolute) {
  let handle
  try {
    handle = await open(absolute, 'r')
    const head = Buffer.alloc(65536)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    let offset = 0
    while (offset + 8 <= bytesRead) {
      const type = head.toString('latin1', offset + 4, offset + 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      const size = head.readUInt32BE(offset)
      if (size < 8) break
      offset += size
    }
    return undefined
  } catch {
    // An unreadable header is not a reason to drop the clip from the pool; the
    // card simply shows no optimisation verdict for it.
    return undefined
  } finally {
    await handle?.close()
  }
}

/**
 * List the clip files currently on disk, newest first.
 *
 * The modification time and size travel with each path as the clip revision.
 * Responses remain no-store; the revision also distinguishes replaced files.
 * @returns every servable clip with its revision stamp and card metadata.
 */
async function listClips() {
  let entries
  try {
    entries = await readdir(assetDir, { withFileTypes: true })
  } catch (error) {
    // A missing directory is an empty pool, not a failure: the overlay then has
    // nothing to play and the plugin must stay invisible rather than break boot.
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const files = entries
    .filter(entry => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map(entry => join(assetDir, entry.name))
  const stamped = await Promise.all(files.map(async (file) => {
    const info = await stat(file)
    return {
      file,
      // Sorted on the raw time, published rounded: two files written in the same
      // millisecond would tie on the rounded value and order nondeterministically.
      mtime: info.mtimeMs,
      revision: Math.round(info.mtimeMs),
      bytes: info.size,
      faststart: await readFaststart(file),
    }
  }))
  return stamped.sort((left, right) => right.mtime - left.mtime)
}

/** Answer one JSON response. */
function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Parse one `Range` header against a known length.
 * @param header - raw header value, if present.
 * @param size - complete resource length.
 * @returns inclusive byte range, or undefined for a full response.
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return undefined
    return { start: Math.max(size - length, 0), end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return { unsatisfiable: true }
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  if (!Number.isFinite(end) || end < start) return { unsatisfiable: true }
  return { start, end }
}

/**
 * Stream one clip, honouring range requests so the browser can seek and so a
 * repeated load does not re-download bytes it already holds.
 * @param absolute - resolved clip path on disk.
 * @param req - incoming request.
 * @param res - outgoing response.
 */
async function serveClip(absolute, req, res) {
  const info = await stat(absolute)
  const type = contentType(absolute)
  const range = parseRange(req.headers.range, info.size)
  if (range?.unsatisfiable === true) {
    res.writeHead(416, {
      'content-range': `bytes */${String(info.size)}`,
      'cache-control': 'no-store',
    })
    res.end()
    return
  }

  // Nothing about a clip response may be stored, complete or not.
  //
  // The overlay replaces the media element when it hands over or skips on, which
  // aborts the in-flight request; whatever arrived is a TRUNCATED body. Any
  // directive that lets the browser keep it — `immutable`, or `no-cache` plus an
  // ETag — turns that into a poisoned cache entry: the next normal reload decodes
  // the fragment, and a clip whose `moov` sits at the end has no index in a
  // fragment, so it paints nothing while a faststart clip still plays. An ETag is
  // no defence, because it only ever claimed the FILE had not changed, never that
  // the copy in hand was complete — and answering `If-None-Match` with 304 is
  // precisely what made the browser confident in a fragment.
  //
  // The cost is that each page load streams the chosen clip again. These are local
  // files over loopback — a few tens of milliseconds — and it buys the only
  // guarantee that matters: what the player decodes is always the whole file.
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }

  // Streamed from disk rather than read whole and sliced. A browser playing a
  // clip issues many overlapping range requests, and reading a 10 MB file per
  // request holds the whole clip in memory on every one of them; the original
  // implementation did exactly that. Streaming also lets the response start
  // before the file is fully read, which is what keeps playback fed while the
  // element seeks into the parts it still needs.
  const from = range === undefined ? 0 : range.start
  const to = range === undefined ? info.size - 1 : range.end
  res.writeHead(range === undefined ? 200 : 206, {
    ...headers,
    'content-length': String(to - from + 1),
    ...(range === undefined ? {} : {
      'content-range': `bytes ${String(from)}-${String(to)}/${String(info.size)}`,
    }),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absolute, { start: from, end: to })
  stream.on('error', () => { res.destroy() })
  res.on('close', () => { stream.destroy() })
  stream.pipe(res)
}

/**
 * Resolve a requested pool path to a file inside the clip directory.
 * @param url - request URL.
 * @returns the absolute path, or undefined when the request is not a pool clip.
 */
function resolveClip(url) {
  const pathname = decodeURIComponent(url.split('?')[0])
  if (!pathname.startsWith(`${ROUTE}/clip/`)) return undefined
  const requested = basename(pathname.slice(`${ROUTE}/clip/`.length))
  if (!VIDEO_EXTENSIONS.has(extname(requested).toLowerCase())) return undefined
  const absolute = resolve(assetDir, requested)
  // Containment: a traversal attempt must not escape the clip directory.
  if (!absolute.startsWith(assetDir + sep)) return undefined
  return absolute
}

/** Mount read-only routes and the official pre-boot index injection. */
export function apply(ctx, config = {}) {
  const server = ctx.webServer

  function sanitize(value) {
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
      fadeMs: typeof value.fadeMs === 'number' && Number.isFinite(value.fadeMs)
        ? Math.min(5000, Math.max(300, value.fadeMs)) : DEFAULT_SETTINGS.fadeMs,
      enterMode: ENTER_MODES.includes(value.enterMode) ? value.enterMode : DEFAULT_SETTINGS.enterMode,
      disabledClips: Array.isArray(value.disabledClips)
        ? value.disabledClips.filter(name => typeof name === 'string') : [],
      sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_SETTINGS.sound,
      clickToEnter: typeof value.clickToEnter === 'boolean' ? value.clickToEnter : DEFAULT_SETTINGS.clickToEnter,
      showHint: typeof value.showHint === 'boolean' ? value.showHint : DEFAULT_SETTINGS.showHint,
    }
  }

  function currentSettings() {
    return sanitize(Object.fromEntries(Object.keys(DEFAULT_SETTINGS)
      .map(key => [key, readField(config, key)])))
  }

  // Two routes rather than one prefix over ROUTE. The web server resolves
  // prefixes longest-first, so a prefix on ROUTE also claims
  // `<ROUTE>/client.js` — the URL the browser fetches for this package's own
  // client bundle (client-modules serves every bundle at
  // `/plugins/<package>/client.js`). That request would answer this plugin's
  // 404, the bundle would never materialize, and the Settings card would never
  // register. An exact manifest route plus a `/clip` prefix leaves every other
  // path under ROUTE to its owner.
  ctx.effect(() => server.register({
    kind: 'exact',
    path: `${ROUTE}/clips.json`,
    handler: (req, res) => {
      void (async () => {
        const clips = await listClips()
        const disabled = new Set(currentSettings().disabledClips)
        sendJson(res, 200, {
          clips: clips.map(clip => ({
            // The revision is the size+time pair. Clip responses are no-store;
            // the URL also makes a stale cache entry unreachable:
            // it changes whenever the file does — or whenever the scheme that
            // produced a bad entry changes. The first scheme (mtime alone) left
            // truncated `immutable` entries that a normal reload kept reusing, and
            // nothing but a hard reload could dislodge them.
            src: `${ROUTE}/clip/${encodeURIComponent(basename(clip.file))}`
              + `?v=${String(clip.revision)}-${String(clip.bytes)}`,
            name: basename(clip.file),
            // Everything on disk is listed, with the pool decision carried as a
            // field. The screen plays only the enabled ones; the settings card
            // needs the whole list to offer them back.
            enabled: !disabled.has(basename(clip.file)),
            bytes: clip.bytes,
            faststart: clip.faststart,
          })),
        })
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: manifest route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: manifest route')

  ctx.effect(() => server.register({
    kind: 'prefix',
    path: `${ROUTE}/clip`,
    handler: (req, res) => {
      void (async () => {
        const absolute = resolveClip(req.url ?? '')
        if (absolute === undefined) {
          sendJson(res, 404, { error: 'not found' })
          return
        }
        try {
          await serveClip(absolute, req, res)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            sendJson(res, 404, { error: 'not found' })
            return
          }
          throw error
        }
      })().catch((error) => {
        ctx.logger?.error?.('boot-animation: clip route failed', error)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal' })
        else res.end()
      })
    },
  }), 'boot-animation: clip route')

  // This package exposes no media rewrite route.

  // `ctx.on` already returns a disposer the fiber tracks, so it is registered
  // directly rather than wrapped in an effect — matching the other subscribers
  // of this event (ui-theme, client-modules, client-connection).
  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()

    // Switched off means switched off: no configuration row, no screen script, no
    // overlay, and not one request for a clip. The kernel's own boot page is what
    // shows. Injecting a disabled screen and making the script bail out would look
    // the same and leave the whole thing running; this is the only version of
    // "off" that is actually off.
    if (!settings.enabled) return
    const screenSource = bootScreenSource()
    if (!screenSource) return

    // The row reads a plain global the script fills in, so the injection stays
    // JSON-serializable data and the script itself stays a static asset.
    table.push({
      kind: 'script',
      placement: 'head',
      text: `globalThis.__DSH_BOOT_ANIM_CFG__=${JSON.stringify({
        base: ROUTE,
        manifest: `${ROUTE}/clips.json`,
        holdMs: 15000,
        fadeMs: settings.fadeMs,
        enterMode: settings.enterMode,
        sound: settings.sound,
        clickToEnter: settings.clickToEnter,
        showHint: settings.showHint,
      })}`,
    })
    table.push({ kind: 'script', placement: 'head', text: screenSource })
  })
}

/**
 * The pre-boot screen source, re-read on every index render.
 *
 * Synchronous because the injection table is collected synchronously; the file is
 * a few kilobytes and read once per page load, not per request in a hot path.
 * A missing or unreadable file must not blank the boot page: the caller then
 * serves the kernel page alone, which is the documented fallback.
 * @returns the script text, or an empty string when the source cannot be read.
 */
function bootScreenSource() {
  try {
    return readFileSync(BOOT_SCREEN_PATH, 'utf8')
  } catch (error) {
    process.emitWarning(`boot-animation: cannot read ${BOOT_SCREEN_PATH}: ${String(error)}`)
    return ''
  }
}
