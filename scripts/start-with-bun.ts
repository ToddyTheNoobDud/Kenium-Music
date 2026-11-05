// Run from the project root with Node 24: node scripts/start-with-bun.ts
// Linux prerequisites: bash, curl, unzip, and outbound HTTPS access.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

try {
  if (process.platform !== 'linux' || !process.execve) {
    throw new Error('This launcher requires Linux and Node.js 24 or newer.')
  }

  const projectDirectory = process.cwd()
  const installDirectory = join(projectDirectory, '.cache', 'bun')
  const bunDirectory = join(installDirectory, 'bin')
  const bunExecutable = join(bunDirectory, 'bun')

  process.env.BUN_INSTALL = installDirectory
  process.env.PATH = `${bunDirectory}:${process.env.PATH ?? ''}`

  if (!existsSync(bunExecutable)) {
    console.log('Installing Bun canary...')
    const response = await fetch('https://bun.sh/install')
    if (!response.ok) {
      throw new Error(
        `Failed to download Bun installer: HTTP ${response.status}`
      )
    }

    execFileSync('bash', ['-s', '--', 'canary'], {
      input: await response.text(),
      stdio: ['pipe', 'inherit', 'inherit']
    })
  }

  execFileSync(bunExecutable, ['install'], { stdio: 'inherit' })

  // Replace Node so the bot receives shutdown signals and owns the exit code.
  process.execve(bunExecutable, [
    bunExecutable,
    './index.ts',
    ...process.argv.slice(2)
  ])
} catch (error) {
  console.error('Unable to start the bot:', error)
  process.exitCode = 1
}
