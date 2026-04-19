import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import { chromium } from 'playwright-extra'
import type { BrowserContext, Page } from 'playwright'
import stealth from 'puppeteer-extra-plugin-stealth'
import fs from 'fs-extra'
import path from 'path'
import PDFDocument from 'pdfkit'
import Jimp from 'jimp'

chromium.use(stealth())

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// --- IPC Handlers ---

ipcMain.handle('select-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (canceled) return null
  return filePaths[0]
})

ipcMain.handle('select-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Executable', extensions: ['exe'] }]
  })
  if (canceled) return null
  return filePaths[0]
})

ipcMain.handle('read-prompt', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  })
  if (canceled) return null
  return await fs.readFile(filePaths[0], 'utf-8')
})

ipcMain.handle('save-prompt', async (_event, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: [{ name: 'Text Files', extensions: ['txt'] }],
    defaultPath: 'prompt_template.txt'
  })
  if (canceled) return false
  await fs.writeFile(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('select-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
  })
  if (canceled) return null
  return filePaths[0]
})

// --- Watermark Images Handler ---
ipcMain.handle('watermark-images', async (event, { logoImage, logoSize, logoPosition, outputFolder }) => {
  try {
    const log = (msg: string) => {
      event.sender.send('automation-log', msg)
    }
    
    log('🖼️ Bắt đầu gắn logo lên ảnh...')
    
    if (!logoImage || !(await fs.pathExists(logoImage))) {
      log('❌ Vui lòng chọn file logo!')
      return { success: false, message: 'Vui lòng chọn file logo!' }
    }
    
    if (!outputFolder || !(await fs.pathExists(outputFolder))) {
      log('❌ Thư mục tải ảnh về không tồn tại!')
      return { success: false, message: 'Thư mục tải ảnh về không tồn tại!' }
    }
    
    const logoFolder = path.join(outputFolder, 'LOGO')
    await fs.ensureDir(logoFolder)
    log(`📁 Tạo thư mục: ${logoFolder}`)
    
    const allFiles = await fs.readdir(outputFolder)
    const imageFiles = allFiles
      .filter(f => ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase()))
      .map(f => path.join(outputFolder, f))
    
    if (imageFiles.length === 0) {
      log('❌ Không tìm thấy ảnh trong thư mục!')
      return { success: false, message: 'Không tìm thấy ảnh trong thư mục!' }
    }
    
    log(`📁 Tìm thấy ${imageFiles.length} ảnh cần xử lý`)
    
    const logo = await Jimp.read(logoImage)
    const logoWidth = logo.getWidth()
    const logoHeight = logo.getHeight()
    
    const sampleImage = await Jimp.read(imageFiles[0])
    const baseWidth = sampleImage.getWidth()
    const baseHeight = sampleImage.getHeight()
    
    const newLogoWidth = Math.round(baseWidth * (logoSize / 100))
    const newLogoHeight = Math.round(newLogoWidth * (logoHeight / logoWidth))
    logo.resize(newLogoWidth, newLogoHeight)
    
    const padding = 20
    let logoX = padding
    let logoY = padding
    
    if (logoPosition === 2) logoX = baseWidth - newLogoWidth - padding
    else if (logoPosition === 3) logoY = baseHeight - newLogoHeight - padding
    else if (logoPosition === 4) {
      logoX = baseWidth - newLogoWidth - padding
      logoY = baseHeight - newLogoHeight - padding
    }
    else if (logoPosition === 5) {
      logoX = Math.round((baseWidth - newLogoWidth) / 2)
      logoY = Math.round((baseHeight - newLogoHeight) / 2)
    }
    
    let processed = 0
    
    for (const imgPath of imageFiles) {
      const fileName = path.basename(imgPath)
      const outputPath = path.join(logoFolder, fileName)
      
      log(`🖼️ Đang xử lý: ${fileName}`)
      
      const image = await Jimp.read(imgPath)
      const imgWidth = image.getWidth()
      const imgHeight = image.getHeight()
      
      const scaleFactor = Math.min(imgWidth / baseWidth, imgHeight / baseHeight)
      const scaledLogo = logo.clone()
      scaledLogo.resize(Math.round(newLogoWidth * scaleFactor), Math.round(newLogoHeight * scaleFactor))
      
      const actualLogoX = Math.round(logoX * scaleFactor)
      const actualLogoY = Math.round(logoY * scaleFactor)
      
      image.composite(scaledLogo, actualLogoX, actualLogoY)
      
      const ext = path.extname(imgPath).toLowerCase()
      if (ext === '.jpg' || ext === '.jpeg') {
        await image.quality(95).writeAsync(outputPath)
      } else {
        await image.writeAsync(outputPath)
      }
      
      processed++
      log(`✅ Đã gắn logo: ${fileName}`)
    }
    
    log(`🎉 Hoàn tất! Đã gắn logo lên ${processed} ảnh`)
    shell.openPath(logoFolder)
    
    return { success: true, processedCount: processed, outputFolder: logoFolder }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('Watermark error:', errorMsg)
    return { success: false, message: errorMsg }
  }
})

