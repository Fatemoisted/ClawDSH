'use strict'

const states = new Map()

/** Return the bridge state shared by every native CommonJS loader in this Node process. */
module.exports = function processSharedBridgeState(generation) {
  let state = states.get(generation)
  if (state === undefined) {
    state = { active: undefined, operation: Promise.resolve() }
    states.set(generation, state)
  }
  return state
}
