const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

const PROMPT = 'Please generate a standard prompt code for this image including keywords: IMPORTANT, PRIMARY OBJECTIVE, ABSOLUTE CONSTRAINTS'
const INPUT_FOLDER = '/Users/bephi/Downloads'
const OUTPUT_FOLDER = '/Users/bephi/Downloads/AI'
const NUM_TABS = 10
const WAIT_UPLOAD = 5000
const WAIT_PROMPT = 120000
const WAIT_IMAGE = 180000

// Background popup dismisser — chạy suốt vòng đời tab, tự click "Đã hiểu"/"Got it"/"OK"
function startPopupWatcher(page, label) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      try {
        const clicked = await page.evaluate(() => {
          const keywords = ['đã hiểu', 'got it', 'got it!', 'ok', 'ok!', 'understand', 'close', 'tôi hiểu']
          const buttons = document.querySelectorAll('button, [role="button"]')
          for (const el of buttons) {
            const text = (el.textContent || '').trim().toLowerCase()
            if (!text) continue
            if (!keywords.some(k => text === k || text.includes(k))) continue
            const style = window.getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && parseFloat(style.opacity) > 0) {
              el.click()
              return text
            }
          }
          return null
        })
        if (clicked) console.log(`[${label}] ⚠️ auto-dismiss popup ("${clicked}")`)
      } catch {}
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  loop()
  return () => { stopped = true }
}

async function waitForPromptComplete(page, maxWait, label) {
  const start = Date.now()
  let lastLen = 0
  let stable = 0
  while (Date.now() - start < maxWait) {
    const msgs = page.locator('[data-message-author-role="assistant"]')
    const count = await msgs.count()
    if (count > 0) {
      const last = msgs.last()
      const pre = last.locator('pre').last()
      let text = ''
      if (await pre.count() > 0) text = await pre.innerText()
      else text = await last.innerText()
      if (text.length > 0 && text.length === lastLen) {
        const hasCopy = await last.locator('button:has-text("Copy"), [aria-label*="Copy"]').count() > 0
        if (hasCopy || text.includes('```')) {
          stable++
          if (stable >= 3) return true
        }
      } else {
        lastLen = text.length
        stable = 0
      }
    }
    await page.waitForTimeout(1000)
  }
  return false
}

async function extractPrompt(page) {
  const last = page.locator('[data-message-author-role="assistant"]').last()
  const pre = last.locator('pre').last()
  let text = ''
  if (await pre.count() > 0) text = await pre.innerText()
  else {
    const full = await last.innerText()
    if (full.includes('```')) {
      const blocks = full.split('```')
      text = blocks[blocks.length - 2].replace(/^[a-zA-Z]+\n/, '')
    } else text = full
  }
  return text.replace(/Copy code/gi, '').trim()
}

async function waitForImageReady(page, maxWait) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    const imgs = page.locator('[data-message-author-role="assistant"] img')
    const count = await imgs.count()
    if (count > 0) {
      const last = imgs.last()
      try {
        const box = await last.boundingBox()
        const src = await last.getAttribute('src')
        if (box && box.width > 200 && box.height > 200 && src && src.startsWith('http')) {
          const ready = await last.evaluate((el) => el.naturalWidth > 0 && el.complete)
          if (ready) return true
        }
      } catch {}
    }
    await page.waitForTimeout(2000)
  }
  return false
}

