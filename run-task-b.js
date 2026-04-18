// Pure Task B runner: mở 10 tab, mỗi tab chọn Create Image, upload ảnh, gửi prompt render, chờ ảnh, tải về
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

const INPUT_FOLDER = '/Users/bephi/Downloads'
const OUTPUT_FOLDER = '/Users/bephi/Downloads/AI'
const NUM_TABS = 10
const WAIT_UPLOAD = 5000
const WAIT_IMAGE = 300000

// Prompt dùng chung (thường thì Task A sẽ sinh ra riêng cho từng ảnh — ở đây dùng prompt mẫu để test Task B độc lập)
const RENDER_PROMPT = `IMPORTANT: Render a high-quality enhanced version of this image.
PRIMARY OBJECTIVE: Preserve layout, composition, and content exactly. Only increase clarity, sharpness, lighting, and texture quality.
ABSOLUTE CONSTRAINTS:
- NO style change
- NO added/removed objects
- NO repositioning
- NO simplification
OUTPUT REQUIREMENTS: Ultra high-resolution (minimum 4K).`

function startPopupWatcher(page, label) {
  let stopped = false
  const loop = async () => {
    while (!stopped) {
      try {
        const clicked = await page.evaluate(() => {
          const keywords = ['đã hiểu', 'got it', 'got it!', 'ok', 'ok!', 'understand', 'tôi hiểu']
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
        if (clicked) console.log(`[${label}] ⚠️ dismiss popup ("${clicked}")`)
      } catch {}
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  loop()
  return () => { stopped = true }
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

async function runTaskB(tabIndex, imagePath, page) {
  const label = `Tab ${tabIndex + 1}`
  const fileName = path.basename(imagePath)
  const stopWatcher = startPopupWatcher(page, label)

  try {
    console.log(`[${label}] 🎨 goto chatgpt.com`)
    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('#prompt-textarea', { timeout: 30000 })

    const ta = page.locator('#prompt-textarea')

    // Retry up to 3 lần — click nút "+" (aria="thêm tệp...") để mở menu tool
    let menuClicked = false
    for (let attempt = 1; attempt <= 3 && !menuClicked; attempt++) {
      console.log(`[${label}] 📝 lần ${attempt}: click nút + mở menu`)

      // Chờ popup rate-limit tan trước
      for (let i = 0; i < 5; i++) {
        const blocked = await page.evaluate(() => {
          const t = (document.body?.innerText || '').toLowerCase()
          return t.includes('quá nhiều yêu cầu') || t.includes('too many requests')
        })
        if (!blocked) break
        console.log(`[${label}] ⏸️ popup đang hiện — chờ watcher dismiss`)
        await page.waitForTimeout(1500)
      }

      // Tìm và click nút "+" trên composer (aria-label có "thêm tệp" hoặc "add")
      const plusBtn = page.locator(
        'button[aria-label*="thêm tệp" i], button[aria-label*="add files" i], button[aria-label*="more features" i]'
      ).first()

      try {
        await plusBtn.waitFor({ state: 'visible', timeout: 5000 })
        await plusBtn.scrollIntoViewIfNeeded()
        await plusBtn.click({ timeout: 3000 })
        await page.waitForTimeout(1500)
      } catch (e) {
        console.log(`[${label}] ⚠️ không tìm thấy nút + (lần ${attempt})`)
        await page.waitForTimeout(2000)
        continue
      }

      // Tìm element có ownText (direct text node) === "tạo hình ảnh" — leaf thật sự
      const targetRect = await page.evaluate(() => {
        const keywords = ['tạo hình ảnh', 'tạo ảnh', 'create image', 'create an image']
        const all = document.querySelectorAll('*')
        for (const el of all) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim().toLowerCase())
            .join(' ')
            .trim()
          if (!ownText) continue
          if (!keywords.some(k => ownText === k || ownText.startsWith(k))) continue
          const rect = el.getBoundingClientRect()
          if (rect.width < 10 || rect.height < 10) return null
          // Loại sidebar
          if (rect.x < 250 && rect.width < 250) continue
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
        }
        return null
      })

      if (targetRect) {
        // Mouse click tại tâm text element (event thật)
        const cx = targetRect.x + targetRect.w / 2
        const cy = targetRect.y + targetRect.h / 2
        await page.mouse.click(cx, cy)
        console.log(`[${label}] ✅ mouse click (${Math.round(cx)}, ${Math.round(cy)}) — "Tạo hình ảnh"`)
        menuClicked = true
        await page.waitForTimeout(2000)
      } else {
        console.log(`[${label}] ⚠️ không thấy "Tạo hình ảnh" trong menu (lần ${attempt})`)
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(2000)
      }
    }

    if (!menuClicked) {
      console.error(`[${label}] ❌ không chọn được Tạo hình ảnh sau 3 lần`)
      return
    }

    console.log(`[${label}] 📤 upload ${fileName}`)
    const fileInput = await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
    await fileInput.setInputFiles(imagePath)
    await page.waitForTimeout(WAIT_UPLOAD)

    await ta.click()
    await ta.fill(RENDER_PROMPT)
    await page.waitForTimeout(500)

    const sendBtn = page.locator('button[data-testid="send-button"], button[aria-label="Send prompt"]').first()
    await sendBtn.click().catch(async () => { await page.keyboard.press('Enter') })
    console.log(`[${label}] 🚀 đã gửi — đang tạo ảnh...`)

    const ok = await waitForImageReady(page, WAIT_IMAGE)
    if (!ok) {
      console.error(`[${label}] ❌ Task B timeout chờ ảnh`)
      return
    }

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
    return runTaskB(i, img, page)
  })

  await Promise.all(tasks)
  console.log('\n✨ Hoàn tất. Browser giữ mở. Ctrl+C để thoát.')
  await new Promise(() => {})
})().catch((err) => { console.error('❌', err); process.exit(1) })
