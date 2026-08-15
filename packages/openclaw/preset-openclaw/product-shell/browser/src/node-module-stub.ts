/** Browser replacement for the vendored Loader's unreachable Node module loader. */
export const createRequire = (): never => {
  throw new Error('createRequire is unavailable in the ClawDSH browser')
}
