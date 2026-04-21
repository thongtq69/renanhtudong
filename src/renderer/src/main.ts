import './style.css'

const { electron } = window as any

const inputFolder = document.getElementById('input-folder') as HTMLInputElement
const outputFolder = document.getElementById('output-folder') as HTMLInputElement
const chromePath = document.getElementById('chrome-path') as HTMLInputElement
const userProfile = document.getElementById('user-profile') as HTMLInputElement
const promptTemplate = document.getElementById('prompt-template') as HTMLTextAreaElement
const waitUpload = document.getElementById('wait-upload') as HTMLInputElement
const waitGenerate = document.getElementById('wait-generate') as HTMLInputElement
const maxRetry = document.getElementById('max-retry') as HTMLInputElement
const renderMode = document.getElementById('render-mode') as HTMLSelectElement

const btnInput = document.getElementById('btn-input') as HTMLButtonElement
const btnOutput = document.getElementById('btn-output') as HTMLButtonElement
const btnChrome = document.getElementById('btn-chrome') as HTMLButtonElement
const btnProfile = document.getElementById('btn-profile') as HTMLButtonElement
const btnLoadPrompt = document.getElementById('btn-load-prompt') as HTMLButtonElement
const btnSavePrompt = document.getElementById('btn-save-prompt') as HTMLButtonElement
const btnStart = document.getElementById('btn-start') as HTMLButtonElement
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement
const btnCover = document.getElementById('btn-cover') as HTMLButtonElement
const btnLogo = document.getElementById('btn-logo') as HTMLButtonElement
const btnClearCover = document.getElementById('btn-clear-cover') as HTMLButtonElement
const btnClearLogo = document.getElementById('btn-clear-logo') as HTMLButtonElement
const btnWatermark = document.getElementById('btn-watermark') as HTMLButtonElement
const btnCreatePdf = document.getElementById('btn-create-pdf') as HTMLButtonElement

const logContainer = document.getElementById('log-container') as HTMLElement
const statusText = document.getElementById('status-text') as HTMLElement
const progressText = document.getElementById('progress-text') as HTMLElement
const progressBar = document.getElementById('progress-bar') as HTMLElement

const coverImage = document.getElementById('cover-image') as HTMLInputElement
const logoImage = document.getElementById('logo-image') as HTMLInputElement
const logoSize = document.getElementById('logo-size') as HTMLInputElement
const logoPosition = document.getElementById('logo-position') as HTMLSelectElement
const logoPreview = document.getElementById('logo-preview') as HTMLDivElement
const coverPreview = document.getElementById('cover-preview') as HTMLDivElement

// Load saved config
const savedConfig = JSON.parse(localStorage.getItem('app-config') || '{}')
inputFolder.value = savedConfig.inputFolder || ''
outputFolder.value = savedConfig.outputFolder || ''
const isMac = /mac/i.test(navigator.userAgent)
const defaultChromePath = isMac ? '' : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
chromePath.value = savedConfig.chromePath ?? defaultChromePath
if (isMac && chromePath.value && chromePath.value.includes('\\')) chromePath.value = ''
userProfile.value = savedConfig.userProfile || ''
promptTemplate.value = savedConfig.promptTemplate || 'Please generate a standard prompt code for this image including keywords: IMPORTANT, PRIMARY OBJECTIVE, ABSOLUTE CONSTRAINTS'
waitUpload.value = savedConfig.waitTimeUpload || 5000
// Ép min 120s cho generate vì ChatGPT tạo ảnh thường 60-180s
const savedWaitGen = parseInt(savedConfig.waitTimeGenerate) || 180000
waitGenerate.value = String(Math.max(savedWaitGen, 120000))
maxRetry.value = savedConfig.maxRetry || 3
renderMode.value = savedConfig.renderMode || 'chatgpt'
coverImage.value = savedConfig.coverImage || ''
logoImage.value = savedConfig.logoImage || ''
logoSize.value = savedConfig.logoSize || 8
logoPosition.value = savedConfig.logoPosition || '4'

if (logoImage.value) {
  logoPreview.innerHTML = `<img src="file://${logoImage.value}" alt="Logo Preview" />`
  btnClearLogo.disabled = false
}
if (coverImage.value) {
  coverPreview.innerHTML = `<img src="file://${coverImage.value}" alt="Cover Preview" />`
  btnClearCover.disabled = false
}

function saveConfig() {
  const config = {
    inputFolder: inputFolder.value,
    outputFolder: outputFolder.value,
    chromePath: chromePath.value,
    userProfile: userProfile.value,
    promptTemplate: promptTemplate.value,
    waitTimeUpload: parseInt(waitUpload.value),
    waitTimeGenerate: parseInt(waitGenerate.value),
    maxRetry: parseInt(maxRetry.value),
    renderMode: renderMode.value,
    coverImage: coverImage.value,
    logoImage: logoImage.value,
    logoSize: parseInt(logoSize.value),
    logoPosition: parseInt(logoPosition.value)
  }
  localStorage.setItem('app-config', JSON.stringify(config))
  return config
}

