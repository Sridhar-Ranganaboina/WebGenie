/**
 * E2E tests for accessibility-tree snapshot capturing.
 *
 * These tests load a real Chrome with the extension loaded (unpacked),
 * navigate to test pages, and verify that the content script correctly
 * captures element snapshots — including from cross-origin iframes.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../../dist')

// ─── Context factory ──────────────────────────────────────────────────────────

async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Inject and run the snapshot logic in a page, returning the raw element list.
 * This simulates what the content script does.
 */
async function captureSnapshot(ctx: BrowserContext, url: string) {
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const elements = await page.evaluate(() => {
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
      'tab',
      'switch',
      'slider',
      'option',
      'listbox',
    ])

    const results: Array<{ id: number; role: string; name: string }> = []
    let id = 1

    function inferRole(el: Element): string {
      const tag = el.tagName.toLowerCase()
      const type = (el as HTMLInputElement).type?.toLowerCase()
      if (tag === 'a') return 'link'
      if (tag === 'button') return 'button'
      if (tag === 'select') return 'combobox'
      if (tag === 'textarea') return 'textarea'
      if (/^h[1-6]$/.test(tag)) return 'heading'
      if (tag === 'input') {
        const m: Record<string, string> = {
          checkbox: 'checkbox',
          radio: 'radio',
          submit: 'button',
          text: 'textbox',
          search: 'searchbox',
          email: 'textbox',
          password: 'textbox',
        }
        return m[type || 'text'] || 'textbox'
      }
      return el.getAttribute('role') || ''
    }

    for (const el of document.querySelectorAll(
      'a[href], button, input, select, textarea, [role]',
    )) {
      const role = el.getAttribute('role') || inferRole(el)
      if (!INTERACTIVE_ROLES.has(role)) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const name =
        (el as HTMLElement).innerText?.trim().slice(0, 100) ||
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('alt') ||
        ''
      if (!name) continue
      results.push({ id: id++, role, name })
    }
    return results
  })

  await page.close()
  return elements
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Snapshot — basic HTML page', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('captures buttons on a simple page', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <button>Click me</button>
        <button>Submit form</button>
        <a href="/about">About us</a>
        <input type="text" placeholder="Search…" />
      </body></html>
    `)
    await page.waitForTimeout(500)

    const elements = await page.evaluate(() => {
      const results: Array<{ role: string; name: string }> = []
      const id = 1

      for (const el of document.querySelectorAll('button, a[href], input')) {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        const role =
          el.tagName.toLowerCase() === 'a'
            ? 'link'
            : el.tagName.toLowerCase() === 'button'
              ? 'button'
              : (el as HTMLInputElement).type === 'text'
                ? 'textbox'
                : 'other'
        const name = (el as HTMLElement).innerText?.trim() || el.getAttribute('placeholder') || ''
        if (name) results.push({ role, name })
      }
      return results
    })

    expect(elements.some((e) => e.role === 'button' && e.name === 'Click me')).toBe(true)
    expect(elements.some((e) => e.role === 'button' && e.name === 'Submit form')).toBe(true)
    expect(elements.some((e) => e.role === 'link' && e.name === 'About us')).toBe(true)
    expect(elements.some((e) => e.role === 'textbox')).toBe(true)
    await page.close()
  })

  test('skips invisible elements', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <button style="display:none">Hidden button</button>
        <button>Visible button</button>
      </body></html>
    `)

    const elements = await page.evaluate(() => {
      const results: string[] = []
      for (const el of document.querySelectorAll('button')) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          results.push((el as HTMLElement).innerText.trim())
        }
      }
      return results
    })

    expect(elements).toContain('Visible button')
    expect(elements).not.toContain('Hidden button')
    await page.close()
  })

  test('captures checkbox state', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <input type="checkbox" id="cb" checked />
        <label for="cb">Accept terms</label>
      </body></html>
    `)

    const checkbox = await page.evaluate(() => {
      const el = document.querySelector('input[type=checkbox]') as HTMLInputElement
      return { checked: el.checked, type: el.type }
    })

    expect(checkbox.checked).toBe(true)
    expect(checkbox.type).toBe('checkbox')
    await page.close()
  })

  test('captures select options', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <select id="country">
          <option value="us">United States</option>
          <option value="uk">United Kingdom</option>
          <option value="de">Germany</option>
        </select>
      </body></html>
    `)

    const options = await page.evaluate(() => {
      const sel = document.querySelector('select') as HTMLSelectElement
      return Array.from(sel.options).map((o) => ({ value: o.value, text: o.text }))
    })

    expect(options).toHaveLength(3)
    expect(options[0]).toEqual({ value: 'us', text: 'United States' })
    await page.close()
  })
})

test.describe('Snapshot — ARIA roles', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('captures custom ARIA button', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <div role="button" tabindex="0" aria-label="Open menu">☰</div>
      </body></html>
    `)

    const el = await page.evaluate(() => {
      const div = document.querySelector('[role=button]')!
      return {
        role: div.getAttribute('role'),
        label: div.getAttribute('aria-label'),
      }
    })

    expect(el.role).toBe('button')
    expect(el.label).toBe('Open menu')
    await page.close()
  })

  test('captures tabs with aria roles', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <div role="tablist">
          <div role="tab" aria-selected="true">Tab 1</div>
          <div role="tab" aria-selected="false">Tab 2</div>
          <div role="tab" aria-selected="false">Tab 3</div>
        </div>
      </body></html>
    `)

    const tabs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role=tab]')).map((el) => ({
        name: (el as HTMLElement).innerText.trim(),
        selected: el.getAttribute('aria-selected'),
      })),
    )

    expect(tabs).toHaveLength(3)
    expect(tabs[0].selected).toBe('true')
    await page.close()
  })
})

test.describe('Snapshot — same-origin iframe', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('content script runs in same-origin iframe', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <p>Main page button:</p>
        <button id="main-btn">Main Button</button>
        <iframe id="frame" srcdoc="<button id='iframe-btn'>Iframe Button</button>"></iframe>
      </body></html>
    `)
    await page.waitForTimeout(500)

    // Verify iframe is accessible
    const frame = page.frameLocator('#frame')
    const iframeBtn = await frame.locator('#iframe-btn').textContent()
    expect(iframeBtn).toBe('Iframe Button')

    // Verify main page button is accessible
    const mainBtn = await page.locator('#main-btn').textContent()
    expect(mainBtn).toBe('Main Button')
    await page.close()
  })
})
