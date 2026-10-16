// 配布物に含まれる他人のソフトウェアのライセンス表記を THIRD_PARTY_NOTICES.md にまとめる。
// 依存を増やしたり更新したりしたら `npm run notices` で作り直す。
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8' }))
const found = new Map()
const walk = (deps = {}) => {
  for (const [name, info] of Object.entries(deps)) {
    if (!info.version || info.extraneous || found.has(`${name}@${info.version}`)) continue
    found.set(`${name}@${info.version}`, name)
    walk(info.dependencies)
  }
}
walk(tree.dependencies)

const sections = []
for (const [id, name] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const dir = join('node_modules', name)
  if (!existsSync(dir)) continue // 別の OS 用の optional な依存
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const files = readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)/i.test(f))
  const texts = files.map((f) => readFileSync(join(dir, f), 'utf8').trim())
  sections.push(
    `## ${id}\n\nLicense: ${pkg.license ?? '(not stated)'}${pkg.homepage ? `\nHomepage: ${pkg.homepage}` : ''}\n\n` +
      (texts.length ? texts.map((t) => '```\n' + t + '\n```').join('\n\n') : '(no license file in package)')
  )
}

const header = `# Third-party notices

Talking Word includes the following software and data. Each is distributed under its own license.

## ReazonSpeech k2 v2 (speech recognition model, downloaded on first use)

License: Apache-2.0
Source: https://huggingface.co/reazon-research/reazonspeech-k2-v2

## Electron and Chromium

License: MIT (Electron) and the licenses listed in LICENSES.chromium.html, which is installed next to the app.
`
writeFileSync('THIRD_PARTY_NOTICES.md', header + '\n' + sections.join('\n\n') + '\n')
console.log(`wrote ${sections.length} packages`)
