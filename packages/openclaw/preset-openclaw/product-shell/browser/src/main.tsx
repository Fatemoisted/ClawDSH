import { bootstrapClawdsh } from './bootstrap-clawdsh.ts'
import './base.css'

const mount = document.getElementById('clawdsh-root')
if (mount === null) throw new Error('ClawDSH browser: missing #clawdsh-root')

void bootstrapClawdsh(mount)
