/**
 * Background Service Worker — the central hub.
 *
 * Data flow:
 *   Native Host → NativeBridge → ActionExecutor → Content Scripts (any frame)
 *   Content Scripts → TabManager → NativeBridge → Native Host
 *
 * Key insight: content scripts are injected with `all_frames: true`, so
 * cross-origin iframes are fully accessible — each runs its own snapshot/action.
 */

import { NativeBridge } from './native-bridge'
import { TabManager } from './tab-manager'
import { ActionExecutor } from './action-executor'
import { randomId } from './utils'
import type {
  ContentToBackground,
  FrameSnapshot,
  HostCommand,
  NativeMessage,
  TabInfo,
  WindowInfo,
} from '../types/messages'

// ─── Singletons ───────────────────────────────────────────────────────────────

const bridge = new NativeBridge()
const tabManager = new TabManager()
const executor = new ActionExecutor(tabManager)

// Pending snapshot collectors: tabId → { resolve, frames collected, timer }
interface SnapshotCollector {
  resolve: (frames: FrameSnapshot[]) => void
  frames: FrameSnapshot[]
  frameCount: number
  timer: ReturnType<typeof setTimeout>
}
const snapshotCollectors = new Map<number, SnapshotCollector>()

// Console log buffer per tab
const consoleLogs = new Map<number, Array<{ level: string; message: string; timestamp: number }>>()

// ─── Tab event listeners ──────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  tabManager.upsertTab(tab)
})

chrome.tabs.onUpdated.addListener((tabId, _changes, tab) => {
  tabManager.upsertTab(tab)
  if (tab.status === 'loading') {
    tabManager.clearFrameSnapshots(tabId)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabManager.removeTab(tabId)
  consoleLogs.delete(tabId)
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId)
  tabManager.upsertTab(tab)
})

// ─── Frame event listeners (webNavigation) ────────────────────────────────────

chrome.webNavigation.onCommitted.addListener((details) => {
  const parentId = (details as unknown as { parentFrameId?: number }).parentFrameId ?? null
  tabManager.registerFrame(details.tabId, details.frameId, details.url, parentId)
})

chrome.webNavigation.onCompleted.addListener(async (details) => {
  const parentId = (details as unknown as { parentFrameId?: number }).parentFrameId ?? null
  tabManager.registerFrame(details.tabId, details.frameId, details.url, parentId)
})

// ─── Content script message handling ─────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (msg: ContentToBackground | { kind: 'GET_MY_FRAME_ID' }, sender, sendResponse) => {
    const tabId = sender.tab?.id
    const frameId = sender.frameId ?? 0

    if (msg.kind === 'GET_MY_FRAME_ID') {
      sendResponse({ frameId })
      return true
    }

    if (msg.kind === 'FRAME_READY') {
      if (tabId !== undefined) {
        tabManager.registerFrame(tabId, frameId, msg.frameUrl, null)
      }
      return false
    }

    if (msg.kind === 'FRAME_SNAPSHOT' && tabId !== undefined) {
      const snapshot: FrameSnapshot = {
        frameId,
        frameUrl: msg.frameUrl,
        parentFrameId: msg.parentFrameId,
        title: '',
        elements: msg.elements,
        rawText: msg.rawText,
      }
      tabManager.updateFrameSnapshot(tabId, frameId, snapshot)

      // Feed into any pending collector
      const collector = snapshotCollectors.get(tabId)
      if (collector) {
        collector.frames.push(snapshot)
        if (collector.frames.length >= collector.frameCount) {
          clearTimeout(collector.timer)
          snapshotCollectors.delete(tabId)
          collector.resolve(collector.frames)
        }
      }
      return false
    }

    if (msg.kind === 'ACTION_RESULT') {
      executor.handleActionResult(msg.actionId, msg.success, msg.result, msg.error)
      return false
    }

    if (msg.kind === 'CONSOLE_LOG' && tabId !== undefined) {
      const buf = consoleLogs.get(tabId) ?? []
      buf.push({ level: msg.level, message: msg.message, timestamp: msg.timestamp })
      if (buf.length > 500) buf.shift()
      consoleLogs.set(tabId, buf)
      return false
    }

    if (msg.kind === 'EVALUATE_RESULT') {
      executor.handleActionResult(msg.actionId, msg.success, msg.value, msg.error)
      return false
    }

    return false
  },
)

// ─── Native host message handling ────────────────────────────────────────────

bridge.onMessage(async (msg: NativeMessage) => {
  if (msg.type === 'PING') {
    bridge.send('PONG', { time: Date.now() })
    return
  }

  if (msg.type === 'ACTION_COMMAND') {
    const cmd = msg.payload as HostCommand
    const response = await handleHostCommand(cmd)
    bridge.send('ACTION_RESULT', { id: msg.id, ...(response as Record<string, unknown>) })
  }
})