function addLog(msg: string) {
  const p = document.createElement('p')
  p.className = 'log-msg'
  if (msg.includes('✅') || msg.includes('✨') || msg.includes('💾') || msg.includes(' Hoàn tất')) p.classList.add('success')
  else if (msg.includes('❌') || msg.includes('LỖI')) p.classList.add('error')
  else if (msg.includes('⚠️') || msg.includes('⏯️')) p.classList.add('warning')
  else p.classList.add('info')

  p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  logContainer.appendChild(p)
  logContainer.scrollTop = logContainer.scrollHeight
  statusText.textContent = msg
}

// Folder/File selection
btnInput.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-folder')
  if (path) inputFolder.value = path
})

btnOutput.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-folder')
  if (path) outputFolder.value = path
})

btnChrome.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-file')
  if (path) chromePath.value = path
})

btnProfile.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-folder')
  if (path) userProfile.value = path
})

// Cover image selection
btnCover.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-image')
  if (path) {
    coverImage.value = path
    coverPreview.innerHTML = `<img src="file://${path}" alt="Cover Preview" />`
  }
})

// Logo image selection
btnLogo.addEventListener('click', async () => {
  const path = await electron.ipcRenderer.invoke('select-image')
  if (path) {
    logoImage.value = path
    logoPreview.innerHTML = `<img src="file://${path}" alt="Logo Preview" />`
    btnClearLogo.disabled = false
  }
})

// Clear cover image
btnClearCover.addEventListener('click', () => {
  coverImage.value = ''
  coverPreview.innerHTML = ''
  btnClearCover.disabled = true
})

// Clear logo image
btnClearLogo.addEventListener('click', () => {
  logoImage.value = ''
  logoPreview.innerHTML = ''
  btnClearLogo.disabled = true
})

// Watermark images
btnWatermark.addEventListener('click', async () => {
  if (!outputFolder.value) {
    addLog('❌ Vui lòng chọn thư mục tải ảnh về trước!')
    return
  }

  if (!logoImage.value) {
    addLog('❌ Vui lòng chọn file logo trước!')
    return
  }

  btnWatermark.disabled = true
  btnWatermark.textContent = 'Đang gắn logo...'
  addLog('🖼️ Bắt đầu gắn logo lên ảnh...')
  addLog('📁 Ảnh gốc giữ nguyên, ảnh có logo lưu vào thư mục LOGO')

  const result = await electron.ipcRenderer.invoke('watermark-images', {
    logoImage: logoImage.value,
    logoSize: parseInt(logoSize.value) || 8,
    logoPosition: parseInt(logoPosition.value) || 4,
    outputFolder: outputFolder.value
  })

  btnWatermark.disabled = false
  btnWatermark.textContent = '🖼️ Gắn Logo lên Ảnh'

  if (result.success) {
    addLog(`✅ Hoàn tất! Đã gắn logo lên ${result.processedCount} ảnh`)
    addLog(`📂 Thư mục LOGO: ${result.outputFolder}`)
  } else {
    addLog(`❌ Lỗi gắn logo: ${result.message}`)
  }
})

// Create PDF
btnCreatePdf.addEventListener('click', async () => {
  if (!outputFolder.value) {
    addLog('❌ Vui lòng chọn thư mục tải ảnh về trước!')
    return
  }

  btnCreatePdf.disabled = true
  btnCreatePdf.textContent = 'Đang tạo PDF...'
  addLog('📄 Bắt đầu tạo PDF...')
  addLog('💡 PDF sẽ ưu tiên lấy ảnh từ thư mục LOGO (nếu có)')

  const result = await electron.ipcRenderer.invoke('create-pdf', {
    coverImage: coverImage.value || null,
    outputFolder: outputFolder.value
  })

  btnCreatePdf.disabled = false
  btnCreatePdf.textContent = '📄 Tạo PDF'

  if (result.success) {
    addLog(`✅ Đã tạo PDF: ${result.outputPath}`)
  } else {
    addLog(`❌ Lỗi tạo PDF: ${result.message}`)
  }
})

btnLoadPrompt.addEventListener('click', async () => {
  const content = await electron.ipcRenderer.invoke('read-prompt')
  if (content !== null) {
     promptTemplate.value = content
     addLog('📥 Đã nạp prompt từ file.')
  }
})

btnSavePrompt.addEventListener('click', async () => {
  const success = await electron.ipcRenderer.invoke('save-prompt', promptTemplate.value)
  if (success) {
     addLog('💾 Đã lưu prompt ra file.')
  }
})

// Automation control
btnStart.addEventListener('click', async () => {
  const config = saveConfig()
  
  if (!config.inputFolder || !config.outputFolder) {
    addLog('❌ Vui lòng chọn thư mục ảnh đầu vào và thư mục tải ảnh về!')
    return
  }

  btnStart.disabled = true
  btnStart.textContent = 'Đang chạy...'
  addLog('🚀 Bắt đầu gửi yêu cầu đến Playwright...')

  const result = await electron.ipcRenderer.invoke('start-automation', config)
  
  btnStart.disabled = false
  btnStart.textContent = '🚀 Bắt đầu Quy trình'
  
  if (result.success) {
    addLog('✨ Đã hoàn tất toàn bộ danh sách!')
  } else {
    addLog(`❌ Quy trình dừng lại: ${result.message || 'Lỗi không xác định'}`)
  }
})

