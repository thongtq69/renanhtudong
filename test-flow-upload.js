// Standalone e2e test: reproduce production scenario with MULTIPLE WINDOWS.
// Each "browser" = separate persistentContext = separate Chromium window.
// 3 windows run in parallel, only one foreground at OS level.
// Verifies: bringToFront + keyboard.insertText + new launch flags work for occluded windows.
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

const IMAGE = '/Users/bephi/Downloads/chu_ky.png'
const PROMPT = [
  'IMPORTANT:',
  'The uploaded image is the ONE, ONLY, and ABSOLUTE source of truth.',
  'All visual decisions must strictly follow this image.',
  '',
  'PRIMARY OBJECTIVE:',
  'Transform this image into a real-world professional product photograph.',
  '',
  'COMPOSITION:',
  '- Subject fills 60-70% of frame',
  '- Clean background with subtle gradient',
  '',
  'LIGHTING:',
  '- Three-point softbox setup',
  '- Color temperature 5500K daylight',
  '',
  'OUTPUT REQUIREMENTS:',
  '- Ultra high-resolution (minimum 4K)',
  '- 16:9 aspect ratio',
  '',
  'Generate EXACTLY 1 image only.',
  'Do NOT create variations.',
].join('\n')

const WINDOW_COUNT = 3

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
]

function readPngDims(filePath) {
  try {
    const fd = require('fs').openSync(filePath, 'r')
    const buf = Buffer.alloc(24)
    require('fs').readSync(fd, buf, 0, 24, 0)
    require('fs').closeSync(fd)
    if (buf.slice(1, 4).toString() === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    if (buf[0] === 0xFF && buf[1] === 0xD8) return { w: 0, h: 0 } // JPEG: skip, fallback to >=256 threshold
  } catch {}
  return { w: 0, h: 0 }
}

async function snapshotFlowImgs(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map(img => img.src || '')
  ).catch(() => [])
}

async function dismissConsentDialog(page) {
  try {
    const btn = page.locator('button').filter({ hasText: /Tôi đồng ý|I agree|Đồng ý|Accept/ }).first()
    if (await btn.count() > 0 && await btn.isVisible()) { await btn.click().catch(() => {}); return true }
  } catch {}
  return false
}

function startDialogWatcher(page) {
  let stopped = false
  ;(async () => {
    while (!stopped) {
      if (page.isClosed?.()) break
      await dismissConsentDialog(page)
      await page.waitForTimeout(3000).catch(() => {})
    }
  })()
  return () => { stopped = true }
}

