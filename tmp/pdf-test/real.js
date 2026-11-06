const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const { buildPdfFromDataUrls } = require('./pdf.js')

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif'
}

function collect(dir, out, limit) {
  if (out.length >= limit) return
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= limit) return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collect(full, out, limit)
    } else {
      const ext = entry.name.split('.').pop().toLowerCase()
      if (!MIME[ext]) continue
      try {
        const st = fs.statSync(full)
        if (st.size < 20000 || st.size > 30 * 1024 * 1024) continue
      } catch {
        continue
      }
      out.push(full)
    }
  }
}

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

app.whenReady().then(() => {
  const files = []
  collect('D:\\Temp\\ScreenShot', files, 6)
  collect('D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image', files, 30)
  collect('D:\\Temp\\baidu', files, 10)
  console.log('collected files:', files.length)

  const groups = [[], [], [], []]
  files.forEach((f, i) => groups[i % 4].push(f))

  groups.forEach((group, gi) => {
    const urls = []
    for (const f of group) {
      const ext = f.split('.').pop().toLowerCase()
      const buf = fs.readFileSync(f)
      urls.push(`data:${MIME[ext]};base64,${buf.toString('base64')}`)
    }
    try {
      const t0 = Date.now()
      const built = buildPdfFromDataUrls(urls)
      console.log(
        `archive${gi}: files=${group.length} used=${built.used} skipped=${built.skipped} pdf=${built.pdf ? mb(built.pdf.length) : 'null'} ${Date.now() - t0}ms`
      )
      if (built.pdf) fs.writeFileSync(path.join(__dirname, `real-${gi}.pdf`), built.pdf)
    } catch (err) {
      console.log(`archive${gi}: THROW ${err && err.stack ? err.stack : err}`)
    }
  })

  for (const f of files) {
    const ext = f.split('.').pop().toLowerCase()
    const buf = fs.readFileSync(f)
    const url = `data:${MIME[ext]};base64,${buf.toString('base64')}`
    try {
      const built = buildPdfFromDataUrls([url])
      if (built.used !== 1) console.log(`SKIP/FAIL: ${f} (${mb(buf.length)}) used=${built.used}`)
    } catch (err) {
      console.log(`THROW on ${f}: ${err && err.message}`)
    }
  }

  app.quit()
})