// --- Create PDF Handler ---
ipcMain.handle('create-pdf', async (event, { coverImage, outputFolder }) => {
  try {
    const log = (msg: string) => {
      event.sender.send('automation-log', msg)
    }
    
    log('📄 Bắt đầu tạo PDF...')
    
    if (!outputFolder || !(await fs.pathExists(outputFolder))) {
      log('❌ Thư mục tải ảnh về không tồn tại!')
      return { success: false, message: 'Thư mục tải ảnh về không tồn tại!' }
    }
    
    const logoFolder = path.join(outputFolder, 'LOGO')
    let imageSourceFolder = outputFolder
    
    if (await fs.pathExists(logoFolder)) {
      const logoFiles = await fs.readdir(logoFolder)
      const hasImages = logoFiles.some(f => ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase()))
      if (hasImages) {
        imageSourceFolder = logoFolder
        log('📁 Phát hiện thư mục LOGO - sẽ tạo PDF từ ảnh đã gắn logo')
      }
    }
    
    const allFiles = await fs.readdir(imageSourceFolder)
    let imageFiles = allFiles
      .filter(f => ['.jpg', '.jpeg', '.png'].includes(path.extname(f).toLowerCase()))
      .map(f => path.join(imageSourceFolder, f))
    
    imageFiles.sort()
    
    if (imageFiles.length === 0) {
      log('❌ Không tìm thấy ảnh trong thư mục!')
      return { success: false, message: 'Không tìm thấy ảnh trong thư mục!' }
    }
    
    log(`📁 Tìm thấy ${imageFiles.length} ảnh`)
    
    let coverPath = coverImage && await fs.pathExists(coverImage) ? coverImage : imageFiles[0]
    const productImages = imageFiles
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outputPath = path.join(outputFolder, `SanPham_${timestamp}.pdf`)
    
    const doc = new PDFDocument({ 
      autoFirstPage: false,
      margin: 0
    })
    const writeStream = fs.createWriteStream(outputPath)
    doc.pipe(writeStream)
    
    const coverImg = await Jimp.read(coverPath)
    const coverWidth = coverImg.getWidth()
    const coverHeight = coverImg.getHeight()
    doc.addPage({ size: [coverWidth, coverHeight], margin: 0 })
    const coverBuffer = await coverImg.getBufferAsync(Jimp.MIME_PNG)
    doc.image(coverBuffer, 0, 0, {
      width: coverWidth,
      height: coverHeight
    })
    log('✅ Đã thêm trang bìa')
    
    for (let i = 0; i < productImages.length; i++) {
      const imgPath = productImages[i]
      log(`🖼️ Đang thêm trang sản phẩm ${i + 1}/${productImages.length}...`)
      
      const img = await Jimp.read(imgPath)
      const imgWidth = img.getWidth()
      const imgHeight = img.getHeight()
      doc.addPage({ size: [imgWidth, imgHeight], margin: 0 })
      
      const imgBuffer = await img.getBufferAsync(Jimp.MIME_PNG)
      doc.image(imgBuffer, 0, 0, {
        width: imgWidth,
        height: imgHeight
      })
      
      log(`✅ Đã thêm trang ${i + 1}`)
    }
    
    doc.end()
    
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
    
    log(`🎉 Hoàn tất! PDF: ${outputPath}`)
    shell.showItemInFolder(outputPath)
    
    return { success: true, outputPath }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('PDF error:', errorMsg)
    return { success: false, message: errorMsg }
  }
})

// ====== 5 BROWSERS AUTOMATION LOGIC ======

let isRunning = false
let shouldStop = false

const getErrorMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err)
}

// ========== BACKGROUND POPUP WATCHER ==========
// Chạy song song suốt lifecycle tab, tự click nút "Đã hiểu"/"Got it" mỗi 1.5s
function startPopupWatcher(page: Page, label: string, log: (msg: string) => void): () => void {
  let stopped = false
  const loop = async (): Promise<void> => {
    while (!stopped && !shouldStop) {
      try {
        if (page.isClosed()) break
        const clicked = await page.evaluate(() => {
          const keywords = ['đã hiểu', 'got it', 'got it!', 'ok', 'ok!', 'understand', 'tôi hiểu']
          const buttons = document.querySelectorAll('button, [role="button"]')
          for (const el of Array.from(buttons)) {
            const text = (el.textContent || '').trim().toLowerCase()
            if (!text || text.length > 30) continue
            if (!keywords.some(k => text === k || text.includes(k))) continue
            const style = window.getComputedStyle(el as HTMLElement)
            const rect = (el as HTMLElement).getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && parseFloat(style.opacity) > 0) {
              ;(el as HTMLElement).click()
              return text
            }
          }
          return null
        })
        if (clicked) log(`⚠️ ${label}: auto-dismiss popup ("${clicked}")`)
      } catch {}
      await new Promise(r => setTimeout(r, 1500))
    }
  }
  loop()
  return () => { stopped = true }
}

// ========== CHỜ SEND BUTTON ENABLED ==========
// Sau upload + fill, button "Gửi lời nhắc" có thể còn disabled (ChatGPT đang xử lý upload).
// Đợi nó enable trước khi click để tránh timeout.
async function waitForSendEnabled(page: Page, maxWaitMs: number = 60000): Promise<boolean> {
  const start = Date.now()
  const selector = 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Gửi lời nhắc"]'
  while (Date.now() - start < maxWaitMs && !shouldStop) {
    if (page.isClosed()) return false
    const enabled = await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement | null
      if (!btn) return false
      return !btn.disabled && !btn.hasAttribute('aria-disabled')
    }, selector).catch(() => false)
    if (enabled) return true
    await page.waitForTimeout(500)
  }
  return false
}

// ========== CHỜ ĐẾN KHI KHÔNG CÒN POPUP ==========
// Block trước mỗi bước input (upload/fill/send) để popup không cắt ngang
async function ensureNoPopup(page: Page, maxWaitMs: number = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs && !shouldStop) {
    if (page.isClosed()) return
    const hasPopup = await page.evaluate(() => {
      const t = (document.body?.innerText || '').toLowerCase()
      return t.includes('quá nhiều yêu cầu') || t.includes('too many requests') ||
             t.includes('rate limit') || t.includes('limit exceeded')
    }).catch(() => false)
    if (!hasPopup) return
    // Thử dismiss ngay
    await page.evaluate(() => {
      const keywords = ['đã hiểu', 'got it', 'got it!', 'ok', 'ok!', 'understand', 'tôi hiểu']
      const buttons = document.querySelectorAll('button, [role="button"]')
      for (const el of Array.from(buttons)) {
        const text = (el.textContent || '').trim().toLowerCase()
        if (!text || text.length > 30) continue
        if (!keywords.some(k => text === k || text.includes(k))) continue
        const style = window.getComputedStyle(el as HTMLElement)
        const rect = (el as HTMLElement).getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none') {
          ;(el as HTMLElement).click()
          return
        }
      }
    }).catch(() => {})
    await page.waitForTimeout(800)
  }
}

