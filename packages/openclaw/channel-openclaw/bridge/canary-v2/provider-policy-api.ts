import type {
  ProviderModelRouteResolution,
  ProviderResolveModelRoutesContext,
} from 'openclaw/plugin-sdk/provider-model-types'

/** Fail-closed physical route declaration for the synthetic ClawDSH provider. */
export function resolveModelRoutes(
  context: ProviderResolveModelRoutesContext,
): ProviderModelRouteResolution | null {
  if (context.provider !== 'clawdsh') {
    return null
  }
  if (context.requestTransportOverrides !== 'none') {
    return {
      kind: 'incompatible',
      code: 'CLAWDSH_TRANSPORT_OVERRIDES',
      message: 'ClawDSH requires a route with no request transport overrides.',
    }
  }
  return {
    kind: 'routes',
    routes: [
      {
        api: 'openai-responses',
        baseUrl: 'http://127.0.0.1:9/v1',
        authRequirement: 'api-key',
        requestTransportOverrides: 'none',
        runtimePolicy: { compatibleIds: ['clawdsh'] },
      },
    ],
    defaultRuntimeId: 'clawdsh',
  }
}
