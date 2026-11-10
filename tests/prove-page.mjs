#!/usr/bin/env node
/**
 * Prove a page actually RUNS, rather than proving a string is present in it.
 *
 * Two pages shipped blank in one day on 2026-09-17 and every API test passed
 * both times:
 *   1. a single quote nested inside a single quoted string in an inline script,
 *      so the whole script failed to parse and nothing rendered,
 *   2. `today` used one line above its own `const`, a temporal dead zone, which
 *      parses PERFECTLY and throws at run time.
 *
 * And the first runtime check written to catch this falsely PASSED on a blank
 * page, because it grepped the dumped HTML for button labels, and those labels
 * are in the script source whether or not the script ever executes.
 *
 * So this does two things and asserts on neither strings nor HTTP status:
 *   A. extracts every inline script and runs `node --check` on it,
 *   B. runs the page in headless Chrome and asserts on RENDERED NODES, counted
 *      in the live DOM after scripts have run, plus every console error and
 *      uncaught exception.
 *
 * It drives Chrome over the DevTools protocol on a PIPE
 * (--remote-debugging-pipe, null-delimited CDP messages on fd 3 and fd 4), not
 * on a port. No debugging port is opened, nothing is listening, and it cannot
 * collide with another session. That approach and the SwiftShader flags below
 * were both learned the hard way.
 *
 *   node prove-page.mjs http://127.0.0.1:7341/
 *   node prove-page.mjs http://127.0.0.1:7341/ --expect "main .card=1" --expect "button=3"
 *   node prove-page.mjs file:///tmp/page.html --min-nodes 20 --shot /tmp/page.png
 *   node prove-page.mjs http://127.0.0.1:3210/ --gpu --advancing "window.__three.gl.info.render.frame"
 *
 * Exit code 0 only if everything asserted was observed. 1 otherwise.
 */
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p))

const argv = process.argv.slice(2)
const URL_ = argv[0]
if (!URL_ || URL_.startsWith('--')) {
  console.error('usage: node prove-page.mjs <url> [--expect "sel=n"]... [--min-nodes n] [--shot out.png] [--click sel] [--wait ms] [--advancing expr] [--gpu] [--timeout ms] [--allow-console] [--cookie name=value]')
  process.exit(1)
}
const flag = (n, d = null) => {
  const i = argv.indexOf('--' + n)
  if (i === -1) return d
  const v = argv[i + 1]
  return (v === undefined || v.startsWith('--')) ? true : v
}
const flagAll = (n) => argv.reduce((a, x, i) => (x === '--' + n && argv[i + 1] ? [...a, argv[i + 1]] : a), [])

const MIN_NODES = Number(flag('min-nodes', 5))
const TIMEOUT = Number(flag('timeout', 20000))
const EXPECT = flagAll('expect').map((s) => {
  const i = s.lastIndexOf('=')
  return i === -1 ? { sel: s, min: 1 } : { sel: s.slice(0, i), min: Number(s.slice(i + 1)) }
})

