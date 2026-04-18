// Debug: mở 1 tab, gõ "/" vào composer, dump DOM quanh menu để thấy structure thật
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

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
  console.log('✅ ChatGPT loaded')
  await page.waitForTimeout(2000)

  // Dismiss any popup first
  await page.evaluate(() => {
    const keywords = ['đã hiểu', 'got it', 'ok', 'understand']
    const btns = document.querySelectorAll('button, [role="button"]')
    for (const b of btns) {
      const t = (b.textContent || '').trim().toLowerCase()
      if (keywords.some(k => t.includes(k))) { b.click(); return }
    }
  })
  await page.waitForTimeout(1000)

  const ta = page.locator('#prompt-textarea')
  await ta.click()
  await page.waitForTimeout(500)

  console.log('\n=== Dump 1: Trước khi gõ "/" ===')
  const beforeSlash = await page.evaluate(() => {
    const popperCount = document.querySelectorAll('[data-radix-popper-content-wrapper]').length
    const listboxCount = document.querySelectorAll('[role="listbox"]').length
    const menuCount = document.querySelectorAll('[role="menu"]').length
    return { popperCount, listboxCount, menuCount }
  })
  console.log(JSON.stringify(beforeSlash))

  // Gõ "/"
  console.log('\n=== Gõ "/" ===')
  await page.keyboard.type('/')
  await page.waitForTimeout(2000)

  console.log('\n=== Dump 2: Sau khi gõ "/" ===')
  const afterSlash = await page.evaluate(() => {
    const result = {
      popperCount: document.querySelectorAll('[data-radix-popper-content-wrapper]').length,
      listboxCount: document.querySelectorAll('[role="listbox"]').length,
      menuCount: document.querySelectorAll('[role="menu"]').length,
      menuitemCount: document.querySelectorAll('[role="menuitem"]').length,
      optionCount: document.querySelectorAll('[role="option"]').length,
      poppers: [],
      listboxes: [],
      menus: [],
      visibleMenuItems: []
    }
    document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach(el => {
      result.poppers.push({
        text: (el.textContent || '').substring(0, 300),
        html: el.outerHTML.substring(0, 500)
      })
    })
    document.querySelectorAll('[role="listbox"], [role="menu"]').forEach(el => {
      result.listboxes.push({
        role: el.getAttribute('role'),
        text: (el.textContent || '').substring(0, 300)
      })
    })
    document.querySelectorAll('[role="option"], [role="menuitem"]').forEach(el => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        result.visibleMenuItems.push({
          role: el.getAttribute('role'),
          text: (el.textContent || '').trim().substring(0, 100)
        })
      }
    })
    return result
  })
  console.log(JSON.stringify(afterSlash, null, 2))

  // Screenshot
  const screenshotPath = '/tmp/slash-menu-debug.png'
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`\n📸 Screenshot: ${screenshotPath}`)

  console.log('\n=== Dump 3: Tìm "+" button trong composer ===')
  const plusInfo = await page.evaluate(() => {
    // Find the "+" button near the composer
    const form = document.querySelector('form') || document.querySelector('[data-testid*="composer"]')
    const result = { plusButtons: [] }
    // Look for buttons with aria-label or text suggesting attachment / more
    const allBtns = document.querySelectorAll('button')
    allBtns.forEach(b => {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase()
      const text = (b.textContent || '').trim()
      const rect = b.getBoundingClientRect()
      if (rect.width < 20 || rect.height < 20) return
      if (aria.includes('attach') || aria.includes('plus') || aria.includes('more') || aria.includes('add') ||
          text === '+' || (b.querySelector('svg') && text === '' && rect.width < 50)) {
        result.plusButtons.push({
          aria,
          text: text.substring(0, 50),
          svg: b.querySelector('svg')?.outerHTML.substring(0, 150)
        })
      }
    })
    return result
  })
  console.log(JSON.stringify(plusInfo, null, 2))

  console.log('\n✅ Done. Ctrl+C để thoát.')
  await new Promise(() => {})
})().catch(e => { console.error('❌', e); process.exit(1) })
