// Scan tabs khi ở chế độ Video: Thành phần / Khung hình / 16:9 / x1 / x2
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

;(async () => {
  const profileDir = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'son-hai-ai-render',
    'browser-profile-0'
  )
  await fs.ensureDir(profileDir)

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  })
  const page = context.pages()[0] || (await context.newPage())

  await page.goto('https://labs.google/fx/vi/tools/flow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })
  await page.waitForTimeout(4000)

  // New project
  const newProj = page.locator('button, div').filter({ hasText: /Dự án mới/i }).last()
  if ((await newProj.count()) > 0) {
    await newProj.click().catch(() => {})
    console.log('✅ Clicked Dự án mới')
    await page.waitForTimeout(4000)
  }

  // Config button
  const cfgBtn = page.locator('button').filter({ hasText: /Nano.*x|Video.*x|Hình ảnh.*x|crop/ }).first()
  console.log('Config btn count:', await cfgBtn.count())
  await cfgBtn.click().catch(() => {})
  await page.waitForTimeout(1500)

  // Click Video tab
  const videoTab = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /videocamVideo/ }).first()
  if ((await videoTab.count()) > 0) {
    await videoTab.click()
    console.log('✅ Clicked Video tab')
  } else {
    console.log('❌ No Video tab found')
  }
  await page.waitForTimeout(2500)

  // Scan new tabs visible after switching to Video
  const tabs = await page.$$eval('button.flow_tab_slider_trigger, button[role="tab"]', (arr) => {
    return arr.map((b) => {
      const r = b.getBoundingClientRect()
      return {
        text: (b.textContent || '').trim().slice(0, 100),
        aria: b.getAttribute('aria-selected') || '',
        visible: r.width > 0 && r.height > 0
      }
    }).filter(t => t.visible)
  })
  console.log('\nTabs after Video click (' + tabs.length + '):')
  tabs.forEach((t, i) => console.log(`  [${i}] ${t.text}   aria-selected=${t.aria}`))

  // Scan entire buttons with relevant keywords
  const allMatches = await page.$$eval('button, [role="button"], div', (arr) => {
    const kw = /Thành phần|Khung hình|components|keyframe/i
    const out = []
    for (const el of arr) {
      const t = (el.textContent || '').trim()
      if (!t || t.length > 80) continue
      if (!kw.test(t)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.height < 10) continue
      out.push({
        tag: el.tagName,
        text: t.slice(0, 80),
        cls: (el.className || '').toString().slice(0, 80),
        role: el.getAttribute('role') || ''
      })
    }
    return out.slice(0, 10)
  })
  console.log('\nThành phần / Khung hình candidates:')
  allMatches.forEach((m, i) => console.log(`  [${i}] <${m.tag} role="${m.role}" cls="${m.cls}"> ${m.text}`))

  console.log('\n✅ Scan video xong')
  await context.close().catch(() => {})
  process.exit(0)
})().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