let passed = 0, failed = 0
const t = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  PASS  ${name}`) } else { failed++; console.log(`  FAIL  ${name}${extra ? ': ' + extra : ''}`) }
}

/* ------------------------------------------------------------------ *
 * A. Does the inline JavaScript even parse?
 * ------------------------------------------------------------------ */
async function sourceOf (url) {
  if (url.startsWith('file://')) return readFileSync(fileURLToPath(url), 'utf8')
  if (/^https?:/.test(url)) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) })
    return await r.text()
  }
  return readFileSync(url, 'utf8')
}

console.log('== 1. The inline script parses ==')
let html = ''
try {
  html = await sourceOf(URL_)
} catch (e) {
  t('the page can be fetched', false, String(e.message))
}
if (html) {
  const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attrs]) => !/\bsrc=/i.test(attrs) && !/type=["']?(application\/(ld\+)?json|text\/template|importmap)/i.test(attrs))
  if (!blocks.length) console.log('  SKIP  no inline script in this page')
  for (const [i, [, attrs, body]] of blocks.entries()) {
    if (body.trim().length < 2) continue
    const ext = /type=["']?module/i.test(attrs) ? '.mjs' : '.js'
    const tmp = join(tmpdir(), `prove-inline-${process.pid}-${i}${ext}`)
    writeFileSync(tmp, body)
    let ok = true, err = ''
    try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }) } catch (e) { ok = false; err = String(e.stderr || e.message).split('\n').slice(0, 3).join(' ') }
    rmSync(tmp, { force: true })
    t(`inline script ${i + 1} of ${blocks.length} parses`, ok, err)
  }
  // The two shapes that broke a real page twice in one day.
  const escapedAttr = html.match(/on[a-z]+="[^">]{0,160}?\\'/g) || []
  t('no escaped quote inside an event handler attribute', escapedAttr.length === 0, escapedAttr[0])
  t('no JSON embedded into an html attribute', !/on[a-z]+="[^">]{0,120}JSON\.stringify/.test(html))
  // Native dialogs freeze the renderer. They have been removed twice already.
  t('no alert(), confirm() or prompt()', !/[^.\w](alert|confirm|prompt)\s*\(/.test(html.replace(/<[^>]*>/g, ' ')))
}

/* ------------------------------------------------------------------ *
 * B. Does it RUN? Assert on rendered nodes, never on a string.
 * ------------------------------------------------------------------ */
console.log('\n== 2. The page renders. Parsing is not running ==')
if (!CHROME) {
  console.log('  FAIL  no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}

const gpuFlags = flag('gpu')
  // SwiftShader through ANGLE is the combination that renders WebGL headlessly
  // on this machine. Plain --use-gl=swiftshader hangs.
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--disable-gpu']

const profile = mkdtempSync(join(tmpdir(), 'prove-page-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', ...gpuFlags,
  '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // Never a sound or a keychain dialog on the person's Mac (2026-10-28).
  '--mute-audio', '--use-mock-keychain', '--password-store=basic',
  `--window-size=${flag('width', 1440)},${flag('height', 900)}`,
  '--hide-scrollbars', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
// never leave a hidden Chrome behind: macOS hands links to it, and project icons then open nothing (2026-10-27)
for (const sig of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { chrome.kill('SIGKILL') } catch {} if (sig !== 'exit') process.exit(1) })

// Chrome's own stderr is full of harmless macOS noise (CVDisplayLink, GPU
// probes). Keep it, print it only if something failed, so a real crash is still
// readable but a passing run is quiet.
let chromeErr = ''
chrome.stderr.on('data', (d) => { chromeErr += d })

const wr = chrome.stdio[3], rd = chrome.stdio[4]
let nextId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []
let buf = Buffer.alloc(0)
rd.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  let i
  while ((i = buf.indexOf(0)) !== -1) {
    let msg
    try { msg = JSON.parse(buf.subarray(0, i).toString('utf8')) } catch { msg = null }
    buf = buf.subarray(i + 1)
    if (!msg) continue
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      exceptions.push(d?.exception?.description || d?.text || 'exception')
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text)
    }
  }
})
const send = (method, params = {}, sessionId) => {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    wr.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
  })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate (session, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
  return r.result.value
}

try {
  // about:blank first, THEN enable the domains, THEN navigate, so that an
  // exception thrown during the first tick is still captured.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Runtime.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Log.enable', {}, sessionId).catch(() => {})
  /* --cookie name=value, repeatable: for pages behind a login. Set on the
     target's own origin before the first request, so the page loads signed in. */
  for (const c of flagAll('cookie')) {
    const i = c.indexOf('=')
    await send('Network.setCookie', { name: c.slice(0, i), value: c.slice(i + 1), url: new URL(URL_).origin }, sessionId)
  }
  await send('Page.navigate', { url: URL_ }, sessionId)

  // Poll the LIVE DOM until the assertions hold or the clock runs out. Counting
  // nodes in the running document is the whole point: a string in the source
  // proves nothing about whether anything executed.
  const probe = `(() => {
    const vis = document.body ? document.body.querySelectorAll('*:not(script):not(style):not(link):not(meta):not(title)').length : 0;
    const sel = ${JSON.stringify(EXPECT.map((e) => e.sel))};
    const counts = {};
    for (const s of sel) { try { counts[s] = document.querySelectorAll(s).length } catch { counts[s] = -1 } }
    return { ready: document.readyState, nodes: vis, counts,
             text: (document.body ? document.body.innerText : '').trim().length };
  })()`
  let state = { nodes: 0, counts: {}, text: 0, ready: 'loading' }
  const deadline = Date.now() + TIMEOUT
  while (Date.now() < deadline) {
    await sleep(300)
    try { state = await evaluate(sessionId, probe) } catch { continue }
    // With --click, wait only for the thing to click; the expectations are about what follows it.
    const enough = typeof flag('click') === 'string'
      ? await evaluate(sessionId, `!!document.querySelector(${JSON.stringify(flag('click'))})`).catch(() => false)
      : typeof flag('run') === 'string'
      ? await evaluate(sessionId, `!!document.querySelector(${JSON.stringify(flag('ready') || 'body')})`).catch(() => false)
      : state.nodes >= MIN_NODES && EXPECT.every((e) => (state.counts[e.sel] ?? 0) >= e.min)
    if (state.ready === 'complete' && enough) break
  }

  // --run "async js": act like a person (type, press keys) after the page is ready, then measure.
  const run = flag('run')
  if (typeof run === 'string') {
    let out = 'ok'
    try { out = await evaluate(sessionId, `(async () => { ${run} ; return 'ok' })()`) } catch (e) { out = String(e.message) }
    t('the --run script did not throw', out === 'ok', out)
    while (Date.now() < deadline + 10000) {
      try { state = await evaluate(sessionId, probe) } catch { await sleep(300); continue }
      if (state.nodes >= MIN_NODES && EXPECT.every((e) => (state.counts[e.sel] ?? 0) >= e.min)) break
      await sleep(300)
    }
  }

  const click = flag('click')
  if (typeof click === 'string') {
    let clicked = 'no such element'
    try {
      clicked = await evaluate(sessionId, `(async () => {
        const el = document.querySelector(${JSON.stringify(click)});
        if (!el) return 'no such element';
        el.click(); await new Promise(r => setTimeout(r, ${Number(flag('wait', 1500))}));
        return 'clicked';
      })()`)
    } catch (e) { clicked = String(e.message) }
    t(`clicking ${click} did not throw`, clicked === 'clicked', clicked)
    while (Date.now() < deadline + 10000) {
      try { state = await evaluate(sessionId, probe) } catch { await sleep(300); continue }
      if (state.nodes >= MIN_NODES && EXPECT.every((e) => (state.counts[e.sel] ?? 0) >= e.min)) break
      await sleep(300)
    }
  }

  const advancing = flag('advancing')
  if (typeof advancing === 'string') {
    // A renderer that exists is not a renderer that draws. Chrome's own
    // --screenshot fires on the load event, long before the first frame, and
    // hands back a picture of an empty canvas. Wait for the counter to MOVE.
    const moved = await evaluate(sessionId, `(async () => {
      for (let i = 0; i < 40; i++) {
        let a; try { a = (${advancing}) } catch { a = null }
        if (a != null) { await new Promise(r => setTimeout(r, 400));
          let b; try { b = (${advancing}) } catch { b = null }
          if (b > a) return true }
        await new Promise(r => setTimeout(r, 400));
      }
      return false;
    })()`)
    t(`${advancing} is advancing, so the renderer is actually drawing`, moved === true)
  }

  t(`the document reached readyState complete`, state.ready === 'complete', state.ready)
  t(`the page rendered at least ${MIN_NODES} real nodes into the DOM`, state.nodes >= MIN_NODES, `${state.nodes} nodes`)
  t('the rendered page has visible text', state.text > 0, `${state.text} characters`)
  for (const e of EXPECT) {
    const got = state.counts[e.sel] ?? 0
    t(`rendered "${e.sel}" x${got}, wanted at least ${e.min}`, got >= e.min, got === -1 ? 'invalid selector' : String(got))
  }

  t('no uncaught exception', exceptions.length === 0, exceptions.slice(0, 3).join(' | '))
  if (!flag('allow-console')) {
    t('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  } else if (consoleErrors.length) {
    console.log('  NOTE  console errors, allowed: ' + consoleErrors.slice(0, 3).join(' | '))
  }

  /* --settle ms: wait for images and fonts before judging what a person sees.
     The assertions pass as soon as the DOM exists, which on an image-heavy
     page is before the art arrives, and a screenshot taken then shows holes
     that are not there. Then every <img> that finished with no pixels is a
     real broken image, which no DOM count can see. */
  const settle = Number(flag('settle', 0))
  if (settle > 0) {
    await sleep(settle)
    const broken = await evaluate(sessionId, `[...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.currentSrc).map(i => i.currentSrc)`)
    const pending = await evaluate(sessionId, `[...document.images].filter(i => !i.complete && i.loading !== 'lazy').map(i => i.currentSrc || i.src)`)
    t('every loaded image has pixels', broken.length === 0, broken.slice(0, 3).join(' | '))
    if (pending.length) console.log('  NOTE  still loading after ' + settle + 'ms: ' + pending.slice(0, 3).join(' | '))
  }

  const shot = flag('shot')
  if (typeof shot === 'string') {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(shot, Buffer.from(data, 'base64'))
    console.log('  wrote ' + shot)
  }
} catch (e) {
  t('the page could be driven at all', false, String(e.message))
} finally {
  try { chrome.kill('SIGKILL') } catch {}
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

if (failed && chromeErr.trim()) {
  const lines = chromeErr.trim().split('\n')
    .filter((l) => /FATAL|CRASH/.test(l))
    .filter((l) => !/CVDisplayLink|GpuMemoryBuffer|crashpad|updater|RLZ|dbus|Fontconfig|XNNPACK/i.test(l))
  if (lines.length) console.log('\nchrome stderr (last 5):\n' + lines.slice(-5).join('\n'))
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