// ─── Host command dispatch ────────────────────────────────────────────────────

async function handleHostCommand(cmd: HostCommand): Promise<unknown> {
  switch (cmd.cmd) {
    // ── Navigation ──────────────────────────────────────────────────────────
    case 'navigate': {
      await chrome.tabs.update(cmd.tabId, { url: cmd.url })
      await waitForTabLoad(cmd.tabId)
      return { success: true, url: cmd.url }
    }

    case 'navigate_back': {
      await chrome.tabs.goBack(cmd.tabId)
      await waitForTabLoad(cmd.tabId)
      return { success: true }
    }

    case 'navigate_forward': {
      await chrome.tabs.goForward(cmd.tabId)
      await waitForTabLoad(cmd.tabId)
      return { success: true }
    }

    case 'reload': {
      await chrome.tabs.reload(cmd.tabId)
      await waitForTabLoad(cmd.tabId)
      return { success: true }
    }

    // ── Tab management ───────────────────────────────────────────────────────
    case 'new_tab': {
      const tab = await chrome.tabs.create({ url: cmd.url ?? 'about:blank', active: true })
      if (cmd.url && tab.id) await waitForTabLoad(tab.id)
      return { success: true, tabId: tab.id }
    }

    case 'close_tab': {
      await chrome.tabs.remove(cmd.tabId)
      return { success: true }
    }

    case 'activate_tab': {
      await chrome.tabs.update(cmd.tabId, { active: true })
      return { success: true }
    }

    case 'pin_tab': {
      await chrome.tabs.update(cmd.tabId, { pinned: cmd.pinned })
      return { success: true }
    }

    case 'list_tabs': {
      const tabs = await chrome.tabs.query({})
      const infos: TabInfo[] = tabs
        .filter((t) => t.id !== undefined)
        .map((t) => ({
          tabId: t.id!,
          windowId: t.windowId,
          url: t.url ?? '',
          title: t.title ?? '',
          isActive: t.active,
          isLoading: t.status === 'loading',
          isPinned: t.pinned,
          index: t.index,
          groupId: t.groupId !== chrome.tabGroups?.TAB_GROUP_ID_NONE ? t.groupId : undefined,
        }))
      return { success: true, tabs: infos }
    }

    // ── Snapshot ─────────────────────────────────────────────────────────────
    case 'get_snapshot': {
      const snapshot = await collectSnapshot(cmd.tabId)
      return { success: true, snapshot }
    }

    // ── Screenshot ───────────────────────────────────────────────────────────
    case 'get_screenshot': {
      await chrome.tabs.update(cmd.tabId, { active: true })
      const tab = await chrome.tabs.get(cmd.tabId)
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: cmd.format ?? 'png',
        quality: 90,
      })
      return { success: true, dataUrl }
    }

    // ── Page content ─────────────────────────────────────────────────────────
    case 'get_page_content': {
      const results = await chrome.scripting.executeScript({
        target: { tabId: cmd.tabId, allFrames: false },
        func: extractPageContent,
        args: [cmd.selector],
      })
      return { success: true, content: results[0]?.result ?? '' }
    }

    // ── Page links ───────────────────────────────────────────────────────────
    case 'get_page_links': {
      const results = await chrome.scripting.executeScript({
        target: { tabId: cmd.tabId, allFrames: false },
        func: extractPageLinks,
      })
      return { success: true, links: results[0]?.result ?? [] }
    }

    // ── History ──────────────────────────────────────────────────────────────
    case 'get_history': {
      const items = await chrome.history.search({
        text: '',
        maxResults: cmd.maxResults ?? 50,
        startTime: Date.now() - 7 * 24 * 60 * 60 * 1000, // last 7 days
      })
      return { success: true, history: items }
    }

    // ── Bookmarks ────────────────────────────────────────────────────────────
    case 'get_bookmarks': {
      const results = cmd.query
        ? await chrome.bookmarks.search(cmd.query)
        : await chrome.bookmarks.getTree()
      return { success: true, bookmarks: results }
    }

    case 'add_bookmark': {
      const bookmark = await chrome.bookmarks.create({ title: cmd.title, url: cmd.url })
      return { success: true, bookmark }
    }

    // ── Console logs ─────────────────────────────────────────────────────────
    case 'get_console_logs': {
      const logs = consoleLogs.get(cmd.tabId) ?? []
      if (cmd.clear) consoleLogs.delete(cmd.tabId)
      return { success: true, logs }
    }

    // ── Evaluate JavaScript ───────────────────────────────────────────────────
    case 'evaluate': {
      try {
        const evalTarget = cmd.frameId !== undefined
          ? { tabId: cmd.tabId, frameIds: [cmd.frameId] }
          : { tabId: cmd.tabId, allFrames: true as const }
        const results = await chrome.scripting.executeScript({
          target: evalTarget,
          func: (expr: string) => {
            try {
              // biome-ignore lint/security/noEval: intentional evaluate tool
              return { success: true, value: eval(expr) } // eslint-disable-line no-eval
            } catch (e) {
              return { success: false, error: String(e) }
            }
          },
          args: [cmd.expression],
        })
        return results[0]?.result ?? { success: false, error: 'No result' }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }

    // ── Execute action ────────────────────────────────────────────────────────
    case 'execute_action': {
      const result = await executor.execute({
        tabId: cmd.tabId,
        frameId: cmd.frameId,
        action: cmd.action,
      })
      return result
    }

    // ── Find element ──────────────────────────────────────────────────────────
    case 'find_element': {
      const target = cmd.frameId !== undefined
        ? { tabId: cmd.tabId, frameIds: [cmd.frameId] }
        : { tabId: cmd.tabId, allFrames: false }

      const results = await chrome.scripting.executeScript({
        target,
        func: (selector: string) => {
          const el = document.querySelector(selector)
          if (!el) return null
          const rect = el.getBoundingClientRect()
          return {
            found: true,
            tagName: el.tagName.toLowerCase(),
            text: (el as HTMLElement).innerText?.trim().slice(0, 200),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          }
        },
        args: [cmd.selector],
      })
      const found = results[0]?.result
      return { success: !!found, element: found ?? null }
    }

    // ── Wait for condition ────────────────────────────────────────────────────
    case 'wait_for': {
      const result = await executor.waitFor(cmd.tabId, cmd.condition, cmd.timeoutMs)
      return result
    }

    // ── Tab groups ───────────────────────────────────────────────────────────
    case 'create_tab_group': {
      const groupId = await chrome.tabs.group({ tabIds: cmd.tabIds })
      if (cmd.title || cmd.color) {
        await chrome.tabGroups.update(groupId, {
          title: cmd.title,
          color: cmd.color as chrome.tabGroups.Color | undefined,
        })
      }
      return { success: true, groupId }
    }

    // ── Windows ───────────────────────────────────────────────────────────────
    case 'list_windows': {
      const windows = await chrome.windows.getAll({ populate: true })
      const infos: WindowInfo[] = windows.map((w) => ({
        windowId: w.id!,
        type: w.type ?? 'normal',
        state: w.state ?? 'normal',
        focused: w.focused,
        tabs: (w.tabs ?? [])
          .filter((t) => t.id !== undefined)
          .map((t) => ({
            tabId: t.id!,
            windowId: t.windowId,
            url: t.url ?? '',
            title: t.title ?? '',
            isActive: t.active,
            isLoading: t.status === 'loading',
            isPinned: t.pinned,
            index: t.index,
          })),
      }))
      return { success: true, windows: infos }
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    case 'memory_read': {
      const result = await chrome.storage.local.get(`memory:${cmd.key}`)
      return { success: true, value: result[`memory:${cmd.key}`] ?? null }
    }

    case 'memory_write': {
      await chrome.storage.local.set({ [`memory:${cmd.key}`]: cmd.value })
      return { success: true }
    }

    case 'memory_search': {
      const all = await chrome.storage.local.get(null)
      const matches: Array<{ key: string; value: string }> = []
      const q = cmd.query.toLowerCase()
      for (const [k, v] of Object.entries(all)) {
        if (!k.startsWith('memory:')) continue
        const val = String(v)
        if (k.toLowerCase().includes(q) || val.toLowerCase().includes(q)) {
          matches.push({ key: k.replace('memory:', ''), value: val })
        }
      }
      return { success: true, matches }
    }

    default:
      return { success: false, error: `Unknown command: ${(cmd as HostCommand).cmd}` }
  }
}