btnStop.addEventListener('click', async () => {
  if (confirm('Bạn có chắc chắn muốn dừng quy trình và đóng ứng dụng?')) {
    await electron.ipcRenderer.invoke('stop-automation')
    btnStart.disabled = false
    btnStart.textContent = '🚀 Bắt đầu Quy trình'
    addLog('🛑 Đã dừng quy trình.')
  }
})

// ========== LOGIN / LOGOUT CONTROLS ==========
const btnLogout = document.getElementById('btn-logout') as HTMLButtonElement
const btnOpenLogin = document.getElementById('btn-open-login') as HTMLButtonElement
const btnOpenLoginFlow = document.getElementById('btn-open-login-flow') as HTMLButtonElement
const btnConfirmLogin = document.getElementById('btn-confirm-login') as HTMLButtonElement

btnLogout.addEventListener('click', async () => {
  if (!confirm('Xoá cookies/session của 5 browser profiles để đăng xuất tài khoản ChatGPT hiện tại?')) return
  btnLogout.disabled = true
  addLog('🚪 Đang xoá cookies/session...')
  const r = await electron.ipcRenderer.invoke('logout-accounts')
  btnLogout.disabled = false
  if (r.success) addLog(`✅ Đã xoá ${r.removed} profile. Bấm "Đăng nhập tài khoản mới" để tiếp tục.`)
  else addLog(`❌ Lỗi đăng xuất: ${r.error}`)
})

btnOpenLogin.addEventListener('click', async () => {
  btnOpenLogin.disabled = true
  btnOpenLoginFlow.disabled = true
  addLog('🔑 Đang mở trình duyệt đăng nhập ChatGPT...')
  const r = await electron.ipcRenderer.invoke('open-login-browser')
  if (r.success) {
    btnConfirmLogin.disabled = false
    addLog('👉 Đăng nhập ChatGPT + xác thực 2FA xong, bấm "Xác nhận đã đăng nhập".')
  } else {
    btnOpenLogin.disabled = false
    btnOpenLoginFlow.disabled = false
    addLog(`❌ Không mở được browser: ${r.message || 'unknown'}`)
  }
})

btnOpenLoginFlow.addEventListener('click', async () => {
  btnOpenLogin.disabled = true
  btnOpenLoginFlow.disabled = true
  addLog('🎨 Đang mở trình duyệt đăng nhập Flow (Google)...')
  const r = await electron.ipcRenderer.invoke('open-login-flow')
  if (r.success) {
    btnConfirmLogin.disabled = false
    addLog('👉 Đăng nhập Google → Flow xong, bấm "Xác nhận đã đăng nhập" để sync sang 4 profile còn lại.')
  } else {
    btnOpenLogin.disabled = false
    btnOpenLoginFlow.disabled = false
    addLog(`❌ Không mở được browser: ${r.message || 'unknown'}`)
  }
})

btnConfirmLogin.addEventListener('click', async () => {
  btnConfirmLogin.disabled = true
  btnConfirmLogin.textContent = 'Đang đồng bộ...'
  addLog('✅ Xác nhận login — đóng browser và copy session sang 4 profile còn lại...')
  const r = await electron.ipcRenderer.invoke('confirm-login-done')
  btnConfirmLogin.textContent = '✅ Xác nhận đã đăng nhập'
  btnOpenLogin.disabled = false
  btnOpenLoginFlow.disabled = false
  if (r.success) {
    addLog('✨ Đồng bộ xong. Có thể bấm "Bắt đầu Quy trình".')
  } else {
    btnConfirmLogin.disabled = false
    addLog(`❌ Lỗi: ${r.message}`)
  }
})

// Listen for logs from main process
electron.ipcRenderer.on('automation-log', (msg: string) => {
  addLog(msg)

  if (msg.includes('Tìm thấy')) {
    const total = parseInt(msg.match(/\d+/)?.[0] || '0')
    progressText.dataset.total = total.toString()
    progressText.dataset.current = '0'
    progressText.textContent = `0/${total}`
    progressBar.style.width = '0%'
  } else if (msg.includes('💾 Đã lưu')) {
    const current = (parseInt(progressText.dataset.current || '0') + 1)
    const total = parseInt(progressText.dataset.total || '1')
    progressText.dataset.current = current.toString()
    progressText.textContent = `${current}/${total}`
    progressBar.style.width = `${(current / total) * 100}%`
  }
})

// Listen for "wait for Got It" event from main process
electron.ipcRenderer.on('wait-got-it', (waiting: boolean) => {
  const overlay = document.getElementById('wait-overlay')
  if (overlay) {
    if (waiting) {
      overlay.classList.add('active')
    } else {
      overlay.classList.remove('active')
    }
  }
})
