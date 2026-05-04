import dashboard from './dashboard'
import den from './den'
import hunt from './hunt'
import pack from './pack'
import settings from './settings'
import agentchat from './agentchat'

export type HelpPageId = 'dashboard' | 'den' | 'hunt' | 'pack' | 'settings' | 'agentchat'

export const HELP_TITLES: Record<HelpPageId, string> = {
  dashboard: 'Dashboard',
  den: 'The Den',
  hunt: 'The Hunt',
  pack: 'The Pack',
  settings: 'Settings',
  agentchat: 'Private DM',
}

export const HELP_CONTENT: Record<HelpPageId, string> = {
  dashboard,
  den,
  hunt,
  pack,
  settings,
  agentchat,
}
