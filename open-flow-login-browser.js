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
  console.log(`🌐 Mở Chromium để đăng nhập Google → Flow...`)

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

  const pages = context.pages()
  const page = pages.length > 0 ? pages[0] : await context.newPage()
  await page.goto('https://labs.google/fx/vi/tools/flow', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  }).catch((err) => {
    console.log('⚠️  Flow không load ngay:', err.message)
  })

  console.log('')
  console.log('========================================================')
  console.log('✅ Anh hãy đăng nhập Google → Flow trong cửa sổ vừa mở')
  console.log('   Làm xong bấm ĐÓNG CỬA SỔ để script tự động lưu')
  console.log('   session và copy sang 4 profile còn lại.')
  console.log('========================================================')
  console.log('')

  let cleaning = false
  context.on('close', async () => {
    if (cleaning) return
    cleaning = true
    console.log(`💾 Session đã lưu tại: ${profileDir}`)
    console.log(`📋 Đang copy profile sang 4 browser còn lại...`)
    // Skip volatile lock files / broken symlinks mà Chromium tạo runtime
    const SKIP = new Set(['RunningChromeVersion', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])
    try {
      for (let i = 1; i <= 4; i++) {
        const dst = path.join(userDataRoot, `browser-profile-${i}`)
        await fs.remove(dst)
        await fs.copy(profileDir, dst, {
          filter: (src) => !SKIP.has(path.basename(src)),
          dereference: false
        })
        console.log(`  ✅ browser-profile-${i}`)
      }
      console.log(`✨ Đã đồng bộ Flow login cho 5 profile.`)
    } catch (err) {
      console.error('❌ Lỗi copy profile:', err && err.message ? err.message : err)
    }
    process.exit(0)
  })
})().catch((err) => {
  console.error('❌ Lỗi:', err && err.stack ? err.stack : err)
  process.exit(1)
})
