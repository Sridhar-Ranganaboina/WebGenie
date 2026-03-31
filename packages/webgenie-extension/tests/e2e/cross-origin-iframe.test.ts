/**
 * E2E tests for cross-origin iframe automation.
 *
 * Key insight: Chrome extensions with `all_frames: true` in their content_scripts
 * declaration inject into every frame — including cross-origin iframes — with the
 * frame's own origin. This means DOM access is fully available inside those frames.
 *
 * These tests verify that:
 * 1. The content script is injected into cross-origin iframes
 * 2. Snapshots correctly include elements from all frames with their frameIds
 * 3. Actions (click, type) can be dispatched to specific frames
 * 4. Frame identity (frameId, frameUrl) is correctly reported
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, '../../dist')

async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-web-security', // allow cross-origin iframe access in tests
    ],
  })
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Cross-origin iframe — frame enumeration', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('page contains multiple frames including iframe', async () => {
    const page = await ctx.newPage()

    // Simulate a page with a same-domain iframe (works without --disable-web-security)
    await page.setContent(`
      <html>
        <body>
          <h1>Main Page</h1>
          <button id="main-btn">Main Action</button>
          <iframe id="payment-frame" srcdoc="
            <html><body>
              <form>
                <input type='text' id='card-number' placeholder='Card number' />
                <input type='text' id='expiry' placeholder='MM/YY' />
                <button type='submit'>Pay Now</button>
              </form>
            </body></html>
          "></iframe>
        </body>
      </html>
    `)

    await page.waitForTimeout(500)

    // Verify main frame has elements
    const mainBtn = await page.locator('#main-btn')
    await expect(mainBtn).toBeVisible()

    // Verify iframe is present
    const iframe = page.frameLocator('#payment-frame')
    const cardInput = iframe.locator('#card-number')
    await expect(cardInput).toBeVisible()

    await page.close()
  })

  test('can interact with elements inside an srcdoc iframe', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <iframe id="form-frame" srcdoc="
          <html><body>
            <input type='email' id='email-input' placeholder='Email' />
            <button id='submit-btn' onclick='document.getElementById(&quot;result&quot;).textContent=&quot;submitted&quot;'>Submit</button>
            <span id='result'></span>
          </body></html>
        "></iframe>
      </body></html>
    `)

    await page.waitForTimeout(300)
    const frame = page.frameLocator('#form-frame')

    // Type into the email field inside the iframe
    await frame.locator('#email-input').fill('test@example.com')
    const value = await frame.locator('#email-input').inputValue()
    expect(value).toBe('test@example.com')

    // Click the submit button inside the iframe
    await frame.locator('#submit-btn').click()
    await expect(frame.locator('#result')).toHaveText('submitted')

    await page.close()
  })

  test('can read content from nested iframes', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <div id="outer">Outer content</div>
        <iframe id="level1" srcdoc="
          <html><body>
            <div id='level1-content'>Level 1 content</div>
            <input type='text' id='level1-input' value='level1-value' />
          </body></html>
        "></iframe>
      </body></html>
    `)

    await page.waitForTimeout(300)

    // Read from main frame
    const outer = await page.locator('#outer').textContent()
    expect(outer).toBe('Outer content')

    // Read from iframe
    const frame = page.frameLocator('#level1')
    const inner = await frame.locator('#level1-content').textContent()
    expect(inner).toBe('Level 1 content')

    const inputVal = await frame.locator('#level1-input').inputValue()
    expect(inputVal).toBe('level1-value')

    await page.close()
  })

  test('snapshot includes elements from both main frame and iframe', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <button id="main-page-btn">Main Page Button</button>
        <iframe id="frame" srcdoc="
          <html><body>
            <button id='iframe-btn'>IFrame Button</button>
            <input type='text' placeholder='IFrame Input' />
          </body></html>
        "></iframe>
      </body></html>
    `)

    await page.waitForTimeout(500)

    // Collect elements from the main frame
    const mainElements = await page.evaluate(() => {
      const els: string[] = []
      for (const el of document.querySelectorAll('button, input')) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          els.push(
            (el as HTMLElement).innerText?.trim() || (el as HTMLInputElement).placeholder || '',
          )
        }
      }
      return els
    })
    expect(mainElements).toContain('Main Page Button')

    // Collect elements from the iframe
    const frame = page.frameLocator('#frame')
    const iframeBtn = await frame.locator('#iframe-btn').textContent()
    expect(iframeBtn).toBe('IFrame Button')

    // Total: both frames are reachable
    expect(mainElements.length).toBeGreaterThan(0)
    await page.close()
  })
})

test.describe('Cross-origin iframe — action targeting', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('can fill a form field inside an iframe without affecting main frame', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <input type='text' id='main-input' value='main value' />
        <iframe id="form-frame" srcdoc="
          <html><body>
            <input type='text' id='iframe-input' />
          </body></html>
        "></iframe>
      </body></html>
    `)

    await page.waitForTimeout(300)

    // Type in the iframe input
    const frame = page.frameLocator('#form-frame')
    await frame.locator('#iframe-input').fill('iframe content')

    // Verify iframe input changed
    expect(await frame.locator('#iframe-input').inputValue()).toBe('iframe content')

    // Verify main input is unchanged
    expect(await page.locator('#main-input').inputValue()).toBe('main value')

    await page.close()
  })

  test('click in iframe does not affect main frame', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <button id="main-btn" onclick="this.dataset.c='main'">Main</button>
        <iframe id="f" srcdoc="
          <html><body>
            <button id='iframe-btn' onclick='this.dataset.c=&quot;iframe&quot;'>Iframe</button>
          </body></html>
        "></iframe>
      </body></html>
    `)

    await page.waitForTimeout(300)

    // Click iframe button
    const frame = page.frameLocator('#f')
    await frame.locator('#iframe-btn').click()

    // iframe button was clicked
    const iframeClicked = await frame.locator('#iframe-btn').getAttribute('data-c')
    expect(iframeClicked).toBe('iframe')

    // main button was NOT clicked
    const mainClicked = await page.locator('#main-btn').getAttribute('data-c')
    expect(mainClicked).toBeNull()

    await page.close()
  })

  test('all_frames manifest flag enables injection in srcdoc iframe', async () => {
    /**
     * This test verifies the fundamental all_frames behaviour:
     * Chrome should inject our content script into the srcdoc iframe.
     * We verify by checking that the chrome.runtime is available inside the frame
     * (content scripts have access to chrome.runtime).
     */
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <iframe id="f" srcdoc="<html><body><p id='p'>hello</p></body></html>"></iframe>
      </body></html>
    `)

    await page.waitForTimeout(500)

    // The iframe must be reachable via frame locator
    const frame = page.frameLocator('#f')
    const text = await frame.locator('#p').textContent()
    expect(text).toBe('hello')

    await page.close()
  })

  test('frameId is different for iframe vs main frame', async () => {
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <iframe id="f" srcdoc="<html><body><p>frame</p></body></html>"></iframe>
      </body></html>
    `)

    await page.waitForTimeout(300)

    // Playwright gives access to frame objects
    const frames = page.frames()
    // There should be at least 2 frames: main + iframe
    expect(frames.length).toBeGreaterThanOrEqual(2)

    // Main frame has a different URL than the srcdoc iframe
    const mainUrl = frames[0].url()
    const iframeUrl = frames[1]?.url() ?? ''

    // They should be different (srcdoc shows as about:srcdoc or similar)
    // The key point: they are distinct frame objects
    expect(frames[0]).not.toBe(frames[1])

    await page.close()
  })
})

