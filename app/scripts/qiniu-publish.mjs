import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appDir = path.resolve(__dirname, '..')
const releaseDir = path.join(appDir, 'release')
const packageJsonPath = path.join(appDir, 'package.json')

const regionUploadHosts = {
  z0: 'https://up-z0.qiniup.com',
  z1: 'https://up-z1.qiniup.com',
  z2: 'https://up-z2.qiniup.com',
  na0: 'https://up-na0.qiniup.com',
  as0: 'https://up-as0.qiniup.com',
  'cn-east-2': 'https://up-cn-east-2.qiniup.com',
}

function fail(message) {
  console.error(`[qiniu-publish] ${message}`)
  process.exit(1)
}

function trimSlashes(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '')
}

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function toUrlSafeBase64(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

function createQiniuV2AccessToken({ accessKey, secretKey, method, url, contentType, body = '' }) {
  const target = new URL(url)
  const signingStr = `${method.toUpperCase()} ${target.pathname}${target.search}\nHost: ${target.host}\nContent-Type: ${contentType}\n\n${body}`
  const sign = crypto.createHmac('sha1', secretKey).update(signingStr).digest()
  return `${accessKey}:${toUrlSafeBase64(sign)}`
}

function getEnv(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim()
}

function getUploadHost() {
  const explicit = trimTrailingSlash(getEnv('QINIU_UPLOAD_HOST'))
  if (explicit) return explicit
  const region = getEnv('QINIU_REGION')
  if (region && regionUploadHosts[region]) return regionUploadHosts[region]
  fail('缺少 QINIU_UPLOAD_HOST 或 QINIU_REGION')
}

function loadPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  return String(pkg.version || '').trim()
}

function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    version: '',
    dryRun: false,
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--version') {
      options.version = String(args[i + 1] || '').trim()
      i += 1
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
  }
  return options
}

function parseYamlArtifactNames(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const names = new Set()
  const fileUrlMatches = content.matchAll(/^\s*-\s*url:\s*(.+)\s*$/gm)
  for (const match of fileUrlMatches) {
    const value = String(match[1] || '').trim()
    if (value) names.add(value)
  }
  const pathMatch = content.match(/^path:\s*(.+)\s*$/m)
  if (pathMatch?.[1]) names.add(String(pathMatch[1]).trim())
  return [...names]
}

function buildLocalCandidates(remoteName) {
  const candidates = new Set([remoteName])
  if (/^AstraShell-Setup-\d/i.test(remoteName)) {
    candidates.add(remoteName.replace(/^AstraShell-Setup-/, 'AstraShell Setup '))
  }
  if (/^AstraShell-Setup-\d/i.test(remoteName.replace(/\.blockmap$/i, ''))) {
    candidates.add(remoteName.replace(/^AstraShell-Setup-/, 'AstraShell Setup '))
  }
  return [...candidates]
}

function resolveLocalFile(remoteName) {
  for (const candidate of buildLocalCandidates(remoteName)) {
    const localPath = path.join(releaseDir, candidate)
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
      return localPath
    }
  }
  return ''
}

function buildUploadList(version) {
  const yamlFiles = ['latest.yml', 'latest-mac.yml', 'latest-linux-arm64.yml']
    .map((name) => path.join(releaseDir, name))
    .filter((filePath) => fs.existsSync(filePath))

  if (yamlFiles.length === 0) fail(`未找到更新元数据，目录：${releaseDir}`)

  const tasks = []
  const remoteNames = new Set()

  for (const yamlPath of yamlFiles) {
    tasks.push({
      localPath: yamlPath,
      remoteKey: path.basename(yamlPath),
      contentType: 'text/yaml; charset=utf-8',
    })
    for (const remoteName of parseYamlArtifactNames(yamlPath)) {
      remoteNames.add(remoteName)
      remoteNames.add(`${remoteName}.blockmap`)
    }
  }

  for (const remoteName of remoteNames) {
    const localPath = resolveLocalFile(remoteName)
    if (!localPath) {
      const isOptionalBlockmap = remoteName.endsWith('.blockmap')
      if (isOptionalBlockmap) continue
      fail(`缺少发版文件：${remoteName}`)
    }
    tasks.push({
      localPath,
      remoteKey: remoteName,
      contentType: guessContentType(remoteName),
    })
  }

  if (version) {
    const matched = tasks.some((task) => task.remoteKey.includes(version))
    if (!matched) {
      fail(`上传列表中未找到版本 ${version} 对应文件`)
    }
  }

  return dedupeTasks(tasks)
}

