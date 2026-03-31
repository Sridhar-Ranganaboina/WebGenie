/**
 * Action Executor — routes action commands from the native host to the correct
 * tab/frame content script, then collects the result.
 */

import type { AgentAction, BackgroundToContent } from '../types/messages'
import { TabManager } from './tab-manager'
import { randomId, sleep } from './utils'

export interface ExecuteOptions {
  tabId: number
  frameId?: number
  action: AgentAction
  timeoutMs?: number
}

export interface ExecuteResult {
  success: boolean
  result?: unknown
  error?: string
}

export class ActionExecutor {
  private tabManager: TabManager
  private pending = new Map<string, { resolve: (r: ExecuteResult) => void; reject: (e: Error) => void }>()

  constructor(tabManager: TabManager) {
    this.tabManager = tabManager
  }

  /**
   * Handle an ACTION_RESULT message coming from a content script.
   */
  handleActionResult(actionId: string, success: boolean, result?: unknown, error?: string): void {
    const entry = this.pending.get(actionId)
    if (!entry) return
    this.pending.delete(actionId)
    entry.resolve({ success, result, error })
  }

  /**
   * Execute an action in a specific tab (and optionally frame), waiting for the result.
   */
  async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    const { tabId, frameId, action, timeoutMs = 15_000 } = opts
    const actionId = randomId()

    const msg: BackgroundToContent = { kind: 'EXECUTE_ACTION', actionId, action }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(actionId)
        reject(new Error(`Action timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(actionId, {
        resolve: (r) => { clearTimeout(timer); resolve(r) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })

      // Send to the specific frame, or all frames in the tab
      if (frameId !== undefined) {
        chrome.tabs.sendMessage(tabId, msg, { frameId })
      } else {
        // Default to main frame (frameId 0) for actions unless specified
        chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })
      }
    })
  }

  /**
   * Wait for a specific condition on a tab.
   */
  async waitFor(
    tabId: number,
    condition: { type: string; [key: string]: unknown },
    timeoutMs = 15_000,
  ): Promise<{ success: boolean; error?: string }> {
    const deadline = Date.now() + timeoutMs
    const pollMs = 500

    while (Date.now() < deadline) {
      try {
        const met = await this.checkCondition(tabId, condition)
        if (met) return { success: true }
      } catch {
        // ignore transient errors
      }
      await sleep(pollMs)
    }

    return { success: false, error: `Condition "${condition.type}" not met within ${timeoutMs}ms` }
  }

  private async checkCondition(tabId: number, condition: { type: string; [key: string]: unknown }): Promise<boolean> {
    switch (condition.type) {
      case 'url_contains': {
        const tab = await chrome.tabs.get(tabId)
        return (tab.url ?? '').includes(condition.text as string)
      }
      case 'title_contains': {
        const tab = await chrome.tabs.get(tabId)
        return (tab.title ?? '').includes(condition.text as string)
      }
      case 'element_visible': {
        const result = await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: (selector: string) => !!document.querySelector(selector),
          args: [condition.selector as string],
        })
        return result[0]?.result === true
      }
      case 'element_gone': {
        const result = await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: (selector: string) => !document.querySelector(selector),
          args: [condition.selector as string],
        })
        return result[0]?.result === true
      }
      case 'text_visible': {
        const result = await chrome.scripting.executeScript({
          target: { tabId, allFrames: false },
          func: (text: string) => document.body.innerText.includes(text),
          args: [condition.text as string],
        })
        return result[0]?.result === true
      }
      case 'delay':
        await sleep(condition.ms as number)
        return true
      case 'network_idle':
        await sleep(1000)
        return true
      default:
        return false
    }
  }
}
