const { app, BrowserWindow, nativeImage } = require('electron')
const path = require('path')

const html = `<!doctype html><html><body><canvas id="c" width="200" height="150"></canvas></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 300, height: 300 })
  await win.loadURL('data:text/html,' + encodeURIComponent(html))

  const urls = await win.webContents.executeJavaScript(`
    (() => {
      const c = document.getElementById('c')
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(0, 0, 200, 150)
      ctx.fillStyle = '#fff'
      ctx.fillRect(20, 20, 60, 60)
      const out = {}
      for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp']) {
        try { out[type] = c.toDataURL(type, 0.92) } catch (e) { out[type] = 'ERR:' + e.message }
      }
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#ef4444"/></svg>'
      out['image/svg+xml'] = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)))
      return out
    })()
  `)

  const fs = require('fs')
  const wechatGif = 'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\C2C\\87954d84f45a8bcd119d0cfb34a3136f.gif'
  if (fs.existsSync(wechatGif)) {
    const buf = fs.readFileSync(wechatGif)
    urls['image/gif'] = 'data:image/gif;base64,' + buf.toString('base64')
  }
  const ico = 'D:\\Temp\\0025e153-02f9-4dc7-98bb-e6a52183b26b.tmp.ico'
  if (fs.existsSync(ico)) {
    const buf = fs.readFileSync(ico)
    urls['image/x-icon'] = 'data:image/x-icon;base64,' + buf.toString('base64')
  }

  for (const [type, url] of Object.entries(urls)) {
    if (typeof url !== 'string' || !url.startsWith('data:')) {
      console.log(type, '->', String(url).slice(0, 40))
      continue
    }
    const buf = Buffer.from(url.split(',')[1], 'base64')
    const byDataUrl = nativeImage.createFromDataURL(url)
    const byBuffer = nativeImage.createFromBuffer(buf)
    console.log(
      type.padEnd(16),
      `${(buf.length / 1024).toFixed(1)}KB`,
      'dataURL empty =', byDataUrl.isEmpty(),
      '| buffer empty =', byBuffer.isEmpty(),
      byBuffer.isEmpty() ? '' : JSON.stringify(byBuffer.getSize())
    )
  }

  app.quit()
})