// ========== HÀM XỬ LÝ POPUP TỰ ĐỘNG ==========
async function dismissPopup(page: Page, log: (msg: string) => void): Promise<boolean> {
  try {
    // Kiểm tra xem có popup nào không
    const hasPopup = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || ''
      const popups = [
        'too many', 'rate limit', 'try again', 'limit exceeded',
        'please wait', 'got it', 'understand',
        'quá nhiều yêu cầu', 'quá nhiều', 'thử lại sau', 'vui lòng đợi', 'đã hiểu', 'tôi hiểu'
      ]
      return popups.some(kw => text.includes(kw))
    })

    if (!hasPopup) {
      return false
    }

    log(`⚠️ Phát hiện popup, đang xử lý...`)

    // METHOD 1: JavaScript DOM - Tìm button có text liên quan
    const clicked = await page.evaluate(() => {
      const validTexts = [
        'got it', 'got it!', 'ok', 'OK', 'Ok', 'đã hiểu', 'đã đồng ý',
        'i understand', 'i get it', 'understood', 'alright', 'close', 
        'try again', 'continue'
      ]
      
      const allElements = document.querySelectorAll('button, [role="button"], span, div, a')
      for (const el of Array.from(allElements)) {
        const text = (el.textContent || '').trim().toLowerCase()
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()
        
        for (const validText of validTexts) {
          if (text === validText || text.includes(validText) || ariaLabel.includes(validText)) {
            const style = window.getComputedStyle(el as HTMLElement)
            const rect = (el as HTMLElement).getBoundingClientRect()
            
            if (rect.width > 0 && rect.height > 0 && 
                style.display !== 'none' && style.visibility !== 'hidden' && 
                parseFloat(style.opacity) > 0) {
              try {
                (el as HTMLElement).click()
                return true
              } catch {
                el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
                return true
              }
            }
          }
        }
      }
      return false
    })

    if (clicked) {
      log(`✅ Đã click nút popup bằng JS`)
      await page.waitForTimeout(2000)
      return true
    }

    // METHOD 2: Playwright Locator cho các nút phổ biến
    const buttonSelectors = [
      'button:has-text("Got it")', 'button:has-text("Got it!")',
      'button:has-text("OK")', 'button:has-text("Ok")', 'button:has-text("OK!")',
      'button:has-text("I understand")', 'button:has-text("Close")',
      'button:has-text("Continue")', 'button:has-text("Try again")',
      '[role="dialog"] button', '[role="alert"] button',
      'button[aria-label*="close" i]', 'button[aria-label*="OK" i]',
      '[data-testid="popup"] button', '[data-testid="modal"] button'
    ]

    for (const sel of buttonSelectors) {
      try {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 500 })) {
          log(`✅ Click nút: ${sel}`)
          await btn.click({ force: true })
          await page.waitForTimeout(2000)
          return true
        }
      } catch {}
    }

    // METHOD 3: Click vào dialog/overlay backdrop để đóng
    try {
      const dialog = page.locator('[role="dialog"], [data-testid="popup"], [data-testid="modal"]').last()
      if (await dialog.isVisible({ timeout: 500 })) {
        const dialogBox = await dialog.boundingBox()
        if (dialogBox) {
          // Click vào backdrop (bên ngoài dialog)
          await page.mouse.click(dialogBox.x - 100, dialogBox.y + dialogBox.height / 2)
          await page.waitForTimeout(1000)
        }
      }
    } catch {}

    // METHOD 4: Escape key
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1000)

    return true

  } catch (e) {
    log(`⚠️ Lỗi xử lý popup: ${e.message}`)
    return false
  }
}

// ========== HÀM ĐỢI VÀ XỬ LÝ POPUP RATE LIMIT ==========
async function waitForRateLimitPopup(
  page: Page,
  maxWaitTime: number,
  log: (msg: string) => void
): Promise<boolean> {
  const startTime = Date.now()
  
  while (Date.now() - startTime < maxWaitTime && !shouldStop) {
    // Kiểm tra popup rate limit
    const hasRateLimit = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || ''
      return ['too many', 'rate limit', 'try again later', 'limit exceeded', 'please wait',
              'quá nhiều yêu cầu', 'quá nhiều', 'thử lại sau', 'vui lòng đợi', 'vui lòng chờ']
        .some(kw => text.includes(kw))
    })

    if (hasRateLimit) {
      log(`⚠️ Phát hiện popup "Too many requests", đang xử lý...`)
      
      // Thử click nhiều lần để tìm nút "Got it"
      for (let i = 0; i < 5; i++) {
        const clicked = await page.evaluate(() => {
          const texts = ['got it', 'got it!', 'ok', 'ok!', 'đã hiểu', 'tôi hiểu', 'understand', 'close', 'đóng']
          const allElements = document.querySelectorAll('button, [role="button"]')
          
          for (const el of Array.from(allElements)) {
            const text = (el.textContent || '').trim().toLowerCase()
            for (const t of texts) {
              if (text.includes(t)) {
                const style = window.getComputedStyle(el as HTMLElement)
                const rect = (el as HTMLElement).getBoundingClientRect()
                if (rect.width > 0 && rect.height > 0 && 
                    style.display !== 'none' && parseFloat(style.opacity) > 0) {
                  el.click()
                  return true
                }
              }
            }
          }
          return false
        })

        if (clicked) {
          log(`✅ Đã click nút Got it!`)
          await page.waitForTimeout(3000)
          break
        }
        
        await page.waitForTimeout(500)
      }
    }

    await page.waitForTimeout(2000)
  }
  
  return true
}

