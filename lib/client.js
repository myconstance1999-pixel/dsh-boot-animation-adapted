window.__ModuleLoader__.load({ id: "dsh-boot-animation", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-boot-animation — browser half.
//
// Two jobs, in this order and with this priority:
//
//   1. Report the browser roster's activation to the injected pre-boot screen
//      (`clientReady`). That call is part of the screen's hand-off condition, so
//      it happens first, unconditionally, and cannot be delayed or prevented by
//      anything below it.
//   2. Contribute the settings card to the Plugins settings page.
//
// Everything about job 2 is optional by construction. This package does not
// declare `inject`, because a required service would leave the fiber PENDING in
// a profile that lacks it — and then job 1 would never run, the screen would
// never learn the kernel is ready, and the animation would sit there refusing to
// hand over. The services are therefore reached with the dynamic
// `ctx.inject(deps, callback)` form, which waits for them without gating `apply`:
// the callback fires once both arrive, and simply never fires if they do not.
//
// Await optional services through ctx.inject and read them from its owner.
// The settings card is served only while configForms exposes its namespace.
//
// Bundle artifact contract: the shell materializes this file as a closure
// factory (`window.__ModuleLoader__.load({ id, factory })`), so `require` is a
// parameter supplied by the shell's module table. `react` is one of the baseline
// modules every dynamic bundle may request (packages/client/web/src/platform.ts),
// so asking for it needs no declaration in package.json.

const OVERLAY = '__DSH_BOOT_ANIM__'

/** Settings namespace supplied by the Host patch entry id. */
const SETTINGS_NAMESPACE = 'boot-animation'

// Official DSH 0.2.0-rc.2 Plugins page slot.
const SLOT = 'plugins.item'

/** Where the clip pool is published, relative to the page. */
const MANIFEST = '/plugins/dsh-boot-animation/clips.json'

/** Offered dissolve lengths, in milliseconds. */
const FADE_CHOICES = [1000, 1500, 2000, 3000, 4000]

/** The three hand-off styles, with the sentence that explains each one. */
const ENTER_MODES = [
  ['tail', '片尾交叉溶解', '片尾开始溶解，影片放完时正好进界面'],
  ['end', '放完再淡', '影片完全静止在最后一帧，再淡出'],
  ['click', '点击才进', '循环播放，直到你点一下进入'],
]

/**
 * The three behaviour switches, in card order.
 *
 * Each entry is the field name, its label, and the pair of sentences under it —
 * the one for "on" and the one for "off" — because a switch whose explanation
 * does not change with its state is the reason people leave it alone.
 */
const BEHAVIOUR = [
  ['sound', '播放影片声音',
    '影片尝试带声音播放，右下角有一个开声音的按钮',
    '已彻底静音：不会尝试开声音，声音按钮也不再出现'],
  ['clickToEnter', '点鼠标直接进入',
    '按一下画面就直接进入界面，不再用第一下开声音',
    '按一下先开声音，再按一下才进入（默认）'],
  ['showHint', '显示底部提示文字',
    '画面底部显示「点击进入」这类操作提示',
    '底部不再显示操作提示，标题和进度条保留'],
]

/** Stable empty snapshot, so `getSnapshot` never returns a fresh object. */
const NO_SNAPSHOT = Object.freeze({
  status: 'unavailable', value: undefined, base: undefined, user: undefined,
  revision: undefined, writable: false, mode: 'host',
})

const STYLE_ID = 'dsh-boot-animation-card-style'

// No backticks in this sheet: it is a plain string, but the surrounding project
// convention is that a stray backtick in a CSS blob has already cost this plugin
// one silent build failure.
//
// The token names and the geometry are copied from the harness's own plugin card
// (ui-settings-plugins/src/client/PluginCard.module.css) so this card reads as a
// shipped one rather than a guest: same border, radius, layer colours, header
// metrics and chevron motion. Each token keeps a literal fallback for a page that
// has no theme loaded.
const CSS = [
  '.dshba-card{list-style:none;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));',
  'border-radius:16px;background:var(--dsw-alias-bg-layer-3,transparent);',
  'transition:border-color .16s,background .16s;font-family:inherit}',
  '.dshba-card:hover{border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshba-card[data-open="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07));',
  'border-color:var(--dsw-alias-label-dimmed,rgba(127,127,127,.5))}',
  '.dshba-head{width:100%;appearance:none;border:0;background:none;font:inherit;color:inherit;',
  'text-align:left;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px}',
  '.dshba-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f9dd9);outline-offset:-2px}',
  '.dshba-headtext{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
  '.dshba-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,inherit)}',
  '.dshba-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshba-chev{flex:none;width:7px;height:7px;margin-right:3px;',
  'border-right:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'border-bottom:1.5px solid var(--dsw-alias-label-tertiary,rgba(127,127,127,.9));',
  'transform:rotate(45deg);transition:transform .16s}',
  '.dshba-card[data-open="1"] .dshba-chev{transform:rotate(225deg)}',
  '.dshba-body{border-top:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
  'margin:0 16px;padding:14px 0 10px}',
  '.dshba-sec{margin:0 0 18px}',
  '.dshba-sec:last-child{margin-bottom:4px}',
  '.dshba-h{font-size:13px;font-weight:600;line-height:1.5;margin:0 0 3px;',
  'color:var(--dsw-alias-label-primary,inherit)}',
  '.dshba-p{margin:0 0 10px;font-size:12px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.9))}',
  '.dshba-row{display:flex;flex-wrap:wrap;gap:6px}',
  '.dshba-switch{display:inline-flex;align-items:center;gap:9px;cursor:pointer}',
  '.dshba-switch input{margin:0;flex:none}',
  '.dshba-opt{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:none;',
  'color:inherit;border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}',
  '.dshba-opt:hover:not(:disabled){background:rgba(127,127,127,.14)}',
  '.dshba-opt[data-on="1"]{border-color:var(--dsw-alias-brand-primary,#07974b);',
  'color:var(--dsw-alias-brand-primary,#07974b);font-weight:600;background:rgba(7,193,96,.1)}',
  '.dshba-opt:disabled{opacity:.45;cursor:default}',
  '.dshba-clip{display:flex;align-items:center;gap:9px;padding:6px 2px;border-radius:8px}',
  '.dshba-clip input{margin:0;flex:none}',
  '.dshba-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dshba-badge{font-size:11px;line-height:1.5;padding:1px 7px;border-radius:999px;white-space:nowrap;',
  'background:rgba(127,127,127,.18);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.95))}',
  '.dshba-badge.warn{background:rgba(210,120,40,.18);color:#b46214}',
  '.dshba-badge.bad{background:rgba(210,74,67,.18);color:#d24a43}',
  '.dshba-badge.ok{background:rgba(7,150,90,.18);color:#07974b}',
  '.dshba-clipline{display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:pointer}',
  '.dshba-mini{flex:none;padding:3px 10px;font-size:11.5px}',
  '.dshba-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));white-space:nowrap}',
  '.dshba-msg{margin-top:8px;font-size:11.5px;line-height:1.5;',
  'color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8))}',
  '.dshba-msg.err{color:var(--dsw-alias-label-error,#d24a43)}',
].join('')

/** Install the card's stylesheet once per document. */
function ensureStyle() {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** Human-readable byte count. */
function formatBytes(value) {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '-'
  if (value < 1024) return String(value) + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB'
  return (value / 1024 / 1024).toFixed(2) + ' MB'
}

/** Human-readable clip length, or a status word while it is unknown. */
function formatDuration(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return '…'
  return seconds.toFixed(2) + 's'
}

/** The summary and page are separate components so their hooks cannot mix. */
function BootAnimationEntry(props) {
  return props.view === 'summary'
    ? '短片、声音、进入方式与素材池'
    : props.runtime.createElement(BootAnimationCard, props)
}

/** Bind the page form first, otherwise its namespace scope; never use direct RPC. */
function cardForm(props) {
  const binding = props.form ?? props.scope
  const observable = binding !== undefined && binding !== null
    && typeof binding.subscribe === 'function' && typeof binding.getSnapshot === 'function'
  const fallback = binding?.state ?? (typeof binding?.getSnapshot === 'function'
    ? binding.getSnapshot() : NO_SNAPSHOT)
  return {
    source: observable ? binding : null,
    fallback,
    mutate: typeof binding?.mutate === 'function'
      ? (ops, revision) => binding.mutate(ops, revision) : null,
  }
}

/**
 * The card.
 *
 * Collapsed by default, like every other card on this page: the Plugins section
 * is a list of plugins, and one that unfolds its controls on arrival pushes
 * everything below it out of view. Disclosure is card-local state — which card a
 * user has open is a reading gesture that neither the Host nor the section has
 * any stake in.
 *
 * Reads ride an observable source (see `cardForm`), whose snapshot reference is
 * stable until the fact moves, which is the contract React needs. The
 * subscription is taken directly with `useSyncExternalStore` rather than through
 * the renderer's `use<Name>` binding, because a package outside this repository
 * cannot depend on that binding existing for it.
 * @param props - the slot's inject face plus the page's owner props.
 * @returns the card element.
 */
function BootAnimationCard(props) {
  const React = props.runtime
  const [open, setOpen] = React.useState(false)
  const [pool, setPool] = React.useState(null)
  const [lengths, setLengths] = React.useState({})
  const [failure, setFailure] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  // The clip whose full-screen preview is on screen right now, or null. A preview
  // covers the whole page, so this is what tells the card to stop offering another
  // one — and what the overlay's own `onDone` clears.
  const [previewing, setPreviewing] = React.useState(null)

  ensureStyle()

  const form = cardForm(props)
  const source = form.source
  const subscribe = React.useCallback(
    (listener) => (source === null ? function () {} : source.subscribe(listener)),
    [source],
  )
  const readSnapshot = React.useCallback(
    () => (source === null ? form.fallback : source.getSnapshot()),
    [source, form.fallback],
  )
  const snapshot = React.useSyncExternalStore(subscribe, readSnapshot)
  const stored = (snapshot && snapshot.value) || {}
  const editingBlocked = form.mutate === null || snapshot?.writable !== true
    || snapshot?.status !== 'ready' || snapshot.revision === undefined || snapshot.revision === null
  const enabled = stored.enabled !== false
  const fadeMs = typeof stored.fadeMs === 'number' ? stored.fadeMs : 2000
  const enterMode = typeof stored.enterMode === 'string' ? stored.enterMode : 'tail'
  const disabled = Array.isArray(stored.disabledClips) ? stored.disabledClips : []
  // Each switch is read the way the Host reads it: absent means the documented
  // default, so a profile written before these fields existed renders them on.
  const sound = stored.sound !== false
  const clickToEnter = stored.clickToEnter === true
  const showHint = stored.showHint !== false
  const behaviour = { sound, clickToEnter, showHint }


  // The pool, and each clip's real length. The length comes from a throwaway media
  // element rather than parsed out of the file: the browser's own decode is the
  // only answer that also tells the user whether this clip can play at all.
  //
  // Both effects are gated on `open` so a collapsed card costs nothing. A manifest
  // read plus three media probes per card, on a settings page that lists every
  // plugin, is not worth paying for a row nobody has opened.
  React.useEffect(() => {
    if (!open || pool !== null) return undefined
    let live = true
    fetch(MANIFEST, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { clips: [] }))
      .then((payload) => { if (live) setPool(Array.isArray(payload.clips) ? payload.clips : []) })
      .catch((error) => { if (live) setFailure('读取素材池失败：' + String(error)) })
    return () => { live = false }
  }, [open, pool])

  React.useEffect(() => {
    if (!open || pool === null) return undefined
    const probes = pool.map((clip) => {
      const element = document.createElement('video')
      element.muted = true
      element.preload = 'auto'
      let active = true
      let decided = false
      let timer = null
      const settle = (patch) => {
        if (active) setLengths((current) => Object.assign({}, current, {
          [clip.name]: Object.assign({}, current[clip.name], patch),
        }))
      }
      const finish = (patch) => {
        if (!active || decided) return
        decided = true
        if (timer !== null) clearTimeout(timer)
        settle(patch)
        try { element.pause() } catch (error) { /* already stopped */ }
        element.removeAttribute('src')
        try { element.load() } catch (error) { /* release is best-effort */ }
      }
      const onRefused = () => finish({ refused: true })
      const onMeta = () => settle({ seconds: element.duration })
      // Detached video elements need not receive a presented-frame callback in
      // the browser. Decoded current-frame data is sufficient, as in the boot path.
      // A fulfilled play() promise alone never marks a clip as decoded.
      const onDecoded = () => {
        if (element.readyState >= 2 && element.videoWidth > 0) finish({ played: true })
      }
      element.addEventListener('error', onRefused)
      element.addEventListener('loadedmetadata', onMeta)
      element.addEventListener('loadeddata', onDecoded)
      element.addEventListener('canplay', onDecoded)
      timer = setTimeout(() => finish({ noFrame: true }), 6000)
      element.src = clip.src
      try {
        const attempt = element.play()
        if (attempt !== undefined && typeof attempt.catch === 'function') attempt.catch(onRefused)
      } catch (error) { onRefused() }
      onDecoded()
      return () => {
        active = false
        if (timer !== null) clearTimeout(timer)
        element.removeEventListener('error', onRefused)
        element.removeEventListener('loadedmetadata', onMeta)
        element.removeEventListener('loadeddata', onDecoded)
        element.removeEventListener('canplay', onDecoded)
        try { element.pause() } catch (error) { /* already stopped */ }
        element.removeAttribute('src')
        try { element.load() } catch (error) { /* release is best-effort */ }
      }
    })
    return () => { for (const dispose of probes) dispose() }
  }, [open, pool])

  /** One revision-fenced write; a refusal is reported without retrying. */
  const write = (field, value) => {
    if (editingBlocked) {
      setFailure('当前页面不允许保存启动动画设置。')
      return
    }
    setBusy(true)
    setFailure(null)
    const revision = snapshot.revision
    const ops = [{ op: 'set', path: [field], value }]
    Promise.resolve().then(() => form.mutate(ops, revision))
      .then((accepted) => {
        if (accepted === false) setFailure('保存失败：本部署没有接受这次修改，请刷新后重试。')
      })
      .catch((error) => setFailure('保存失败：' + String(error)))
      .then(() => setBusy(false))
  }

  const toggleClip = (name, enabled) => {
    const next = enabled ? disabled.filter(entry => entry !== name) : disabled.concat([name])
    // Switching every clip off would leave the screen with nothing to play, so the
    // last enabled one cannot be turned off from here.
    if (pool !== null && next.length >= pool.length) {
      setFailure('至少要留一条素材参与随机。')
      return
    }
    write('disabledClips', next)
  }

  /**
   * Play this clip as the real boot animation, full screen, right now.
   *
   * The overlay is the one the page already carries (`__DSH_BOOT_ANIM__`, installed
   * by the injected head script): it is asked to run a second time, for this clip,
   * with the settings the card is showing at this moment — so the fade, the enter
   * mode, the hint line and the sound behaviour are the live ones rather than the
   * ones this page happened to be served with. It leaves by the same dissolve a real
   * start uses, then calls back, which is when the button becomes pressable again.
   *
   * The one failure worth naming: a page loaded BEFORE this feature existed has the
   * old overlay in memory, whose namespace has no `preview`. Saying so beats a
   * button that appears to do nothing.
   * @param name - the clip's file name, exactly as the manifest published it.
   */
  const preview = (name) => {
    const overlay = globalThis[OVERLAY]
    if (overlay === null || overlay === undefined || typeof overlay.preview !== 'function') {
      setFailure('这一页的入场层还没有预览接口（页面是在这次改动之前加载的）：刷新页面后再点。')
      return
    }
    setFailure(null)
    setPreviewing(name)
    let started = false
    try {
      started = overlay.preview({
        name,
        fadeMs,
        enterMode,
        sound,
        clickToEnter,
        showHint,
        onDone: () => setPreviewing(null),
      }) === true
    } catch (error) {
      setPreviewing(null)
      setFailure('预览没能启动：' + String(error))
      return
    }
    if (!started) {
      setPreviewing(null)
      setFailure('已经有一个预览在跑了，等它结束再点。')
    }
  }

  /**
   * One behaviour switch: label, checkbox, and the sentence for the state it is
   * currently in. A plain factory rather than a component — it calls no hooks,
   * which is what lets the card's hook count stay the same for every render.
   */
  const switchRow = (field, label, onNote, offNote) => React.createElement('div', {
    className: 'dshba-sec',
    key: field,
  },
  React.createElement('label', { className: 'dshba-switch' },
    React.createElement('input', {
      type: 'checkbox',
      checked: behaviour[field],
      disabled: busy || editingBlocked,
      onChange: (event) => write(field, event.target.checked),
    }),
    React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, label)),
  React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
    behaviour[field] ? onNote : offNote))

  const header = React.createElement('button', {
    type: 'button',
    className: 'dshba-head',
    'aria-expanded': open,
    'aria-label': (open ? '收起' : '展开') + '：启动动画',
    onClick: () => { setOpen(!open) },
  },
  React.createElement('span', { className: 'dshba-headtext' },
    React.createElement('span', { className: 'dshba-name' }, '启动动画'),
    React.createElement('span', { className: 'dshba-desc' }, '短片、进入方式与素材池')),
  React.createElement('span', { className: 'dshba-chev' }))

  try {
    if (!open) {
      return React.createElement('li', { className: 'dshba-card', 'data-open': '0' }, header)
    }

    const sections = []

    // The switch comes first because it is the only setting that changes whether
    // any of the others run at all.
    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'enabled' },
      React.createElement('label', { className: 'dshba-switch' },
        React.createElement('input', {
          type: 'checkbox',
          checked: enabled,
          disabled: busy || editingBlocked,
          onChange: (event) => write('enabled', event.target.checked),
        }),
        React.createElement('span', { className: 'dshba-h', style: { margin: '0' } }, '开启启动动画')),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '6px', marginBottom: '0' } },
        enabled
          ? '关掉并刷新页面，就会回到 DSH 原生启动页'
          : '已关闭：刷新页面后就是 DSH 原生启动页，下面的设置暂时不生效')))

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'behaviour-head' },
      React.createElement('div', { className: 'dshba-h' }, '交互与声音'),
      React.createElement('div', { className: 'dshba-p', style: { marginBottom: '0' } },
        '三项都在下次刷新页面时生效')))
    for (const entry of BEHAVIOUR) {
      sections.push(switchRow(entry[0], entry[1], entry[2], entry[3]))
    }

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'fade' },
      React.createElement('div', { className: 'dshba-h' }, '淡入时长'),
      React.createElement('div', { className: 'dshba-row' },
        FADE_CHOICES.map(choice => React.createElement('button', {
          key: choice,
          type: 'button',
          className: 'dshba-opt',
          'data-on': choice === fadeMs ? 1 : 0,
          disabled: busy || editingBlocked,
          onClick: () => write('fadeMs', choice),
        }, (choice / 1000) + ' 秒'))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
        enterMode === 'tail'
          ? '15 秒的片子会在 ' + ((15000 - fadeMs) / 1000) + ' 秒开始溶解，15 秒正好进界面'
          : '改动在下次刷新页面时生效')))

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'mode' },
      React.createElement('div', { className: 'dshba-h' }, '进入方式'),
      React.createElement('div', { className: 'dshba-row' },
        ENTER_MODES.map(entry => React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: 'dshba-opt',
          'data-on': entry[0] === enterMode ? 1 : 0,
          disabled: busy || editingBlocked,
          onClick: () => write('enterMode', entry[0]),
        }, entry[1]))),
      React.createElement('div', { className: 'dshba-p', style: { marginTop: '8px', marginBottom: '0' } },
        (ENTER_MODES.filter(entry => entry[0] === enterMode)[0] || ['', '', ''])[2])))

    const clipNodes = []
    if (pool === null) {
      clipNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'loading' }, '正在读取…'))
    } else if (pool.length === 0) {
      clipNodes.push(React.createElement('div', { className: 'dshba-msg', key: 'empty' },
        '素材池是空的。把 mp4 放进 assets/videos/ 再刷新这一页。'))
    } else {
      for (const clip of pool) {
        const known = lengths[clip.name] || {}
        // The duration is the row's primary fact, so it is shown whenever the
        // probe has it; a problem is an ADDITIONAL badge rather than a replacement
        // for it. Reporting "unplayable" in place of the length meant a probe bug
        // cost the user the information they actually came for.
        const badges = [React.createElement('span', { className: 'dshba-badge', key: 'len' },
          formatDuration(known.seconds))]
        if (known.refused === true) {
          badges.push(React.createElement('span', {
            className: 'dshba-badge bad',
            key: 'refused',
            title: '浏览器拒绝解码这一段：可能是编码档次不被支持，或文件不完整。',
          }, '浏览器播不了'))
        } else if (known.noFrame === true) {
          // Started, then never painted: the failure that leaves the boot screen on
          // its background. Distinct from a refused clip, and worth saying so.
          badges.push(React.createElement('span', {
            className: 'dshba-badge warn',
            key: 'noframe',
            title: '在这台浏览器里 6 秒内没有解码出首帧。'
              + '这种片子放启动动画时只会看到背景色。',
          }, '一直没有画面'))
        }
        if (clip.faststart === false) {
          badges.push(React.createElement('span', {
            className: 'dshba-badge warn',
            key: 'moov',
            title: '索引表(moov)在文件末尾：浏览器要整段下载完才出画面。'
              + '本地候选保留原片，不重排媒体文件。',
          }, '索引在片尾'))
        }
        // The button is a SIBLING of the label, never a child of it: a button
        // nested in a label is an interactive element inside a control, and a click
        // on it then becomes a question about label activation rather than about
        // the button.
        clipNodes.push(React.createElement('div', { className: 'dshba-clip', key: clip.name },
          React.createElement('label', { className: 'dshba-clipline', title: clip.name },
            React.createElement('input', {
              type: 'checkbox',
              // Read from the SETTINGS, not from the manifest field. The manifest is
              // fetched once when the card opens, so binding the box to its `enabled`
              // value meant a write never changed what the box displayed: the change
              // persisted and only appeared after the dialog was reopened, which is
              // exactly how that was reported.
              checked: !disabled.includes(clip.name),
              disabled: busy || editingBlocked,
              onChange: (event) => toggleClip(clip.name, event.target.checked),
            }),
            React.createElement('span', { className: 'dshba-nm' }, clip.name),
            badges),
          // 预览 on EVERY row: whether a clip's index sits at the front has nothing
          // to do with how it looks as the boot animation, and the preview is the
          // only way to judge that without restarting DSH.
          React.createElement('button', {
            type: 'button',
            className: 'dshba-opt dshba-mini',
            disabled: previewing !== null,
            title: '现在就把这一段当作启动动画满屏跑一遍：按当前设置演一遍真实的入场过渡。',
            onClick: () => preview(clip.name),
          }, previewing === clip.name ? '预览中…' : '预览'),
          React.createElement('span', { className: 'dshba-meta' }, formatBytes(clip.bytes))))
      }
    }

    sections.push(React.createElement('div', { className: 'dshba-sec', key: 'pool' },
      React.createElement('div', { className: 'dshba-h' }, '素材池'),
      React.createElement('div', { className: 'dshba-p' }, '勾选的素材参与随机轮播；取消勾选的只留在文件夹里，不再被抽中。'),
      clipNodes))

    if (failure !== null) {
      sections.push(React.createElement('div', { className: 'dshba-msg err', key: 'failure' }, failure))
    }
    if (snapshot && snapshot.status === 'unavailable') {
      sections.push(React.createElement('div', { className: 'dshba-msg', key: 'unavailable' },
        '这一页连不上设置文档，改动不会保存。'))
    }
    if (snapshot && snapshot.writable === false) {
      sections.push(React.createElement('div', { className: 'dshba-msg', key: 'readonly' },
        '当前页面不允许写入设置文档。'))
    }

    return React.createElement('li', { className: 'dshba-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshba-body' }, sections))
  } catch (error) {
    // A card that cannot draw itself must still leave the settings page usable.
    return React.createElement('li', { className: 'dshba-card', 'data-open': '1' },
      header,
      React.createElement('div', { className: 'dshba-body' },
        '启动动画设置面板渲染失败：' + String(error && error.message ? error.message : error)))
  }
}

