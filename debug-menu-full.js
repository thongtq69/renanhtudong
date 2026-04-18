// Full debug: click + button, dump a11y + full structure of the menu with LOGGED IN profile
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

  // Dismiss popups
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase()
      if (['đã hiểu', 'got it', 'ok', 'understand'].some(k => t.includes(k))) b.click()
    })
  })
  await page.waitForTimeout(1000)

  // Click + button
  const plusBtn = page.locator('button[aria-label*="thêm tệp" i]').first()
  await plusBtn.click()
  await page.waitForTimeout(2000)

  await page.screenshot({ path: '/tmp/menu-open.png' })

  // Dump FULL menu HTML
  const menuHTML = await page.evaluate(() => {
    // Tìm container menu — popover nổi trên composer
    const selectors = [
      '[role="menu"]',
      '[data-radix-popper-content-wrapper]',
      '[data-radix-menu-content]',
      '[id*="menu-content"]'
    ]
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel)
      for (const el of els) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 100 && rect.height > 100) {
          return {
            selector: sel,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            html: el.outerHTML.substring(0, 4000)
          }
        }
      }
    }
    return null
  })
  console.log('\n=== MENU HTML ===')
  console.log(JSON.stringify(menuHTML, null, 2))

  // Tìm element có text đúng "Tạo hình ảnh" và dump all ancestors
  const taoInfo = await page.evaluate(() => {
    const all = document.querySelectorAll('*')
    for (const el of all) {
      const ownText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim().toLowerCase())
        .join(' ')
        .trim()
      if (ownText !== 'tạo hình ảnh') continue
      const rect = el.getBoundingClientRect()
      const ancestors = []
      let cur = el
      for (let i = 0; i < 8 && cur; i++) {
        const r = cur.getBoundingClientRect()
        ancestors.push({
          tag: cur.tagName,
          role: cur.getAttribute('role'),
          className: (cur.className || '').toString().substring(0, 150),
          dataTestId: cur.getAttribute('data-testid'),
          ariaLabel: cur.getAttribute('aria-label'),
          onClick: cur.onclick ? 'yes' : 'no',
          tabindex: cur.getAttribute('tabindex'),
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
        })
        cur = cur.parentElement
      }
      return { text: ownText, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }, ancestors }
    }
    return null
  })
  console.log('\n=== "Tạo hình ảnh" + ancestors ===')
  console.log(JSON.stringify(taoInfo, null, 2))

  // Test: click thử bằng mouse tại center của text
  if (taoInfo) {
    const cx = taoInfo.rect.x + taoInfo.rect.w / 2
    const cy = taoInfo.rect.y + taoInfo.rect.h / 2
    console.log(`\n→ Mouse click tại (${Math.round(cx)}, ${Math.round(cy)})`)
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(3000)
    await page.screenshot({ path: '/tmp/after-mouse-click.png' })
    console.log('📸 /tmp/after-mouse-click.png')

    // Check composer state để xem đã switch mode chưa
    const composerState = await page.evaluate(() => {
      const ta = document.querySelector('#prompt-textarea')
      const placeholder = ta?.getAttribute('data-placeholder') || ta?.getAttribute('placeholder')
      // Tìm chip/badge "Tạo hình ảnh" gần composer
      const chips = []
      document.querySelectorAll('[role="img"], [aria-label], button').forEach(el => {
        const text = (el.textContent || '').trim()
        if (['tạo hình ảnh', 'image', 'create image'].some(k => text.toLowerCase().includes(k))) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.y > 400) chips.push({ text: text.substring(0, 50), y: Math.round(r.y) })
        }
      })
      return { placeholder, chips }
    })
    console.log('\n=== Composer state sau click ===')
    console.log(JSON.stringify(composerState, null, 2))
  }

  console.log('\n✅ Done')
  await new Promise(() => {})
})().catch(e => { console.error('❌', e); process.exit(1) })
