// Minimal deterministic React/service/DOM faces for reachable client behavior.
// There is no renderer, browser, media decoder, RPC, network, or settings store.
import assert from 'node:assert/strict'
import vm from 'node:vm'

const equalDeps = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]))

export function browserFixture(bundle, { reactFailure = false } = {}) {
  const hooks = []
  const media = []
  const timers = new Map()
  const fetches = []
  const stages = []
  const styles = new Map()
  let cursor = 0
  let pending = []
  let manifest = []
  let nextTimer = 1
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children: children.flat(Infinity) } } },
    useState(initial) {
      const index = cursor++
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [hooks[index].value, (next) => {
        hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next
      }]
    },
    useCallback(fn, deps) {
      const index = cursor++
      if (!hooks[index] || !equalDeps(hooks[index].deps, deps)) hooks[index] = { deps, fn }
      return hooks[index].fn
    },
    useSyncExternalStore(subscribe, read) {
      const index = cursor++
      if (!hooks[index] || hooks[index].subscribe !== subscribe) {
        hooks[index]?.cleanup?.()
        hooks[index] = { subscribe, cleanup: subscribe(() => {}) }
      }
      return read()
    },
    useEffect(factory, deps) {
      const index = cursor++
      if (!hooks[index] || !equalDeps(hooks[index].deps, deps)) {
        const previous = hooks[index]
        hooks[index] = { deps, cleanup: previous?.cleanup }
        pending.push(() => {
          previous?.cleanup?.()
          hooks[index].cleanup = factory()
        })
      }
    },
  }
  const document = {
    getElementById(id) { return styles.get(id) ?? null },
    head: { appendChild(style) { styles.set(style.id, style) } },
    body: { appendChild() { throw new Error('Detached probes must never be mounted') } },
    createElement(kind) {
      if (kind === 'style') return {}
      assert.equal(kind, 'video')
      const listeners = new Map()
      const element = {
        isConnected: false, readyState: 0, videoWidth: 0, duration: 12.5,
        pausedCount: 0, releasedCount: 0,
        addEventListener(name, fn) { listeners.set(name, fn) },
        removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name) },
        dispatch(name) { listeners.get(name)?.() },
        play() { return Promise.resolve() },
        pause() { this.pausedCount += 1 },
        removeAttribute(name) { assert.equal(name, 'src'); delete this.src },
        load() { this.releasedCount += 1 },
        requestVideoFrameCallback() { throw new Error('Detached probes cannot require a presented callback') },
        listeners,
      }
      media.push(element)
      return element
    },
  }
  let client
  const sandbox = {
    document,
    console: { warn() {}, info() {} },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    fetch(url, options) { fetches.push({ url, options }); return Promise.resolve({ ok: true, json: async () => ({ clips: manifest }) }) },
    __DSH_BOOT_ANIM__: { clientReady() { stages.push('clientReady') } },
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, 'dsh-boot-animation')
      client = factory((name) => {
        stages.push('require')
        assert.equal(name, 'react')
        if (reactFailure) throw new Error('fixture React unavailable')
        return React
      })
    } } },
  }
  vm.runInNewContext(bundle, sandbox, { timeout: 1000 })
  const render = (component, props) => {
    let element = component(props)
    if (typeof element?.type === 'function') {
      cursor = 0
      element = element.type(element.props)
    }
    return element
  }
  return {
    client, React, media, timers, fetches, stages,
    setManifest(value) { manifest = value },
    render,
    flushEffects() { const current = pending; pending = []; for (const effect of current) effect() },
    dispose() { for (const hook of hooks) hook?.cleanup?.(); pending = [] },
  }
}

export function formFixture(snapshot, accepted = true) {
  const reads = []
  const writes = []
  let subscriptions = 0
  let disposals = 0
  const form = {
    subscribe() { subscriptions += 1; return () => { disposals += 1 } },
    getSnapshot() { reads.push(snapshot); return snapshot },
    mutate(ops, revision) { writes.push({ ops, revision }); return Promise.resolve(accepted) },
  }
  return { form, reads, writes, subscriptions: () => subscriptions, disposals: () => disposals }
}

export function pageFormFixture(snapshot, accepted = true) {
  const writes = []
  const form = {
    state: snapshot,
    mutate(ops, revision) { writes.push({ ops, revision }); return Promise.resolve(accepted) },
  }
  return { form, writes }
}

export function servicesFixture(scope) {
  const registrations = new Map()
  const watchers = new Set()
  const effects = []
  const dependencyCalls = []
  let served = false
  const slots = {
    inject(name, factory) { assert.equal(name, 'plugins.item'); return factory() },
    register(options, component) {
      assert.equal(options.name, 'plugins.item')
      assert(!registrations.has(options.id))
      const row = { options, component }
      registrations.set(options.id, row)
      return () => registrations.delete(options.id)
    },
  }
  const forms = {
    get(name) { assert.equal(name, 'boot-animation'); return scope },
    whileServed(names, factory) {
      assert.deepEqual(Array.from(names), ['boot-animation'])
      const watcher = { factory, cleanup: null }
      watchers.add(watcher)
      if (served) watcher.cleanup = factory(new Set(['boot-animation']))
      return () => { watcher.cleanup?.(); watchers.delete(watcher) }
    },
  }
  const owner = {
    get(name) { return { slots, configForms: forms }[name] },
    effect(factory) { effects.push(factory()) },
  }
  return {
    ctx: { inject(names, callback) { dependencyCalls.push(Array.from(names)); callback(owner) } },
    registrations, dependencyCalls,
    setServed(next) {
      if (next === served) return
      served = next
      for (const watcher of watchers) {
        if (served) watcher.cleanup = watcher.factory(new Set(['boot-animation']))
        else { watcher.cleanup?.(); watcher.cleanup = null }
      }
    },
    dispose() { for (const stop of effects.reverse()) stop?.() },
  }
}

export function nodes(root, predicate) {
  const result = []
  function walk(node) {
    if (node === null || typeof node !== 'object') return
    if (predicate(node)) result.push(node)
    for (const child of node.props?.children ?? []) walk(child)
  }
  walk(root)
  return result
}

export async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve))
}
