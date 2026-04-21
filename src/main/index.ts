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

    // Scan img, ƯU TIÊN ảnh có alt="Ảnh đã tạo"/"Generated image" (ảnh assistant generated)
    // Loại ảnh inside [data-message-author-role="user"] (ảnh user upload input)
    type BestImg = { src: string; w: number; h: number; nw: number; nh: number; score: number }
    let bestImg: BestImg | null = null
    if (!stillGenerating) {
      try {
        bestImg = await page.evaluate((): BestImg | null => {
          const GEN_ALT_PREFIXES = ['ảnh đã tạo', 'generated image', 'image:', 'ảnh được tạo']
          const imgs = document.querySelectorAll('img')
          let best: BestImg | null = null
          imgs.forEach(img => {
            const el = img as HTMLImageElement
            const r = el.getBoundingClientRect()
            if (r.width < 200 || r.height < 200) return
            if (!el.src || el.src.startsWith('data:')) return
            if (!el.complete || el.naturalWidth < 200) return
            // Loại ảnh user upload
            if (el.closest('[data-message-author-role="user"]')) return
            // Score: alt khớp "Ảnh đã tạo" = 1000, không = 0
            const alt = (el.alt || '').toLowerCase()
            const altScore = GEN_ALT_PREFIXES.some(p => alt.startsWith(p)) ? 1000000 : 0
            const area = r.width * r.height
            const score = altScore + area
            if (!best || score > best.score) {
              best = { src: el.src, w: r.width, h: r.height, nw: el.naturalWidth, nh: el.naturalHeight, score }
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
        // Stability window: 4 samples × 2s = 8s yêu cầu src + naturalWidth ổn định
        // và Stop button không bật lại. ChatGPT streaming reveal ảnh top-to-bottom,
        // dù Edit/Copy xuất hiện sớm, naturalWidth vẫn có thể nhảy khi ảnh re-decode.
        const STABILITY_SAMPLES = 4
        const SAMPLE_INTERVAL = 2000
        let stableCount = 0
        let lastNw = bestImg.nw
        let lastSrc = bestImg.src

        for (let i = 0; i < STABILITY_SAMPLES; i++) {
          await page.waitForTimeout(SAMPLE_INTERVAL)
          const state = await page.evaluate((src: string) => {
            const imgs = document.querySelectorAll('img')
            let match: HTMLImageElement | null = null
            imgs.forEach(img => {
              if ((img as HTMLImageElement).src === src) match = img as HTMLImageElement
            })
            const stopBtn = document.querySelector(
              'button[data-testid="stop-button"], button[aria-label*="Stop streaming" i], button[aria-label*="Dừng" i]'
            )
            if (!match) return { found: false, stillGen: !!stopBtn, nw: 0, complete: false }
            const m = match as HTMLImageElement
            return { found: true, stillGen: !!stopBtn, nw: m.naturalWidth, complete: m.complete }
          }, lastSrc)

          if (!state.found || state.stillGen || !state.complete || state.nw !== lastNw || state.nw < 512) {
            stableCount = 0
            if (state.found) lastNw = state.nw
          } else {
            stableCount++
          }
        }

        if (stableCount >= STABILITY_SAMPLES - 1) {
          log(`✅ Ảnh đã hoàn thiện (${Math.round(bestImg.w)}x${Math.round(bestImg.h)}, natural ${lastNw}px, stable ${stableCount}/${STABILITY_SAMPLES})`)
          return true
        }
        log(`⏳ Ảnh chưa stable (${stableCount}/${STABILITY_SAMPLES}), tiếp tục chờ...`)
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
// Ưu tiên: marker ===PROMPT_START===/===PROMPT_END=== (bot inject trong wrappedPrompt gửi ChatGPT).
// Fallback cũ: <pre> cuối / code block ```...```.
async function extractPrompt(page: Page, log: (msg: string) => void): Promise<string> {
  try {
    const lastMsg = page.locator('[data-message-author-role="assistant"]').last()
    const fullText = await lastMsg.innerText()

    // 1. Marker match — non-greedy để lấy đúng cặp đầu tiên
    const markerMatch = fullText.match(/===PROMPT_START===\s*\n?([\s\S]*?)\n?===PROMPT_END===/)
    if (markerMatch && markerMatch[1].trim().length >= 20) {
      return markerMatch[1].trim()
    }

    // 2. Fallback: <pre> cuối
    const preElement = lastMsg.locator('pre').last()
    let extractedPrompt = ''
    if (await preElement.count() > 0) {
      extractedPrompt = await preElement.innerText()
    } else if (fullText.includes('```')) {
      // 3. Fallback: code block ```...```
      const blocks = fullText.split('```')
      extractedPrompt = blocks[blocks.length - 2] || ''
      extractedPrompt = extractedPrompt.replace(/^[a-zA-Z]+\n/, '')
    } else {
      extractedPrompt = fullText
    }

    return extractedPrompt.replace(/Copy code/gi, '').trim()
  } catch (e) {
    log(`❌ Lỗi extract prompt: ${(e as Error).message}`)
    return ''
  }
}

// Validate bytes đã tải có phải ảnh hoàn thiện không.
// Trả về null nếu hợp lệ, hoặc chuỗi lý do nếu partial/lỗi.
async function validateImageBytes(
  bytes: Buffer,
  expectedNw: number
): Promise<string | null> {
  if (bytes.length < 10000) return `quá nhỏ (${bytes.length} bytes)`
  try {
    const img = await Jimp.read(bytes)
    const w = img.getWidth()
    const h = img.getHeight()
    if (w < 512 || h < 512) return `dimensions nhỏ (${w}x${h})`
    // Cho sai số ±8% vs expected — ChatGPT đôi khi serve scaled variant
    if (expectedNw > 0 && Math.abs(w - expectedNw) / expectedNw > 0.08) {
      return `width ${w} lệch expected ${expectedNw}`
    }
    return null
  } catch (e) {
    return `decode lỗi: ${getErrorMessage(e)}`
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

    // Scan img, ƯU TIÊN alt="Ảnh đã tạo"/"Generated", LOẠI ảnh trong user message (upload input)
    type TargetImgInfo = { src: string; w: number; h: number; nw: number; alt: string }
    const targetImgInfo: TargetImgInfo | null = await page.evaluate((): TargetImgInfo | null => {
      const GEN_ALT_PREFIXES = ['ảnh đã tạo', 'generated image', 'image:', 'ảnh được tạo']
      const imgs = document.querySelectorAll('img')
      let best: (TargetImgInfo & { score: number }) | null = null
      imgs.forEach(img => {
        const el = img as HTMLImageElement
        const r = el.getBoundingClientRect()
        if (r.width < 200 || r.height < 200) return
        if (!el.src || el.src.startsWith('data:')) return
        if (!el.complete || el.naturalWidth < 200) return
        if (el.closest('[data-message-author-role="user"]')) return
        const alt = (el.alt || '').toLowerCase()
        const altScore = GEN_ALT_PREFIXES.some(p => alt.startsWith(p)) ? 1000000 : 0
        const score = altScore + r.width * r.height
        if (!best || score > best.score) {
          best = { src: el.src, w: r.width, h: r.height, nw: el.naturalWidth, alt: el.alt || '', score }
        }
      })
      if (!best) return null
      const { src, w, h, nw, alt } = best
      return { src, w, h, nw, alt }
    })

    if (!targetImgInfo) {
      log(`❌ Browser ${pageIndex + 1}: Không tìm thấy ảnh hợp lệ`)
      return false
    }

    log(`✅ Browser ${pageIndex + 1}: Target ảnh ${Math.round(targetImgInfo.w)}x${Math.round(targetImgInfo.h)} (natural ${targetImgInfo.nw}px) alt="${targetImgInfo.alt.substring(0, 60)}"`)
    log(`📎 Browser ${pageIndex + 1}: URL ${targetImgInfo.src.substring(0, 120)}...`)

    // ===== CÁCH 1 (PRIMARY): CLICK SHARE → TẢI XUỐNG =====
    // Đây là cách ChatGPT cung cấp bytes final — server gửi file đã finalize,
    // không phải URL streaming còn đang render. Đảm bảo ảnh không bị cắt/vỡ.
    try {
      log(`📥 Browser ${pageIndex + 1}: Click Chia sẻ hình ảnh → Tải xuống...`)
      // Đảm bảo ảnh trong viewport để share button visible
      const imgLoc = page.locator(`img[src="${targetImgInfo.src.replace(/"/g, '\\"')}"]`).first()
      await imgLoc.scrollIntoViewIfNeeded().catch(() => {})
      await imgLoc.hover().catch(() => {})
      await page.waitForTimeout(500)

      const shareBtn = page.locator(
        'button[aria-label="Chia sẻ hình ảnh này"], button[aria-label*="Chia sẻ hình ảnh" i], button[aria-label*="share image" i]'
      ).first()
      await shareBtn.click({ timeout: 8000 })
      // Dialog cần ~2s để render đầy đủ các nút
      await page.waitForTimeout(2500)

      const dlPromise = page.waitForEvent('download', { timeout: 20000 })
      const downloadBtn = page.locator(
        '[role="dialog"] button:has-text("Tải xuống"), [role="dialog"] button:has-text("Download")'
      ).first()
      await downloadBtn.click({ timeout: 8000 })
      const dl = await dlPromise
      await dl.saveAs(finalSavePath)
      const stat = await fs.stat(finalSavePath)
      // Đóng dialog
      await page.keyboard.press('Escape').catch(() => {})
      // Validate bytes
      const buf = await fs.readFile(finalSavePath)
      const invalid = await validateImageBytes(buf, targetImgInfo.nw)
      if (invalid) {
        log(`⚠️ Browser ${pageIndex + 1}: Share download không hợp lệ (${invalid}), thử cách khác...`)
        throw new Error(`validate fail: ${invalid}`)
      }
      log(`✅ Browser ${pageIndex + 1}: Đã lưu ${(stat.size / 1024).toFixed(0)} KB qua share dialog (validated)`)
      return true
    } catch (err) {
      log(`⚠️ Browser ${pageIndex + 1}: Share → Tải xuống lỗi: ${getErrorMessage(err)}, thử fetch URL...`)
      // Đảm bảo dialog đóng nếu đang mở
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(500)
    }

    // ===== CÁCH 2 (FALLBACK): TẢI QUA URL FETCH =====
    // Chỉ dùng nếu share flow fail. Retry 3 lần kèm validate decode.
    const FETCH_RETRIES = 3
    for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
      try {
        log(`📥 Browser ${pageIndex + 1}: Thử fetch URL trực tiếp (lần ${attempt + 1}/${FETCH_RETRIES})...`)
        const bytes = await page.evaluate(async (url: string) => {
          const r = await fetch(url, { credentials: 'include', cache: 'no-store' })
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const ab = await r.arrayBuffer()
          return Array.from(new Uint8Array(ab))
        }, targetImgInfo.src)
        const buf = Buffer.from(bytes)
        const invalid = await validateImageBytes(buf, targetImgInfo.nw)
        if (invalid) {
          log(`⚠️ Browser ${pageIndex + 1}: Bytes không hợp lệ (${invalid}), chờ 5s rồi thử lại...`)
          if (attempt < FETCH_RETRIES - 1) await page.waitForTimeout(5000)
          continue
        }
        await fs.writeFile(finalSavePath, buf)
        log(`✅ Browser ${pageIndex + 1}: Đã lưu ${(buf.length / 1024).toFixed(0)} KB qua fetch URL (validated)`)
        return true
      } catch (err) {
        log(`⚠️ Browser ${pageIndex + 1}: Fetch URL lỗi: ${getErrorMessage(err)}`)
        if (attempt < FETCH_RETRIES - 1) await page.waitForTimeout(3000)
      }
    }

    // ===== CÁCH 3 (FALLBACK): context.request =====
    try {
      log(`📥 Browser ${pageIndex + 1}: Thử context.request.get...`)
      const ctx = page.context()
      const resp = await ctx.request.get(targetImgInfo.src)
      if (resp.ok()) {
        const body = await resp.body()
        const invalid = await validateImageBytes(body, targetImgInfo.nw)
        if (!invalid) {
          await fs.writeFile(finalSavePath, body)
          log(`✅ Browser ${pageIndex + 1}: Đã lưu ${(body.length / 1024).toFixed(0)} KB qua context.request (validated)`)
          return true
        }
        log(`⚠️ Browser ${pageIndex + 1}: context.request bytes không hợp lệ (${invalid})`)
      } else {
        log(`⚠️ Browser ${pageIndex + 1}: HTTP ${resp.status()}`)
      }
    } catch (err) {
      log(`⚠️ Browser ${pageIndex + 1}: context.request lỗi: ${getErrorMessage(err)}`)
    }

    // ===== CÁCH 4 (LEGACY FALLBACK): click lightbox + download button =====
    log(`📥 Browser ${pageIndex + 1}: Thử lightbox fallback...`)
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

// ========================================================================
// ========== GOOGLE LABS FLOW AUTOMATION ==========
// ========================================================================
// Tab B (render) có 3 mode: 'chatgpt' (mặc định) | 'flow-image' | 'flow-video'
// Flow đăng nhập bằng Google → cùng profile-0..4 với ChatGPT là OK (cookies per-domain).
//
// Thứ tự bước Flow KHÔNG được đổi (sẽ mất sync hoặc UI reject):
//   goto → new project → open config → chọn mode (image/video) → (video: chọn Thành phần)
//   → chọn 16:9 → chọn x1 → close config → paste asset → fill prompt
//   → wait composer ready → snapshot old imgs/videos → click send
//   → wait new element xuất hiện → download (fetch trong browser context)

type RenderMode = 'chatgpt' | 'flow-image' | 'flow-video'

// Dismiss consent dialog "Tôi đồng ý" — Flow popup giữa chừng nếu không click sẽ kẹt
async function dismissFlowConsent(page: Page): Promise<void> {
  try {
    const btn = page.locator('button').filter({
      hasText: /Tôi đồng ý|I agree|Đồng ý|Accept/i
    }).first()
    if ((await btn.count()) > 0 && await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {})
    }
  } catch {}
}

// Watcher background: cứ 3s check + dismiss consent dialog
function startFlowConsentWatcher(page: Page): () => void {
  let stopped = false
  ;(async () => {
    while (!stopped) {
      try {
        if (page.isClosed()) break
        await dismissFlowConsent(page)
      } catch {}
      await new Promise(r => setTimeout(r, 3000))
    }
  })()
  return () => { stopped = true }
}

// Click config button → mở/đóng panel (toggle)
async function clickFlowConfigButton(page: Page): Promise<boolean> {
  const cfg = page.locator('button').filter({
    hasText: /Nano.*x|Video.*x|Hình ảnh.*x|crop/
  }).first()
  if ((await cfg.count()) === 0) return false
  await cfg.click({ timeout: 5000 }).catch(() => {})
  return true
}

// Chọn tab trong panel config bằng regex match trên textContent
async function clickFlowTab(page: Page, regex: RegExp, ensureSelected = true): Promise<boolean> {
  const tab = page.locator('button.flow_tab_slider_trigger').filter({ hasText: regex }).first()
  if ((await tab.count()) === 0) return false
  if (ensureSelected) {
    const selected = await tab.getAttribute('aria-selected').catch(() => null)
    if (selected === 'true') return true
  }
  await tab.click({ timeout: 5000 }).catch(() => {})
  return true
}

// Snapshot img URL hiện tại để waitForFlowAssetReady phân biệt ảnh mới vs ảnh cũ
// (avatar, placeholder — flower-placeholder.webp 45x77 qua mọi filter size nên phải snapshot trước).
async function snapshotFlowImgs(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(img => (img as HTMLImageElement).src || '')
  }).catch(() => [])
}

// Upload ảnh vào Flow qua CLIPBOARD PASTE (Cmd/Ctrl+V).
// File input cách cũ flaky (input[type=file] không always attach), và setInputFiles đôi khi
// route ảnh vào project gallery thay vì composer. Paste thật → Flow nhận đúng như user paste,
// route vào composer đang focus. Yêu cầu context có permissions clipboard-read/clipboard-write.
async function pasteAssetIntoFlow(page: Page, imagePath: string): Promise<void> {
  const buf = await fs.readFile(imagePath)
  const base64 = buf.toString('base64')
  const ext = path.extname(imagePath).slice(1).toLowerCase() || 'png'
  const srcMime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : 'image/png'

  const tb = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]').last()
  await tb.waitFor({ state: 'visible', timeout: 15000 })
  await tb.scrollIntoViewIfNeeded().catch(() => {})
  await tb.click({ timeout: 5000 })
  await page.waitForTimeout(300)

  // navigator.clipboard.write chỉ guarantee image/png. JPEG/WebP → re-encode qua canvas.
  await page.evaluate(async ({ b64, srcMime }) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    let pngBlob: Blob
    if (srcMime === 'image/png') {
      pngBlob = new Blob([bytes], { type: 'image/png' })
    } else {
      const srcBlob = new Blob([bytes], { type: srcMime })
      const url = URL.createObjectURL(srcBlob)
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const el = new Image()
          el.onload = () => res(el)
          el.onerror = () => rej(new Error('decode-fail'))
          el.src = url
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        pngBlob = await new Promise<Blob>((res, rej) => {
          canvas.toBlob(b => b ? res(b) : rej(new Error('encode-fail')), 'image/png')
        })
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
  }, { b64: base64, srcMime })

  await tb.click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(150)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
}

// Chờ asset thumbnail load vào COMPOSER (không phải project gallery).
// Scope bằng geo: tìm img có tâm nằm trong ~500x300 quanh textbox (Flow không có <form> ancestor
// nên closest('form') fail; geo-scope robust hơn). Thumbnail ready khi src bắt đầu là blob/data/http
// + rendered ≥30px + stable qua 2 tick (đợi Flow đổi src từ blob → media.getMediaUrlRedirect sau upload).
// baselineSrcs không còn cần — giữ signature để không phải đổi callers.
async function waitForFlowAssetReady(
  page: Page,
  _baselineSrcs: string[],
  timeoutMs = 120000
): Promise<boolean> {
  const start = Date.now()
  let stableCount = 0
  let lastSrc: string | null = null
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false
    const state = await page.evaluate(() => {
      const tb = document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]') as HTMLElement | null
      if (!tb) return { ok: false, thumbSrc: null as string | null }
      const tbR = tb.getBoundingClientRect()
      const tcx = tbR.left + tbR.width / 2
      const tcy = tbR.top + tbR.height / 2
      const nearby = (Array.from(document.querySelectorAll('img')) as HTMLImageElement[]).filter(img => {
        const r = img.getBoundingClientRect()
        if (!r.width || !r.height) return false
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        return Math.abs(cx - tcx) < 500 && Math.abs(cy - tcy) < 300
      })
      const thumb = nearby.find(img => {
        const src = img.src || ''
        if (!src || src.includes('avatar') || src.includes('googleusercontent.com/a/')) return false
        if (!img.complete || img.naturalWidth < 10) return false
        if (!(src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('http'))) return false
        const r = img.getBoundingClientRect()
        return r.width >= 30 && r.height >= 30
      })
      return { ok: !!thumb, thumbSrc: thumb?.src || null }
    }).catch(() => ({ ok: false, thumbSrc: null as string | null }))

    if (state.ok) {
      if (state.thumbSrc === lastSrc) stableCount++
      else { stableCount = 1; lastSrc = state.thumbSrc }
      if (stableCount >= 2) return true
    } else {
      stableCount = 0
      lastSrc = null
    }
    await page.waitForTimeout(1000)
  }
  return false
}

// Fill prompt vào composer Flow — Flow dùng Slate editor.
// Slate chấp nhận 1 `insertText` duy nhất với `\n` embedded → tất cả prompt vào 1 paragraph
// với soft line breaks. KHÔNG cần loop Enter/Shift+Enter (Flow coi Enter=Submit nên nguy hiểm).
// Chiến lược: 1 call keyboard.insertText (CDP isTrusted=true), verify placeholder gone.
// Fallback: synthetic InputEvent với cùng text (cho trường hợp CDP fail).
async function fillFlowPrompt(page: Page, prompt: string, log?: (s: string) => void): Promise<boolean> {
  const l = log || (() => {})
  const isCommitted = async (): Promise<boolean> => {
    return await page.evaluate(() => !document.querySelector('[data-slate-placeholder="true"]')).catch(() => false)
  }
  const pollCommit = async (maxMs = 3000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < maxMs) {
      await page.waitForTimeout(150)
      if (await isCommitted()) return true
    }
    return false
  }

  try {
    await page.bringToFront().catch(() => {})
    const tb = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]').first()
    await tb.waitFor({ state: 'visible', timeout: 5000 })
    await tb.click({ timeout: 5000 })
    await page.waitForTimeout(200)

    // Clear existing text (nếu có)
    await page.keyboard.press('Meta+A').catch(() => {})
    await page.keyboard.press('Control+A').catch(() => {})
    await page.keyboard.press('Backspace').catch(() => {})
    await page.waitForTimeout(150)
    await tb.click({ timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(100)

    // === CÁCH A: 1 call keyboard.insertText (CDP Input.insertText, isTrusted=true) ===
    // Slate tự hiểu \n là soft break, tạo 1 paragraph với nhiều dòng.
    await page.keyboard.insertText(prompt)
    if (await pollCommit(3000)) {
      l(`   fill: cách A (keyboard.insertText 1-shot) OK`)
      return true
    }
    l(`   fill: cách A FAIL sau 3s, thử cách B (synthetic)`)

    // === CÁCH B: synthetic InputEvent qua page.evaluate (fallback khi CDP bị throttle) ===
    await tb.click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Meta+A').catch(() => {})
    await page.keyboard.press('Control+A').catch(() => {})
    await page.keyboard.press('Backspace').catch(() => {})
    await page.waitForTimeout(150)

    await page.evaluate((text: string) => {
      const tb = document.querySelector(
        '[role="textbox"][contenteditable="true"][data-slate-editor="true"]'
      ) as HTMLElement | null
      if (!tb) return
      tb.focus()
      const anchor =
        tb.querySelector('[data-slate-string="true"]') ||
        tb.querySelector('[data-slate-zero-width]')
      const firstChild = anchor ? (anchor as HTMLElement).firstChild : null
      if (anchor && firstChild) {
        const sel = window.getSelection()
        const r = document.createRange()
        r.setStart(firstChild, 0)
        r.setEnd(firstChild, 0)
        sel?.removeAllRanges()
        sel?.addRange(r)
      }
      // 1 shot insertText với \n embedded
      tb.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: text,
        bubbles: true, cancelable: true, composed: true
      }))
    }, prompt)

    if (await pollCommit(3000)) {
      l(`   fill: cách B (synthetic InputEvent) OK`)
      return true
    }
    l(`   fill: cả 2 cách đều FAIL — Slate editor từ chối`)
    return false
  } catch (e) {
    l(`   fill: exception ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

// Chờ composer sẵn sàng gửi (send button không disabled)
async function waitForFlowComposerReady(page: Page, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false
    const ready = await page.evaluate(() => {
      // Send button: chứa 'arrow_forward' hoặc text 'Tạo' hoặc aria-label có Send/Gửi
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
      const sendBtn = btns.find(b => {
        const t = (b.textContent || '').trim()
        const aria = (b.getAttribute('aria-label') || '').toLowerCase()
        return (
          t.includes('arrow_forward') ||
          /^tạo$/i.test(t) ||
          aria.includes('send') ||
          aria.includes('gửi')
        )
      })
      if (!sendBtn) return false
      if (sendBtn.disabled) return false
      if (sendBtn.getAttribute('aria-disabled') === 'true') return false
      const r = sendBtn.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }).catch(() => false)
    if (ready) return true
    await page.waitForTimeout(500)
  }
  return false
}

// Click send button (có fallback Enter)
async function clickFlowSendButton(page: Page): Promise<void> {
  const sendBtn = page.locator('button').filter({ hasText: /arrow_forward|^Tạo$/i }).first()
  if ((await sendBtn.count()) > 0) {
    await sendBtn.click({ timeout: 5000 }).catch(async () => {
      await page.keyboard.press('Enter').catch(() => {})
    })
  } else {
    await page.keyboard.press('Enter').catch(() => {})
  }
}

// ========== FLOW IMAGE: tạo 1 ảnh ==========
async function runFlowImage(
  page: Page,
  imagePath: string,
  prompt: string,
  savePath: string,
  timeoutMs: number,
  log: (msg: string) => void
): Promise<boolean> {
  const stopConsent = startFlowConsentWatcher(page)
  try {
    log(`🌐 Flow: goto labs.google/fx/tools/flow`)
    await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)
    await dismissFlowConsent(page)

    // Nếu đang ở trang lỗi → bấm Quay lại
    const backBtn = page.locator('button').filter({ hasText: /Quay lại dự án|Back to project/i }).first()
    if ((await backBtn.count()) > 0) await backBtn.click({ timeout: 3000 }).catch(() => {})

    // Click Dự án mới
    const newProj = page.locator('button, div').filter({ hasText: /Dự án mới|New project/i }).last()
    if ((await newProj.count()) > 0) {
      await newProj.click({ timeout: 5000 }).catch(() => {})
      log(`✅ Flow: click Dự án mới`)
    }
    await page.waitForTimeout(4000)

    // Mở config panel
    await clickFlowConfigButton(page)
    await page.waitForTimeout(1500)

    // Chế độ Hình ảnh
    await clickFlowTab(page, /imageHình ảnh/, true)
    await page.waitForTimeout(500)
    // x1 (mặc định x2)
    await clickFlowTab(page, /^x1$/, false)
    await page.waitForTimeout(500)
    // Đóng panel config (click lại config button)
    await clickFlowConfigButton(page)
    await page.waitForTimeout(1000)
    log(`⚙️ Flow: config image x1 xong`)

    // Snapshot img hiện có TRƯỚC khi upload (để phân biệt asset mới)
    const baselineImgs = await snapshotFlowImgs(page)
    // Upload ảnh qua hidden file input
    await pasteAssetIntoFlow(page, imagePath)
    log(`📎 Flow: upload asset, chờ ảnh load vào composer...`)
    const assetReady = await waitForFlowAssetReady(page, baselineImgs, 120000)
    if (!assetReady) throw new Error('Flow: thumbnail asset không xuất hiện sau 2 phút')
    log(`✅ Flow: asset đã load xong vào composer`)

    // Fill prompt — abort nếu Slate state không nhận.
    // Gửi khi state rỗng sẽ bị Flow chặn với "Bạn phải cung cấp câu lệnh" và tốn quota.
    const filled = await fillFlowPrompt(page, prompt, log)
    log(`📝 Flow: điền prompt (${prompt.length} chars) — ${filled ? 'ok' : 'FAIL'}`)
    if (!filled) throw new Error('Flow: không điền được prompt vào Slate composer')

    // Snapshot existing media URLs trước khi send (để phát hiện ảnh output mới)
    const preSendSources: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img'))
        .map(img => (img as HTMLImageElement).src || '')
        .filter(Boolean)
    })

    await clickFlowSendButton(page)
    log(`🚀 Flow: đã gửi, chờ ảnh generate xong...`)

    // Poll phát hiện output. Signal ready THẬT:
    //   - img có src mới (không trong preSendSources)
    //   - src chứa 'media.getMediaUrlRedirect' (Flow generated asset URL)
    //   - naturalWidth >= 400 (ảnh final, không phải thumb/placeholder)
    //   - complete === true (đã load xong bytes)
    //   - KHÔNG còn progressbar visible (generation hoàn tất)
    let outputSrc: string | null = null
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed()) break
      const res = await page.evaluate((old: string[]) => {
        const imgs = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]
        const outputs = imgs.filter(img => {
          const src = img.src || ''
          if (!src || old.includes(src)) return false
          if (!src.includes('media.getMediaUrlRedirect')) return false
          if (src.includes('avatar') || src.includes('flower-placeholder')) return false
          if (src.includes('googleusercontent.com/a/')) return false
          if (!img.complete || img.naturalWidth < 400) return false
          return true
        })
        const progressbars = Array.from(document.querySelectorAll('[role="progressbar"]'))
          .filter(p => (p as HTMLElement).getBoundingClientRect().width > 0)
        // Check DOM text cho % progress (Flow hiển thị "3%", "50%" etc khi đang generate)
        const hasProgressText = /\b\d{1,3}\s*%/.test(document.body.innerText || '')
        const best = outputs.reduce<HTMLImageElement | null>((a, b) =>
          !a || b.naturalWidth > a.naturalWidth ? b : a, null)
        return {
          bestSrc: best?.src || null,
          bestNaturalW: best?.naturalWidth || 0,
          hasProgress: progressbars.length > 0,
          hasProgressText,
        }
      }, preSendSources).catch(() => null)

      if (res?.bestSrc && !res.hasProgress && !res.hasProgressText) {
        outputSrc = res.bestSrc
        log(`✅ Flow: ảnh generate xong (${res.bestNaturalW}px natural) sau ${Math.round((Date.now()-start)/1000)}s`)
        break
      }
      await page.waitForTimeout(2000)
    }

    if (!outputSrc) {
      log(`❌ Flow: timeout chờ ảnh generate sau ${Math.round(timeoutMs/1000)}s`)
      return false
    }

    const firstSrc = outputSrc
    log(`📥 Flow: tải ảnh từ ${firstSrc.slice(0, 80)}...`)

    if (firstSrc.startsWith('data:image')) {
      const base64 = firstSrc.split('base64,')[1] || ''
      await fs.writeFile(savePath, Buffer.from(base64, 'base64'))
    } else if (firstSrc.startsWith('blob:')) {
      const dataUrl = await page.evaluate(async (url) => {
        const r = await fetch(url)
        const b = await r.blob()
        return await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(b)
        })
      }, firstSrc)
      const base64 = dataUrl.split('base64,')[1] || ''
      await fs.writeFile(savePath, Buffer.from(base64, 'base64'))
    } else {
      // HTTPS URL — fetch trong browser context. KHÔNG dùng credentials:'include'
      // vì Flow's media URL redirect sang Google storage cross-origin, trả về CORS error
      // "Failed to fetch". Default fetch mode tự động kèm cookie same-origin đủ để pass.
      // Trả về base64 thay vì Array.from(Uint8Array) — nhỏ hơn ~30%, tránh size limit.
      const b64 = await page.evaluate(async (url) => {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        const ab = await r.arrayBuffer()
        const bytes = new Uint8Array(ab)
        let s = ''
        const CHUNK = 0x8000
        for (let i = 0; i < bytes.length; i += CHUNK) {
          s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
        }
        return btoa(s)
      }, firstSrc)
      await fs.writeFile(savePath, Buffer.from(b64, 'base64'))
    }

    const stat = await fs.stat(savePath)
    log(`✅ Flow: lưu ảnh ${(stat.size / 1024).toFixed(0)} KB → ${savePath}`)
    return true
  } finally {
    stopConsent()
  }
}

// ========== FLOW VIDEO: tạo 1 video ==========
async function runFlowVideo(
  page: Page,
  imagePath: string,
  prompt: string,
  savePath: string,
  timeoutMs: number,
  log: (msg: string) => void
): Promise<boolean> {
  const stopConsent = startFlowConsentWatcher(page)
  try {
    log(`🌐 Flow-video: goto labs.google/fx/tools/flow`)
    await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(3000)
    await dismissFlowConsent(page)

    const backBtn = page.locator('button').filter({ hasText: /Quay lại dự án|Back to project/i }).first()
    if ((await backBtn.count()) > 0) await backBtn.click({ timeout: 3000 }).catch(() => {})

    const newProj = page.locator('button, div').filter({ hasText: /Dự án mới|New project/i }).last()
    if ((await newProj.count()) > 0) {
      await newProj.click({ timeout: 5000 }).catch(() => {})
      log(`✅ Flow-video: click Dự án mới`)
    }
    await page.waitForTimeout(4000)

    // Mở config panel
    await clickFlowConfigButton(page)
    await page.waitForTimeout(1500)

    // Chế độ Video
    await clickFlowTab(page, /videocamVideo/, true)
    await page.waitForTimeout(800)
    // Thành phần (Components) thay vì Khung hình mặc định
    await clickFlowTab(page, /chrome_extensionThành phần/, true)
    await page.waitForTimeout(500)
    // 16:9 (thường đã default, đảm bảo active)
    await clickFlowTab(page, /crop_16_916:9/, true)
    await page.waitForTimeout(500)
    // x1 (mặc định x2)
    await clickFlowTab(page, /^x1$/, false)
    await page.waitForTimeout(500)

    // Ép model = Veo 3.1 - Quality (tránh default drift sang Fast/Lite).
    // Dropdown model là button có aria-haspopup="menu" và text bắt đầu bằng "Veo".
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
      const dd = btns.find(b =>
        b.getAttribute('aria-haspopup') === 'menu' && /^Veo\s/i.test((b.textContent || '').trim())
      )
      dd?.click()
    })
    await page.waitForTimeout(600)
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button'))
      // Chỉ match "Veo 3.1 - Quality" chuẩn, KHÔNG match "[Lower Priority]" variant
      const target = items.find(el => {
        const t = (el.textContent || '').trim()
        return /Veo\s*3\.1\s*-\s*Quality\b/i.test(t) && !/Lower Priority/i.test(t)
      }) as HTMLElement | undefined
      target?.click()
    })
    await page.waitForTimeout(500)

    // Đóng config
    await clickFlowConfigButton(page)
    await page.waitForTimeout(1000)
    log(`⚙️ Flow-video: config Video / Thành phần / 16:9 / x1 / Veo 3.1 - Quality xong`)

    // Snapshot img hiện có TRƯỚC upload để phân biệt asset mới
    const baselineImgs = await snapshotFlowImgs(page)
    // Upload ảnh qua hidden file input
    await pasteAssetIntoFlow(page, imagePath)
    log(`📎 Flow-video: upload asset, chờ ảnh load vào composer...`)
    const assetReady = await waitForFlowAssetReady(page, baselineImgs, 120000)
    if (!assetReady) throw new Error('Flow-video: thumbnail asset không xuất hiện sau 2 phút')
    log(`✅ Flow-video: asset đã load xong vào composer`)

    // Fill prompt — abort nếu Slate state không nhận.
    const filled = await fillFlowPrompt(page, prompt, log)
    log(`📝 Flow-video: điền prompt (${prompt.length} chars) — ${filled ? 'ok' : 'FAIL'}`)
    if (!filled) throw new Error('Flow-video: không điền được prompt vào Slate composer')

    // Snapshot existing video src
    const oldVideos: string[] = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('video'))
        .map(v => (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc || '')
    })

    await clickFlowSendButton(page)
    log(`🚀 Flow-video: đã gửi, chờ video render (có thể đến 10 phút)...`)

    // Chờ <video> có src chứa 'media.getMediaUrlRedirect' (signature Flow)
    try {
      await page.waitForFunction(
        ({ old }: { old: string[] }) => {
          const vids = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]
          const fresh = vids.filter(v => {
            const src = v.src || v.currentSrc || ''
            return !!src && !old.includes(src) && src.includes('media.getMediaUrlRedirect')
          })
          return fresh.length >= 1
        },
        { old: oldVideos },
        { timeout: timeoutMs }
      )
    } catch (err) {
      log(`⚠️ Flow-video: timeout chờ video sau ${Math.round(timeoutMs / 1000)}s — thử tiếp`)
    }

    await page.waitForTimeout(5000)

    // Lấy video URL
    const newVideos: Array<{ src: string }> = await page.evaluate((old) => {
      return Array.from(document.querySelectorAll('video'))
        .map(v => ({ src: (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc || '' }))
        .filter(v => v.src && !old.includes(v.src) && v.src.includes('media.getMediaUrlRedirect'))
    }, oldVideos)

    if (newVideos.length === 0) {
      // Fallback: bất kỳ video mới nào (blob OK)
      const anyNew: Array<{ src: string }> = await page.evaluate((old) => {
        return Array.from(document.querySelectorAll('video'))
          .map(v => ({ src: (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc || '' }))
          .filter(v => v.src && !old.includes(v.src))
      }, oldVideos)
      if (anyNew.length === 0) {
        log(`❌ Flow-video: không tìm thấy video mới`)
        return false
      }
      newVideos.push(...anyNew)
    }

    const firstSrc = newVideos[0].src
    log(`📥 Flow-video: tải video từ ${firstSrc.slice(0, 100)}...`)

    if (firstSrc.startsWith('blob:')) {
      const dataUrl = await page.evaluate(async (url) => {
        const r = await fetch(url)
        const b = await r.blob()
        return await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(b)
        })
      }, firstSrc)
      const base64 = dataUrl.split('base64,')[1] || ''
      await fs.writeFile(savePath, Buffer.from(base64, 'base64'))
    } else {
      // Không dùng credentials:'include' — Flow redirect cross-origin bị CORS block.
      const b64 = await page.evaluate(async (url) => {
        const r = await fetch(url)
        if (!r.ok) throw new Error(`fetch ${r.status}`)
        const ab = await r.arrayBuffer()
        const bytes = new Uint8Array(ab)
        let s = ''
        const CHUNK = 0x8000
        for (let i = 0; i < bytes.length; i += CHUNK) {
          s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
        }
        return btoa(s)
      }, firstSrc)
      await fs.writeFile(savePath, Buffer.from(b64, 'base64'))
    }

    const stat = await fs.stat(savePath)
    log(`✅ Flow-video: lưu ${(stat.size / 1024 / 1024).toFixed(1)} MB → ${savePath}`)
    return true
  } finally {
    stopConsent()
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
  log: (msg: string) => void,
  renderMode: RenderMode = 'chatgpt'
): Promise<{ success: boolean; fileName: string; error?: string }> {

  const fileName = path.basename(imagePath)
  const outExt = renderMode === 'flow-video' ? 'mp4' : 'png'
  const targetFilename = `SH_AI_${path.parse(fileName).name}.${outExt}`
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

    // Clean lock files còn sót từ lần crash/force-quit trước — nếu không Chrome sẽ "Mở trong phiên hiện tại"
    // rồi tự close context mới, gây lỗi launchPersistentContext.
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'RunningChromeVersion']) {
      const lockPath = path.join(profileDir, lockName)
      try {
        await fs.remove(lockPath)
      } catch {}
    }

    log(`🌐 Browser ${imageIndex + 1}: Mở browser tại (${pos.x}, ${pos.y})`)
    log(`📂 Profile: ${profileDir}`)
    
    // Sử dụng launchPersistentContext với profile cố định
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath && chromePath.trim() ? chromePath : undefined,
      headless: false,
      viewport: { width: browserWidth, height: browserHeight },
      ignoreDefaultArgs: ['--enable-automation'],
      permissions: ['clipboard-read', 'clipboard-write'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        // Disable occlusion/background throttling — KHI CHẠY SONG SONG NHIỀU WINDOW,
        // các window bị occluded sẽ throttle input, khiến keyboard.insertText trên Slate
        // editor không commit state. Ép Chrome coi tất cả window như visible.
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-background-timer-throttling',
        '--disable-features=CalculateNativeWinOcclusion',
        `--window-position=${pos.x},${pos.y}`
      ]
    })
    // Ép permission clipboard cho labs.google (pasteAssetIntoFlow dùng navigator.clipboard.write)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://labs.google' }).catch(() => {})
    
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
    // Ràng buộc ChatGPT wrap output giữa marker rõ ràng, extractPrompt bắt chuỗi này đầu tiên.
    const wrappedPrompt = `${promptTemplate}\n\n---\nQUAN TRỌNG: Trả về DUY NHẤT prompt cuối cùng, đặt giữa 2 marker dưới đây trên 2 dòng riêng. KHÔNG giải thích, KHÔNG thêm markdown, KHÔNG lặp lại marker.\n===PROMPT_START===\n<prompt ở đây>\n===PROMPT_END===`
    await pageA.locator('#prompt-textarea').fill(wrappedPrompt)
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

    let downloaded = false

    if (renderMode === 'chatgpt') {
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
    downloaded = await downloadImage(pageB, imageIndex, finalSavePath, log)
    } else if (renderMode === 'flow-image') {
      // ===== FLOW IMAGE =====
      log(`🎨 Browser ${imageIndex + 1}: Tab B - Render qua Flow (image)...`)
      const flowTimeout = Math.max(waitTimeGenerate, 360000) // tối thiểu 6 phút
      downloaded = await runFlowImage(pageB, imagePath, extractedPrompt, finalSavePath, flowTimeout, log)
    } else if (renderMode === 'flow-video') {
      // ===== FLOW VIDEO =====
      log(`🎬 Browser ${imageIndex + 1}: Tab B - Render qua Flow (video)...`)
      const flowTimeout = Math.max(waitTimeGenerate, 600000) // tối thiểu 10 phút
      downloaded = await runFlowVideo(pageB, imagePath, extractedPrompt, finalSavePath, flowTimeout, log)
    }

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
      waitTimeGenerate,
      maxRetry,
      renderMode: rawRenderMode
    } = config

    const renderMode: RenderMode =
      rawRenderMode === 'flow-image' || rawRenderMode === 'flow-video' ? rawRenderMode : 'chatgpt'

    const finalOutputFolder = outputFolder || path.join(inputFolder, 'AI')
    const CONCURRENCY = 5
    const retryCap = Math.max(0, parseInt(maxRetry) || 3)
    const modeLabel =
      renderMode === 'flow-image' ? 'Flow (ảnh)' : renderMode === 'flow-video' ? 'Flow (video)' : 'ChatGPT'
    log(`🚀 Bắt đầu quy trình [${modeLabel}] với ${CONCURRENCY} BROWSERS song song, max retry = ${retryCap}`)

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

    // Chạy 1 batch (tối đa CONCURRENCY ảnh song song). Trả về map filename → kết quả.
    const runBatch = async (
      batchFiles: string[],
      passLabel: string
    ): Promise<Array<{ success: boolean; fileName: string; error?: string }>> => {
      log(`🖥️ ${passLabel}: chạy ${batchFiles.length} ảnh song song...`)
      return Promise.all(
        batchFiles.map((file, idx) => {
          const imagePath = path.join(inputFolder, file)
          return processImageInBrowser(
            imagePath,
            idx,
            promptTemplate,
            chromePath,
            finalOutputFolder,
            waitTimeUpload || 5000,
            waitTimeGenerate || 120000,
            log,
            renderMode
          )
        })
      )
    }

    // PASS 0: xử lý HẾT ảnh, cắt thành batch 5
    const allResults = new Map<string, { success: boolean; fileName: string; error?: string }>()
    let pending = [...files]

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      if (shouldStop) { log('⏹️ Đã dừng theo yêu cầu người dùng'); break }
      const batch = pending.slice(i, i + CONCURRENCY)
      const batchNum = Math.floor(i / CONCURRENCY) + 1
      const totalBatches = Math.ceil(pending.length / CONCURRENCY)
      const results = await runBatch(batch, `Pass 1 — batch ${batchNum}/${totalBatches}`)
      results.forEach((r, idx) => allResults.set(batch[idx], r))
      const okInBatch = results.filter(r => r.success).length
      log(`📊 Batch ${batchNum}/${totalBatches}: ${okInBatch}/${batch.length} ok`)
    }

    // RETRY PASS: gom ảnh fail, retry tối đa retryCap lần
    for (let pass = 1; pass <= retryCap; pass++) {
      if (shouldStop) break
      const failedFiles = [...allResults.entries()]
        .filter(([, r]) => !r.success)
        .map(([f]) => f)
      if (failedFiles.length === 0) {
        log(`🎉 Không còn ảnh lỗi, skip retry pass ${pass}`)
        break
      }
      log(`🔁 Retry pass ${pass}/${retryCap}: ${failedFiles.length} ảnh lỗi cần làm lại`)
      for (let i = 0; i < failedFiles.length; i += CONCURRENCY) {
        if (shouldStop) { log('⏹️ Đã dừng theo yêu cầu'); break }
        const batch = failedFiles.slice(i, i + CONCURRENCY)
        const batchNum = Math.floor(i / CONCURRENCY) + 1
        const totalBatches = Math.ceil(failedFiles.length / CONCURRENCY)
        const results = await runBatch(batch, `Retry ${pass} — batch ${batchNum}/${totalBatches}`)
        results.forEach((r, idx) => {
          // Chỉ cập nhật nếu retry thành công, giữ lỗi cũ nếu lại fail (để log rõ)
          if (r.success) allResults.set(batch[idx], r)
          else allResults.set(batch[idx], { ...r, error: `retry ${pass}: ${r.error || 'unknown'}` })
        })
      }
    }

    // Tổng hợp
    const finalResults = [...allResults.values()]
    const successCount = finalResults.filter(r => r.success).length
    const failedList = finalResults.filter(r => !r.success)

    log(`🏁 Hoàn tất!`)
    log(`✅ Thành công: ${successCount}/${finalResults.length}`)
    if (failedList.length > 0) {
      log(`⚠️ Còn ${failedList.length} ảnh lỗi sau ${retryCap} retry:`)
      for (const r of failedList) log(`  - ${r.fileName}: ${r.error}`)
    }

    isRunning = false
    return { success: true, processedCount: successCount, totalCount: finalResults.length, failed: failedList }

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

// ========== LOGOUT: XOÁ HẾT PROFILE ĐỂ ĐĂNG XUẤT TÀI KHOẢN CHATGPT ==========
ipcMain.handle('logout-accounts', async () => {
  try {
    const PROFILES = 5
    let removed = 0
    for (let i = 0; i < PROFILES; i++) {
      const dir = getBrowserProfileDir(i)
      if (await fs.pathExists(dir)) {
        await fs.remove(dir)
        removed++
      }
    }
    return { success: true, removed }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) }
  }
})

// Giữ reference để close khi user confirm
let loginContext: BrowserContext | null = null

// ========== OPEN LOGIN BROWSER: mở profile-0, chờ user login + 2FA ==========
async function openLoginBrowserFor(
  site: 'chatgpt' | 'flow',
  event: Electron.IpcMainInvokeEvent
): Promise<{ success: boolean; message?: string }> {
  if (loginContext) {
    return { success: false, message: 'Đang có phiên login khác mở, vui lòng confirm hoặc hủy trước' }
  }
  const log = (msg: string) => {
    try { if (!event.sender.isDestroyed()) event.sender.send('automation-log', msg) } catch {}
  }
  try {
    const profileDir = getBrowserProfileDir(0)
    await fs.ensureDir(profileDir)
    // Clean stale singleton locks
    for (const lockName of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'RunningChromeVersion']) {
      try { await fs.remove(path.join(profileDir, lockName)) } catch {}
    }
    log(`🔑 Mở trình duyệt đăng nhập ${site === 'flow' ? 'Flow (Google)' : 'ChatGPT'} tại profile-0...`)
    loginContext = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled', '--disable-infobars']
    })
    const page = loginContext.pages()[0] || await loginContext.newPage()
    const url = site === 'flow' ? 'https://labs.google/fx/vi/tools/flow' : 'https://chatgpt.com'
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    log(`✅ Browser đã mở (${url}). Đăng nhập xong thì bấm "Xác nhận đã đăng nhập" trong app.`)

    loginContext.on('close', () => {
      loginContext = null
      log(`⚠️ Browser login đã đóng. Nếu chưa bấm "Xác nhận", session KHÔNG được copy.`)
    })
    return { success: true }
  } catch (err) {
    loginContext = null
    return { success: false, message: getErrorMessage(err) }
  }
}

ipcMain.handle('open-login-browser', async (event) => openLoginBrowserFor('chatgpt', event))
ipcMain.handle('open-login-flow', async (event) => openLoginBrowserFor('flow', event))

// ========== CONFIRM LOGIN DONE: copy profile-0 sang 1..4, đóng browser ==========
ipcMain.handle('confirm-login-done', async (event) => {
  const log = (msg: string) => {
    try { if (!event.sender.isDestroyed()) event.sender.send('automation-log', msg) } catch {}
  }
  if (!loginContext) {
    return { success: false, message: 'Chưa có browser login đang mở' }
  }
  try {
    log(`💾 Đóng browser và lưu session...`)
    await loginContext.close().catch(() => {})
    loginContext = null

    const src = getBrowserProfileDir(0)
    if (!(await fs.pathExists(src))) {
      return { success: false, message: 'Profile-0 không tồn tại' }
    }
    log(`📋 Copy session sang profile 1..4...`)
    // Skip volatile lock files / broken symlinks mà Chromium tạo runtime
    const SKIP_FILES = new Set(['RunningChromeVersion', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'])
    for (let i = 1; i <= 4; i++) {
      const dst = getBrowserProfileDir(i)
      await fs.remove(dst)
      await fs.copy(src, dst, {
        filter: (srcPath) => !SKIP_FILES.has(path.basename(srcPath)),
        dereference: false
      })
      log(`  ✅ profile-${i}`)
    }
    log(`✨ Đã đồng bộ login cho 5 browsers. Sẵn sàng chạy lại quy trình.`)
    return { success: true }
  } catch (err) {
    return { success: false, message: getErrorMessage(err) }
  }
})
