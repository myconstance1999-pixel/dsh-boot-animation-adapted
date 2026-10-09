// Offline package acceptance with explicit schema, Host, React, service, and
// media stubs. No official app/kernel, browser, sockets, dependencies, private
// settings, or external model is used. Scratch writes stay below validation/.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Writable } from 'node:stream'
import { browserFixture, formFixture, pageFormFixture, servicesFixture, nodes, flushPromises } from './client-fixture.mjs'

const validation = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const originalHashes = {
  'src/boot-screen.js': '6c8c01f94ead14d22716d8cb636c7a45475438333d7a50f0cddaf6cce7701ec6',
  'assets/videos/1.mp4': '970afeb9b8a981de88abc3997adba2d4aef7624d45b3deac9bab1033613ad937',
  'assets/videos/2.mp4': '95794b99c3ae4c3690ec2100e42a48dc79949111d565bb818e4aebfc90f45584',
  'assets/videos/3.mp4': '585143d714778d48eb8fba277d5a4771e65fb5210dd1ffe3803515da41424471',
}
const relativeFiles = ['entry.js', 'src/boot-screen.js', 'src/client.js', 'lib/client.js',
  'package.json', 'LICENSE', 'cordis.patch.yml', ...[1, 2, 3].map((index) => `assets/videos/${index}.mp4`)]
const hash = (data) => createHash('sha256').update(data).digest('hex')
const packageBefore = Object.fromEntries(relativeFiles.map((relative) => [relative, hash(readFileSync(join(packageRoot, relative)))]))
const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const bundle = readFileSync(join(packageRoot, 'lib/client.js'), 'utf8')
const results = []
const plain = (value) => JSON.parse(JSON.stringify(value))
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }) }
  catch (error) {
    const detail = (error.stack ?? String(error)).replaceAll(packageRoot, '<repository>/')
    results.push({ name, status: 'failed', error: detail.replace(/(?:file:\/\/)?\/(?:Users|home)\/[^/\s]+\/[^:\n)]+/g, '<local-path>') })
  }
}

function hostFixture() {
  const routes = new Map()
  const events = new Map()
  const disposers = []
  let legacyCalls = 0
  const ctx = {
    logger: { warn() {}, error() {} },
    settings: { register() { legacyCalls += 1; throw new Error('legacy settings.register is unavailable') } },
    inject() { throw new Error('Host must not request an optional legacy provider') },
    webServer: { register(route) {
      const key = `${route.kind}:${route.path}`
      assert(!routes.has(key))
      routes.set(key, route)
      return () => routes.delete(key)
    } },
    effect(factory) { const stop = factory(); if (typeof stop === 'function') disposers.push(stop) },
    on(name, callback) {
      events.set(name, callback)
      const stop = () => events.delete(name)
      disposers.push(stop)
      return stop
    },
  }
  return {
    ctx, routes, legacyCalls: () => legacyCalls,
    injections() { const rows = []; events.get('webserver/index-inject')?.(rows); return rows },
    dispose() { for (const stop of disposers.reverse()) stop() },
  }
}

function request(route, method, url, range) {
  return new Promise((resolve, reject) => {
    assert(route, 'fixture route missing')
    const parts = []
    const response = new Writable({ write(chunk, _encoding, done) { parts.push(Buffer.from(chunk)); done() } })
    response.headersSent = false
    response.writeHead = (status, headers = {}) => {
      response.status = status; response.headers = headers; response.headersSent = true
    }
    const timer = setTimeout(() => reject(new Error('fixture response exceeded 3 seconds')), 3000)
    response.on('error', (error) => { clearTimeout(timer); reject(error) })
    response.on('finish', () => {
      clearTimeout(timer)
      resolve({ status: response.status, headers: response.headers, body: Buffer.concat(parts) })
    })
    try { route.handler({ method, url, headers: range ? { range } : {} }, response) }
    catch (error) { clearTimeout(timer); reject(error) }
  })
}

