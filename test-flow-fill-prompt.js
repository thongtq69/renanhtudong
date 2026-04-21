// Test từng cách fill prompt để tìm cách Flow nhận được (không báo "Bạn phải cung cấp câu lệnh")
const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

const SAMPLE_IMAGE = '/Users/bephi/Downloads/v6_tiles.png'
const SAMPLE_PROMPT = 'A minimalist product shot on a clean white background, soft studio lighting, high detail. Very subtle shadow if placed on surface.'

;(async () => {
  // Dùng profile-1 (đã copy từ profile-0 — có Flow login) vì profile-0 có thể đang bị app chiếm
  const profileDir = path.join(os.homedir(), 'Library', 'Application Support', 'son-hai-ai-render', 'browser-profile-1')

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars']
  })
  const page = ctx.pages()[0] || (await ctx.newPage())

  console.log('🌐 goto Flow')
  await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(4000)

  // New project
  const newProj = page.locator('button, div').filter({ hasText: /Dự án mới/i }).last()
  if (await newProj.count()) {
    await newProj.click().catch(() => {})
    console.log('✅ clicked Dự án mới')
    await page.waitForTimeout(5000)
  }

  // Config → Image / x1
  const cfgBtn = page.locator('button').filter({ hasText: /Nano.*x|Video.*x|Hình ảnh.*x|crop/ }).first()
  await cfgBtn.click().catch(() => {})
  await page.waitForTimeout(1500)

  const imgTab = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /imageHình ảnh/ }).first()
  if ((await imgTab.getAttribute('aria-selected')) !== 'true') await imgTab.click()
  await page.waitForTimeout(500)

  const x1 = page.locator('button.flow_tab_slider_trigger').filter({ hasText: /^x1$/ }).first()
  await x1.click()
  await page.waitForTimeout(500)

  await cfgBtn.click().catch(() => {}) // đóng panel
  await page.waitForTimeout(1000)
  console.log('⚙️  config image x1 xong')

  // Paste ảnh
  const bytes = await fs.readFile(SAMPLE_IMAGE)
  const base64 = bytes.toString('base64')
  await page.evaluate(async ({ base64, name }) => {
    const bin = atob(base64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const file = new File([arr], name, { type: 'image/png' })
    const tb = document.querySelector('[role="textbox"][contenteditable="true"]')
    tb.focus()
    const dt = new DataTransfer()
    dt.items.add(file)
    tb.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { base64, name: path.basename(SAMPLE_IMAGE) })
  console.log('📎 paste image, chờ thumbnail 10s...')
  await page.waitForTimeout(10000)

  // ==================================================================
  // 4 approach fill prompt — thử lần lượt, sau mỗi lần click Send và đọc toast
  // ==================================================================

  const approaches = [
    {
      name: 'A1-typeKeyboard',
      run: async () => {
        const tb = page.locator('[role="textbox"][contenteditable="true"]').first()
        await tb.click()
        await page.keyboard.press('Meta+A').catch(() => {})
        await page.keyboard.press('Control+A').catch(() => {})
        await page.keyboard.press('Delete').catch(() => {})
        await page.keyboard.type(SAMPLE_PROMPT, { delay: 0 })
      }
    },
    {
      name: 'A2-pressSequentially',
      run: async () => {
        const tb = page.locator('[role="textbox"][contenteditable="true"]').first()
        await tb.click()
        await page.keyboard.press('Meta+A').catch(() => {})
        await page.keyboard.press('Control+A').catch(() => {})
        await page.keyboard.press('Delete').catch(() => {})
        await tb.pressSequentially(SAMPLE_PROMPT, { delay: 8 })
      }
    },
    {
      name: 'A3-clipboardTextPaste',
      run: async () => {
        const tb = page.locator('[role="textbox"][contenteditable="true"]').first()
        await tb.click()
        await page.keyboard.press('Meta+A').catch(() => {})
        await page.keyboard.press('Control+A').catch(() => {})
        await page.keyboard.press('Delete').catch(() => {})
        // Dispatch paste event với text
        await page.evaluate((text) => {
          const tb = document.querySelector('[role="textbox"][contenteditable="true"]')
          tb.focus()
          const dt = new DataTransfer()
          dt.setData('text/plain', text)
          dt.setData('text/html', text)
          tb.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
        }, SAMPLE_PROMPT)
      }
    },
    {
      name: 'A4-execCommandInsertText',
      run: async () => {
        const tb = page.locator('[role="textbox"][contenteditable="true"]').first()
        await tb.click()
        await page.keyboard.press('Meta+A').catch(() => {})
        await page.keyboard.press('Control+A').catch(() => {})
        await page.keyboard.press('Delete').catch(() => {})
        // document.execCommand('insertText', ...) chính xác emit đủ input events
        await page.evaluate((text) => {
          const tb = document.querySelector('[role="textbox"][contenteditable="true"]')
          tb.focus()
          document.execCommand('insertText', false, text)
        }, SAMPLE_PROMPT)
      }
    }
  ]

  const results = []

  for (const a of approaches) {
    console.log(`\n==== Thử ${a.name} ====`)
    // clear textbox
    try {
      const tb = page.locator('[role="textbox"][contenteditable="true"]').first()
      await tb.click().catch(() => {})
      await page.keyboard.press('Meta+A').catch(() => {})
      await page.keyboard.press('Control+A').catch(() => {})
      await page.keyboard.press('Delete').catch(() => {})
      await page.waitForTimeout(400)
    } catch {}

    await a.run()
    await page.waitForTimeout(1500)

    // Đọc text hiển thị trong textbox
    const displayed = await page.evaluate(() => {
      const tb = document.querySelector('[role="textbox"][contenteditable="true"]')
      return tb ? tb.innerText : ''
    })
    console.log(`   UI hiển thị (${displayed.length} chars): "${displayed.slice(0, 60)}"`)

    // Click send, sau 2s đọc toast error nếu có
    const sendBtn = page.locator('button').filter({ hasText: /arrow_forward|^Tạo$/i }).first()
    const disabled = await sendBtn.evaluate((b) => b.disabled || b.getAttribute('aria-disabled') === 'true').catch(() => null)
    console.log(`   send button disabled=${disabled}`)
    if (disabled === true) {
      results.push({ name: a.name, displayed: displayed.length, disabled: true, toast: null, accepted: false })
      continue
    }

    await sendBtn.click().catch(() => {})
    await page.waitForTimeout(2500)

    // Kiểm tra toast "Bạn phải cung cấp câu lệnh"
    const toast = await page.evaluate(() => {
      const t = document.body.innerText || ''
      if (t.includes('Bạn phải cung cấp câu lệnh')) return 'MISSING_PROMPT'
      if (t.includes('must provide') || t.includes('cung cấp câu lệnh')) return 'MISSING_PROMPT'
      return null
    })

    // Check xem có thumbnail progress/result nào không (accepted)
    const accepted = await page.evaluate(() => {
      // Nếu có % progress bar hoặc "generating" state → accepted
      const t = document.body.innerText || ''
      return /\d+%/.test(t) || t.toLowerCase().includes('generating') || t.toLowerCase().includes('đang tạo')
    })

    console.log(`   toast=${toast}, accepted=${accepted}`)
    results.push({ name: a.name, displayed: displayed.length, disabled: false, toast, accepted })

    // Nếu accepted thì break (tìm được approach hoạt động)
    if (accepted && !toast) {
      console.log(`   ✅ ${a.name} WORKS!`)
      break
    }

    // Nếu lỡ có job đang chạy, đợi hủy/dismiss toast rồi sang approach sau
    await page.waitForTimeout(1500)
    // Đóng toast nếu có
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if ((b.textContent || '').trim().toLowerCase().includes('close') || b.getAttribute('aria-label') === 'close') {
          b.click()
        }
      })
    })
  }

  console.log('\n\n=============== KẾT QUẢ ===============')
  results.forEach(r => console.log(JSON.stringify(r)))

  console.log('\nBrowser giữ mở để tự xem. Ctrl+C để thoát.')
  await new Promise(() => {})
})().catch(e => {
  console.error('❌', e.stack || e.message)
  process.exit(1)
})
