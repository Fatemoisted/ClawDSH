/** Strict runtime validation for the ClawDSH channel bridge protocol v1. */

const ACTION_KINDS = new Set([
  'send',
  'edit',
  'delete',
  'react',
  'poll',
  'typing',
  'directory.self',
  'directory.list-peers',
  'directory.list-groups',
  'directory.list-group-members',
  'resolve',
])
const NOTIFICATION_KINDS = new Set(['text.delta', 'reasoning.delta', 'tool', 'status'])
const TRUST_CLASSES = new Set(['owner', 'paired', 'allowlisted', 'admitted', 'group-allowlisted'])
const MEDIA_KINDS = new Set(['image', 'audio', 'video', 'file'])

/** A wire payload failed strict protocol validation. */
export class ProtocolValidationError extends Error {
  /**
   * @param {string} message - Sanitized validation failure.
   */
  constructor(message) {
    super(message)
    this.name = 'ProtocolValidationError'
    this.code = 'CHANNEL_PROTOCOL_INVALID'
  }
}

function fail(path, message) {
  throw new ProtocolValidationError(`${path}: ${message}`)
}

function record(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'expected an object')
  }
  return value
}

function exact(value, required, optional, path) {
  const object = record(value, path)
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(path, `unexpected field ${JSON.stringify(key)}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) fail(path, `missing field ${JSON.stringify(key)}`)
  }
  return object
}

function nonEmptyString(value, path) {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'expected a non-empty string')
  if (value.includes('\0')) fail(path, 'must not contain NUL')
  return value
}

function opaqueString(value, path) {
  const result = nonEmptyString(value, path)
  if (result.trim() !== result) fail(path, 'must not have surrounding whitespace')
  return result
}

function nonBlankString(value, path) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    fail(path, 'expected a non-blank string')
  }
  if (value.includes('\0')) fail(path, 'must not contain NUL')
  return value
}

function plainString(value, path) {
  if (typeof value !== 'string') fail(path, 'expected a string')
  if (value.includes('\0')) fail(path, 'must not contain NUL')
  return value
}

function booleanValue(value, path) {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean')
  return value
}

function safeInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(path, `expected a safe integer greater than or equal to ${minimum}`)
  }
  return value
}

function anyFiniteNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number')
  return value
}

function rfc3339(value, path) {
  const timestamp = nonEmptyString(value, path)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) {
    fail(path, 'expected an RFC 3339 timestamp')
  }
  return timestamp
}

function positiveSafeInteger(value, path) {
  return safeInteger(value, path, 1)
}

function literal(value, expected, path) {
  if (value !== expected) fail(path, `expected ${JSON.stringify(expected)}`)
  return value
}

function oneOf(value, choices, path) {
  if (!choices.has(value)) fail(path, `unexpected value ${JSON.stringify(value)}`)
  return value
}

function arrayOf(value, validate, path) {
  if (!Array.isArray(value)) fail(path, 'expected an array')
  value.forEach((item, index) => validate(item, `${path}[${index}]`))
  return value
}

function optional(object, key, validate, path) {
  if (Object.hasOwn(object, key)) validate(object[key], `${path}.${key}`)
}

function validateFailure(value, path) {
  const object = exact(value, ['code', 'message', 'retryable'], [], path)
  nonBlankString(object.code, `${path}.code`)
  nonBlankString(object.message, `${path}.message`)
  booleanValue(object.retryable, `${path}.retryable`)
}

function validateHostIdentity(value, path) {
  const object = exact(value, ['tag', 'commitSha', 'artifactSha512', 'nodeEngine'], [], path)
  nonBlankString(object.tag, `${path}.tag`)
  if (!/^[a-f0-9]{40}$/.test(nonEmptyString(object.commitSha, `${path}.commitSha`))) {
    fail(`${path}.commitSha`, 'expected a canonical lowercase 40-character commit SHA')
  }
  if (!/^[a-f0-9]{128}$/.test(nonEmptyString(object.artifactSha512, `${path}.artifactSha512`))) {
    fail(`${path}.artifactSha512`, 'expected a canonical lowercase SHA-512')
  }
  nonBlankString(object.nodeEngine, `${path}.nodeEngine`)
}

function validateCapabilities(value, path) {
  const object = exact(value, ['actions', 'notifications', 'extensions'], [], path)
  arrayOf(object.actions, (item, itemPath) => oneOf(item, ACTION_KINDS, itemPath), `${path}.actions`)
  arrayOf(
    object.notifications,
    (item, itemPath) => oneOf(item, NOTIFICATION_KINDS, itemPath),
    `${path}.notifications`,
  )
  arrayOf(
    object.extensions,
    (item, itemPath) => literal(item, 'delivery.report', itemPath),
    `${path}.extensions`,
  )
  for (const key of ['actions', 'notifications', 'extensions']) {
    if (new Set(object[key]).size !== object[key].length) fail(`${path}.${key}`, 'contains duplicates')
  }
}

/**
 * Validate a ChannelBridgeHandshakeV1.
 * @param {unknown} value - Candidate payload.
 * @returns {object} The validated payload.
 */
export function validateHandshake(value) {
  const path = 'handshake'
  const object = exact(
    value,
    ['protocolVersion', 'gatewayInstanceId', 'openclaw', 'agentHarness', 'capabilities', 'startupNonce'],
    [],
    path,
  )
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  opaqueString(object.gatewayInstanceId, `${path}.gatewayInstanceId`)
  validateHostIdentity(object.openclaw, `${path}.openclaw`)
  oneOf(object.agentHarness, new Set(['v1', 'v2']), `${path}.agentHarness`)
  validateCapabilities(object.capabilities, `${path}.capabilities`)
  opaqueString(object.startupNonce, `${path}.startupNonce`)
  return object
}

function validateRoute(value, path) {
  const object = exact(
    value,
    ['gatewayInstanceId', 'openclawSessionKey', 'generation', 'channel', 'account', 'conversation', 'kind'],
    ['thread'],
    path,
  )
  for (const key of ['gatewayInstanceId', 'openclawSessionKey', 'channel', 'account', 'conversation']) {
    opaqueString(object[key], `${path}.${key}`)
  }
  safeInteger(object.generation, `${path}.generation`)
  optional(object, 'thread', opaqueString, path)
  oneOf(object.kind, new Set(['direct', 'group']), `${path}.kind`)
}

function validatePrincipal(value, path) {
  const object = exact(value, ['senderId', 'trust'], ['displayName'], path)
  opaqueString(object.senderId, `${path}.senderId`)
  optional(object, 'displayName', plainString, path)
  oneOf(object.trust, TRUST_CLASSES, `${path}.trust`)
}

function validateMessageReference(value, path) {
  const object = exact(value, ['messageId'], ['senderId'], path)
  opaqueString(object.messageId, `${path}.messageId`)
  optional(object, 'senderId', opaqueString, path)
}

function validateRelativePath(value, path) {
  const relativePath = nonEmptyString(value, path)
  if (relativePath.startsWith('/') || relativePath.includes('\\')) {
    fail(path, 'expected a slash-normalized relative path')
  }
  const segments = relativePath.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    fail(path, 'contains an empty, dot, or parent segment')
  }
}

/**
 * Validate one ChannelStagedMediaV1.
 * @param {unknown} value - Candidate media reference.
 * @param {string} [path='media'] - Diagnostic field path.
 * @returns {object} The validated reference.
 */
export function validateStagedMedia(value, path = 'media') {
  const object = exact(
    value,
    ['mediaId', 'ordinal', 'kind', 'mediaType', 'bytes', 'sha256', 'relativePath'],
    ['name'],
    path,
  )
  opaqueString(object.mediaId, `${path}.mediaId`)
  safeInteger(object.ordinal, `${path}.ordinal`)
  oneOf(object.kind, MEDIA_KINDS, `${path}.kind`)
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(nonEmptyString(object.mediaType, `${path}.mediaType`))) {
    fail(`${path}.mediaType`, 'expected a media type')
  }
  positiveSafeInteger(object.bytes, `${path}.bytes`)
  if (!/^[a-f0-9]{64}$/.test(nonEmptyString(object.sha256, `${path}.sha256`))) {
    fail(`${path}.sha256`, 'expected a canonical lowercase SHA-256')
  }
  validateRelativePath(object.relativePath, `${path}.relativePath`)
  optional(object, 'name', (item, itemPath) => {
    const name = nonEmptyString(item, itemPath)
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      fail(itemPath, 'expected a display basename')
    }
  }, path)
  return object
}

function validateMediaArray(value, path) {
  const media = arrayOf(value, validateStagedMedia, path)
  const ids = new Set()
  for (const [index, item] of media.entries()) {
    if (item.ordinal !== index) fail(`${path}[${index}].ordinal`, `expected contiguous ordinal ${index}`)
    if (ids.has(item.mediaId)) fail(`${path}[${index}].mediaId`, 'duplicate media identity')
    ids.add(item.mediaId)
  }
}

function validateTrace(value, path) {
  const object = exact(value, ['traceId'], ['parentTraceId'], path)
  opaqueString(object.traceId, `${path}.traceId`)
  optional(object, 'parentTraceId', opaqueString, path)
}

/**
 * Validate a ChannelTurnEnvelopeV1.
 * @param {unknown} value - Candidate payload.
 * @returns {object} The validated payload.
 */
export function validateTurnEnvelope(value) {
  const path = 'turn'
  const object = exact(
    value,
    ['protocolVersion', 'idempotencyKey', 'turnId', 'runId', 'route', 'sender', 'messageId', 'text', 'media'],
    ['wasMentioned', 'replyTo', 'trace'],
    path,
  )
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  for (const key of ['idempotencyKey', 'turnId', 'runId', 'messageId']) {
    opaqueString(object[key], `${path}.${key}`)
  }
  validateRoute(object.route, `${path}.route`)
  validatePrincipal(object.sender, `${path}.sender`)
  optional(object, 'wasMentioned', booleanValue, path)
  optional(object, 'replyTo', validateMessageReference, path)
  plainString(object.text, `${path}.text`)
  validateMediaArray(object.media, `${path}.media`)
  if (object.text.length === 0 && object.media.length === 0) fail(path, 'text and media cannot both be empty')
  optional(object, 'trace', validateTrace, path)
  return object
}

function validateUsage(value, path) {
  const object = exact(value, ['inputTokens', 'outputTokens'], ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'], path)
  for (const key of ['inputTokens', 'outputTokens']) safeInteger(object[key], `${path}.${key}`)
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
    optional(object, key, safeInteger, path)
  }
}

function validateResultBase(object, path) {
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  for (const key of ['turnId', 'runId', 'replayId']) opaqueString(object[key], `${path}.${key}`)
}

/**
 * Validate a ChannelTurnResultV1.
 * @param {unknown} value - Candidate payload.
 * @returns {object} The validated payload.
 */
export function validateTurnResult(value) {
  const path = 'turnResult'
  const base = ['protocolVersion', 'turnId', 'runId', 'replayId', 'status']
  const candidate = record(value, path)
  switch (candidate.status) {
    case 'completed': {
      const object = exact(candidate, [...base, 'sessionId', 'text', 'media'], ['usage'], path)
      validateResultBase(object, path)
      opaqueString(object.sessionId, `${path}.sessionId`)
      plainString(object.text, `${path}.text`)
      validateMediaArray(object.media, `${path}.media`)
      if (object.text.length === 0 && object.media.length === 0) fail(path, 'text and media cannot both be empty')
      optional(object, 'usage', validateUsage, path)
      return object
    }
    case 'silent': {
      const object = exact(candidate, [...base, 'sessionId'], ['usage'], path)
      validateResultBase(object, path)
      opaqueString(object.sessionId, `${path}.sessionId`)
      optional(object, 'usage', validateUsage, path)
      return object
    }
    case 'cancelled': {
      const object = exact(candidate, [...base, 'reason'], ['sessionId'], path)
      validateResultBase(object, path)
      nonBlankString(object.reason, `${path}.reason`)
      optional(object, 'sessionId', opaqueString, path)
      return object
    }
    case 'failed': {
      const object = exact(candidate, [...base, 'error'], ['sessionId'], path)
      validateResultBase(object, path)
      validateFailure(object.error, `${path}.error`)
      optional(object, 'sessionId', opaqueString, path)
      return object
    }
    default:
      fail(`${path}.status`, `unexpected value ${JSON.stringify(candidate.status)}`)
  }
}

/** Validate a ChannelTurnCancelV1. */
export function validateTurnCancel(value) {
  const path = 'turnCancel'
  const object = exact(value, ['protocolVersion', 'turnId', 'runId', 'reason'], [], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  opaqueString(object.turnId, `${path}.turnId`)
  opaqueString(object.runId, `${path}.runId`)
  oneOf(object.reason, new Set(['user', 'timeout', 'gateway-shutdown']), `${path}.reason`)
  return object
}

/** Validate a ChannelSessionResetV1. */
export function validateSessionReset(value) {
  const path = 'sessionReset'
  const object = exact(value, ['protocolVersion', 'route', 'nextGeneration', 'reason'], [], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  validateRoute(object.route, `${path}.route`)
  safeInteger(object.nextGeneration, `${path}.nextGeneration`)
  if (object.nextGeneration <= object.route.generation) {
    fail(`${path}.nextGeneration`, 'must exceed the retired generation')
  }
  oneOf(object.reason, new Set(['new', 'reset']), `${path}.reason`)
  return object
}

/** Validate a ChannelSessionResetResultV1. */
export function validateSessionResetResult(value) {
  const path = 'sessionResetResult'
  const object = exact(value, ['protocolVersion', 'route'], ['previousSessionId'], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  validateRoute(object.route, `${path}.route`)
  optional(object, 'previousSessionId', opaqueString, path)
  return object
}

/** Validate a ChannelSessionCloseV1. */
export function validateSessionClose(value) {
  const path = 'sessionClose'
  const object = exact(value, ['protocolVersion', 'route', 'reason'], [], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  validateRoute(object.route, `${path}.route`)
  oneOf(object.reason, new Set(['gateway', 'account-disabled', 'shutdown']), `${path}.reason`)
  return object
}

function validateActionTarget(value, path) {
  const object = exact(value, ['gatewayInstanceId', 'channel', 'account', 'conversation'], ['thread'], path)
  for (const key of ['gatewayInstanceId', 'channel', 'account', 'conversation']) {
    opaqueString(object[key], `${path}.${key}`)
  }
  optional(object, 'thread', opaqueString, path)
}

function validateActionBase(object, path) {
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  opaqueString(object.actionId, `${path}.actionId`)
  validateActionTarget(object.target, `${path}.target`)
}

/**
 * Validate a ChannelActionV1.
 * @param {unknown} value - Candidate payload.
 * @returns {object} The validated payload.
 */
export function validateAction(value) {
  const path = 'action'
  const base = ['protocolVersion', 'actionId', 'target', 'kind']
  const candidate = record(value, path)
  switch (candidate.kind) {
    case 'send': {
      const object = exact(candidate, [...base, 'text', 'media'], ['replyTo'], path)
      validateActionBase(object, path)
      plainString(object.text, `${path}.text`)
      validateMediaArray(object.media, `${path}.media`)
      if (object.text.length === 0 && object.media.length === 0) fail(path, 'text and media cannot both be empty')
      optional(object, 'replyTo', opaqueString, path)
      return object
    }
    case 'edit': {
      const object = exact(candidate, [...base, 'messageId', 'text', 'media'], [], path)
      validateActionBase(object, path)
      opaqueString(object.messageId, `${path}.messageId`)
      plainString(object.text, `${path}.text`)
      validateMediaArray(object.media, `${path}.media`)
      if (object.text.length === 0 && object.media.length === 0) fail(path, 'text and media cannot both be empty')
      return object
    }
    case 'delete': {
      const object = exact(candidate, [...base, 'messageId'], [], path)
      validateActionBase(object, path)
      opaqueString(object.messageId, `${path}.messageId`)
      return object
    }
    case 'react': {
      const object = exact(candidate, [...base, 'messageId', 'reaction', 'operation'], [], path)
      validateActionBase(object, path)
      opaqueString(object.messageId, `${path}.messageId`)
      nonBlankString(object.reaction, `${path}.reaction`)
      oneOf(object.operation, new Set(['add', 'remove']), `${path}.operation`)
      return object
    }
    case 'poll': {
      const object = exact(candidate, [...base, 'question', 'options', 'multiple'], [], path)
      validateActionBase(object, path)
      nonBlankString(object.question, `${path}.question`)
      arrayOf(object.options, nonBlankString, `${path}.options`)
      if (object.options.length < 2) fail(`${path}.options`, 'expected at least two options')
      if (new Set(object.options).size !== object.options.length) fail(`${path}.options`, 'contains duplicate labels')
      booleanValue(object.multiple, `${path}.multiple`)
      return object
    }
    case 'typing': {
      const object = exact(candidate, [...base, 'active'], [], path)
      validateActionBase(object, path)
      booleanValue(object.active, `${path}.active`)
      return object
    }
    case 'directory.self': {
      const object = exact(candidate, base, [], path)
      validateActionBase(object, path)
      return object
    }
    case 'directory.list-peers':
    case 'directory.list-groups': {
      const object = exact(candidate, [...base, 'source'], ['query', 'limit'], path)
      validateActionBase(object, path)
      oneOf(object.source, new Set(['cached', 'live']), `${path}.source`)
      optional(object, 'query', plainString, path)
      optional(object, 'limit', positiveSafeInteger, path)
      return object
    }
    case 'directory.list-group-members': {
      const object = exact(candidate, [...base, 'groupId'], ['limit'], path)
      validateActionBase(object, path)
      opaqueString(object.groupId, `${path}.groupId`)
      optional(object, 'limit', positiveSafeInteger, path)
      return object
    }
    case 'resolve': {
      const object = exact(candidate, [...base, 'resolveKind', 'inputs'], [], path)
      validateActionBase(object, path)
      oneOf(object.resolveKind, new Set(['user', 'group']), `${path}.resolveKind`)
      arrayOf(object.inputs, nonBlankString, `${path}.inputs`)
      if (object.inputs.length === 0) fail(`${path}.inputs`, 'expected at least one input')
      return object
    }
    default:
      fail(`${path}.kind`, `unexpected value ${JSON.stringify(candidate.kind)}`)
  }
}

function validateDirectoryEntry(value, path) {
  const object = exact(value, ['kind', 'id'], ['name', 'handle', 'rank'], path)
  oneOf(object.kind, new Set(['user', 'group', 'channel']), `${path}.kind`)
  opaqueString(object.id, `${path}.id`)
  optional(object, 'name', plainString, path)
  optional(object, 'handle', plainString, path)
  optional(object, 'rank', anyFiniteNumber, path)
}

function validateResolveMatch(value, path) {
  const candidate = record(value, path)
  if (candidate.resolved === false) {
    const object = exact(candidate, ['input', 'resolved'], ['note'], path)
    nonBlankString(object.input, `${path}.input`)
    optional(object, 'note', plainString, path)
    return
  }
  if (candidate.resolved === true) {
    const object = exact(candidate, ['input', 'resolved', 'id'], ['name', 'note'], path)
    nonBlankString(object.input, `${path}.input`)
    opaqueString(object.id, `${path}.id`)
    optional(object, 'name', plainString, path)
    optional(object, 'note', plainString, path)
    return
  }
  fail(`${path}.resolved`, 'expected a boolean discriminant')
}

/**
 * Validate a ChannelActionResultV1.
 * @param {unknown} value - Candidate payload.
 * @returns {object} The validated payload.
 */
export function validateActionResult(value) {
  const path = 'actionResult'
  const candidate = record(value, path)
  if (candidate.kind === 'directory') {
    const object = exact(candidate, ['protocolVersion', 'actionId', 'kind', 'entries'], [], path)
    literal(object.protocolVersion, 1, `${path}.protocolVersion`)
    opaqueString(object.actionId, `${path}.actionId`)
    arrayOf(object.entries, validateDirectoryEntry, `${path}.entries`)
    return object
  }
  if (candidate.kind === 'resolve') {
    const object = exact(candidate, ['protocolVersion', 'actionId', 'kind', 'results'], [], path)
    literal(object.protocolVersion, 1, `${path}.protocolVersion`)
    opaqueString(object.actionId, `${path}.actionId`)
    arrayOf(object.results, validateResolveMatch, `${path}.results`)
    return object
  }
  const receipt = validateDeliveryReceipt(candidate)
  if (receipt.subject.kind !== 'action') fail(`${path}.subject`, 'expected an action subject')
  return receipt
}

function validateDeliverySubject(value, path) {
  const candidate = record(value, path)
  if (candidate.kind === 'action') {
    const object = exact(candidate, ['kind', 'actionId'], [], path)
    opaqueString(object.actionId, `${path}.actionId`)
    return
  }
  if (candidate.kind === 'turn') {
    const object = exact(candidate, ['kind', 'turnId', 'runId'], [], path)
    opaqueString(object.turnId, `${path}.turnId`)
    opaqueString(object.runId, `${path}.runId`)
    return
  }
  fail(`${path}.kind`, `unexpected value ${JSON.stringify(candidate.kind)}`)
}

/** Validate a ChannelDeliveryReceiptV1. */
export function validateDeliveryReceipt(value) {
  const path = 'deliveryReceipt'
  const candidate = record(value, path)
  const base = ['protocolVersion', 'deliveryId', 'subject', 'attempt', 'status']
  const optionalBase = ['platformMessageId']
  let object
  if (candidate.status === 'accepted' || candidate.status === 'confirmed') {
    object = exact(candidate, base, optionalBase, path)
  } else if (candidate.status === 'retrying') {
    object = exact(candidate, [...base, 'nextAttemptAt', 'error'], optionalBase, path)
    rfc3339(object.nextAttemptAt, `${path}.nextAttemptAt`)
    validateFailure(object.error, `${path}.error`)
  } else if (candidate.status === 'ambiguous' || candidate.status === 'dead-letter') {
    object = exact(candidate, [...base, 'error'], optionalBase, path)
    validateFailure(object.error, `${path}.error`)
  } else {
    fail(`${path}.status`, `unexpected value ${JSON.stringify(candidate.status)}`)
  }
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  opaqueString(object.deliveryId, `${path}.deliveryId`)
  validateDeliverySubject(object.subject, `${path}.subject`)
  safeInteger(object.attempt, `${path}.attempt`, 1)
  optional(object, 'platformMessageId', opaqueString, path)
  return object
}

/** Validate a ChannelDeliveryReportV1. */
export function validateDeliveryReport(value) {
  const path = 'deliveryReport'
  const object = exact(value, ['protocolVersion', 'extension', 'receipt'], [], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  literal(object.extension, 'delivery.report', `${path}.extension`)
  validateDeliveryReceipt(object.receipt)
  if (object.receipt.subject.kind !== 'turn') fail(`${path}.receipt.subject`, 'expected a final-turn subject')
  return object
}

/** Validate a ChannelTurnNotificationV1. */
export function validateTurnNotification(value) {
  const path = 'turnNotification'
  const candidate = record(value, path)
  const base = ['kind', 'turnId', 'runId', 'sequence']
  let object
  if (candidate.kind === 'text.delta' || candidate.kind === 'reasoning.delta') {
    object = exact(candidate, [...base, 'text'], [], path)
    nonBlankString(object.text, `${path}.text`)
  } else if (candidate.kind === 'tool') {
    object = exact(candidate, [...base, 'toolCallId', 'name', 'phase'], ['summary'], path)
    opaqueString(object.toolCallId, `${path}.toolCallId`)
    nonBlankString(object.name, `${path}.name`)
    oneOf(object.phase, new Set(['started', 'finished']), `${path}.phase`)
    optional(object, 'summary', plainString, path)
  } else if (candidate.kind === 'status') {
    object = exact(candidate, [...base, 'status'], [], path)
    oneOf(object.status, new Set(['accepted', 'running', 'waiting-tool', 'finalizing']), `${path}.status`)
  } else {
    fail(`${path}.kind`, `unexpected value ${JSON.stringify(candidate.kind)}`)
  }
  opaqueString(object.turnId, `${path}.turnId`)
  opaqueString(object.runId, `${path}.runId`)
  safeInteger(object.sequence, `${path}.sequence`)
  return object
}

function validateAccountHealth(value, path) {
  const object = exact(value, ['channel', 'account', 'status', 'actions'], ['error'], path)
  opaqueString(object.channel, `${path}.channel`)
  opaqueString(object.account, `${path}.account`)
  oneOf(object.status, new Set(['disabled', 'connecting', 'ready', 'degraded', 'failed']), `${path}.status`)
  arrayOf(object.actions, (item, itemPath) => oneOf(item, ACTION_KINDS, itemPath), `${path}.actions`)
  if (new Set(object.actions).size !== object.actions.length) fail(`${path}.actions`, 'contains duplicates')
  optional(object, 'error', validateFailure, path)
}

/** Validate a ChannelHealthV1. */
export function validateHealth(value) {
  const path = 'health'
  const object = exact(value, ['protocolVersion', 'status', 'checkedAt', 'accounts', 'diagnostics'], ['handshake'], path)
  literal(object.protocolVersion, 1, `${path}.protocolVersion`)
  oneOf(object.status, new Set(['starting', 'ready', 'degraded', 'stopping', 'stopped', 'failed']), `${path}.status`)
  rfc3339(object.checkedAt, `${path}.checkedAt`)
  optional(object, 'handshake', validateHandshake, path)
  arrayOf(object.accounts, validateAccountHealth, `${path}.accounts`)
  arrayOf(object.diagnostics, (item, itemPath) => {
    const diagnostic = exact(item, ['code', 'message'], [], itemPath)
    nonBlankString(diagnostic.code, `${itemPath}.code`)
    nonBlankString(diagnostic.message, `${itemPath}.message`)
  }, `${path}.diagnostics`)
  return object
}

/** Validate an exact empty method parameter object. */
export function validateEmptyParams(value) {
  return exact(value, [], [], 'params')
}
