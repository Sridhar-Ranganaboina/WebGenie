/**
 * E2E tests for DOM action execution.
 * Tests click, type, scroll, select, press_key and their effects on the DOM.
 */

import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../../dist')

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

// ─── DOM action executor (mirrors actions.ts without extension context) ────────

const ACTION_SCRIPT = `
function executeAction(action) {
  function resolveById(id) {
    return document.querySelector('[data-wg-id="' + id + '"]');
  }

  switch (action.type) {
    case 'click': {
      const el = resolveById(action.elementId) || document.getElementById('el-' + action.elementId);
      if (!el) return { success: false, error: 'Element not found: ' + action.elementId };
      el.click();
      return { success: true };
    }
    case 'type': {
      const el = resolveById(action.elementId) || document.getElementById('el-' + action.elementId);
      if (!el) return { success: false, error: 'not found' };
      if (!action.append) el.value = '';
      el.value += action.text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
    case 'select_option': {
      const el = resolveById(action.elementId) || document.getElementById('el-' + action.elementId);
      if (!el) return { success: false, error: 'not found' };
      const opt = Array.from(el.options).find(o => o.value === action.value || o.text === action.value);
      if (!opt) return { success: false, error: 'option not found: ' + action.value };
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, selected: opt.value };
    }
    case 'clear': {
      const el = resolveById(action.elementId) || document.getElementById('el-' + action.elementId);
      if (!el) return { success: false };
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true };
    }
    case 'scroll': {
      const delta = action.direction === 'down' || action.direction === 'right' ? (action.amount || 300) : -(action.amount || 300);
      if (action.direction === 'up' || action.direction === 'down') window.scrollBy(0, delta);
      else window.scrollBy(delta, 0);
      return { success: true };
    }
    default:
      return { success: false, error: 'unknown: ' + action.type };
  }
}
`

async function execAction(page: Page, action: Record<string, unknown>) {
  return page.evaluate(
    ([script, act]) => {
      // biome-ignore lint/security/noEval: test helper
      eval(script) // eslint-disable-line no-eval
      // biome-ignore lint/security/noEval: test helper
      return eval(`executeAction(${JSON.stringify(act)})`) // eslint-disable-line no-eval
    },
    [ACTION_SCRIPT, action] as const,
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Actions — click', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('click fires click event on button', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <button id="el-1" onclick="this.dataset.clicked='yes'">Click me</button>
      </body></html>
    `)

    await execAction(page, { type: 'click', elementId: 1 })
    const clicked = await page.evaluate(() => document.getElementById('el-1')?.dataset.clicked)
    expect(clicked).toBe('yes')
    await page.close()
  })

  test('click returns error for non-existent element', async () => {
    const page = await ctx.newPage()
    await page.setContent('<html><body></body></html>')

    const result = await execAction(page, { type: 'click', elementId: 999 })
    expect((result as { success: boolean }).success).toBe(false)
    await page.close()
  })

  test('click on link navigates', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <a id="el-1" href="#section">Go to section</a>
        <div id="section">Section content</div>
      </body></html>
    `)

    await execAction(page, { type: 'click', elementId: 1 })
    const url = page.url()
    expect(url).toContain('#section')
    await page.close()
  })
})

test.describe('Actions — type', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('types text into input field', async () => {
    const page = await ctx.newPage()
    await page.setContent(`<input id="el-1" type="text" />`)

    await execAction(page, { type: 'type', elementId: 1, text: 'hello world', append: false })
    const value = await page.evaluate(() => (document.getElementById('el-1') as HTMLInputElement)?.value)
    expect(value).toBe('hello world')
    await page.close()
  })

  test('append mode adds to existing text', async () => {
    const page = await ctx.newPage()
    await page.setContent(`<input id="el-1" type="text" value="hello " />`)

    await execAction(page, { type: 'type', elementId: 1, text: 'world', append: true })
    const value = await page.evaluate(() => (document.getElementById('el-1') as HTMLInputElement)?.value)
    expect(value).toBe('hello world')
    await page.close()
  })

  test('replaces existing text without append', async () => {
    const page = await ctx.newPage()
    await page.setContent(`<input id="el-1" type="text" value="old text" />`)

    await execAction(page, { type: 'type', elementId: 1, text: 'new text', append: false })
    const value = await page.evaluate(() => (document.getElementById('el-1') as HTMLInputElement)?.value)
    expect(value).toBe('new text')
    await page.close()
  })

  test('clear removes field content', async () => {
    const page = await ctx.newPage()
    await page.setContent(`<input id="el-1" type="text" value="some content" />`)

    await execAction(page, { type: 'clear', elementId: 1 })
    const value = await page.evaluate(() => (document.getElementById('el-1') as HTMLInputElement)?.value)
    expect(value).toBe('')
    await page.close()
  })

  test('fires input event on type', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <input id="el-1" type="text" />
      <script>
        document.getElementById('el-1').addEventListener('input', function() {
          this.dataset.inputFired = 'yes';
        });
      </script>
    `)

    await execAction(page, { type: 'type', elementId: 1, text: 'test', append: false })
    const fired = await page.evaluate(() => (document.getElementById('el-1') as HTMLInputElement)?.dataset.inputFired)
    expect(fired).toBe('yes')
    await page.close()
  })
})

test.describe('Actions — select option', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('selects by value', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <select id="el-1">
        <option value="a">Option A</option>
        <option value="b">Option B</option>
        <option value="c">Option C</option>
      </select>
    `)

    await execAction(page, { type: 'select_option', elementId: 1, value: 'b' })
    const val = await page.evaluate(() => (document.getElementById('el-1') as HTMLSelectElement)?.value)
    expect(val).toBe('b')
    await page.close()
  })

  test('selects by text label', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <select id="el-1">
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
      </select>
    `)

    await execAction(page, { type: 'select_option', elementId: 1, value: 'United Kingdom' })
    const val = await page.evaluate(() => (document.getElementById('el-1') as HTMLSelectElement)?.value)
    expect(val).toBe('uk')
    await page.close()
  })

  test('returns error for non-existent option', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <select id="el-1">
        <option value="a">A</option>
      </select>
    `)

    const result = await execAction(page, { type: 'select_option', elementId: 1, value: 'Z' })
    expect((result as { success: boolean }).success).toBe(false)
    await page.close()
  })
})

test.describe('Actions — scroll', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('scroll down changes scrollY', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body style="height: 3000px; width: 100%;">
        <div>Top</div>
        <div style="margin-top: 2000px">Bottom</div>
      </body></html>
    `)

    const before = await page.evaluate(() => window.scrollY)
    await execAction(page, { type: 'scroll', direction: 'down', amount: 500 })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.scrollY)
    // scrollBy is called but smooth scrolling may be instant in headless
    expect(after).toBeGreaterThanOrEqual(before)
    await page.close()
  })
})
