import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const useColor = Boolean(process.stdout.isTTY)

const colors = {
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  red: '\u001b[31m',
  reset: '\u001b[0m',
  yellow: '\u001b[33m',
}

function tint(color, value) {
  if (!useColor) {
    return value
  }

  return `${colors[color]}${value}${colors.reset}`
}

function logStep(title, detail) {
  console.log(`\n${tint('cyan', `==> ${title}`)}`)
  if (detail) {
    console.log(tint('dim', detail))
  }
}

function logInfo(message) {
  console.log(tint('dim', message))
}

function logSuccess(message) {
  console.log(tint('green', message))
}

function logFailure(message) {
  console.error(tint('red', message))
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error(stderr.trim() || `${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function gitHead() {
  return capture('git', ['rev-parse', 'HEAD'])
}

async function changedFiles(baseRef, headRef) {
  if (!baseRef || baseRef === headRef) {
    return []
  }

  const output = await capture('git', ['diff', '--name-only', baseRef, headRef])
  return output ? output.split(/\r?\n/).filter(Boolean) : []
}

async function main() {
  console.log(tint('blue', 'AniFlow host update'))
  logInfo('Pulling latest code, refreshing dependencies if needed, rebuilding, then starting the server.')

  const previousHead = await gitHead()

  logStep('Git pull', 'Running git pull --ff-only so the host only advances with a fast-forward update.')
  await run('git', ['pull', '--ff-only'])

  const nextHead = await gitHead()
  const files = await changedFiles(previousHead, nextHead)
  const needsInstall =
    !existsSync('node_modules') || files.includes('package.json') || files.includes('package-lock.json')

  logStep('Dependencies', needsInstall ? 'Dependency files changed, so npm install is required.' : 'No dependency manifest changes detected.')
  if (needsInstall) {
    await run(npmCommand, ['install'])
  } else {
    logInfo('Skipping npm install.')
  }

  logStep('Build', 'Compiling the backend and frontend bundles used by npm start.')
  await run(npmCommand, ['run', 'build'])

  logStep('Start', 'Launching the compiled AniFlow server.')
  logSuccess('Build finished. Server output continues below.\n')
  await run(npmCommand, ['start'])
}

main().catch((error) => {
  logFailure(`AniFlow host update failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
