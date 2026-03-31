# WebGenie Extension

> Chrome Extension **HANDS** — browser automation via content scripts with full cross-origin iframe support.

## Architecture

```
Chrome Extension (HANDS)                    Native Messaging Host (BRAIN)
┌────────────────────────────────────┐      ┌──────────────────────────────┐
│  Side Panel UI                     │      │  host.py (stdio loop)        │
│  ┌────────────────────────────┐    │      │  agent.py (LLM agent loop)   │
│  │ Chat interface             │    │      │  llm.py (OpenAI/Anthropic/   │
│  └────────────────────────────┘    │      │          Ollama)             │
│                                    │      │  tools.py (53+ tools)        │
│  Background Service Worker         │◄────►│                              │
│  ┌────────────────────────────┐    │      │  Supports:                   │
│  │ NativeBridge               │    │      │  - OpenAI GPT-4o             │
│  │ TabManager                 │    │      │  - Anthropic Claude          │
│  │ ActionExecutor             │    │      │  - Ollama (local)            │
│  └────────────────────────────┘    │      │  - Azure OpenAI              │
│                                    │      └──────────────────────────────┘
│  Content Scripts (all_frames: true)│
│  ┌────────────────────────────┐    │
│  │ content-script.ts          │    │
│  │ snapshot.ts                │    │
│  │ actions.ts                 │    │
│  │                            │    │
│  │ ↑ Injected into:           │    │
│  │   - Main frame             │    │
│  │   - Same-origin iframes    │    │
│  │   - Cross-origin iframes ← │    │
│  └────────────────────────────┘    │
└────────────────────────────────────┘
```

### Why cross-origin iframes work

Chrome extensions are **above** the Same-Origin Policy. With `"all_frames": true` in `content_scripts`, Chrome injects your script into every frame — including `https://payments.stripe.com` embedded in `https://amazon.com`. The script runs in the iframe's own security context, so it has full DOM access. The `frameId` returned by `chrome.webNavigation.getAllFrames` uniquely identifies each frame, and `chrome.tabs.sendMessage(tabId, msg, { frameId })` routes commands to the right frame.

## Features (matching BrowserOS)

| Feature | Tool |
|---------|------|
| Navigation | `navigate`, `navigate_back`, `navigate_forward`, `reload` |
| Tab management | `list_tabs`, `new_tab`, `close_tab`, `activate_tab`, `pin_tab` |
| Snapshot (all frames) | `take_snapshot` |
| Click / hover | `click`, `click_at`, `hover` |
| Type / clear | `type_text`, `clear_field` |
| Keyboard | `press_key` |
| Select | `select_option` |
| Scroll | `scroll`, `scroll_to_element` |
| Screenshot | `take_screenshot` |
| Page content | `get_page_content`, `get_page_links` |
| JavaScript eval | `evaluate` |
| Wait conditions | `wait_for` |
| Find element | `find_element` |
| History | `get_history` |
| Bookmarks | `get_bookmarks`, `add_bookmark` |
| Console logs | `get_console_logs` |
| Memory | `memory_read`, `memory_write`, `memory_search` |
| Windows | `list_windows` |
| Tab groups | `create_tab_group` |

## Setup

### 1. Install the extension

```bash
cd packages/webgenie-extension
npm install
npm run build        # compiles TypeScript + copies assets to dist/
```

Load in Chrome:
1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `packages/webgenie-extension/dist`
4. Note the **Extension ID** shown in the card

### 2. Install the native host

```bash
cd packages/webgenie-host
pip install -e ".[dev]"

# Set your LLM API key
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, or use Ollama (no key needed)

# Install host manifest
python install.py
```

Then edit the installed `com.webgenie.host.json` and replace `YOUR_EXTENSION_ID_HERE` with your real extension ID.

### 3. Run

1. Open Chrome with the extension loaded
2. Click the WebGenie icon in the toolbar → the side panel opens
3. Type a task: *"Go to github.com and find the trending repos"*
4. Watch the agent work

## Development

```bash
# Watch mode (TypeScript)
npm run build:watch

# Lint
npm run lint

# Unit tests (no browser)
npm test

# E2E tests (requires Chrome)
npm run test:e2e
```

## Testing

```bash
# Python host tests
cd packages/webgenie-host
pip install -e ".[dev]"
pytest                    # unit + integration tests

# Extension E2E tests
cd packages/webgenie-extension
npm run test:e2e          # Playwright tests against real Chrome
```