async function pasteAssetIntoPrompt(page, imagePath) {
  const buf = await fs.readFile(imagePath)
  const base64 = buf.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase() || 'png'
  const srcMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : 'image/png'

  const tb = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]').last()
  await tb.waitFor({ state: 'visible', timeout: 15000 })
  await tb.scrollIntoViewIfNeeded().catch(() => {})
  await tb.click({ timeout: 5000 })
  await page.waitForTimeout(300)

  // Clipboard API chỉ hỗ trợ image/png — JPEG/WebP phải re-encode qua canvas.
  await page.evaluate(async ({ b64, srcMime }) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    let pngBlob
    if (srcMime === 'image/png') {
      pngBlob = new Blob([bytes], { type: 'image/png' })
    } else {
      const srcBlob = new Blob([bytes], { type: srcMime })
      const url = URL.createObjectURL(srcBlob)
      try {
        const img = await new Promise((res, rej) => {
          const el = new Image()
          el.onload = () => res(el); el.onerror = () => rej(new Error('decode-fail'))
          el.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        pngBlob = await new Promise((res, rej) => {
          canvas.toBlob(b => b ? res(b) : rej(new Error('encode-fail')), 'image/png')
        })
      } finally { URL.revokeObjectURL(url) }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
  }, { b64: base64, srcMime })

  await tb.click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(150)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
}

async function waitForComposerAttachment(page, _w, _h, timeoutMs = 60000) {
  // Scope bằng geo: img có tâm nằm trong ~500x300 quanh textbox (composer bar).
  const start = Date.now()
  let stableCount = 0
  let lastSrc = null
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const tb = document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
      if (!tb) return { ok: false, reason: 'no-textbox' }
      const tbR = tb.getBoundingClientRect()
      const tcx = tbR.left + tbR.width/2, tcy = tbR.top + tbR.height/2
      const nearby = Array.from(document.querySelectorAll('img')).filter(img => {
        const r = img.getBoundingClientRect()
        if (!r.width || !r.height) return false
        const cx = r.left + r.width/2, cy = r.top + r.height/2
        return Math.abs(cx - tcx) < 500 && Math.abs(cy - tcy) < 300
      })
      const thumb = nearby.find(img => {
        const src = img.src || ''
        if (!src || src.includes('avatar') || src.includes('googleusercontent.com/a/')) return false
        if (!img.complete || img.naturalWidth < 10) return false
        if (!(src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('http'))) return false
        const r = img.getBoundingClientRect()
        return r.width >= 30 && r.height >= 30
      })
      const dump = nearby.slice(0, 5).map(i => {
        const r = i.getBoundingClientRect()
        return `${Math.round(r.width)}x${Math.round(r.height)}/nat${i.naturalWidth}x${i.naturalHeight}/${(i.src||'').slice(0,20)}`
      }).join('|')
      return { ok: !!thumb, reason: thumb ? 'ok' : `no-match near textbox (${nearby.length}): ${dump}`, thumbSrc: thumb?.src?.slice(0, 60) }
    }).catch(e => ({ ok: false, reason: `err:${e.message?.slice(0,40)}` }))
    if (state.ok) {
      if (state.thumbSrc === lastSrc) stableCount++
      else { stableCount = 1; lastSrc = state.thumbSrc }
      if (stableCount >= 2) return { ok: true, reason: state.reason, thumbSrc: state.thumbSrc }
    } else {
      stableCount = 0; lastSrc = null
    }
    await page.waitForTimeout(1000)
  }
  // Final debug dump
  const finalDump = await page.evaluate(() => {
    const tb = document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
    if (!tb) return 'no-tb'
    const tbR = tb.getBoundingClientRect()
    const tcx = tbR.left + tbR.width/2, tcy = tbR.top + tbR.height/2
    const nearby = Array.from(document.querySelectorAll('img')).filter(img => {
      const r = img.getBoundingClientRect()
      const cx = r.left + r.width/2, cy = r.top + r.height/2
      return Math.abs(cx - tcx) < 500 && Math.abs(cy - tcy) < 300
    })
    return nearby.map(i => {
      const r = i.getBoundingClientRect()
      return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)} nat${i.naturalWidth}x${i.naturalHeight} ${(i.src||'').slice(0,40)}`
    }).join('\n  ')
  }).catch(e => `err:${e.message}`)
  return { ok: false, reason: `timeout\n  nearby imgs:\n  ${finalDump}`, thumbSrc: lastSrc }
}

async function waitForFlowAssetReady(page, baseline, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate((b) => {
      const imgs = Array.from(document.querySelectorAll('img'))
      const newReady = imgs.filter(img => {
        const src = img.src || ''
        if (!src || b.includes(src)) return false
        if (src.includes('avatar') || src.includes('googleusercontent.com/a/') || src.includes('flower-placeholder')) return false
        const r = img.getBoundingClientRect()
        return r.width >= 30 && r.height >= 30 && img.complete && img.naturalWidth > 0
      })
      const progressbars = Array.from(document.querySelectorAll('[role="progressbar"]'))
        .filter(p => p.getBoundingClientRect().width > 0)
      return { newReady: newReady.length, hasProgress: progressbars.length > 0 }
    }, baseline).catch(() => ({ newReady: 0, hasProgress: false }))
    if (state.newReady >= 1 && !state.hasProgress) return true
    await page.waitForTimeout(1000)
  }
  return false
}

async function fillFlowPrompt(page, prompt, log) {
  const isCommitted = async () =>
    await page.evaluate(() => !document.querySelector('[data-slate-placeholder="true"]')).catch(() => false)
  const pollCommit = async (maxMs = 3000) => {
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      await page.waitForTimeout(150)
      if (await isCommitted()) return true
    }
    return false
  }
  try {
    await page.bringToFront().catch(() => {})
    const tb = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]').first()
    await tb.waitFor({ state: 'visible', timeout: 5000 })
    await tb.click({ timeout: 5000 })
    await page.waitForTimeout(200)
    await page.keyboard.press('Meta+A').catch(() => {})
    await page.keyboard.press('Control+A').catch(() => {})
    await page.keyboard.press('Backspace').catch(() => {})
    await page.waitForTimeout(150)
    await tb.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(100)

    // Flow Enter=Submit, dùng Shift+Enter để xuống dòng
    const lines = prompt.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) await page.keyboard.press('Shift+Enter')
      if (lines[i]) await page.keyboard.insertText(lines[i])
    }
    if (await pollCommit(3000)) { log(`cách A (CDP) OK`); return true }
    log(`cách A FAIL, thử cách B`)

    await tb.click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Meta+A').catch(() => {})
    await page.keyboard.press('Control+A').catch(() => {})
    await page.keyboard.press('Backspace').catch(() => {})
    await page.waitForTimeout(150)

    await page.evaluate((text) => {
      const tb = document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
      if (!tb) return
      tb.focus()
      const anchor = tb.querySelector('[data-slate-string="true"]') || tb.querySelector('[data-slate-zero-width]')
      const fc = anchor?.firstChild
      if (anchor && fc) {
        const sel = window.getSelection()
        const r = document.createRange()
        r.setStart(fc, 0); r.setEnd(fc, 0)
        sel.removeAllRanges(); sel.addRange(r)
      }
      const fire = (it, d) => tb.dispatchEvent(new InputEvent('beforeinput', {
        inputType: it, ...(d !== undefined ? { data: d } : {}),
        bubbles: true, cancelable: true, composed: true,
      }))
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) fire('insertParagraph')
        if (lines[i]) fire('insertText', lines[i])
      }
    }, prompt)
    if (await pollCommit(3000)) { log(`cách B (synthetic) OK`); return true }
    log(`cả 2 cách FAIL`)
    return false
  } catch (e) { log(`exception: ${e.message}`); return false }
}

async function runOneWindow(winIdx) {
  const tag = `[W${winIdx+1}]`
  const log = (s) => console.log(`${tag} ${s}`)
  const profileDir = path.join(os.homedir(), 'Library', 'Application Support', 'son-hai-ai-render', `browser-profile-${winIdx}`)
  await fs.ensureDir(profileDir)

  // Each window = separate context = separate Chromium process
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [...LAUNCH_ARGS, `--window-position=${100 + winIdx*50},${100 + winIdx*30}`],
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://labs.google' }).catch(() => {})
  for (const p of ctx.pages()) if (p.url() === 'about:blank') await p.close().catch(()=>{})

  let stopWatcher = () => {}
  try {
    const page = await ctx.newPage()
    log(`🌐 goto Flow`)
    await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    stopWatcher = startDialogWatcher(page)
    await dismissConsentDialog(page)

    const errBack = page.locator('button:has-text("Quay lại dự án"), button:has-text("Quay lai du an")').first()
    if (await errBack.count() > 0) await errBack.click().catch(() => {})

    const newProj = page.locator('button, div').filter({ hasText: /Dự án mới|Du an moi|New project/i }).last()
    if (await newProj.count() > 0) await newProj.click().catch(() => {})
    await page.waitForTimeout(4000)

    const configBtn = page.locator('button').filter({ hasText: /Video.*x|Hình ảnh.*x|Nano.*x|crop/ }).first()
    await configBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    await configBtn.click().catch(() => {})
    await page.waitForTimeout(1500)

    const imgTab = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /imageHình ảnh/i }).first()
    if (await imgTab.count() > 0) {
      const sel = await imgTab.getAttribute('aria-selected').catch(() => null)
      if (sel !== 'true') await imgTab.click().catch(() => {})
    }
    await page.waitForTimeout(400)

    const x1Btn = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /^x1$/ }).first()
    if (await x1Btn.count() > 0) await x1Btn.click().catch(() => {})
    await page.waitForTimeout(300)

    await configBtn.click().catch(() => {})
    await page.waitForTimeout(500)

    log(`📎 paste asset vào ô chat`)
    const dims = readPngDims(IMAGE)
    await pasteAssetIntoPrompt(page, IMAGE)
    const attached = await waitForComposerAttachment(page, dims.w, dims.h, 60000)
    const shotPath = path.join(os.tmpdir(), `flow_${attached.ok ? 'ok' : 'fail'}_w${winIdx+1}.png`)
    await page.screenshot({ path: shotPath }).catch(() => {})
    log(`${attached.ok ? '✅' : '❌'} composer check: ${attached.reason} (src: ${(attached.thumbSrc||'').slice(0,60)}) → ${shotPath}`)
    if (!attached.ok) {
      const dump = await page.evaluate(() => {
        const tb = document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
        const form = tb?.closest('form')
        if (!form) return { err: 'no-form-or-tb' }
        const imgs = Array.from(form.querySelectorAll('img')).map(i => ({
          src: (i.src||'').slice(0,80), nw: i.naturalWidth, nh: i.naturalHeight,
          rw: Math.round(i.getBoundingClientRect().width), rh: Math.round(i.getBoundingClientRect().height)
        }))
        const bgs = Array.from(form.querySelectorAll('*')).filter(el => {
          const bg = getComputedStyle(el).backgroundImage
          return bg && bg !== 'none' && (bg.includes('url(') || bg.includes('blob'))
        }).slice(0,5).map(el => ({ tag: el.tagName, bg: getComputedStyle(el).backgroundImage.slice(0,80), rw: Math.round(el.getBoundingClientRect().width), rh: Math.round(el.getBoundingClientRect().height) }))
        const canvases = Array.from(form.querySelectorAll('canvas')).map(c => ({ w: c.width, h: c.height }))
        return { imgs, bgs, canvases, formHtml: form.outerHTML.slice(0, 2000) }
      }).catch(e => ({ err: e.message }))
      log(`DOM dump: ${JSON.stringify(dump, null, 0).slice(0, 1500)}`)
      return
    }

    log(`📝 fill (${PROMPT.length} chars)`)
    const filled = await fillFlowPrompt(page, PROMPT, log)
    log(filled ? `✅ FILL OK` : `❌ FILL FAIL`)
  } catch (e) {
    log(`💥 ${e.message}`)
  } finally {
    stopWatcher()
    await new Promise(r => setTimeout(r, 5000))
    await ctx.close().catch(() => {})
  }
}

;(async () => {
  console.log(`🏁 Starting ${WINDOW_COUNT} parallel WINDOWS (separate Chromium processes)`)
  const tasks = []
  for (let i = 0; i < WINDOW_COUNT; i++) {
    tasks.push(runOneWindow(i))
    await new Promise(r => setTimeout(r, 1500))
  }
  await Promise.all(tasks)
  console.log('\n✨ All windows done')
})().catch(e => { console.error('💥', e); process.exit(1) })
