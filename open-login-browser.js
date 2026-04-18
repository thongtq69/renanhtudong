const { chromium } = require('playwright-extra')
const stealth = require('puppeteer-extra-plugin-stealth')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')

chromium.use(stealth())

;(async () => {
  const userDataRoot = path.join(os.homedir(), 'Library', 'Application Support', 'son-hai-ai-render')
  const profileIndex = parseInt(process.argv[2] || '0', 10)
  const profileDir = path.join(userDataRoot, `browser-profile-${profileIndex}`)
  await fs.ensureDir(profileDir)

  console.log(`📂 Profile: ${profileDir}`)
  console.log(`🌐 Mở trình duyệt để đăng nhập ChatGPT...`)

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1200, height: 800 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars'
    ]
  })

  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })

  console.log(`✅ Trình duyệt đã mở. Đăng nhập xong anh đóng cửa sổ lại để lưu session.`)

  context.on('close', async () => {
    console.log(`💾 Session đã lưu tại: ${profileDir}`)
    console.log(`📋 Đang copy profile sang 4 browser còn lại...`)
    try {
      for (let i = 1; i <= 4; i++) {
        const dst = path.join(userDataRoot, `browser-profile-${i}`)
        await fs.remove(dst)
        await fs.copy(profileDir, dst)
        console.log(`  ✅ browser-profile-${i}`)
      }
      console.log(`✨ Đã đồng bộ login cho 5 browsers.`)
    } catch (err) {
      console.error('❌ Lỗi copy profile:', err)
    }
    process.exit(0)
  })
})().catch((err) => {
  console.error('❌ Lỗi:', err)
  process.exit(1)
})