// ========== HÀM ĐỢI PROMPT HOÀN THÀNH ==========
async function waitForPromptComplete(
  page: Page, 
  maxWaitTime: number = 120000,
  log: (msg: string) => void
): Promise<boolean> {
  const startTime = Date.now()
  let lastTextLength = 0
  let stableCount = 0
  let rateLimitCount = 0
  
  while (Date.now() - startTime < maxWaitTime && !shouldStop) {
    // Kiểm tra popup rate limit TRƯỚC
    const hasRateLimit = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || ''
      return ['too many', 'rate limit', 'try again later', 'limit exceeded',
              'quá nhiều yêu cầu', 'quá nhiều', 'thử lại sau', 'vui lòng đợi']
        .some(kw => text.includes(kw))
    })
    
    if (hasRateLimit) {
      rateLimitCount++
      log(`⚠️ Browser: Phát hiện popup rate limit (lần ${rateLimitCount})`)
      
      // Thử click nút Got it nhiều lần
      let gotItClicked = false
      for (let i = 0; i < 10; i++) {
        const clicked = await page.evaluate(() => {
          const texts = ['got it', 'got it!', 'ok', 'ok!', 'understand', 'đã hiểu', 'tôi hiểu', 'đóng', 'close']
          const allElements = document.querySelectorAll('button, [role="button"]')
          
          for (const el of Array.from(allElements)) {
            const text = (el.textContent || '').trim().toLowerCase()
            for (const t of texts) {
              if (text.includes(t)) {
                const style = window.getComputedStyle(el as HTMLElement)
                const rect = (el as HTMLElement).getBoundingClientRect()
                if (rect.width > 0 && rect.height > 0 && 
                    style.display !== 'none' && parseFloat(style.opacity) > 0) {
                  el.click()
                  return true
                }
              }
            }
          }
          return false
        })

        if (clicked) {
          log(`✅ Đã click "Got it"!`)
          gotItClicked = true
          await page.waitForTimeout(5000) // Đợi 5 giây sau khi click
          break
        }
        
        await page.waitForTimeout(1000)
      }
      
      if (!gotItClicked) {
        log(`⚠️ Không tìm thấy nút Got it, thử reload trang...`)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3000)
      }
      
      continue // Quay lại kiểm tra
    }
    
    // Reset rate limit count nếu không có popup
    rateLimitCount = 0
    
    // Kiểm tra xem prompt đã hoàn thành chưa
    const assistantMsgs = page.locator('[data-message-author-role="assistant"]')
    const count = await assistantMsgs.count()
    
    if (count > 0) {
      const lastMsg = assistantMsgs.last()
      const preElement = lastMsg.locator('pre').last()
      
      let currentText = ''
      if (await preElement.count() > 0) {
        currentText = await preElement.innerText()
      } else {
        currentText = await lastMsg.innerText()
      }
      
      if (currentText.length > 0 && currentText.length === lastTextLength) {
        // Nhận diện response đã xong bằng:
        // 1) Có action buttons bên dưới (Copy/Sao chép, thumbs, share, regenerate)
        // 2) Nút "Stop generating" đã biến mất
        // 3) Text có ``` (code block)
        // 4) Text đã stable nhiều chu kỳ (fallback)
        const hasActionBtn = await lastMsg.locator(
          'button:has-text("Copy"), [aria-label*="Copy" i], [aria-label*="Sao chép" i], ' +
          '[aria-label*="thumbs" i], [aria-label*="thích" i], [aria-label*="chia sẻ" i], ' +
          '[aria-label*="share" i], [aria-label*="regenerate" i], [aria-label*="tạo lại" i]'
        ).count() > 0
        const stopBtnCount = await page.locator(
          'button[data-testid="stop-button"], button[aria-label*="Stop streaming" i], button[aria-label*="Stop generating" i], button[aria-label*="Dừng phản hồi" i], button[aria-label*="Dừng tạo" i]'
        ).count()
        const stillGenerating = stopBtnCount > 0
        if (!stillGenerating && (hasActionBtn || currentText.includes('```') || stableCount >= 5)) {
          stableCount++
          if (stableCount >= 3) {
            log('✅ Prompt hoàn thành!')
            return true
          }
        } else {
          stableCount++
        }
      } else {
        lastTextLength = currentText.length
        stableCount = 0
      }
    }
    
    await page.waitForTimeout(1000)
  }
  
  return false
}

// ========== HÀM ĐỢI ẢNH HOÀN THÀNH ==========
async function waitForImageReady(
  page: Page,
  maxWaitTime: number = 180000,
  log: (msg: string) => void
): Promise<boolean> {
  const startTime = Date.now()
  let rateLimitCount = 0
  
  while (Date.now() - startTime < maxWaitTime && !shouldStop) {
    // Kiểm tra popup rate limit TRƯỚC
    const hasRateLimit = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || ''
      return ['too many', 'rate limit', 'try again later', 'limit exceeded',
              'quá nhiều yêu cầu', 'quá nhiều', 'thử lại sau', 'vui lòng đợi']
        .some(kw => text.includes(kw))
    })
    
    if (hasRateLimit) {
      rateLimitCount++
      log(`⚠️ Browser: Phát hiện popup rate limit (lần ${rateLimitCount})`)
      
      // Thử click nút Got it nhiều lần
      let gotItClicked = false
      for (let i = 0; i < 10; i++) {
        const clicked = await page.evaluate(() => {
          const texts = ['got it', 'got it!', 'ok', 'ok!', 'understand', 'đã hiểu', 'tôi hiểu', 'đóng', 'close']
          const allElements = document.querySelectorAll('button, [role="button"]')
          
          for (const el of Array.from(allElements)) {
            const text = (el.textContent || '').trim().toLowerCase()
            for (const t of texts) {
              if (text.includes(t)) {
                const style = window.getComputedStyle(el as HTMLElement)
                const rect = (el as HTMLElement).getBoundingClientRect()
                if (rect.width > 0 && rect.height > 0 && 
                    style.display !== 'none' && parseFloat(style.opacity) > 0) {
                  el.click()
                  return true
                }
              }
            }
          }
          return false
        })

        if (clicked) {
          log(`✅ Đã click "Got it"!`)
          gotItClicked = true
          await page.waitForTimeout(5000) // Đợi 5 giây sau khi click
          break
        }
        
        await page.waitForTimeout(1000)
      }
      
      if (!gotItClicked) {
        log(`⚠️ Không tìm thấy nút Got it, thử reload trang...`)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3000)
      }
      
      continue // Quay lại kiểm tra
    }
    
    // Reset rate limit count nếu không có popup
    rateLimitCount = 0
    
    // Kiểm tra nút Stop/Dừng — còn = vẫn đang stream
    const stillGenerating = await page.locator(
      'button[data-testid="stop-button"], button[aria-label*="Stop streaming" i], button[aria-label*="Stop generating" i], button[aria-label*="Dừng phản hồi" i], button[aria-label*="Dừng tạo" i]'
    ).count() > 0

    // Scan TẤT CẢ img > 200px, lấy cái lớn nhất đã load xong (ảnh generated không nằm trong [data-message-author-role="assistant"])
    type BestImg = { src: string; w: number; h: number; nw: number; nh: number }
    let bestImg: BestImg | null = null
    if (!stillGenerating) {
      try {
        bestImg = await page.evaluate((): BestImg | null => {
          const imgs = document.querySelectorAll('img')
          let best: BestImg | null = null
          imgs.forEach(img => {
            const el = img as HTMLImageElement
            const r = el.getBoundingClientRect()
            if (r.width < 200 || r.height < 200) return
            if (!el.src || el.src.startsWith('data:')) return
            if (!el.complete || el.naturalWidth < 200) return
            const area = r.width * r.height
            if (!best || area > best.w * best.h) {
              best = { src: el.src, w: r.width, h: r.height, nw: el.naturalWidth, nh: el.naturalHeight }
            }
          })
          return best
        })
      } catch {}
    }

    if (bestImg) {
      const hasEditOverlay = await page.locator(
        'button:has-text("Chỉnh sửa"), button:has-text("Edit"), [aria-label*="Chỉnh sửa" i], [aria-label*="Edit image" i]'
      ).count() > 0
      const hasActionBtn = await page.locator(
        'button:has-text("Copy"), [aria-label*="Copy" i], [aria-label*="Sao chép" i], [aria-label*="chia sẻ" i]'
      ).count() > 0

      if (hasEditOverlay || hasActionBtn) {
        await page.waitForTimeout(3000)
        const stableSrc = await page.evaluate((prevSrc: string) => {
          const imgs = document.querySelectorAll('img')
          for (const img of Array.from(imgs)) {
            if ((img as HTMLImageElement).src === prevSrc) return true
          }
          return false
        }, bestImg.src)
        if (stableSrc) {
          log(`✅ Ảnh đã hoàn thiện (${Math.round(bestImg.w)}x${Math.round(bestImg.h)}, natural ${bestImg.nw}x${bestImg.nh})`)
          return true
        }
      }
    }

    const elapsed = Date.now() - startTime
    if (elapsed % 30000 < 2000) {
      log(`⏳ Đang chờ ảnh hoàn thành... (${Math.round(elapsed / 1000)}s/${Math.round(maxWaitTime / 1000)}s)`)
    }

    await page.waitForTimeout(2000)
  }

  return false
}

