import type { ClawdshChannelCatalogEntry } from '../../shared/src/protocol.ts'

/**
 * User-facing projection of the checked OpenClaw production catalog.
 *
 * Support remains `cataloged` until the separate installability, live-smoke,
 * and deployment evidence gates promote an individual channel.
 */
export const PRODUCTION_CHANNEL_CATALOG = [
  { id: 'discord', label: 'Discord', provenance: 'repo-official', support: 'cataloged' },
  { id: 'feishu', label: 'Feishu', provenance: 'repo-official', support: 'cataloged' },
  { id: 'googlechat', label: 'Google Chat', provenance: 'repo-official', support: 'cataloged' },
  { id: 'imessage', label: 'iMessage', provenance: 'bundled', support: 'cataloged' },
  { id: 'irc', label: 'IRC', provenance: 'repo-official', support: 'cataloged' },
  { id: 'line', label: 'LINE', provenance: 'repo-official', support: 'cataloged' },
  { id: 'matrix', label: 'Matrix', provenance: 'repo-official', support: 'cataloged' },
  { id: 'mattermost', label: 'Mattermost', provenance: 'repo-official', support: 'cataloged' },
  { id: 'msteams', label: 'Microsoft Teams', provenance: 'repo-official', support: 'cataloged' },
  { id: 'nextcloud-talk', label: 'Nextcloud Talk', provenance: 'repo-official', support: 'cataloged' },
  { id: 'nostr', label: 'Nostr', provenance: 'repo-official', support: 'cataloged' },
  { id: 'qqbot', label: 'QQ Bot', provenance: 'repo-official', support: 'cataloged' },
  { id: 'raft', label: 'Raft', provenance: 'repo-official', support: 'cataloged' },
  { id: 'signal', label: 'Signal', provenance: 'repo-official', support: 'cataloged' },
  { id: 'slack', label: 'Slack', provenance: 'repo-official', support: 'cataloged' },
  { id: 'sms', label: 'SMS', provenance: 'repo-official', support: 'cataloged' },
  { id: 'synology-chat', label: 'Synology Chat', provenance: 'repo-official', support: 'cataloged' },
  { id: 'telegram', label: 'Telegram', provenance: 'bundled', support: 'cataloged' },
  { id: 'tlon', label: 'Tlon', provenance: 'repo-official', support: 'cataloged' },
  { id: 'twitch', label: 'Twitch', provenance: 'repo-official', support: 'cataloged' },
  { id: 'webchat', label: 'WebChat', provenance: 'core', support: 'cataloged' },
  { id: 'wechat', label: 'WeChat', provenance: 'external', support: 'cataloged' },
  { id: 'whatsapp', label: 'WhatsApp', provenance: 'repo-official', support: 'cataloged' },
  { id: 'yuanbao', label: 'Yuanbao', provenance: 'external', support: 'cataloged' },
  { id: 'zalo', label: 'Zalo', provenance: 'repo-official', support: 'cataloged' },
  { id: 'zaloclawbot', label: 'Zalo ClawBot', provenance: 'external', support: 'cataloged' },
  { id: 'zalouser', label: 'Zalo Personal', provenance: 'repo-official', support: 'cataloged' },
] as const satisfies readonly ClawdshChannelCatalogEntry[]