function dedupeTasks(tasks) {
  const seen = new Set()
  return tasks.filter((task) => {
    const key = `${task.localPath}::${task.remoteKey}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function guessContentType(fileName) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.yml')) return 'text/yaml; charset=utf-8'
  if (lower.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  if (lower.endsWith('.appimage')) return 'application/octet-stream'
  if (lower.endsWith('.blockmap')) return 'application/octet-stream'
  return 'application/octet-stream'
}

function buildUploadToken({ accessKey, secretKey, bucket, remoteKey }) {
  const putPolicy = {
    scope: `${bucket}:${remoteKey}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  }
  const encodedPolicy = toUrlSafeBase64(JSON.stringify(putPolicy))
  const sign = crypto.createHmac('sha1', secretKey).update(encodedPolicy).digest()
  return `${accessKey}:${toUrlSafeBase64(sign)}:${encodedPolicy}`
}

async function uploadFile({ uploadHost, accessKey, secretKey, bucket, prefix, task }) {
  const remoteKey = trimSlashes(prefix ? `${prefix}/${task.remoteKey}` : task.remoteKey)
  const token = buildUploadToken({ accessKey, secretKey, bucket, remoteKey })
  const form = new FormData()
  form.set('token', token)
  form.set('key', remoteKey)
  form.set('file', new Blob([fs.readFileSync(task.localPath)], { type: task.contentType }), path.basename(task.localPath))

  const response = await fetch(uploadHost, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`上传失败 ${task.remoteKey}（HTTP ${response.status}）：${body}`)
  }
  const data = await response.json()
  console.log(`[qiniu-publish] uploaded ${task.remoteKey} -> ${data.key || remoteKey}`)
}

async function refreshCdnUrls({ accessKey, secretKey, urls }) {
  if (!urls.length) return
  const refreshApiUrl = 'https://api.qiniu.com/v2/tune/refresh'
  const body = JSON.stringify({ urls })
  const authorization = `Qiniu ${createQiniuV2AccessToken({
    accessKey,
    secretKey,
    method: 'POST',
    url: refreshApiUrl,
    contentType: 'application/json',
    body,
  })}`
  const response = await fetch(refreshApiUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    body,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`刷新 CDN 缓存失败（HTTP ${response.status}）：${text}`)
  }
  try {
    const data = JSON.parse(text)
    if (data?.code === 400031) {
      console.warn(`[qiniu-publish] skip cdn refresh: 当前域名不是七牛 CDN 加速域名，返回 ${text}`)
      return
    }
  } catch {}
  console.log(`[qiniu-publish] cdn refresh ok ${urls.join(', ')}`)
}

async function main() {
  const { version, dryRun } = parseArgs()
  const resolvedVersion = version || loadPackageVersion()
  const accessKey = getEnv('QINIU_ACCESS_KEY')
  const secretKey = getEnv('QINIU_SECRET_KEY')
  const bucket = getEnv('QINIU_BUCKET', 'astrashell')
  const prefix = trimSlashes(getEnv('QINIU_PREFIX'))
  const publicBaseUrl = trimTrailingSlash(getEnv('QINIU_PUBLIC_BASE_URL', 'https://astra.jitux.com'))
  const uploadHost = getUploadHost()

  if (!accessKey) fail('缺少 QINIU_ACCESS_KEY')
  if (!secretKey) fail('缺少 QINIU_SECRET_KEY')
  if (!bucket) fail('缺少 QINIU_BUCKET')

  const tasks = buildUploadList(resolvedVersion)
  console.log(`[qiniu-publish] version=${resolvedVersion}`)
  console.log(`[qiniu-publish] uploadHost=${uploadHost}`)
  console.log(`[qiniu-publish] publicBaseUrl=${publicBaseUrl}${prefix ? `/${prefix}` : ''}`)
  console.log(`[qiniu-publish] files=${tasks.length}`)

  if (dryRun) {
    for (const task of tasks) {
      const remoteKey = prefix ? `${prefix}/${task.remoteKey}` : task.remoteKey
      console.log(`[qiniu-publish] dry-run ${task.localPath} -> ${remoteKey}`)
    }
    return
  }

  for (const task of tasks) {
    await uploadFile({ uploadHost, accessKey, secretKey, bucket, prefix, task })
  }

  const refreshUrls = tasks
    .filter((task) => task.remoteKey.endsWith('.yml'))
    .map((task) => `${publicBaseUrl}${prefix ? `/${prefix}` : ''}/${task.remoteKey}`)

  await refreshCdnUrls({ accessKey, secretKey, urls: refreshUrls })
}

main().catch((error) => {
  fail(error?.message || String(error))
})
