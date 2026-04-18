// Debug 1 tab: click +, dump menu DOM exact structure, tìm & click "Tạo hình ảnh"
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')

chromium.use(stealth())

;(async () => {
  const profileDir = path.join(os.homedir(), 'Library', 'Application Support', 'son-hai-ai-render', 'browser-profile-0')
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  })

  const page = context.pages()[0] || await context.newPage()
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('#prompt-textarea', { timeout: 30000 })
  console.log('✅ loaded')
  await page.waitForTimeout(3000)

  // Dismiss popup
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase()
      if (['đã hiểu', 'got it', 'ok', 'understand'].some(k => t.includes(k))) b.click()
    })
  })
  await page.waitForTimeout(1000)

  // Click + button với playwright real click
  const plusBtn = page.locator('button[aria-label*="thêm tệp" i]').first()
  await plusBtn.waitFor({ state: 'visible', timeout: 5000 })
  console.log('→ clicking + button...')
  await plusBtn.click()
  await page.waitForTimeout(2000)

  await page.screenshot({ path: '/tmp/after-plus-click.png' })
  console.log('📸 /tmp/after-plus-click.png')

  // Dump full menu structure
  const dump = await page.evaluate(() => {
    const result = { menuitems: [], buttons: [], divsWithText: [] }

    document.querySelectorAll('[role="menuitem"], [role="option"]').forEach(el => {
      const rect = el.getBoundingClientRect()
      result.menuitems.push({
        role: el.getAttribute('role'),
        text: (el.textContent || '').trim().substring(0, 80),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      })
    })

    // Tìm các element có text "tạo hình ảnh"
    const all = document.querySelectorAll('*')
    const target = 'tạo hình ảnh'
    all.forEach(el => {
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim().toLowerCase())
        .join(' ')
      if (ownText.includes(target)) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          result.divsWithText.push({
            tag: el.tagName,
            role: el.getAttribute('role'),
            ownText: ownText.substring(0, 80),
            fullText: (el.textContent || '').trim().substring(0, 80),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          })
        }
      }
    })
    return result
  })
  console.log('\n=== DUMP ===')
  console.log(JSON.stringify(dump, null, 2))

  // Tìm và click element "Tạo hình ảnh" dùng ownText match
  const clickedInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('*')
    const target = 'tạo hình ảnh'
    let best = null
    let bestArea = Infinity
    all.forEach(el => {
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim().toLowerCase())
        .join(' ')
      if (!ownText.includes(target)) return
      const rect = el.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 10) return
      // Tìm ancestor có role menuitem hoặc button
      let clickable = el
      for (let i = 0; i < 5 && clickable; i++) {
        const role = clickable.getAttribute && clickable.getAttribute('role')
        if (role === 'menuitem' || role === 'option' || clickable.tagName === 'BUTTON') break
        clickable = clickable.parentElement
      }
      if (!clickable) clickable = el
      const cRect = clickable.getBoundingClientRect()
      const area = cRect.width * cRect.height
      if (area < bestArea) {
        bestArea = area
        best = { clickable, text: ownText, rect: cRect, role: clickable.getAttribute('role'), tag: clickable.tagName }
      }
    })
    if (!best) return null
    best.clickable.click()
    return { text: best.text, role: best.role, tag: best.tag, x: Math.round(best.rect.x), y: Math.round(best.rect.y), w: Math.round(best.rect.width), h: Math.round(best.rect.height) }
  })
  console.log('\n=== CLICKED ===')
  console.log(JSON.stringify(clickedInfo, null, 2))
  await page.waitForTimeout(3000)

  await page.screenshot({ path: '/tmp/after-tao-click.png' })
  console.log('📸 /tmp/after-tao-click.png')

  console.log('\n✅ Done')
  await new Promise(() => {})
})().catch(e => { console.error('❌', e); process.exit(1) })