// ========== HÀM EXTRACT PROMPT ==========
async function extractPrompt(page: Page, log: (msg: string) => void): Promise<string> {
  try {
    const lastMsg = page.locator('[data-message-author-role="assistant"]').last()
    const preElement = lastMsg.locator('pre').last()
    
    let extractedPrompt = ''
    
    if (await preElement.count() > 0) {
      extractedPrompt = await preElement.innerText()
    } else {
      let fullText = await lastMsg.innerText()
      if (fullText.includes('```')) {
        const blocks = fullText.split('```')
        extractedPrompt = blocks[blocks.length - 2]
        extractedPrompt = extractedPrompt.replace(/^[a-zA-Z]+\n/, '')
      } else {
        extractedPrompt = fullText
      }
    }
    
    extractedPrompt = extractedPrompt.replace(/Copy code/gi, '').trim()
    return extractedPrompt
    
  } catch (e) {
    log(`❌ Lỗi extract prompt: ${e.message}`)
    return ''
  }
}

// ========== HÀM TẢI ẢNH ==========
async function downloadImage(
  page: Page,
  pageIndex: number,
  finalSavePath: string,
  log: (msg: string) => void
): Promise<boolean> {
  try {
    log(`🔍 Browser ${pageIndex + 1}: Đang xác nhận ảnh đã tạo...`)

    // Scan TẤT CẢ img > 200px, lấy cái lớn nhất đã load xong (ảnh generated không nằm trong [data-message-author-role="assistant"])
    type TargetImgInfo = { src: string; w: number; h: number; nw: number }
    const targetImgInfo: TargetImgInfo | null = await page.evaluate((): TargetImgInfo | null => {
      const imgs = document.querySelectorAll('img')
      let best: TargetImgInfo | null = null
      imgs.forEach(img => {
        const el = img as HTMLImageElement
        const r = el.getBoundingClientRect()
        if (r.width < 200 || r.height < 200) return
        if (!el.src || el.src.startsWith('data:')) return
        if (!el.complete || el.naturalWidth < 200) return
        const area = r.width * r.height
        if (!best || area > best.w * best.h) {
          best = { src: el.src, w: r.width, h: r.height, nw: el.naturalWidth }
        }
      })
      return best
    })

    if (!targetImgInfo) {
      log(`❌ Browser ${pageIndex + 1}: Không tìm thấy ảnh hợp lệ`)
      return false
    }

    log(`✅ Browser ${pageIndex + 1}: Target ảnh ${Math.round(targetImgInfo.w)}x${Math.round(targetImgInfo.h)} (natural ${targetImgInfo.nw}px)`)

    // ===== TẢI QUA URL FETCH (ưu tiên — nhanh + không cần lightbox) =====
    try {
      const bytes = await page.evaluate(async (url: string) => {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const ab = await r.arrayBuffer()
        return Array.from(new Uint8Array(ab))
      }, targetImgInfo.src)
      await fs.writeFile(finalSavePath, Buffer.from(bytes))
      log(`✅ Browser ${pageIndex + 1}: Đã lưu (${bytes.length} bytes) tại ${finalSavePath}`)
      return true
    } catch (err) {
      log(`⚠️ Browser ${pageIndex + 1}: Fetch URL lỗi (${getErrorMessage(err)}), thử qua lightbox...`)
    }

    // ===== FALLBACK: click lightbox + download button =====
    const targetImage = page.locator(`img[src="${targetImgInfo.src.replace(/"/g, '\\"')}"]`).first()
    const targetBox = { x: 0, y: 0, width: targetImgInfo.w, height: targetImgInfo.h }
    try {
      const b = await targetImage.boundingBox()
      if (b) { targetBox.x = b.x; targetBox.y = b.y; targetBox.width = b.width; targetBox.height = b.height }
    } catch {}

    // ===== BƯỚC 2: CLICK VÀO ẢNH ĐỂ MỞ LIGHTBOX =====
    log(`🖼️ Browser ${pageIndex + 1}: Click vào ảnh...`)
    await targetImage.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)

    // Click vào ảnh
    if (targetBox && targetBox.width > 0 && targetBox.height > 0) {
      await page.mouse.click(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
    } else {
      await targetImage.click({ force: true })
    }

    // Đợi lightbox mở
    await page.waitForTimeout(2000)
    log(`✅ Browser ${pageIndex + 1}: Đã click vào ảnh`)

    // ===== BƯỚC 3: TÌM VÀ NHẤN NÚT TẢI XUỐNG =====
    log(`📥 Browser ${pageIndex + 1}: Đang tìm nút tải xuống...`)

    // Đợi lightbox xuất hiện
    await page.waitForTimeout(1500)

    // Tìm nút download - thử nhiều cách
    let clicked = false

    // Cách 1: Tìm nút có aria-label chứa "download"
    const downloadSelectors = [
      'button[aria-label*="download" i]',
      'button[aria-label*="Download" i]',
      'button[aria-label*="save" i]',
      'button[aria-label*="Save" i]',
      '[data-testid="download"]',
    ]

    for (const sel of downloadSelectors) {
      try {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 500 })) {
          log(`📥 Browser ${pageIndex + 1}: Click nút download (${sel})`)
          await btn.click({ force: true })
          clicked = true
          break
        }
      } catch {}
    }

    // Cách 2: Tìm tất cả button và kiểm tra SVG icon
    if (!clicked) {
      const allButtons = await page.locator('button').all()
      for (const btn of allButtons) {
        try {
          const isVisible = await btn.isVisible()
          if (!isVisible) continue

          const btnBox = await btn.boundingBox()
          if (!btnBox || btnBox.width < 30 || btnBox.height < 30) continue

          // Kiểm tra xem có icon download không (SVG arrow-down)
          const hasDownloadIcon = await btn.evaluate((el) => {
            const svg = el.querySelector('svg')
            if (!svg) return false
            const html = svg.outerHTML.toLowerCase()
            return html.includes('arrow') ||
                   html.includes('download') ||
                   html.includes('m12') ||
                   html.includes('20 20') ||
                   (html.includes('path') && html.includes('16'))
          })

          if (hasDownloadIcon) {
            log(`📥 Browser ${pageIndex + 1}: Click nút có icon download`)
            await btn.click({ force: true })
            clicked = true
            break
          }
        } catch {}
      }
    }

    // Cách 3: Click vào vị trí nút download trong lightbox
    if (!clicked) {
      log(`🔍 Browser ${pageIndex + 1}: Thử click vị trí nút download...`)

      const dialog = page.locator('[role="dialog"]').last()
      if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        const dialogBox = await dialog.boundingBox()
        if (dialogBox) {
          // Nút download thường ở góc phải trên
          const downloadX = dialogBox.x + dialogBox.width - 60
          const downloadY = dialogBox.y + 50
          await page.mouse.click(downloadX, downloadY)
          clicked = true
        }
      }

      // Thử tìm trong div có class liên quan đến ảnh
      if (!clicked) {
        const imgContainer = page.locator('[class*="image"], [class*="lightbox"], [class*="modal"]').last()
        if (await imgContainer.isVisible({ timeout: 1000 }).catch(() => false)) {
          const containerBox = await imgContainer.boundingBox()
          if (containerBox) {
            // Click vào vị trí nút download
            await page.mouse.click(containerBox.x + containerBox.width - 50, containerBox.y + 40)
            clicked = true
          }
        }
      }
    }

    await page.waitForTimeout(2000)

    // Kiểm tra menu
    const menuTexts = ['download', 'tải xuống', 'save image', 'lưu ảnh']
    for (const text of menuTexts) {
      const menu = page.locator(`text="${text}"`).first()
      if (await menu.isVisible({ timeout: 500 }).catch(() => false)) {
        log(`📥 Browser ${pageIndex + 1}: Click menu "${text}"`)
        await menu.click()
        await page.waitForTimeout(2000)
        break
      }
    }

    // ===== LƯU FILE =====
    log(`💾 Browser ${pageIndex + 1}: Đang lưu file...`)

    try {
      const download = await page.waitForEvent('download', { timeout: 10000 })
      await download.saveAs(finalSavePath)
      log(`✅ Browser ${pageIndex + 1}: Đã lưu ảnh tại ${finalSavePath}`)

      await page.keyboard.press('Escape')
      return true
    } catch {
      log(`⚠️ Browser ${pageIndex + 1}: Không bắt được download event, thử tải qua URL...`)
    }

    // ===== FALLBACK: Tải qua URL =====
    const imgSrc = await targetImage.getAttribute('src')
    if (imgSrc && imgSrc.startsWith('http')) {
      log(`📎 Browser ${pageIndex + 1}: Tải qua URL: ${imgSrc.substring(0, 80)}...`)

      const buffer = await page.evaluate(async (url) => {
        const resp = await fetch(url)
        const arrayBuffer = await resp.arrayBuffer()
        return Array.from(new Uint8Array(arrayBuffer))
      }, imgSrc)

      await fs.writeFile(finalSavePath, Buffer.from(buffer))
      log(`✅ Browser ${pageIndex + 1}: Đã tải qua URL!`)
      return true
    }

    return false

  } catch (e) {
    log(`❌ Browser ${pageIndex + 1}: Lỗi tải ảnh: ${e.message}`)
    return false
  }
}