async function runPipeline(tabIndex, imagePath, page) {
  const label = `Tab ${tabIndex + 1}`
  const fileName = path.basename(imagePath)
  const stopWatcher = startPopupWatcher(page, label)

  try {
    // ===== TASK A =====
    console.log(`[${label}] 🚀 Task A: goto chatgpt.com`)
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#prompt-textarea', { timeout: 30000 })

    const fileInputA = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
    await fileInputA.setInputFiles(imagePath)
    console.log(`[${label}] 📤 upload ${fileName}`)
    await page.waitForTimeout(WAIT_UPLOAD)

    await page.locator('#prompt-textarea').fill(PROMPT)
    await page.waitForTimeout(500)
    const sendBtnA = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"]').first()
    await sendBtnA.click().catch(async () => { await page.keyboard.press('Enter') })
    console.log(`[${label}] ⏳ đang phân tích...`)

    const ok = await waitForPromptComplete(page, WAIT_PROMPT, label)
    if (!ok) { console.error(`[${label}] ❌ Task A timeout`); return }

    const extracted = await extractPrompt(page)
    if (!extracted || extracted.length < 20) {
      console.error(`[${label}] ❌ không extract được prompt (${extracted.length} chars)`)
      return
    }
    console.log(`[${label}] 📝 extracted ${extracted.length} chars`)

    // ===== TASK B =====
    console.log(`[${label}] 🎨 Task B: chuyển sang Create Image`)
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#prompt-textarea', { timeout: 30000 })

    const ta = page.locator('#prompt-textarea')
    await ta.click()
    await ta.fill('/')
    await page.waitForTimeout(1000)

    try {
      const menu = page.locator('[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"]').last()
      const createOpt = menu.locator('text="Create image"').first()
      await createOpt.waitFor({ state: 'visible', timeout: 3000 })
      await createOpt.click({ force: true })
    } catch {
      await ta.fill('/cr')
      await page.waitForTimeout(1000)
      await page.keyboard.press('Enter')
    }
    await page.waitForTimeout(2000)

    const fileInputB = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
    await fileInputB.setInputFiles(imagePath)
    console.log(`[${label}] 📤 Task B upload`)
    await page.waitForTimeout(WAIT_UPLOAD)

    await ta.click()
    await ta.fill(extracted)
    await page.waitForTimeout(500)

    const sendBtnB = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"]').first()
    await sendBtnB.click().catch(async () => { await page.keyboard.press('Enter') })
    console.log(`[${label}] 🎨 đang tạo ảnh...`)

    const imgReady = await waitForImageReady(page, WAIT_IMAGE)
    if (!imgReady) { console.error(`[${label}] ❌ Task B timeout`); return }

    // Download image via URL fallback
    const assistantImg = page.locator('[data-message-author-role="assistant"] img').last()
    const src = await assistantImg.getAttribute('src')
    if (src && src.startsWith('http')) {
      await fs.ensureDir(OUTPUT_FOLDER)
      const savePath = path.join(OUTPUT_FOLDER, `SH_AI_${path.parse(fileName).name}.png`)
      const buffer = await page.evaluate(async (url) => {
        const r = await fetch(url)
        const ab = await r.arrayBuffer()
        return Array.from(new Uint8Array(ab))
      }, src)
      await fs.writeFile(savePath, Buffer.from(buffer))
      console.log(`[${label}] ✅ lưu ${savePath}`)
    } else {
      console.error(`[${label}] ❌ không lấy được URL ảnh`)
    }
  } catch (err) {
    console.error(`[${label}] ❌ ${err.message}`)
  } finally {
    stopWatcher()
  }
}

;(async () => {
  const profileDir = path.join(os.homedir(), 'Library', 'Application Support', 'son-hai-ai-render', 'browser-profile-0')

  const allFiles = (await fs.readdir(INPUT_FOLDER)).filter(f =>
    ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase())
  )
  const images = allFiles.slice(0, NUM_TABS).map(f => path.join(INPUT_FOLDER, f))
  console.log(`📁 ${images.length} ảnh | Output: ${OUTPUT_FOLDER}`)

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  })

  const tasks = images.map(async (img, i) => {
    const existing = context.pages()
    const page = i === 0 && existing[0] ? existing[0] : await context.newPage()
    return runPipeline(i, img, page)
  })

  await Promise.all(tasks)
  console.log('\n✨ Hoàn tất. Browser giữ mở. Ctrl+C để thoát.')
  await new Promise(() => {})
})().catch((err) => { console.error('❌', err); process.exit(1) })
