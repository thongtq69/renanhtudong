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

async function snapshotFlowImgs(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).map(img => img.src || '')
  ).catch(() => [])
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
  })
  for (const p of ctx.pages()) if (p.url() === 'about:blank') await p.close().catch(()=>{})

  try {
    const page = await ctx.newPage()
    log(`🌐 goto Flow`)
    await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)

    const newProj = page.locator('button, div').filter({ hasText: /Dự án mới|New project/i }).last()
    if (await newProj.count() > 0) await newProj.click().catch(() => {})
    await page.waitForTimeout(4000)

    const configBtn = page.locator('button').filter({ hasText: /Video.*x|Hình ảnh.*x|Nano.*x/ }).first()
    await configBtn.click().catch(() => {})
    await page.waitForTimeout(800)
    const imgTab = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /imageHình ảnh/i }).first()
    if (await imgTab.count() > 0) await imgTab.click().catch(() => {})
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(500)

    log(`📎 upload`)
    const baseline = await snapshotFlowImgs(page)
    const fileInput = page.locator('input[type="file"][accept*="image"]').first()
    await fileInput.waitFor({ state: 'attached', timeout: 10000 })
    await fileInput.setInputFiles(IMAGE)
    if (!(await waitForFlowAssetReady(page, baseline, 60000))) { log(`❌ asset not ready`); return }
    log(`✅ asset ready`)

    log(`📝 fill (${PROMPT.length} chars)`)
    const filled = await fillFlowPrompt(page, PROMPT, log)
    log(filled ? `✅ FILL OK` : `❌ FILL FAIL`)
  } catch (e) {
    log(`💥 ${e.message}`)
  } finally {
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