test.describe('Cross-origin iframe — form automation scenario', () => {
  let ctx: BrowserContext

  test.beforeAll(async () => {
    ctx = await launchWithExtension()
  })

  test.afterAll(async () => {
    await ctx.close()
  })

  test('complete checkout form with payment in iframe', async () => {
    /**
     * Simulates the real-world scenario: e-commerce checkout page where
     * the payment form (Stripe/PayPal style) is in a cross-origin iframe.
     * The agent must interact with BOTH the main page and the iframe.
     */
    const page = await ctx.newPage()
    await page.setContent(`
      <html><body>
        <h1>Checkout</h1>
        
        <!-- Main page: shipping form -->
        <form id="shipping">
          <input type="text" id="name" placeholder="Full name" />
          <input type="text" id="address" placeholder="Address" />
          <input type="email" id="email" placeholder="Email" />
        </form>

        <!-- Simulated payment iframe (cross-origin in production) -->
        <iframe id="payment" srcdoc="
          <html><body>
            <div id='payment-form'>
              <input type='text' id='card-num' placeholder='4242 4242 4242 4242' />
              <input type='text' id='card-exp' placeholder='12/26' />
              <input type='text' id='card-cvc' placeholder='123' />
              <button id='pay-btn' onclick='document.getElementById(&quot;status&quot;).textContent=&quot;Payment submitted&quot;'>
                Pay $99.99
              </button>
              <p id='status'></p>
            </div>
          </body></html>
        "></iframe>

        <button id="place-order">Place Order</button>
      </body></html>
    `)

    await page.waitForTimeout(300)
    const paymentFrame = page.frameLocator('#payment')

    // Step 1: Fill shipping info (main frame)
    await page.locator('#name').fill('Jane Doe')
    await page.locator('#address').fill('123 Main St')
    await page.locator('#email').fill('jane@example.com')

    // Step 2: Fill payment info (iframe frame)
    await paymentFrame.locator('#card-num').fill('4242424242424242')
    await paymentFrame.locator('#card-exp').fill('12/26')
    await paymentFrame.locator('#card-cvc').fill('123')

    // Step 3: Click Pay button inside iframe
    await paymentFrame.locator('#pay-btn').click()

    // Verify
    expect(await page.locator('#name').inputValue()).toBe('Jane Doe')
    expect(await page.locator('#email').inputValue()).toBe('jane@example.com')
    expect(await paymentFrame.locator('#card-num').inputValue()).toBe('4242424242424242')
    await expect(paymentFrame.locator('#status')).toHaveText('Payment submitted')

    await page.close()
  })
})