function injectedConfig(host) {
  const rows = host.injections()
  assert.equal(rows.length, 2)
  assert(rows.every((row) => row.kind === 'script' && row.placement === 'head'))
  assert(rows[0].text.startsWith('globalThis.__DSH_BOOT_ANIM_CFG__='))
  return JSON.parse(rows[0].text.slice(rows[0].text.indexOf('=') + 1))
}

function cardFixture(scope, suppliedForm) {
  const browser = browserFixture(bundle)
  const services = servicesFixture(scope)
  services.setServed(true)
  browser.client.apply(services.ctx)
  const row = services.registrations.get('boot-animation')
  assert(row, 'served modern settings card missing')
  const props = { ...row.options.inject(), view: 'page' }
  if (suppliedForm !== undefined) props.form = suppliedForm
  let tree
  const render = () => { tree = browser.render(row.component, props); return tree }
  const open = () => {
    render()
    nodes(tree, (node) => node.props?.className === 'dshba-head')[0].props.onClick()
    return render()
  }
  return {
    browser, services, render, open,
    replaceForm(form) { props.form = form },
    dispose() { browser.dispose(); services.dispose() },
  }
}

function enabledControl(tree) {
  const section = nodes(tree, (node) => node.props?.key === 'enabled')[0]
  assert(section, 'enabled section missing')
  return nodes(section, (node) => node.type === 'input')[0]
}

