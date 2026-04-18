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
  await page.waitForTimeout(2000)

  // Dismiss popup
  await page.evaluate(() => {
    const keywords = ['đã hiểu', 'got it', 'ok', 'understand']
    document.querySelectorAll('button').forEach(b => {
      const t = (b.textContent || '').trim().toLowerCase()
      if (keywords.some(k => t.includes(k))) b.click()
    })
  })
  await page.waitForTimeout(1000)

  // Click the "+" button
  console.log('\n=== Click + button ===')
  const plusClicked = await page.evaluate(() => {
    const btns = document.querySelectorAll('button')
    for (const b of btns) {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase()
      if (aria.includes('thêm tệp') || aria.includes('add files') || aria.includes('more features')) {
        const rect = b.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          b.click()
          return { aria, x: rect.x, y: rect.y }
        }
      }
    }
    return null
  })
  console.log('clicked:', JSON.stringify(plusClicked))
  await page.waitForTimeout(2000)

  console.log('\n=== Dump menu sau click + ===')
  const menu = await page.evaluate(() => {
    const result = {
      popperCount: document.querySelectorAll('[data-radix-popper-content-wrapper]').length,
      menuCount: document.querySelectorAll('[role="menu"]').length,
      listboxCount: document.querySelectorAll('[role="listbox"]').length,
      items: []
    }
    const sels = ['[data-radix-popper-content-wrapper]', '[role="menu"]', '[role="listbox"]']
    const containers = []
    sels.forEach(s => document.querySelectorAll(s).forEach(e => containers.push(e)))
    containers.forEach(c => {
      c.querySelectorAll('[role="menuitem"], [role="option"], button, li').forEach(item => {
        const rect = item.getBoundingClientRect()
        if (rect.width < 20 || rect.height < 20) return
        const text = (item.textContent || '').trim().substring(0, 120)
        if (text) result.items.push({ role: item.getAttribute('role'), text })
      })
    })
    return result
  })
  console.log(JSON.stringify(menu, null, 2))

  await page.screenshot({ path: '/tmp/plus-menu-debug.png' })
  console.log('\n📸 /tmp/plus-menu-debug.png')
  console.log('\n✅ Done')
  await new Promise(() => {})
})().catch(e => { console.error('❌', e); process.exit(1) })
