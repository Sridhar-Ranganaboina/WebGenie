/**
 * Accessibility-tree snapshot builder.
 * Runs inside the content script (any frame, including cross-origin iframes).
 */

import type { SnapshotElement } from '../types/messages'

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'textarea',
  'checkbox',
  'radio',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'slider',
  'spinbutton',
  'option',
  'treeitem',
  'listbox',
  'DisclosureTriangle',
  'gridcell',
])

const NAMED_CONTENT_ROLES = new Set([
  'heading',
  'img',
  'cell',
  'columnheader',
  'rowheader',
  'dialog',
  'alertdialog',
  'alert',
  'status',
])

const SKIP_ROLES = new Set(['none', 'presentation', 'LineBreak', 'InlineTextBox', 'generic'])

interface SimpleAXNode {
  nodeId: string
  role: string
  name: string
  value: string
  description: string
  properties: Record<string, unknown>
  children: string[]
  domNode: Element | null
  backendNodeId: number
}

let _nodeCounter = 1

/**
 * Build a snapshot using the Accessibility Object Model if available,
 * otherwise fall back to DOM heuristics.
 */
export function buildSnapshot(
  frameId: number,
  frameUrl: string,
): { elements: SnapshotElement[]; rawText: string } {
  const elements: SnapshotElement[] = []
  const lines: string[] = []

  try {
    const axNodes = collectAxNodes()
    for (const node of axNodes) {
      const el = buildElement(node, frameId, frameUrl)
      if (el) {
        elements.push(el)
        lines.push(formatLine(el))
      }
    }
  } catch {
    // AOM not available – fall back to DOM heuristics
    const domElements = collectDomElements()
    for (const el of domElements) {
      elements.push(el)
      lines.push(formatLine(el))
    }
  }

  return { elements, rawText: lines.join('\n') }
}

function formatLine(el: SnapshotElement): string {
  let line = `[${el.id}] ${el.role} "${el.name}"`
  if (el.value) line += ` value="${el.value}"`
  const props: string[] = []
  if (el.checked) props.push('checked')
  if (el.disabled) props.push('disabled')
  if (el.expanded) props.push('expanded')
  if (el.required) props.push('required')
  if (el.selected) props.push('selected')
  if (el.level != null) props.push(`level=${el.level}`)
  if (props.length > 0) line += ` (${props.join(', ')})`
  if (el.frameUrl && el.frameUrl !== window.location.href) {
    line += ` [frame: ${new URL(el.frameUrl).origin}]`
  }
  return line
}

function buildElement(
  node: SimpleAXNode,
  frameId: number,
  frameUrl: string,
): SnapshotElement | null {
  const role = node.role
  if (!role || SKIP_ROLES.has(role)) return null

  const isInteractive = INTERACTIVE_ROLES.has(role)
  const isContent = NAMED_CONTENT_ROLES.has(role) && node.name.length > 0

  if (!isInteractive && !isContent) return null
  if (!node.name && !node.value) return null

  const rect = node.domNode?.getBoundingClientRect()
  if (rect && rect.width === 0 && rect.height === 0) return null

  const props = node.properties
  return {
    id: node.backendNodeId || _nodeCounter++,
    role,
    name: node.name,
    value: node.value || undefined,
    description: node.description || undefined,
    checked: props.checked === true || undefined,
    disabled: props.disabled === true || undefined,
    expanded: props.expanded === true || undefined,
    required: props.required === true || undefined,
    selected: props.selected === true || undefined,
    level: typeof props.level === 'number' ? props.level : undefined,
    frameId,
    frameUrl,
    tagName: node.domNode?.tagName?.toLowerCase(),
    rect: rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      : undefined,
  }
}

function collectAxNodes(): SimpleAXNode[] {
  // Use AccessibilityObjectModel when available (Chrome 70+)
  const nodes: SimpleAXNode[] = []
  const allElements = document.querySelectorAll<Element>('*')
  let id = 1

  for (const el of allElements) {
    const axEl = el as Element & { accessibilityProperties?: unknown }
    const role = el.getAttribute('role') || inferRole(el)
    if (!role) continue

    const name =
      el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') &&
        document.getElementById(el.getAttribute('aria-labelledby') || '')?.textContent?.trim()) ||
      el.getAttribute('placeholder') ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      el.getAttribute('value') ||
      (el as HTMLElement).innerText?.trim().slice(0, 200) ||
      ''

    const value = (el as HTMLInputElement).value || el.getAttribute('aria-valuenow') || ''

    const properties: Record<string, unknown> = {
      checked: (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true',
      disabled: (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true',
      expanded: el.getAttribute('aria-expanded') === 'true',
      required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true',
      selected: (el as HTMLOptionElement).selected || el.getAttribute('aria-selected') === 'true',
      level: el.tagName.match(/^H(\d)$/i) ? parseInt(RegExp.$1, 10) : undefined,
    }

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue

    el.setAttribute('data-wg-id', String(id))
    nodes.push({
      nodeId: String(id),
      role,
      name: name.trim(),
      value: value.trim(),
      description: el.getAttribute('aria-description') || '',
      properties,
      children: [],
      domNode: el,
      backendNodeId: id++,
    })
  }

  return nodes
}

function inferRole(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const type = (el as HTMLInputElement).type?.toLowerCase()

  const roleMap: Record<string, string> = {
    a: 'link',
    button: 'button',
    select: 'combobox',
    textarea: 'textarea',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'img',
    dialog: 'dialog',
  }

  if (tag === 'input') {
    const inputRoles: Record<string, string> = {
      checkbox: 'checkbox',
      radio: 'radio',
      range: 'slider',
      submit: 'button',
      reset: 'button',
      button: 'button',
      search: 'searchbox',
      email: 'textbox',
      tel: 'textbox',
      url: 'textbox',
      number: 'spinbutton',
      text: 'textbox',
      password: 'textbox',
    }
    return inputRoles[type || 'text'] || 'textbox'
  }

  return roleMap[tag] || ''
}

function collectDomElements(): SnapshotElement[] {
  const results: SnapshotElement[] = []
  const seen = new Set<Element>()
  let id = 1

  const selectors = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[tabindex]:not([tabindex="-1"])',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
  ]

  for (const selector of selectors) {
    for (const el of document.querySelectorAll<Element>(selector)) {
      if (seen.has(el)) continue
      seen.add(el)

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue

      const role = el.getAttribute('role') || inferRole(el)
      if (!role) continue

      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('alt') ||
        el.getAttribute('title') ||
        (el as HTMLElement).innerText?.trim().slice(0, 200) ||
        el.getAttribute('value') ||
        ''

      if (!name.trim()) continue

      el.setAttribute('data-wg-id', String(id))
      results.push({
        id: id++,
        role,
        name: name.trim(),
        value: (el as HTMLInputElement).value || undefined,
        frameId: 0,
        frameUrl: window.location.href,
        tagName: el.tagName.toLowerCase(),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      })
    }
  }

  return results
}

/**
 * Resolve an element by its snapshot ID (data-wg-id attribute).
 */
export function resolveElementById(id: number): Element | null {
  return document.querySelector(`[data-wg-id="${id}"]`)
}

/**
 * Clean up snapshot marker attributes from all elements.
 */
export function cleanupSnapshotMarkers(): void {
  for (const el of document.querySelectorAll('[data-wg-id]')) {
    el.removeAttribute('data-wg-id')
  }
}