// ========== HÀM XỬ LÝ 1 ẢNH TRONG 1 BROWSER ==========

// Thư mục lưu profiles cố định cho 5 browsers
const getBrowserProfileDir = (index: number): string => {
  return path.join(app.getPath('userData'), `browser-profile-${index}`)
}

async function processImageInBrowser(
  imagePath: string,
  imageIndex: number,
  promptTemplate: string,
  chromePath: string,
  outputFolder: string,
  waitTimeUpload: number,
  waitTimeGenerate: number,
  log: (msg: string) => void
): Promise<{ success: boolean; fileName: string; error?: string }> {
  
  const fileName = path.basename(imagePath)
  const targetFilename = `SH_AI_${path.parse(fileName).name}.png`
  const finalSavePath = path.join(outputFolder, targetFilename)
  
  log(`🚀 Browser ${imageIndex + 1}/5: Bắt đầu xử lý ${fileName}`)
  
  let context: BrowserContext | null = null
  let pageA: Page | null = null
  let pageB: Page | null = null
  let stopWatcherA: (() => void) | null = null
  let stopWatcherB: (() => void) | null = null

  try {
    // ===== BƯỚC 1: TẠO BROWSER RIÊNG =====
    // Kích thước và vị trí cố định cho mỗi browser
    const browserWidth = 800
    const browserHeight = 700
    
    // Vị trí cố định trên màn hình
    const positions = [
      { x: 0, y: 0 },      // Browser 1: góc trái trên
      { x: 820, y: 0 },   // Browser 2: giữa trên
      { x: 0, y: 380 },   // Browser 3: góc trái dưới
      { x: 820, y: 380 }, // Browser 4: giữa dưới
      { x: 1640, y: 0 },  // Browser 5: góc phải trên
    ]
    
    const pos = positions[imageIndex] || { x: imageIndex * 100, y: imageIndex * 100 }
    
    // Thư mục profile cố định cho browser này
    const profileDir = getBrowserProfileDir(imageIndex)
    await fs.ensureDir(profileDir)
    
    log(`🌐 Browser ${imageIndex + 1}: Mở browser tại (${pos.x}, ${pos.y})`)
    log(`📂 Profile: ${profileDir}`)
    
    // Sử dụng launchPersistentContext với profile cố định
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath && chromePath.trim() ? chromePath : undefined,
      headless: false,
      viewport: { width: browserWidth, height: browserHeight },
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        `--window-position=${pos.x},${pos.y}`
      ]
    })
    
    // Tạo 2 tabs trong browser
    pageA = await context.newPage()
    pageB = await context.newPage()

    // Khởi động popup watcher cho cả 2 tab — tự click "Đã hiểu"/"Got it" liên tục
    stopWatcherA = startPopupWatcher(pageA, `Browser ${imageIndex + 1} Tab A`, log)
    stopWatcherB = startPopupWatcher(pageB, `Browser ${imageIndex + 1} Tab B`, log)

    log(`🌐 Browser ${imageIndex + 1}: Đã mở browser với 2 tabs + popup watcher`)
    
    // ===== BƯỚC 2: TAB A - UPLOAD + GỬI PROMPT =====
    log(`🌐 Browser ${imageIndex + 1}: Tab A - Mở ChatGPT...`)
    await pageA.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await pageA.waitForSelector('#prompt-textarea', { timeout: 30000 })
    await dismissPopup(pageA, log)
    
    log(`📤 Browser ${imageIndex + 1}: Tab A - Upload ảnh...`)
    await ensureNoPopup(pageA)
    const fileInputA = pageA.locator('input[type="file"]').first()
    await fileInputA.setInputFiles(imagePath)
    await pageA.waitForTimeout(waitTimeUpload)

    log(`⌨️ Browser ${imageIndex + 1}: Tab A - Gửi prompt phân tích...`)
    await ensureNoPopup(pageA)
    await pageA.locator('#prompt-textarea').fill(promptTemplate)
    await pageA.waitForTimeout(500)
    await ensureNoPopup(pageA)

    // Đợi send button enabled (upload có thể còn pending)
    const enabledA = await waitForSendEnabled(pageA!, 60000)
    if (!enabledA) {
      log(`⚠️ Browser ${imageIndex + 1}: Tab A - send button vẫn disabled sau 60s, thử bằng Enter`)
    }

    const sendBtnA = pageA.locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Gửi lời nhắc"]').first()
    await sendBtnA.click({ timeout: 10000 }).catch(async () => {
      await pageA!.keyboard.press('Enter')
    })
    
    // Kiểm tra popup sau khi gửi
    await pageA.waitForTimeout(2000)
    await dismissPopup(pageA, log)
    
    log(`⏳ Browser ${imageIndex + 1}: Tab A - Đang phân tích...`)
    
    // Đợi prompt hoàn thành
    const promptComplete = await waitForPromptComplete(pageA, 120000, log)
    
    if (!promptComplete) {
      throw new Error('Tab A: Không hoàn thành prompt trong thời gian chờ')
    }
    
    // ===== BƯỚC 3: TAB A - EXTRACT PROMPT =====
    const extractedPrompt = await extractPrompt(pageA, log)
    
    if (!extractedPrompt || extractedPrompt.length < 20) {
      throw new Error('Tab A: Không extract được prompt')
    }
    
    log(`📝 Browser ${imageIndex + 1}: Đã extract prompt (${extractedPrompt.length} chars)`)
    
    // ===== BƯỚC 4: TAB B - PREPARE RENDER =====
    log(`🌐 Browser ${imageIndex + 1}: Tab B - Mở ChatGPT...`)
    await pageB.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await pageB.waitForSelector('#prompt-textarea', { timeout: 30000 })
    await dismissPopup(pageB, log)
    
    // Chọn chế độ Create Image qua nút "+" trên composer
    log(`🎨 Browser ${imageIndex + 1}: Tab B - Chọn Create Image...`)
    const textareaB = pageB.locator('#prompt-textarea')

    let createImageClicked = false
    for (let attempt = 1; attempt <= 3 && !createImageClicked && !shouldStop; attempt++) {
      // Chờ popup rate-limit tan
      for (let i = 0; i < 5; i++) {
        const blocked = await pageB.evaluate(() => {
          const t = (document.body?.innerText || '').toLowerCase()
          return t.includes('quá nhiều yêu cầu') || t.includes('too many requests')
        })
        if (!blocked) break
        await dismissPopup(pageB, log)
        await pageB.waitForTimeout(1500)
      }

      // Click nút "+" — hỗ trợ cả VI & EN + fallback: tìm button + gần composer
      let plusClicked = false
      const plusSelectors = [
        'button[aria-label*="thêm tệp" i]',
        'button[aria-label*="add files" i]',
        'button[aria-label*="add photos" i]',
        'button[aria-label*="attach" i]',
        'button[aria-label*="more features" i]',
        'button[aria-label*="more options" i]'
      ]
      for (const sel of plusSelectors) {
        const btn = pageB.locator(sel).first()
        if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
          await btn.click({ timeout: 3000 }).catch(() => {})
          plusClicked = true
          break
        }
      }
      if (!plusClicked) {
        // Fallback: tìm button có haspopup="menu" gần #prompt-textarea (composer form)
        const fallbackClicked = await pageB.evaluate(() => {
          const ta = document.querySelector('#prompt-textarea')
          if (!ta) return false
          const form = ta.closest('form') || ta.parentElement?.parentElement
          if (!form) return false
          const btns = form.querySelectorAll('button[aria-haspopup="menu"]')
          for (const b of Array.from(btns)) {
            const r = (b as HTMLElement).getBoundingClientRect()
            if (r.width > 0 && r.height > 0) {
              ;(b as HTMLElement).click()
              return true
            }
          }
          return false
        })
        if (!fallbackClicked) {
          log(`⚠️ Browser ${imageIndex + 1}: lần ${attempt} - không tìm thấy nút +`)
          await pageB.waitForTimeout(1500)
          continue
        }
      }
      await pageB.waitForTimeout(1500)

      // Tìm element "Create image" / "Tạo hình ảnh" — ưu tiên scan trong menu container vừa mở
      const targetRect = await pageB.evaluate(() => {
        const keywords = [
          'tạo hình ảnh', 'tạo ảnh',
          'create image', 'create an image', 'create images', 'generate image',
          'make image', 'make an image'
        ]
        const isMatch = (text: string): boolean => {
          const t = text.trim().toLowerCase()
          if (!t) return false
          return keywords.some(k => t === k || t.startsWith(k) || t.includes(k))
        }

        // Ưu tiên các container menu/popover vừa mở (visible, size vừa phải)
        const menuContainers = Array.from(document.querySelectorAll(
          '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-radix-menu-content], [class*="popover"], [class*="dropdown"]'
        )).filter(c => {
          const r = (c as HTMLElement).getBoundingClientRect()
          return r.width > 100 && r.height > 50
        })

        const searchRoots: Element[] = menuContainers.length > 0
          ? (menuContainers as Element[])
          : [document.body]

        let best: { x: number; y: number; w: number; h: number; area: number } | null = null
        for (const root of searchRoots) {
          const all = root.querySelectorAll('*')
          for (const el of Array.from(all)) {
            // Chỉ xét leaf-ish: text node trực tiếp khớp
            const ownText = Array.from(el.childNodes)
              .filter((n: Node) => n.nodeType === 3)
              .map((n: Node) => (n.textContent || '').trim())
              .join(' ')
              .trim()
            if (!isMatch(ownText)) continue
            const rect = (el as HTMLElement).getBoundingClientRect()
            if (rect.width < 10 || rect.height < 10) continue
            // Loại nav/aside (sidebar)
            if (el.closest('nav, aside, [data-testid*="sidebar" i]')) continue
            const area = rect.width * rect.height
            if (!best || area < best.area) {
              best = { x: rect.x, y: rect.y, w: rect.width, h: rect.height, area }
            }
          }
          if (best) break // match trong menu container, không cần fallback body
        }
        return best ? { x: best.x, y: best.y, w: best.w, h: best.h } : null
      })

      if (targetRect) {
        const cx = targetRect.x + targetRect.w / 2
        const cy = targetRect.y + targetRect.h / 2
        await pageB.mouse.click(cx, cy)
        log(`✅ Browser ${imageIndex + 1}: click "Tạo hình ảnh" tại (${Math.round(cx)}, ${Math.round(cy)})`)
        createImageClicked = true
        await pageB.waitForTimeout(2000)
      } else {
        log(`⚠️ Browser ${imageIndex + 1}: lần ${attempt} - menu không có "Tạo hình ảnh"`)
        await pageB.keyboard.press('Escape').catch(() => {})
        await pageB.waitForTimeout(2000)
      }
    }

    if (!createImageClicked) {
      throw new Error('Tab B: không chọn được chế độ Tạo hình ảnh sau 3 lần')
    }
    
    // Upload ảnh lên Tab B
    log(`📤 Browser ${imageIndex + 1}: Tab B - Upload ảnh...`)
    await ensureNoPopup(pageB)
    const fileInputB = pageB.locator('input[type="file"]').first()
    await fileInputB.setInputFiles(imagePath)
    await pageB.waitForTimeout(waitTimeUpload)

    // Fill prompt đã extract
    await ensureNoPopup(pageB)
    await textareaB.click()
    await textareaB.fill(extractedPrompt)
    await pageB.waitForTimeout(500)

    // ===== BƯỚC 5: TAB B - GỬI RENDER =====
    log(`🚀 Browser ${imageIndex + 1}: Tab B - Gửi render...`)
    await ensureNoPopup(pageB)

    const enabledB = await waitForSendEnabled(pageB!, 60000)
    if (!enabledB) {
      log(`⚠️ Browser ${imageIndex + 1}: Tab B - send button vẫn disabled sau 60s, thử bằng Enter`)
    }

    const sendBtnB = pageB.locator('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Gửi lời nhắc"]').first()
    await sendBtnB.click({ timeout: 10000 }).catch(async () => {
      await pageB!.keyboard.press('Enter')
    })
    
    // Kiểm tra popup
    await pageB.waitForTimeout(2000)
    await dismissPopup(pageB, log)
    
    log(`🎨 Browser ${imageIndex + 1}: Tab B - Đang tạo ảnh...`)
    
    // Đợi ảnh hoàn thành
    const imageReady = await waitForImageReady(pageB, waitTimeGenerate, log)
    
    if (!imageReady) {
      throw new Error('Tab B: Không tạo được ảnh trong thời gian chờ')
    }
    
    // ===== BƯỚC 6: TAB B - TẢI ẢNH =====
    await pageB.waitForTimeout(3000)
    const downloaded = await downloadImage(pageB, imageIndex, finalSavePath, log)
    
    if (downloaded) {
      log(`✅ Browser ${imageIndex + 1}: Hoàn thành ${fileName}`)
    }

    if (stopWatcherA) stopWatcherA()
    if (stopWatcherB) stopWatcherB()
    if (context) await context.close().catch(() => {})

    return { success: downloaded, fileName }

  } catch (e) {
    const errMsg = getErrorMessage(e)
    log(`❌ Browser ${imageIndex + 1}: Lỗi - ${errMsg}`)

    if (stopWatcherA) stopWatcherA()
    if (stopWatcherB) stopWatcherB()
    if (context) await context.close().catch(() => {})

    return { success: false, fileName, error: errMsg }
  }
}

