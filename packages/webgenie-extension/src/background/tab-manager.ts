/**
 * Tab & Frame Registry — tracks all open tabs, their frames, and pending snapshots.
 */

import type { FrameSnapshot, PageSnapshot, TabInfo } from '../types/messages'

export interface FrameEntry {
  frameId: number
  tabId: number
  url: string
  parentFrameId: number | null
  snapshot: FrameSnapshot | null
}

export class TabManager {
  private tabs = new Map<number, TabInfo>()
  private frames = new Map<string, FrameEntry>()

  // ─── Tab lifecycle ────────────────────────────────────────────────────────

  upsertTab(tab: chrome.tabs.Tab): void {
    if (!tab.id) return
    this.tabs.set(tab.id, {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url ?? '',
      title: tab.title ?? '',
      isActive: tab.active,
      isLoading: tab.status === 'loading',
      isPinned: tab.pinned,
      index: tab.index,
      groupId: tab.groupId !== undefined && tab.groupId !== chrome.tabGroups?.TAB_GROUP_ID_NONE ? tab.groupId : undefined,
    })
  }

  removeTab(tabId: number): void {
    this.tabs.delete(tabId)
    // Remove all frames for this tab
    for (const [key, entry] of this.frames) {
      if (entry.tabId === tabId) this.frames.delete(key)
    }
  }

  getTab(tabId: number): TabInfo | undefined {
    return this.tabs.get(tabId)
  }

  listTabs(): TabInfo[] {
    return [...this.tabs.values()]
  }

  // ─── Frame lifecycle ──────────────────────────────────────────────────────

  private frameKey(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`
  }

  registerFrame(tabId: number, frameId: number, url: string, parentFrameId: number | null): void {
    const key = this.frameKey(tabId, frameId)
    this.frames.set(key, {
      frameId,
      tabId,
      url,
      parentFrameId,
      snapshot: null,
    })
  }

  updateFrameSnapshot(tabId: number, frameId: number, snapshot: FrameSnapshot): void {
    const key = this.frameKey(tabId, frameId)
    const entry = this.frames.get(key)
    if (entry) {
      entry.snapshot = snapshot
    } else {
      this.frames.set(key, { frameId, tabId, url: snapshot.frameUrl, parentFrameId: null, snapshot })
    }
  }

  getFramesForTab(tabId: number): FrameEntry[] {
    return [...this.frames.values()].filter((f) => f.tabId === tabId)
  }

  clearFrameSnapshots(tabId: number): void {
    for (const entry of this.frames.values()) {
      if (entry.tabId === tabId) entry.snapshot = null
    }
  }

  // ─── Composite snapshot ───────────────────────────────────────────────────

  buildPageSnapshot(tabId: number): PageSnapshot | null {
    const tab = this.tabs.get(tabId)
    const frames = this.getFramesForTab(tabId)
    const populated = frames.filter((f) => f.snapshot !== null)

    return {
      tabId,
      url: tab?.url ?? '',
      title: tab?.title ?? '',
      frames: populated.map((f) => ({
        ...f.snapshot!,
        parentFrameId: f.parentFrameId,
      })),
      timestamp: Date.now(),
    }
  }
}
