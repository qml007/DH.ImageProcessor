const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { buildPdfFromDataUrls } = require('./pdf.js')

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body), 0)
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
  return (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length
}

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

app.whenReady().then(() => {
  const big = makePng(3000, 4000, 6, (x, y, c) => (c === 3 ? 255 : (x * 7 + y * 3) % 256))
  const bigUrl = `data:image/png;base64,${big.toString('base64')}`
  console.log('big RGBA png 3000x4000:', mb(big.length), 'dataUrl:', mb(bigUrl.length))

  const ni = nativeImage.createFromDataURL(bigUrl)
  console.log('  nativeImage empty =', ni.isEmpty(), 'size =', JSON.stringify(ni.getSize()))
  const jpeg = ni.toJPEG(90)
  console.log('  toJPEG bytes =', jpeg.length)

  const t0 = Date.now()
  const built = buildPdfFromDataUrls([bigUrl])
  console.log(
    `  single build: used=${built.used} skipped=${built.skipped} bytes=${built.pdf ? mb(built.pdf.length) : 0} pages=${built.pdf ? countPages(built.pdf) : 0} ${Date.now() - t0}ms`
  )

  const urls = []
  for (let i = 0; i < 8; i++) urls.push(bigUrl)
  const t1 = Date.now()
  const multi = buildPdfFromDataUrls(urls)
  console.log(
    `  8x build: used=${multi.used} skipped=${multi.skipped} bytes=${multi.pdf ? mb(multi.pdf.length) : 0} pages=${multi.pdf ? countPages(multi.pdf) : 0} ${Date.now() - t1}ms rss=${mb(process.memoryUsage().rss)}`
  )

  console.log('heapUsed =', mb(process.memoryUsage().heapUsed))

  app.quit()
})