const ready = (value = {}, revision = 'fixture-r1') => ({ status: 'ready', value, revision, writable: true })
await mkdir(join(validation, 'test-runs'), { recursive: true })
const scratch = await mkdtemp(join(validation, 'test-runs', 'offline-'))
try {
  await mkdir(join(scratch, 'src'))
  await mkdir(join(scratch, 'assets', 'videos'), { recursive: true })
  await mkdir(join(scratch, 'node_modules', '@deepseek-ai', 'schemastery'), { recursive: true })
  await writeFile(join(scratch, 'package.json'), '{"type":"module"}\n')
  await writeFile(join(scratch, 'node_modules', '@deepseek-ai', 'schemastery', 'package.json'),
    '{"name":"@deepseek-ai/schemastery","type":"module","exports":"./index.mjs"}\n')
  await copyFile(join(validation, 'schema-stub.mjs'), join(scratch, 'node_modules', '@deepseek-ai', 'schemastery', 'index.mjs'))
  await copyFile(join(packageRoot, 'entry.js'), join(scratch, 'entry.js'))
  await copyFile(join(packageRoot, 'src', 'boot-screen.js'), join(scratch, 'src', 'boot-screen.js'))
  const bytes = Buffer.from(Array.from({ length: 128 }, (_, index) => index))
  await writeFile(join(scratch, 'assets', 'videos', 'fixture.mp4'), bytes)
  await writeFile(join(scratch, 'assets', 'videos', 'ignored.txt'), 'not a video\n')
  const plugin = await import(pathToFileURL(join(scratch, 'entry.js')).href)

  await check('Config declares exactly seven defaulted volatile fields and supported bounds', () => {
    const fields = plugin.Config.fields
    assert.deepEqual(Object.keys(fields), ['enabled', 'fadeMs', 'enterMode', 'disabledClips', 'sound', 'clickToEnter', 'showHint'])
    for (const field of Object.values(fields)) { assert(field.hasDefault); assert(field.volatileField) }
    assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.defaultValue])), {
      enabled: true, fadeMs: 2000, enterMode: 'tail', disabledClips: [], sound: true, clickToEnter: false, showHint: true,
    })
    assert.equal(fields.fadeMs.minimum, 300)
    assert.equal(fields.fadeMs.maximum, 5000)
    assert.deepEqual(fields.enterMode.choices, ['tail', 'end', 'click'])
  })

  await check('Host activates with only webServer and never calls legacy settings.register', () => {
    const host = hostFixture()
    plugin.apply(host.ctx)
    assert.deepEqual(plugin.inject, ['webServer'])
    assert.equal(host.legacyCalls(), 0)
    assert.deepEqual([...host.routes.keys()], ['exact:/plugins/dsh-boot-animation/clips.json', 'prefix:/plugins/dsh-boot-animation/clip'])
    assert.equal(host.injections()[1].text, readFileSync(join(packageRoot, 'src', 'boot-screen.js'), 'utf8'))
    host.dispose()
    assert.equal(host.routes.size, 0)
    assert.deepEqual(host.injections(), [])
  })

  await check('Latest .get values drive injections, bounds, disablement, and the clip manifest', async () => {
    const values = {}
    const config = Object.fromEntries(Object.keys(plugin.Config.fields).map((key) => [key, { get: () => values[key] }]))
    const host = hostFixture()
    plugin.apply(host.ctx, config)
    assert.equal(injectedConfig(host).fadeMs, 2000)
    Object.assign(values, { fadeMs: 50, enterMode: 'click', sound: false, clickToEnter: true, showHint: false, disabledClips: ['fixture.mp4', 42] })
    assert.deepEqual(Object.fromEntries(Object.entries(injectedConfig(host)).filter(([key]) => ['fadeMs', 'enterMode', 'sound', 'clickToEnter', 'showHint'].includes(key))),
      { fadeMs: 300, enterMode: 'click', sound: false, clickToEnter: true, showHint: false })
    values.fadeMs = 9000
    assert.equal(injectedConfig(host).fadeMs, 5000)
    values.fadeMs = Infinity
    values.enterMode = 'unsupported'
    assert.equal(injectedConfig(host).fadeMs, 2000)
    assert.equal(injectedConfig(host).enterMode, 'tail')
    const response = await request(host.routes.get('exact:/plugins/dsh-boot-animation/clips.json'), 'GET', '/plugins/dsh-boot-animation/clips.json')
    assert.equal(response.headers['cache-control'], 'no-store')
    const clips = JSON.parse(response.body).clips
    assert.equal(clips.length, 1)
    assert.equal(clips[0].name, 'fixture.mp4')
    assert.equal(clips[0].bytes, 128)
    assert.equal(clips[0].enabled, false)
    assert.match(clips[0].src, /^\/plugins\/dsh-boot-animation\/clip\/fixture\.mp4\?v=\d+-128$/)
    values.disabledClips = []
    const updated = await request(host.routes.get('exact:/plugins/dsh-boot-animation/clips.json'), 'GET', '/plugins/dsh-boot-animation/clips.json')
    assert.equal(JSON.parse(updated.body).clips[0].enabled, true)
    values.enabled = false
    assert.deepEqual(host.injections(), [])
    host.dispose()
  })

  await check('Clip GET, HEAD, inclusive Range, suffix Range, and 416 preserve transport contracts', async () => {
    const host = hostFixture()
    plugin.apply(host.ctx)
    const route = host.routes.get('prefix:/plugins/dsh-boot-animation/clip')
    const full = await request(route, 'GET', '/plugins/dsh-boot-animation/clip/fixture.mp4')
    assert.equal(full.status, 200)
    assert.deepEqual(full.body, bytes)
    assert.equal(full.headers['cache-control'], 'no-store')
    const head = await request(route, 'HEAD', '/plugins/dsh-boot-animation/clip/fixture.mp4')
    assert.equal(head.status, 200)
    assert.equal(head.headers['content-length'], '128')
    assert.equal(head.headers['cache-control'], 'no-store')
    assert.equal(head.body.length, 0)
    const range = await request(route, 'GET', '/plugins/dsh-boot-animation/clip/fixture.mp4', 'bytes=32-47')
    assert.equal(range.status, 206)
    assert.equal(range.headers['content-range'], 'bytes 32-47/128')
    assert.equal(range.headers['cache-control'], 'no-store')
    assert.deepEqual(range.body, bytes.subarray(32, 48))
    const suffix = await request(route, 'GET', '/plugins/dsh-boot-animation/clip/fixture.mp4', 'bytes=-4')
    assert.equal(suffix.status, 206)
    assert.equal(suffix.headers['cache-control'], 'no-store')
    assert.deepEqual(suffix.body, bytes.subarray(124))
    const unsatisfiable = await request(route, 'GET', '/plugins/dsh-boot-animation/clip/fixture.mp4', 'bytes=128-')
    assert.equal(unsatisfiable.status, 416)
    assert.equal(unsatisfiable.headers['cache-control'], 'no-store')
    assert.equal(unsatisfiable.headers['content-range'], 'bytes */128')
    assert.equal(unsatisfiable.body.length, 0)
    const missing = await request(route, 'GET', '/plugins/dsh-boot-animation/clip/missing.mp4')
    assert.equal(missing.status, 404)
    assert.equal(missing.headers['cache-control'], 'no-store')
    host.dispose()
  })

  await check('clientReady precedes React or optional-service failure without a required client inject', () => {
    for (const reactFailure of [true, false]) {
      const browser = browserFixture(bundle, { reactFailure })
      assert.equal(browser.client.inject, undefined)
      browser.client.apply({ inject() { browser.stages.push('optional'); throw new Error('optional services absent') } })
      assert.equal(browser.stages[0], 'clientReady')
      assert.equal(browser.stages.filter((stage) => stage === 'clientReady').length, 1)
      browser.dispose()
    }
  })

  await check('plugins.item contribution exists only while configForms namespace is served and disposes', () => {
    const browser = browserFixture(bundle)
    const form = formFixture(ready())
    const services = servicesFixture(form.form)
    browser.client.apply(services.ctx)
    assert.deepEqual(services.dependencyCalls, [['slots', 'configForms']])
    assert.equal(services.registrations.size, 0)
    services.setServed(true)
    assert.equal(services.registrations.size, 1)
    assert.equal(services.registrations.get('boot-animation').options.inject().scope, form.form)
    services.setServed(false)
    assert.equal(services.registrations.size, 0)
    services.setServed(true)
    assert.equal(services.registrations.size, 1)
    services.dispose()
    assert.equal(services.registrations.size, 0)
    services.setServed(false)
    services.setServed(true)
    assert.equal(services.registrations.size, 0)
    browser.dispose()
  })

  await check('Supplied page form owns state and one refused revision-fenced write without retry', async () => {
    const supplied = pageFormFixture(ready({ enabled: false }, 'page-r3'), false)
    const scope = formFixture(ready({ enabled: true }, 'scope-r8'))
    const card = cardFixture(scope.form, supplied.form)
    const control = enabledControl(card.open())
    assert.equal(control.props.checked, false)
    assert.equal(control.props.disabled, false)
    control.props.onChange({ target: { checked: true } })
    await flushPromises()
    assert.deepEqual(plain(supplied.writes), [{ ops: [{ op: 'set', path: ['enabled'], value: true }], revision: 'page-r3' }])
    assert.equal(scope.writes.length, 0)
    assert.equal(scope.reads.length, 0)
    assert.equal(scope.subscriptions(), 0)
    const after = card.render()
    assert(nodes(after, (node) => node.props?.key === 'failure').length > 0)
    await flushPromises()
    card.render()
    assert.equal(supplied.writes.length, 1, 'refused mutation must not retry')
    card.dispose()
  })

  await check('Official page form receives fresh parent-supplied state and revision after accepted mutation', async () => {
    const supplied = pageFormFixture(ready({ enabled: true }, 'page-r1'))
    const scope = formFixture(ready({ enabled: false }, 'scope-r1'))
    const card = cardFixture(scope.form, supplied.form)
    enabledControl(card.open()).props.onChange({ target: { checked: false } })
    await flushPromises()
    assert.equal(supplied.writes.length, 1)
    card.replaceForm({ state: ready({ enabled: false }, 'page-r2'), mutate: supplied.form.mutate })
    const updated = enabledControl(card.render())
    assert.equal(updated.props.checked, false)
    updated.props.onChange({ target: { checked: true } })
    await flushPromises()
    assert.deepEqual(plain(supplied.writes), [
      { ops: [{ op: 'set', path: ['enabled'], value: false }], revision: 'page-r1' },
      { ops: [{ op: 'set', path: ['enabled'], value: true }], revision: 'page-r2' },
    ])
    assert.equal(scope.writes.length, 0)
    assert.equal(scope.reads.length, 0)
    card.dispose()
  })

  await check('Without page form the namespace scope owns reads and mutation coherently', async () => {
    const scope = formFixture(ready({ enabled: true }, 'scope-r2'))
    const card = cardFixture(scope.form)
    const control = enabledControl(card.open())
    assert.equal(control.props.checked, true)
    control.props.onChange({ target: { checked: false } })
    await flushPromises()
    assert.deepEqual(plain(scope.writes), [{ ops: [{ op: 'set', path: ['enabled'], value: false }], revision: 'scope-r2' }])
    assert.equal(scope.subscriptions(), 1)
    card.dispose()
  })

  await check('Missing/null revision, unavailable, readonly, and non-mutating forms disable writes', async () => {
    for (const snapshot of [
      { ...ready(), revision: undefined }, { ...ready(), revision: null },
      { ...ready(), status: 'unavailable' }, { ...ready(), writable: false },
    ]) {
      const form = formFixture(snapshot)
      const card = cardFixture(form.form)
      const control = enabledControl(card.open())
      assert.equal(control.props.disabled, true)
      control.props.onChange({ target: { checked: false } })
      await flushPromises()
      assert.equal(form.writes.length, 0)
      card.dispose()
    }
    const scope = formFixture(ready())
    const supplied = pageFormFixture(ready())
    delete supplied.form.mutate
    const card = cardFixture(scope.form, supplied.form)
    const control = enabledControl(card.open())
    assert.equal(control.props.disabled, true)
    control.props.onChange({ target: { checked: false } })
    await flushPromises()
    assert.equal(scope.writes.length, 0, 'page form must not borrow a writable scope')
    card.dispose()
  })

  await check('Collapsed card performs no manifest or media probe work', () => {
    const scope = formFixture(ready())
    const card = cardFixture(scope.form)
    card.render()
    card.browser.flushEffects()
    assert.equal(card.browser.fetches.length, 0)
    assert.equal(card.browser.media.length, 0)
    card.dispose()
  })

  async function openedProbeCard() {
    const scope = formFixture(ready())
    const card = cardFixture(scope.form)
    card.browser.setManifest([{ name: 'fixture.mp4', src: '/disposable/fixture.mp4', bytes: 128, enabled: true }])
    card.render(); card.browser.flushEffects()
    card.open(); card.browser.flushEffects()
    await flushPromises()
    card.render(); card.browser.flushEffects()
    assert.equal(card.browser.fetches.length, 1)
    assert.equal(card.browser.fetches[0].url, '/plugins/dsh-boot-animation/clips.json')
    assert.equal(card.browser.fetches[0].options.cache, 'no-store')
    assert.equal(card.browser.media.length, 1)
    return card
  }

  await check('Detached probes require decoded data, retain metadata, and release resources after success', async () => {
    const card = await openedProbeCard()
    const media = card.browser.media[0]
    assert.equal(media.isConnected, false)
    assert.equal(media.muted, true)
    assert.equal(card.browser.timers.size, 1, 'fulfilled play alone cannot settle the probe')
    media.dispatch('loadedmetadata')
    assert.equal(card.browser.timers.size, 1)
    media.readyState = 2; media.videoWidth = 640
    media.dispatch('loadeddata')
    assert.equal(card.browser.timers.size, 0)
    assert.equal(media.src, undefined)
    assert.equal(media.pausedCount, 1)
    assert.equal(media.releasedCount, 1)
    const tree = card.render()
    assert(nodes(tree, (node) => node.props?.className === 'dshba-badge' && node.props.children.includes('12.50s')).length > 0)
    assert.equal(nodes(tree, (node) => node.props?.key === 'noframe' || node.props?.key === 'refused').length, 0)
    card.dispose()
    assert.equal(media.listeners.size, 0)
    assert.equal(card.browser.timers.size, 0)
    media.dispatch('error')
  })

  await check('Detached probe timeout and refusal settle once and unmount removes listeners and timers', async () => {
    for (const event of ['timeout', 'error']) {
      const card = await openedProbeCard()
      const media = card.browser.media[0]
      media.dispatch('loadedmetadata')
      if (event === 'timeout') {
        const timer = [...card.browser.timers.values()][0]
        assert.equal(timer.delay, 6000)
        timer.fn()
      } else media.dispatch('error')
      assert.equal(card.browser.timers.size, 0)
      assert.equal(media.src, undefined)
      assert.equal(media.pausedCount, 1)
      media.readyState = 2; media.videoWidth = 640; media.dispatch('canplay')
      assert.equal(media.pausedCount, 1, 'settled probe cannot decide twice')
      const tree = card.render()
      assert(nodes(tree, (node) => node.props?.key === (event === 'timeout' ? 'noframe' : 'refused')).length > 0)
      assert(nodes(tree, (node) => node.props?.className === 'dshba-badge' && node.props.children.includes('12.50s')).length > 0)
      card.dispose()
      assert.equal(media.listeners.size, 0)
      assert.equal(card.browser.timers.size, 0)
    }
    const pending = await openedProbeCard()
    pending.dispose()
    assert.equal(pending.browser.timers.size, 0)
    assert.equal(pending.browser.media[0].listeners.size, 0)
    assert.equal(pending.browser.media[0].src, undefined)
  })

  const wrapperEqualsSource = () => {
    const source = readFileSync(join(packageRoot, 'src/client.js'), 'utf8')
    const prefix = 'window.__ModuleLoader__.load({ id: "dsh-boot-animation", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;\n'
    const suffix = '\nreturn module.exports; } });\n'
    assert.equal(bundle, prefix + source + suffix)
  }
  await check('Client wrapper equals its source and original boot-screen and video bytes are preserved', () => {
    wrapperEqualsSource()
    for (const [relative, expected] of Object.entries(originalHashes)) {
      assert.equal(hash(readFileSync(join(packageRoot, relative))), expected, relative)
    }
    for (const relative of relativeFiles) assert.equal(hash(readFileSync(join(packageRoot, relative))), packageBefore[relative], relative)
  })
} finally {
  await rm(scratch, { recursive: true, force: true })
}

const failed = results.filter((result) => result.status === 'failed')
process.stdout.write(JSON.stringify({
  scope: 'offline stubs only; not official Desktop GUI, real DSH, React, schemastery, or media-decoder acceptance',
  selection: 'full public distribution fixture',
  package: { name: metadata.name, version: metadata.version },
  target: { dsh: '0.2.0-rc.2', schemastery: '3.18.4' },
  stubs: ['schema declaration chains', 'Host service and transport', 'React hooks', 'configForms and slots lifecycle', 'detached media events and timers'],
  socketOpened: false, officialAppLaunched: false, modelRequested: false,
  count: results.length, passed: results.length - failed.length, failed: failed.length,
  scratchCleaned: true, originalHashes, testedFiles: packageBefore, results,
}, null, 2) + '\n')
if (failed.length) process.exitCode = 1
