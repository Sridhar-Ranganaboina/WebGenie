/**
 * Message protocol shared between content scripts, background service worker,
 * and the native messaging host.
 */

// ─── Actions the agent can request ───────────────────────────────────────────

export type MouseButton = 'left' | 'right' | 'middle'

export type AgentAction =
  | { type: 'click'; elementId: number; button?: MouseButton; clickCount?: number }
  | { type: 'click_at'; x: number; y: number; button?: MouseButton; clickCount?: number }
  | { type: 'hover'; elementId: number }
  | { type: 'type'; elementId: number; text: string; append?: boolean }
  | { type: 'clear'; elementId: number }
  | { type: 'press_key'; key: string; modifiers?: string[] }
  | { type: 'select_option'; elementId: number; value: string }
  | {
      type: 'scroll'
      direction: 'up' | 'down' | 'left' | 'right'
      amount?: number
      elementId?: number
    }
  | { type: 'scroll_to_element'; elementId: number }
  | { type: 'scroll_to_top' }
  | { type: 'scroll_to_bottom' }
  | { type: 'focus'; elementId: number }
  | { type: 'evaluate'; expression: string; frameId?: number }

// ─── Element node from the accessibility tree ────────────────────────────────

export interface SnapshotElement {
  id: number
  role: string
  name: string
  value?: string
  description?: string
  checked?: boolean
  disabled?: boolean
  expanded?: boolean
  required?: boolean
  selected?: boolean
  level?: number
  frameId: number
  frameUrl: string
  tagName?: string
  rect?: { x: number; y: number; width: number; height: number }
}

export interface FrameSnapshot {
  frameId: number
  frameUrl: string
  parentFrameId: number | null
  title: string
  elements: SnapshotElement[]
  rawText: string
}

export interface PageSnapshot {
  tabId: number
  url: string
  title: string
  frames: FrameSnapshot[]
  timestamp: number
}

// ─── Content Script → Background ─────────────────────────────────────────────

export type ContentToBackground =
  | {
      kind: 'FRAME_SNAPSHOT'
      frameId: number
      frameUrl: string
      parentFrameId: number | null
      elements: SnapshotElement[]
      rawText: string
    }
  | { kind: 'ACTION_RESULT'; actionId: string; success: boolean; result?: unknown; error?: string }
  | {
      kind: 'CONSOLE_LOG'
      level: 'log' | 'warn' | 'error' | 'info'
      message: string
      timestamp: number
    }
  | { kind: 'FRAME_READY'; frameId: number; frameUrl: string }
  | { kind: 'EVALUATE_RESULT'; actionId: string; success: boolean; value?: unknown; error?: string }

// ─── Background → Content Script ─────────────────────────────────────────────

export type BackgroundToContent =
  | { kind: 'GET_SNAPSHOT' }
  | { kind: 'EXECUTE_ACTION'; actionId: string; action: AgentAction }

// ─── Background ↔ Native Host ─────────────────────────────────────────────────

export interface NativeMessage {
  id: string
  type: NativeMessageType
  payload: unknown
}

export type NativeMessageType =
  | 'TASK_START'
  | 'PAGE_STATE'
  | 'ACTION_COMMAND'
  | 'ACTION_RESULT'
  | 'AGENT_RESPONSE'
  | 'SCREENSHOT'
  | 'PAGE_LINKS'
  | 'PAGE_CONTENT'
  | 'TAB_LIST'
  | 'HISTORY'
  | 'BOOKMARKS'
  | 'CONSOLE_LOGS'
  | 'EVALUATE_RESULT'
  | 'MEMORY_READ'
  | 'MEMORY_WRITE'
  | 'PING'
  | 'PONG'
  | 'ERROR'

// Host → Extension: tell the extension what to do
export type HostCommand =
  | { cmd: 'navigate'; tabId: number; url: string }
  | { cmd: 'navigate_back'; tabId: number }
  | { cmd: 'navigate_forward'; tabId: number }
  | { cmd: 'reload'; tabId: number }
  | { cmd: 'new_tab'; url?: string }
  | { cmd: 'close_tab'; tabId: number }
  | { cmd: 'activate_tab'; tabId: number }
  | { cmd: 'pin_tab'; tabId: number; pinned: boolean }
  | { cmd: 'get_snapshot'; tabId: number }
  | { cmd: 'get_screenshot'; tabId: number; fullPage?: boolean; format?: 'png' | 'jpeg' }
  | { cmd: 'get_page_content'; tabId: number; selector?: string }
  | { cmd: 'get_page_links'; tabId: number }
  | { cmd: 'list_tabs' }
  | { cmd: 'get_history'; maxResults?: number }
  | { cmd: 'get_bookmarks'; query?: string }
  | { cmd: 'add_bookmark'; title: string; url: string }
  | { cmd: 'get_console_logs'; tabId: number; clear?: boolean }
  | { cmd: 'evaluate'; tabId: number; expression: string; frameId?: number }
  | { cmd: 'execute_action'; tabId: number; frameId?: number; action: AgentAction }
  | { cmd: 'find_element'; tabId: number; selector: string; frameId?: number }
  | { cmd: 'wait_for'; tabId: number; condition: WaitCondition; timeoutMs?: number }
  | { cmd: 'create_tab_group'; tabIds: number[]; title?: string; color?: string }
  | { cmd: 'list_windows' }
  | { cmd: 'memory_read'; key: string }
  | { cmd: 'memory_write'; key: string; value: string }
  | { cmd: 'memory_search'; query: string }

export type WaitCondition =
  | { type: 'url_contains'; text: string }
  | { type: 'title_contains'; text: string }
  | { type: 'element_visible'; selector: string }
  | { type: 'element_gone'; selector: string }
  | { type: 'text_visible'; text: string }
  | { type: 'network_idle' }
  | { type: 'delay'; ms: number }

// Extension → Host: results and state
export interface TabInfo {
  tabId: number
  windowId: number
  url: string
  title: string
  isActive: boolean
  isLoading: boolean
  isPinned: boolean
  index: number
  groupId?: number
}

export interface WindowInfo {
  windowId: number
  type: string
  state: string
  focused: boolean
  tabs: TabInfo[]
}

export interface BookmarkNode {
  id: string
  title: string
  url?: string
  children?: BookmarkNode[]
}

export interface HistoryItem {
  id: string
  url: string
  title: string
  lastVisitTime: number
  visitCount: number
}
