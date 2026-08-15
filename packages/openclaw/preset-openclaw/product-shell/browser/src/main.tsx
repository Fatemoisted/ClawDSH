import { ClawdshWebEntry } from './ClawdshWebEntry.tsx'
import './base.css'

const mount = document.getElementById('clawdsh-root')
if (mount === null) throw new Error('ClawDSH browser: missing #clawdsh-root')

void new ClawdshWebEntry(mount).run()