/**
 * Read one awaited service from the injected owner context.
 *
 * `get` first, because that is the form every working plugin in this deployment
 * uses and the property proxy is topology-sensitive; the property is the fallback
 * for a context that has the service declared.
 * @param owner - the context passed to the inject callback.
 * @param name - service name.
 * @returns the service, or undefined when it is not reachable.
 */
function serviceAt(owner, name) {
  try {
    if (owner !== null && owner !== undefined && typeof owner.get === 'function') {
      const value = owner.get(name)
      if (value !== undefined && value !== null) return value
    }
  } catch (error) {
    // A global-store miss is the expected miss; the property may still answer.
  }
  try {
    return owner === null || owner === undefined ? undefined : owner[name]
  } catch (error) {
    return undefined
  }
}

/**
 * Report activation, then contribute the settings card if the shell is willing.
 * @param ctx - Client plugin context.
 */
exports.apply = function apply(ctx) {
  // 1. Priority one, and it must not be able to fail for any other reason.
  try {
    const overlay = globalThis[OVERLAY]
    // A missing overlay means the Host half contributed nothing (for example a
    // static deployment whose boot payload carries no injection), in which case
    // the kernel boot page is the only screen and there is nothing to hand over.
    if (overlay !== undefined && typeof overlay.clientReady === 'function') {
      overlay.clientReady()
    }
  } catch (error) {
    // Never break the client roster over a decorative overlay.
    console.warn('boot-animation: client half failed', error)
  }

  // 2. Optional, and reached with the dynamic `ctx.inject` rather than `ctx.get`
  //    or a declared `inject`; see the module header for both reasons.
  try {
    let React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    if (React === null || typeof React.createElement !== 'function') return
    if (ctx === undefined || ctx === null || typeof ctx.inject !== 'function') return

    ctx.inject(['slots', 'configForms'], (owner) => {
      try {
        const slots = serviceAt(owner, 'slots')
        const forms = serviceAt(owner, 'configForms')
        if (typeof slots?.inject !== 'function' || typeof slots?.register !== 'function') return
        if (typeof forms?.get !== 'function' || typeof forms?.whileServed !== 'function') return

        let registration = null
        const contribute = () => {
          if (registration !== null) return
          try {
            registration = slots.inject(SLOT, () => slots.register(
              {
                name: SLOT,
                id: SETTINGS_NAMESPACE,
                order: 60,
                label: () => '启动动画',
                inject: () => ({ runtime: React, scope: forms.get(SETTINGS_NAMESPACE) }),
              },
              BootAnimationEntry,
            ))
          } catch (error) {
            registration = null
            console.warn('boot-animation: settings card not registered', error)
          }
        }
        const withdraw = () => {
          if (registration === null) return
          const dispose = registration
          registration = null
          try { if (typeof dispose === 'function') dispose() }
          catch (error) { console.warn('boot-animation: settings card not withdrawn', error) }
        }
        const serve = () => forms.whileServed([SETTINGS_NAMESPACE], () => {
          contribute()
          return withdraw
        })
        if (typeof owner.effect === 'function') owner.effect(serve, 'boot-animation: settings page')
        else serve()
      } catch (error) {
        console.warn('boot-animation: settings card not registered', error)
      }
    })
  } catch (error) {
    // The card is a convenience; the animation is the feature.
    console.warn('boot-animation: settings card wiring failed', error)
  }
}

return module.exports; } });
