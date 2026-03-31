/**
 * Native Messaging Bridge — background service worker side.
 * Manages the persistent port to the native host process.
 */

import type { NativeMessage } from '../types/messages'
import { randomId } from './utils'

const HOST_NAME = 'com.webgenie.host'

type MessageHandler = (msg: NativeMessage) => void
type PendingResolve = (msg: NativeMessage) => void

export class NativeBridge {
  private port: chrome.runtime.Port | null = null
  private handlers: MessageHandler[] = []
  private pending = new Map<string, PendingResolve>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connected = false

  connect(): void {
    if (this.connected) return
    try {
      this.port = chrome.runtime.connectNative(HOST_NAME)
      this.connected = true
      console.log('[WebGenie] Native host connected')

      this.port.onMessage.addListener((msg: NativeMessage) => {
        this.handleIncoming(msg)
      })

      this.port.onDisconnect.addListener(() => {
        this.connected = false
        this.port = null
        console.warn('[WebGenie] Native host disconnected:', chrome.runtime.lastError?.message)
        this.scheduleReconnect()
      })
    } catch (err) {
      console.error('[WebGenie] Failed to connect to native host:', err)
      this.scheduleReconnect()
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.port?.disconnect()
    this.port = null
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Send a one-way message to the native host (fire-and-forget).
   */
  send(type: NativeMessage['type'], payload: unknown): void {
    if (!this.port || !this.connected) {
      console.warn('[WebGenie] Not connected to native host, dropping message')
      return
    }
    const msg: NativeMessage = { id: randomId(), type, payload }
    this.port.postMessage(msg)
  }

  /**
   * Send a message and wait for a response with the same ID.
   */
  request(
    type: NativeMessage['type'],
    payload: unknown,
    timeoutMs = 30_000,
  ): Promise<NativeMessage> {
    return new Promise((resolve, reject) => {
      if (!this.port || !this.connected) {
        reject(new Error('Not connected to native host'))
        return
      }

      const msg: NativeMessage = { id: randomId(), type, payload }
      const timer = setTimeout(() => {
        this.pending.delete(msg.id)
        reject(new Error(`Native host request timed out (${type})`))
      }, timeoutMs)

      this.pending.set(msg.id, (response) => {
        clearTimeout(timer)
        resolve(response)
      })

      this.port.postMessage(msg)
    })
  }

  /**
   * Register a handler for all incoming native messages.
   */
  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler)
  }

  private handleIncoming(msg: NativeMessage): void {
    // Resolve pending request if ID matches
    const pending = this.pending.get(msg.id)
    if (pending) {
      this.pending.delete(msg.id)
      pending(msg)
      return
    }

    // Otherwise broadcast to all handlers
    for (const h of this.handlers) h(msg)
  }

  private scheduleReconnect(delayMs = 5_000): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delayMs)
  }
}
