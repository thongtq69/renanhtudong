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
  await page.waitForTimeout(3000)

  // Quét trạng thái page
  const state = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      h1: document.querySelector('h1')?.textContent,
      isTemporaryChat: document.body.innerText.toLowerCase().includes('đoạn chat tạm thời') ||
                       document.body.innerText.toLowerCase().includes('temporary chat'),
      composerBg: (() => {
        const ta = document.querySelector('#prompt-textarea')
        if (!ta) return null
        let el = ta.parentElement
        for (let i = 0; i < 5; i++) {
          const bg = window.getComputedStyle(el).backgroundColor
          if (bg && bg !== 'rgba(0, 0, 0, 0)') return bg
          el = el.parentElement
          if (!el) break
        }
        return 'transparent'
      })()
    }
  })
  console.log('=== State ===')
  console.log(JSON.stringify(state, null, 2))

  await page.screenshot({ path: '/tmp/scan-initial.png' })
  console.log('📸 /tmp/scan-initial.png')

  // Tìm nút toggle temporary chat
  const toggleInfo = await page.evaluate(() => {
    const results = []
    document.querySelectorAll('button').forEach(b => {
      const aria = (b.getAttribute('aria-label') || '').toLowerCase()
      if (aria.includes('tạm thời') || aria.includes('temporary') || aria.includes('hidden') || aria.includes('private')) {
        const r = b.getBoundingClientRect()
        if (r.width > 0) results.push({ aria, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
      }
    })
    return results
  })
  console.log('\n=== Toggle buttons (tạm thời) ===')
  console.log(JSON.stringify(toggleInfo, null, 2))

  // Thử click link "Đoạn chat mới" (new chat) để thoát temp mode
  const newChatClicked = await page.evaluate(() => {
    const links = document.querySelectorAll('a, button')
    for (const el of links) {
      const text = (el.textContent || '').trim().toLowerCase()
      if (text === 'đoạn chat mới' || text === 'new chat') {
        const href = el.getAttribute('href')
        if (href === '/' || !href) {
          el.click()
          return { text, href }
        }
      }
    }
    return null
  })
  console.log('\n=== New chat click ===')
  console.log(JSON.stringify(newChatClicked, null, 2))
  await page.waitForTimeout(3000)

  // Re-scan sau click new chat
  const state2 = await page.evaluate(() => ({
    url: location.href,
    h1: document.querySelector('h1')?.textContent,
    isTemporaryChat: document.body.innerText.toLowerCase().includes('đoạn chat tạm thời')
  }))
  console.log('\n=== State after new chat ===')
  console.log(JSON.stringify(state2, null, 2))

  await page.screenshot({ path: '/tmp/scan-after-newchat.png' })

  // Click + button, dump menu
  const plusBtn = page.locator('button[aria-label*="thêm tệp" i]').first()
  await plusBtn.click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/scan-after-plus.png' })

  const menuDump = await page.evaluate(() => {
    // Tìm các role=menu, popper, và list tất cả text nodes visible có text ngắn
    const visibleTexts = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while (node = walker.nextNode()) {
      const text = node.textContent.trim()
      if (!text || text.length > 40) continue
      const parent = node.parentElement
      if (!parent) continue
      const r = parent.getBoundingClientRect()
      if (r.width < 10 || r.height < 10) continue
      // Chỉ lấy text hiển thị trong area composer/menu (y > 300, không sidebar)
      if (r.y < 200) continue
      if (r.x < 250 && r.width < 250) continue
      const style = window.getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      visibleTexts.push({
        text,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        tag: parent.tagName,
        role: parent.getAttribute('role'),
        parentRole: parent.parentElement?.getAttribute('role')
      })
    }
    return visibleTexts.slice(0, 60)
  })
  console.log('\n=== Menu visible texts (y>200, x>250) ===')
  console.log(JSON.stringify(menuDump, null, 2))

  console.log('\n✅ Done')
  await new Promise(() => {})
})().catch(e => { console.error('❌', e); process.exit(1) })
