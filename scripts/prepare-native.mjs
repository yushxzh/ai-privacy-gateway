// 固定官方构建与摘要；打包时准备运行时，用户安装后不再依赖外部 Python。
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const target = process.argv[2] || `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
const releases = {
  'mac-arm64': ['mitmproxy-12.2.3-macos-arm64.tar.gz','0a09ee3b82569e8985aff8186e4792618b8e5d0c766098db093d09a87d4b013a'],
  'mac-x64': ['mitmproxy-12.2.3-macos-x86_64.tar.gz','7998187f5a0d399ab796af4523d3ad830ebe690726a41bc3e1df47a8e477a641'],
  'win-x64': ['mitmproxy-12.2.3-windows-x86_64.zip','04a01ea95ae96df75058a893e774957d294e69012dab1f4e256ce2b0c6725483']
}
if (!releases[target]) throw new Error('尚未提供此平台的原生运行时。')
const [name, digest] = releases[target]
const directory = resolve('resources/native',target)
const marker = join(directory,'runtime.json')
const executable = target.startsWith('mac-') ? 'mitmproxy.app/Contents/MacOS/mitmdump' : 'mitmdump.exe'
try {
  if (JSON.parse(await readFile(marker,'utf8')).sha256 === digest) {
    await access(join(directory,executable)); console.log(`已准备 ${target} mitmproxy 12.2.3`); process.exit(0)
  }
} catch {}
const cache = resolve('work/runtime-downloads')
await mkdir(cache,{recursive:true})
const archive = join(cache,name)
let bytes
try { bytes = await readFile(archive) } catch {}
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== digest) {
  const response = await fetch(`https://downloads.mitmproxy.org/12.2.3/${name}`,{signal:AbortSignal.timeout(180000)})
  if (!response.ok) throw new Error('官方运行时下载失败。')
  bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('运行时摘要不匹配，已拒绝安装。')
  await writeFile(archive,bytes)
}
await mkdir(directory,{recursive:true})
if (name.endsWith('.tar.gz')) await exec('tar',['-xzf',archive,'-C',directory])
else if (process.platform === 'win32') {
  const quote = value => "'" + value.replaceAll("'","''") + "'"
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(directory)} -Force`])
} else await exec('unzip',['-q','-o',archive,'-d',directory])
await access(join(directory,executable))
await writeFile(marker,JSON.stringify({version:'12.2.3',sha256:digest,source:`https://downloads.mitmproxy.org/12.2.3/${name}`,executable},null,2)+'\n')
console.log(`已校验并准备 ${target} mitmproxy 12.2.3`)
