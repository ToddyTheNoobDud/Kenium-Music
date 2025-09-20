const { exec, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const https = require('node:https')
const { writeFileSync } = require('node:fs')
const { tmpdir, homedir } = require('node:os')
const { join } = require('node:path')

const run = promisify(exec)

async function hasBun() {
  try {
    await run('bun --version')
    return true
  } catch {
    return false
  }
}

async function installBun() {
  const isWindows = process.platform === 'win32'
  const url = isWindows ? 'https://bun.sh/install.ps1' : 'https://bun.sh/install'

  const script = await new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = ''
      res.on('data', chunk => (data += chunk))
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })

  const ext = isWindows ? '.ps1' : '.sh'
  const tempFile = join(tmpdir(), `bun_install${ext}`)
  writeFileSync(tempFile, script)

  console.log('Installing Bun...')

  if (isWindows) {
    await run(`powershell -ExecutionPolicy Bypass -File "${tempFile}"`)
  } else {
    await run(`bash ${tempFile}`)
  }

  // Manually add Bun to PATH for this session
  const bunDir = isWindows
    ? join(process.env.USERPROFILE, '.bun', 'bin')
    : join(homedir(), '.bun', 'bin')

  process.env.PATH = `${bunDir}:${process.env.PATH}`
}

function runLive(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit', env: process.env })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function main() {
  if (!(await hasBun())) {
    await installBun()
  } else {
    console.log('Bun is already installed ✅')
  }

  console.log('Running bun install...')
  await runLive('bun', ['install'])

  console.log('Running bun run index.ts...')
  await runLive('bun', ['run', 'index.ts'])

  console.log('Done ✅')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
