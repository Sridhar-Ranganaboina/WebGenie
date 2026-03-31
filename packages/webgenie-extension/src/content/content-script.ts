/**
 * Content script — injected into ALL frames (including cross-origin iframes)
 * via manifest "all_frames": true.
 *
 * Responsibilities:
 *  1. Capture DOM/accessibility snapshots and report them to the background SW.
 *  2. Execute agent actions (click, type, scroll, etc.) dispatched by the background SW.
 *  3. Collect console logs and forward them to the background SW.
 */

import type { BackgroundToContent, ContentToBackground } from '../types/messages'
import { executeAction } from './actions'
import { buildSnapshot, cleanupSnapshotMarkers } from './snapshot'

// ─── Frame identity ───────────────────────────────────────────────────────────

const FRAME_URL = window.location.href

/**
 * Determine the current frame's numeric ID.
 * In Chrome extensions, `chrome.runtime.sendMessage` callbacks carry
 * `sender.frameId`. We ask the background to tell us our ID on startup.
 */
let MY_FRAME_ID = 0

// ─── Console log interceptor ──────────────────────────────────────────────────

const consoleBuffer: Array<{
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
  timestamp: number
}> = []

function interceptConsole(): void {
  const levels = ['log', 'warn', 'error', 'info'] as const
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      const message = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ')
      consoleBuffer.push({ level, message, timestamp: Date.now() })
      if (consoleBuffer.length > 200) consoleBuffer.shift()
    }
  }
}

// ─── Message handling ─────────────────────────────────────────────────────────

function sendToBackground(msg: ContentToBackground): void {
  try {
    chrome.runtime.sendMessage(msg)
  } catch {
    // Extension might have been updated/reloaded — ignore
  }
}

function handleMessage(msg: BackgroundToContent): void {
  if (msg.kind === 'GET_SNAPSHOT') {
    cleanupSnapshotMarkers()
    const { elements, rawText } = buildSnapshot(MY_FRAME_ID, FRAME_URL)
    sendToBackground({
      kind: 'FRAME_SNAPSHOT',
      frameId: MY_FRAME_ID,
      frameUrl: FRAME_URL,
      parentFrameId: null, // background fills this in via webNavigation
      elements,
      rawText,
    })
    return
  }

  if (msg.kind === 'EXECUTE_ACTION') {
    executeAction(msg.action)
      .then((result) => {
        sendToBackground({
          kind: 'ACTION_RESULT',
          actionId: msg.actionId,
          success: result.success,
          result: result.result,
          error: result.error,
        })
      })
      .catch((err: unknown) => {
        sendToBackground({
          kind: 'ACTION_RESULT',
          actionId: msg.actionId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    return
  }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

function init(): void {
  interceptConsole()

  // Listen for commands from the background service worker
  chrome.runtime.onMessage.addListener((msg: BackgroundToContent) => {
    handleMessage(msg)
  })

  // Announce ourselves to the background so it registers this frame
  sendToBackground({ kind: 'FRAME_READY', frameId: MY_FRAME_ID, frameUrl: FRAME_URL })

  // Ask the background to assign our real frameId
  chrome.runtime.sendMessage(
    { kind: 'GET_MY_FRAME_ID' },
    (response: { frameId: number } | undefined) => {
      if (chrome.runtime.lastError) return
      if (response?.frameId != null) {
        MY_FRAME_ID = response.frameId
      }
    },
  )
}

init()
