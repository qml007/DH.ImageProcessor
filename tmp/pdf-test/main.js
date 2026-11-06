const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { buildPdfFromDataUrls } = require('./pdf.js')

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  let crc = 0xffffffff
  const buf = body
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  crc = (crc ^ 0xffffffff) >>> 0
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc, 0)
  return Buffer.concat([len, body, crcBuf])
}

function makePng(width, height, colorType, fill) {
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = Buffer.alloc((width * channels + 1) * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) raw[p++] = fill(x, y, c)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)
  ihdr.writeUInt8(colorType, 9)
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function countPages(pdf) {
  const text = pdf.toString('latin1')
  return (text.match(/\/Type \/Page[^s]/g) || []).length
}

function report(label, dataUrl) {
  const built = buildPdfFromDataUrls([dataUrl])
  console.log(
    `${label}: used=${built.used} skipped=${built.skipped} pdfBytes=${built.pdf ? built.pdf.length : 0}` +
      (built.pdf ? ` pages=${countPages(built.pdf)}` : '')
  )
  return built
}

app.whenReady().then(() => {
  const iconPath = path.join(__dirname, '..', '..', 'resources', 'icon.png')
  const iconBuf = fs.readFileSync(iconPath)
  console.log('icon.png bytes =', iconBuf.length, 'colorType =', iconBuf.readUInt8(8 + 8 + 9))

  const iconUrl = `data:image/png;base64,${iconBuf.toString('base64')}`
  report('icon.png', iconUrl)

  const ni = nativeImage.createFromDataURL(iconUrl)
  console.log('nativeImage empty =', ni.isEmpty(), 'size =', JSON.stringify(ni.getSize()))
  const jpegBuf = ni.toJPEG(90)
  console.log('toJPEG bytes =', jpegBuf.length)

  if (jpegBuf.length) {
    const jpegUrl = `data:image/jpeg;base64,${Buffer.from(jpegBuf).toString('base64')}`
    report('toJPEG(baseline?)', jpegUrl)
  }

  const rgba = makePng(800, 1200, 6, (x, y, c) => (c === 3 ? 255 : (x + y) % 256))
  const rgbaUrl = `data:image/png;base64,${rgba.toString('base64')}`
  report('synthetic RGBA png 800x1200', rgbaUrl)

  const rgb = makePng(800, 1200, 2, (x, y, c) => (x * 3 + y + c * 60) % 256)
  const rgbUrl = `data:image/png;base64,${rgb.toString('base64')}`
  report('synthetic RGB png 800x1200', rgbUrl)

  const ni2 = nativeImage.createFromDataURL(rgbaUrl)
  console.log('rgba nativeImage empty =', ni2.isEmpty(), 'size =', JSON.stringify(ni2.getSize()))
  console.log('rgba toJPEG bytes =', ni2.toJPEG(90).length)

  const multi = buildPdfFromDataUrls([iconUrl, rgbaUrl, rgbUrl, iconUrl])
  console.log(
    `multi: used=${multi.used} skipped=${multi.skipped} pages=${multi.pdf ? countPages(multi.pdf) : 0}`
  )
  if (multi.pdf) {
    fs.writeFileSync(path.join(__dirname, 'out.pdf'), multi.pdf)
    console.log('wrote out.pdf')
  }

  app.quit()
})