const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

exports.default = async function afterPack(context) {
  const outDir = context && context.appOutDir
  if (!outDir) return
  const platform = context && context.electronPlatformName
  try {
    execFileSync('xattr', ['-cr', outDir], { stdio: 'inherit' })
    console.log(`[afterPack] cleared xattr: ${outDir}`)
  } catch (error) {
    console.warn(`[afterPack] xattr clear failed: ${error && error.message ? error.message : error}`)
  }
  if (platform === 'win32') {
    const badSerialBindingDir = path.join(
      outDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '@serialport',
      'bindings-cpp',
      'build',
      'Release',
    )
    try {
      fs.rmSync(badSerialBindingDir, { recursive: true, force: true })
      console.log(`[afterPack] removed serialport build bindings: ${badSerialBindingDir}`)
    } catch (error) {
      console.warn(`[afterPack] remove serialport build bindings failed: ${error && error.message ? error.message : error}`)
    }
  }
}
