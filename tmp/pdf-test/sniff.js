const { app, nativeImage } = require('electron')
const fs = require('fs')

const files = [
  'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\Group2\\$%\\N\\$%(N@`XMR@{PI_UPTN2N8Q9.jpg',
  'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\Group2\\$2\\7H\\$27HWZ(GC1_B9`(74YFUDMP.jpg',
  'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\Group2\\$2\\Z{\\$2Z{P`P(@LYVA9)1YN){N5R.jpg',
  'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\C2C\\87954d84f45a8bcd119d0cfb34a3136f.gif',
  'D:\\Temp\\ScreenShot_2026-11-05_135516_277.png',
  'D:\\Kevin\\Documents\\Tencent Files\\517337146\\Image\\Group2\\@V\\}~\\@V}~{ZTM]QEM%KUM~7(%F[D.jpg'
]

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg'
  if (buf.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png'
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF') return 'webp?'
  if (buf.toString('ascii', 0, 2) === 'BM') return 'bmp'
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico'
  return 'unknown'
}

const MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

app.whenReady().then(() => {
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log('MISSING', f)
      continue
    }
    const buf = fs.readFileSync(f)
    const kind = sniff(buf)
    console.log('\n===', f.split('\\').pop(), `${(buf.length / 1024 / 1024).toFixed(2)}MB`, 'real =', kind)

    const declared = `data:image/${f.split('.').pop().toLowerCase()};base64,${buf.toString('base64')}`
    const a = nativeImage.createFromDataURL(declared)
    console.log('  createFromDataURL(declared mime): empty =', a.isEmpty(), a.isEmpty() ? '' : JSON.stringify(a.getSize()))

    const correct = MIME[kind] || 'image/png'
    const b = nativeImage.createFromDataURL(`data:${correct};base64,${buf.toString('base64')}`)
    console.log(`  createFromDataURL(${correct}): empty =`, b.isEmpty(), b.isEmpty() ? '' : JSON.stringify(b.getSize()))

    const c = nativeImage.createFromBuffer(buf)
    console.log('  createFromBuffer: empty =', c.isEmpty(), c.isEmpty() ? '' : JSON.stringify(c.getSize()))

    if (!c.isEmpty()) console.log('  toJPEG bytes =', c.toJPEG(90).length)
  }
  app.quit()
})