ipcMain.handle('start-automation', async (event, config) => {
  if (isRunning) return { success: false, message: 'Process already running' }
  isRunning = true
  shouldStop = false

  const log = (msg: string) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('automation-log', msg)
      } else {
        console.log(`[log after window closed] ${msg}`)
      }
    } catch {
      console.log(`[log error] ${msg}`)
    }
  }

    try {
    const {
      inputFolder,
      outputFolder,
      chromePath,
      promptTemplate,
      waitTimeUpload,
      waitTimeGenerate
    } = config

    const finalOutputFolder = outputFolder || path.join(inputFolder, 'AI')
    log(`🚀 Bắt đầu quy trình với 5 BROWSERS riêng biệt...`)
    
    await fs.ensureDir(finalOutputFolder)
    
    const files = (await fs.readdir(inputFolder)).filter(f => 
      ['.jpg', '.png', '.jpeg'].includes(path.extname(f).toLowerCase())
    )

    if (files.length === 0) {
      log('❌ Không tìm thấy ảnh trong thư mục INPUT')
      isRunning = false
      return { success: false, message: 'No images found' }
    }

    log(`📁 Tìm thấy ${files.length} ảnh`)
    log(`📂 Output: ${finalOutputFolder}`)

    // Chuẩn bị danh sách ảnh cần xử lý (tối đa 5)
    const maxImages = Math.min(files.length, 5)
    const imagesToProcess = files.slice(0, maxImages)
    
    log(`🖥️ Sẽ xử lý ${maxImages} ảnh đồng thời trong 5 browsers...`)

    // Chạy 5 browsers song song
    const results = await Promise.all(
      imagesToProcess.map((file, index) => {
        const imagePath = path.join(inputFolder, file)
        return processImageInBrowser(
          imagePath,
          index,
          promptTemplate,
          chromePath,
          finalOutputFolder,
          waitTimeUpload || 5000,
          waitTimeGenerate || 120000,
          log
        )
      })
    )

    // Tổng hợp kết quả
    const successCount = results.filter(r => r.success).length
    const failedCount = results.length - successCount
    
    log(`🏁 Hoàn tất!`)
    log(`✅ Thành công: ${successCount}/${results.length}`)
    
    if (failedCount > 0) {
      log(`⚠️ Thất bại: ${failedCount}`)
      for (const r of results.filter(r => !r.success)) {
        log(`  - ${r.fileName}: ${r.error}`)
      }
    }

    isRunning = false
    return { success: true, processedCount: successCount, totalCount: results.length }

  } catch (err) {
    log(`🔴 LỖI NGHIÊM TRỌNG: ${getErrorMessage(err)}`)
    isRunning = false
    return { success: false, error: getErrorMessage(err) }
  }
})

ipcMain.handle('stop-automation', async () => {
  shouldStop = true
  isRunning = false
  return { success: true }
})