// ─── Snapshot collection helpers ─────────────────────────────────────────────

async function collectSnapshot(tabId: number): Promise<unknown> {
  // 1. Find how many frames exist in this tab
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => [])
  const frameCount = Math.max(frames?.length ?? 1, 1)

  // 2. Request snapshots from all frames simultaneously
  return new Promise((resolve) => {
    const collected: FrameSnapshot[] = []
    const timer = setTimeout(() => {
      snapshotCollectors.delete(tabId)
      // Return whatever we have
      const ps = tabManager.buildPageSnapshot(tabId)
      resolve(ps ?? { tabId, url: '', title: '', frames: [], timestamp: Date.now() })
    }, 5_000)

    snapshotCollectors.set(tabId, {
      resolve: (frames) => {
        const ps = tabManager.buildPageSnapshot(tabId)
        resolve(ps ?? { tabId, url: '', title: '', frames, timestamp: Date.now() })
      },
      frames: collected,
      frameCount,
      timer,
    })

    // Inject or message all frames
    chrome.tabs.sendMessage(tabId, { kind: 'GET_SNAPSHOT' }, { frameId: 0 })
    for (const frame of frames ?? []) {
      if (frame.frameId === 0) continue
      chrome.tabs.sendMessage(tabId, { kind: 'GET_SNAPSHOT' }, { frameId: frame.frameId })
        .catch(() => { /* frame may not have content script */ })
    }
  })
}

