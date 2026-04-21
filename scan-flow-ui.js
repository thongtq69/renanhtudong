// Scanner: mở Flow tại profile-0, quét các selector chính để verify reference doc.
// Chạy: node scan-flow-ui.js
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

function section(title) {
  console.log('\n========================================================')
  console.log('  ' + title)
  console.log('========================================================')
}

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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars'
    ]
  })
  const page = context.pages()[0] || (await context.newPage())
  await page.goto('https://labs.google/fx/vi/tools/flow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  })

  section('Landing URL')
  console.log('URL:', page.url())
  console.log('Title:', await page.title())

  await page.waitForTimeout(5000)

  section('Kiểm tra "Dự án mới" button')
  try {
    const btns = await page.$$eval('button', (arr) => {
      const found = []
      for (const b of arr) {
        const t = (b.textContent || '').trim()
        if (/dự án mới|du an moi|new project|nouveau projet/i.test(t)) {
          const r = b.getBoundingClientRect()
          found.push({
            text: t.slice(0, 80),
            visible: r.width > 0 && r.height > 0,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            aria: b.getAttribute('aria-label') || ''
          })
        }
      }
      return found
    })
    console.log(`Tìm được ${btns.length} "Dự án mới":`, JSON.stringify(btns, null, 2))
  } catch (e) {
    console.log('Lỗi:', e.message)
  }

  section('Quét config button (Video.*x|Hình ảnh.*x|Nano.*x|crop)')
  const configBtns = await page.$$eval('button', (arr) => {
    const out = []
    for (const b of arr) {
      const t = (b.textContent || '').trim()
      if (/Video.*x|Hình ảnh.*x|Nano.*x|crop/i.test(t)) {
        const r = b.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          out.push({ text: t.slice(0, 100), w: Math.round(r.width), h: Math.round(r.height) })
        }
      }
    }
    return out
  })
  console.log('Config candidates:', JSON.stringify(configBtns, null, 2))

  // Nếu có "Dự án mới", click thử để xem UI trong project (nơi có panel config)
  section('Click Dự án mới (nếu có) để mở workspace')
  try {
    const newProj = page
      .locator('button, div')
      .filter({ hasText: /Dự án mới|Du an moi/i })
      .last()
    if ((await newProj.count()) > 0) {
      await newProj.click({ timeout: 5000 })
      console.log('✅ Đã click Dự án mới')
      await page.waitForTimeout(5000)
      console.log('URL sau click:', page.url())
    } else {
      console.log('⚠️  Không thấy nút Dự án mới trên trang gốc — có thể đã ở trong project')
    }
  } catch (e) {
    console.log('Lỗi click Dự án mới:', e.message)
  }

  section('Quét lại config button sau khi vào project')
  const configAfter = await page.$$eval('button', (arr) => {
    const out = []
    for (const b of arr) {
      const t = (b.textContent || '').trim()
      if (!t) continue
      if (/Video.*x|Hình ảnh.*x|Nano.*x|crop/i.test(t)) {
        const r = b.getBoundingClientRect()
        out.push({
          text: t.slice(0, 120),
          cls: (b.className || '').slice(0, 120),
          visible: r.width > 0 && r.height > 0
        })
      }
    }
    return out
  })
  console.log('Config btn sau New project:', JSON.stringify(configAfter, null, 2))

  // Click config button để mở panel
  section('Click config button → quét tab Video/Hình ảnh/Thành phần/Khung hình/16:9/x1/x4')
  try {
    const cfgLoc = page
      .locator('button')
      .filter({ hasText: /Video.*x|Hình ảnh.*x|Nano.*x|crop/i })
      .first()
    if ((await cfgLoc.count()) > 0) {
      await cfgLoc.click({ timeout: 5000 })
      console.log('✅ Đã click config')
      await page.waitForTimeout(2000)

      const tabs = await page.$$eval('button.flow_tab_slider_trigger, button[role="tab"]', (arr) => {
        return arr.map((b) => {
          const t = (b.textContent || '').trim()
          const r = b.getBoundingClientRect()
          return {
            text: t.slice(0, 80),
            cls: (b.className || '').slice(0, 80),
            aria: b.getAttribute('aria-selected') || '',
            visible: r.width > 0 && r.height > 0
          }
        })
      })
      console.log(`Flow tabs (${tabs.length}):`, JSON.stringify(tabs, null, 2))
    } else {
      console.log('⚠️  Không thấy config button')
    }
  } catch (e) {
    console.log('Lỗi click config:', e.message)
  }

  section('Quét textbox composer (prompt)')
  const textboxes = await page.$$eval('[contenteditable="true"], textarea', (arr) => {
    return arr.map((el) => {
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        visible: r.width > 0 && r.height > 0,
        w: Math.round(r.width),
        h: Math.round(r.height)
      }
    })
  })
  console.log('Textboxes:', JSON.stringify(textboxes, null, 2))

  section('Quét send button (arrow_forward | Gửi | Send | Tạo)')
  const sendBtns = await page.$$eval('button', (arr) => {
    const out = []
    for (const b of arr) {
      const t = (b.textContent || '').trim()
      const aria = b.getAttribute('aria-label') || ''
      if (
        /arrow_forward/.test(t) ||
        /^gửi$/i.test(t) ||
        /send/i.test(aria) ||
        /gửi|gui/i.test(aria) ||
        /tạo|tao/i.test(aria)
      ) {
        const r = b.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          out.push({
            text: t.slice(0, 60),
            aria: aria.slice(0, 60),
            disabled: b.disabled
          })
        }
      }
    }
    return out.slice(0, 10)
  })
  console.log('Send candidates:', JSON.stringify(sendBtns, null, 2))

  console.log('\n✅ Scan xong. Browser giữ mở — Ctrl+C để thoát.')
  await new Promise(() => {})
})().catch((err) => {
  console.error('❌ Lỗi:', err && err.stack ? err.stack : err)
  process.exit(1)
})
