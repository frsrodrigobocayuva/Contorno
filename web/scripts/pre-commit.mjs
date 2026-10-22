// Roda o Prettier ou o ESLint nos arquivos que o pre-commit passa, a partir de web/,
// para que cada ferramenta encontre a própria configuração.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tools = {
  prettier: ['prettier/bin/prettier.cjs', '--write', '--ignore-unknown'],
  eslint: ['eslint/bin/eslint.js', '--fix'],
}

const [name, ...files] = process.argv.slice(2)
const [bin, ...args] = tools[name]
const relative = files.map((file) => path.relative(webDir, path.resolve(file)))
const result = spawnSync(
  process.execPath,
  [path.join(webDir, 'node_modules', bin), ...args, ...relative],
  { cwd: webDir, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
