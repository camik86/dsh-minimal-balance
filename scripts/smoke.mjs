import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

const { apply: hostApply, inject: hostInject } = await import(pathToFileURL(join(repoRoot, 'index.js')).href)
const routes = []
hostApply({
  effect: (fn) => fn(),
  get: () => undefined,
  webServer: {
    register: (route) => {
      routes.push(`${route.kind} ${route.path}`)
      return () => {}
    },
  },
}, { enabled: true, allowPublicClients: false })
console.log('host inject:', hostInject.join(','), '| routes:', routes.join(' | '))

const source = readFileSync(join(repoRoot, 'client.js'), 'utf8')
let factory
let moduleId
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => {
      factory = definition.factory
      moduleId = definition.id
    },
  },
}
new Function(source)()
const stubReact = {
  createElement: () => null,
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}
const mod = factory((id) => {
  if (id === 'react') return stubReact
  throw new Error('unexpected require: ' + id)
})
const registrations = []
mod.apply({
  effect: (fn) => fn(),
  slots: {
    inject: (_name, register) => register(),
    register: (options) => {
      registrations.push(`${options.name}:${options.id ?? options.key}`)
      return () => {}
    },
  },
})
console.log('client id:', moduleId, '| inject:', mod.inject.join(','), '| registrations:', registrations.join(' | '))

if (moduleId !== pkg.name) throw new Error(`client bundle id ${moduleId} != package name ${pkg.name}`)
console.log('smoke OK')
