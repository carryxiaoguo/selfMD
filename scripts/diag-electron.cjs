// Diagnostic: what does require('electron') actually resolve to in the main process?
const electron = require('electron')

console.log('typeof require("electron") =>', typeof electron)
console.log('is string (npm package path)? =>', typeof electron === 'string')
try {
  console.log('keys =>', Object.keys(electron).slice(0, 30).join(', '))
} catch (e) {
  console.log('keys => <not an object>', e.message)
}
console.log('typeof electron.protocol =>', typeof electron.protocol)
console.log('typeof electron.app =>', typeof electron.app)
console.log('require.resolve("electron") =>', require.resolve('electron'))

const { app } = electron
if (app && typeof app.whenReady === 'function') {
  app.whenReady().then(() => {
    console.log('app ready OK, electron version:', process.versions.electron)
    app.exit(0)
  })
} else {
  console.log('NO app API — this is not running inside the Electron main process')
  process.exit(2)
}
