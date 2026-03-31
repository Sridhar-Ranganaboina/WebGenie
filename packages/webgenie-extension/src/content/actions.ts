/**
 * DOM action executors — runs inside content scripts (any frame).
 */

import { resolveElementById } from './snapshot'
import type { AgentAction } from '../types/messages'

export interface ActionResult {
  success: boolean
  result?: unknown
  error?: string
}

export async function executeAction(action: AgentAction): Promise<ActionResult> {
  try {
    switch (action.type) {
      case 'click':
        return await doClick(action.elementId, action.button ?? 'left', action.clickCount ?? 1)
      case 'click_at':
        return doClickAt(action.x, action.y, action.button ?? 'left', action.clickCount ?? 1)
      case 'hover':
        return doHover(action.elementId)
      case 'type':
        return doType(action.elementId, action.text, action.append ?? false)
      case 'clear':
        return doClear(action.elementId)
      case 'press_key':
        return doPressKey(action.key, action.modifiers ?? [])
      case 'select_option':
        return doSelectOption(action.elementId, action.value)
      case 'scroll':
        return doScroll(action.direction, action.amount ?? 300, action.elementId)
      case 'scroll_to_element':
        return doScrollToElement(action.elementId)
      case 'scroll_to_top':
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return { success: true }
      case 'scroll_to_bottom':
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
        return { success: true }
      case 'focus':
        return doFocus(action.elementId)
      case 'evaluate':
        return doEvaluate(action.expression)
      default:
        return { success: false, error: `Unknown action type: ${(action as AgentAction).type}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function doClick(elementId: number, button: string, clickCount: number): Promise<ActionResult> {
  const el = resolveElementById(elementId)
  if (!el) return { success: false, error: `Element [${elementId}] not found in this frame` }

  // Scroll into view first
  el.scrollIntoView({ block: 'center', inline: 'nearest' })
  await sleep(50)

  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  const buttonMap: Record<string, number> = { left: 0, middle: 1, right: 2 }
  const buttonNum = buttonMap[button] ?? 0

  for (let i = 0; i < clickCount; i++) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
  }

  // Also call native click for real DOM interaction
  if (button === 'left' && clickCount === 1) {
    ;(el as HTMLElement).click?.()
  }

  return { success: true, result: { x: Math.round(x), y: Math.round(y) } }
}

function doClickAt(x: number, y: number, button: string, clickCount: number): ActionResult {
  const buttonMap: Record<string, number> = { left: 0, middle: 1, right: 2 }
  const buttonNum = buttonMap[button] ?? 0
  const el = document.elementFromPoint(x, y) ?? document.body

  for (let i = 0; i < clickCount; i++) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: buttonNum }))
  }

  return { success: true }
}

function doHover(elementId: number): ActionResult {
  const el = resolveElementById(elementId)
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  el.scrollIntoView({ block: 'center' })
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: false, clientX: x, clientY: y }))
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }))

  return { success: true }
}

function doType(elementId: number, text: string, append: boolean): ActionResult {
  const el = resolveElementById(elementId) as HTMLInputElement | HTMLTextAreaElement | null
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  ;(el as HTMLElement).focus()

  if (!append) {
    if ('value' in el) {
      el.value = ''
    } else {
      (el as HTMLElement).textContent = ''
    }
  }

  // Simulate realistic typing via input events
  for (const char of text) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }))

    if ('value' in el) {
      el.value += char
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      (el as HTMLElement).textContent = ((el as HTMLElement).textContent ?? '') + char
    }

    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
  }

  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true, result: { typed: text.length } }
}

function doClear(elementId: number): ActionResult {
  const el = resolveElementById(elementId) as HTMLInputElement | null
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  ;(el as HTMLElement).focus()
  if ('value' in el) {
    el.value = ''
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return { success: true }
}

function doPressKey(key: string, modifiers: string[]): ActionResult {
  const options: KeyboardEventInit = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.includes('ctrl') || modifiers.includes('Control'),
    shiftKey: modifiers.includes('shift') || modifiers.includes('Shift'),
    altKey: modifiers.includes('alt') || modifiers.includes('Alt'),
    metaKey: modifiers.includes('meta') || modifiers.includes('Meta'),
  }

  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', options))
  target.dispatchEvent(new KeyboardEvent('keypress', options))
  target.dispatchEvent(new KeyboardEvent('keyup', options))

  return { success: true }
}

function doSelectOption(elementId: number, value: string): ActionResult {
  const el = resolveElementById(elementId) as HTMLSelectElement | null
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  // Try matching by value, then by label
  const option = Array.from(el.options).find(
    (o) => o.value === value || o.text === value || o.label === value
  )

  if (!option) {
    return { success: false, error: `Option "${value}" not found in select` }
  }

  el.value = option.value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { success: true, result: { selected: option.value } }
}

function doScroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number,
  elementId?: number,
): ActionResult {
  const target: Element | Window = elementId
    ? (resolveElementById(elementId) ?? window)
    : window

  const scrollOptions: ScrollToOptions = { behavior: 'smooth' }

  if (direction === 'up') scrollOptions.top = -amount
  else if (direction === 'down') scrollOptions.top = amount
  else if (direction === 'left') scrollOptions.left = -amount
  else if (direction === 'right') scrollOptions.left = amount

  if (target instanceof Window) {
    target.scrollBy(scrollOptions)
  } else {
    (target as HTMLElement).scrollBy(scrollOptions)
  }

  return { success: true }
}

function doScrollToElement(elementId: number): ActionResult {
  const el = resolveElementById(elementId)
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  return { success: true }
}

function doFocus(elementId: number): ActionResult {
  const el = resolveElementById(elementId) as HTMLElement | null
  if (!el) return { success: false, error: `Element [${elementId}] not found` }

  el.focus()
  return { success: true }
}

function doEvaluate(expression: string): ActionResult {
  try {
    // biome-ignore lint/security/noEval: intentional script evaluation tool
    const result = eval(expression) // eslint-disable-line no-eval
    return { success: true, result: typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : result }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