// ─── Page content extraction (injected JS) ────────────────────────────────────

function extractPageContent(selector?: string): string {
  const root = selector ? document.querySelector(selector) : document.body
  if (!root) return ''

  function processNode(node: Node, depth: number): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').trim()
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const el = node as Element
    const tag = el.tagName.toLowerCase()

    if (['script', 'style', 'noscript', 'svg', 'iframe'].includes(tag)) return ''

    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return ''

    const indent = '  '.repeat(depth)

    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10)
      const prefix = '#'.repeat(level) + ' '
      return `\n${prefix}${el.textContent?.trim()}\n`
    }

    if (tag === 'a') {
      const href = el.getAttribute('href')
      const text = el.textContent?.trim()
      if (href && text) return `[${text}](${href})`
      return text ?? ''
    }

    if (tag === 'img') {
      const alt = el.getAttribute('alt') ?? ''
      const src = el.getAttribute('src') ?? ''
      return `![${alt}](${src})`
    }

    if (tag === 'li') {
      const parent = el.parentElement?.tagName.toLowerCase()
      const prefix = parent === 'ol' ? '1. ' : '- '
      const children = Array.from(node.childNodes).map((c) => processNode(c, 0)).filter(Boolean).join(' ')
      return `\n${indent}${prefix}${children}`
    }

    if (tag === 'tr') {
      const cells = Array.from(el.querySelectorAll('td, th')).map((c) => c.textContent?.trim() ?? '')
      return `| ${cells.join(' | ')} |`
    }

    const children = Array.from(node.childNodes).map((c) => processNode(c, depth)).filter(Boolean)
    const blockTags = new Set(['div', 'p', 'section', 'article', 'main', 'header', 'footer', 'aside', 'table', 'ul', 'ol'])
    if (blockTags.has(tag)) {
      return '\n' + children.join('\n') + '\n'
    }

    return children.join('')
  }

  const result = processNode(root, 0)
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

function extractPageLinks(): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = []
  const seen = new Set<string>()

  for (const el of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = el.href
    if (!href || seen.has(href)) continue
    seen.add(href)
    const text = el.innerText?.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || ''
    if (text || href) links.push({ text, href })
  }

  return links
}

// ─── Tab load helper ──────────────────────────────────────────────────────────

function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const deadline = setTimeout(resolve, timeoutMs)

    function onUpdated(id: number, info: chrome.tabs.TabChangeInfo): void {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(deadline)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

// ─── Side panel communication ─────────────────────────────────────────────────

// Forward agent responses to the side panel
bridge.onMessage((msg) => {
  if (msg.type === 'AGENT_RESPONSE') {
    chrome.runtime.sendMessage({ kind: 'AGENT_RESPONSE', payload: msg.payload }).catch(() => {})
  }
  if (msg.type === 'PAGE_STATE') {
    chrome.runtime.sendMessage({ kind: 'PAGE_STATE', payload: msg.payload }).catch(() => {})
  }
})

// ─── Startup ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  // Seed tab manager with existing tabs
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) tabManager.upsertTab(tab)

  // Open side panel on extension icon click
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})

chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({})
  for (const tab of tabs) tabManager.upsertTab(tab)
  bridge.connect()
})

// Connect to native host on service worker activation
bridge.connect()

// Handle messages from the side panel UI
chrome.runtime.onMessage.addListener((msg: { kind: string; payload?: unknown }, _sender, sendResponse) => {
  if (msg.kind === 'SIDEPANEL_TASK') {
    // Forward task to native host
    bridge.send('TASK_START', msg.payload)
    sendResponse({ ok: true })
    return true
  }

  if (msg.kind === 'SIDEPANEL_GET_TABS') {
    chrome.tabs.query({}).then((tabs) => {
      sendResponse({ tabs: tabs.filter((t) => t.id).map((t) => ({
        tabId: t.id,
        url: t.url,
        title: t.title,
        isActive: t.active,
      })) })
    })
    return true
  }

  return false
})
