import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveModelRoutes } from '../canary-v2/provider-policy-api.js'

test('canary policy exposes only the physical clawdsh route', () => {
  assert.equal(resolveModelRoutes({ provider: 'other', requestTransportOverrides: 'none' }), null)
  assert.deepEqual(resolveModelRoutes({ provider: 'clawdsh', requestTransportOverrides: 'present' }), {
    kind: 'incompatible',
    code: 'CLAWDSH_TRANSPORT_OVERRIDES',
    message: 'ClawDSH requires a route with no request transport overrides.',
  })
  assert.deepEqual(resolveModelRoutes({ provider: 'clawdsh', requestTransportOverrides: 'none' }), {
    kind: 'routes',
    routes: [{
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:9/v1',
      authRequirement: 'api-key',
      requestTransportOverrides: 'none',
      runtimePolicy: { compatibleIds: ['clawdsh'] },
    }],
    defaultRuntimeId: 'clawdsh',
  })
})

test('canary policy fails closed when the host omits override facts', () => {
  assert.equal(resolveModelRoutes({ provider: 'clawdsh' }).kind, 'incompatible')
})
