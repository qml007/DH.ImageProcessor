const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const logFile = path.join(__dirname, 'ipc-result.txt')
fs.writeFileSync(logFile, '')

function log(line) {
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
}

ipcMain.handle('echo', (_e, payload) => {
  return { length: payload ? payload.length : 0 }
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })

  win.webContents.on('console-message', (_e, _level, message) => log('[page] ' + message))
  win.webContents.on('render-process-gone', (_e, details) => {
    log('RENDER GONE: ' + JSON.stringify(details))
    app.quit()
  })

  win.loadURL(
    'data:text/html,<script>' +
      'const { ipcRenderer } = require("electron");' +
      '(async () => {' +
      ' const sizes = [50, 100, 150, 200, 300];' +
      ' for (const mb of sizes) {' +
      '  const len = mb * 1024 * 1024;' +
      '  try {' +
      '   const s = "A".repeat(len);' +
      '   const t0 = Date.now();' +
      '   const r = await ipcRenderer.invoke("echo", s);' +
      '   console.log("OK " + mb + "MB -> " + r.length + " in " + (Date.now()-t0) + "ms");' +
      '  } catch (err) {' +
      '   console.log("FAIL " + mb + "MB -> " + err.message);' +
      '  }' +
      ' }' +
      ' console.log("DONE");' +
      '})();' +
      '</script>'
  )

  setTimeout(() => app.quit(), 60000)
})