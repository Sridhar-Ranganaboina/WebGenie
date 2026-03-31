/**
 * Side Panel UI logic.
 * Communicates with the background service worker for task submission
 * and agent response streaming.
 */

const messagesEl = document.getElementById('messages') as HTMLDivElement
const inputEl = document.getElementById('task-input') as HTMLTextAreaElement
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement
const statusDot = document.getElementById('status-dot') as HTMLDivElement
const tabsBar = document.getElementById('tabs-bar') as HTMLDivElement

let isRunning = false
let thinkingEl: HTMLDivElement | null = null

// ─── Connection status ────────────────────────────────────────────────────────

function checkConnection(): void {
  chrome.runtime.sendMessage({ kind: 'SIDEPANEL_PING' }, () => {
    if (chrome.runtime.lastError) {
      statusDot.classList.remove('connected')
    } else {
      statusDot.classList.add('connected')
    }
  })
}

setInterval(checkConnection, 3000)
checkConnection()

// ─── Tab bar ──────────────────────────────────────────────────────────────────

function refreshTabs(): void {
  chrome.runtime.sendMessage({ kind: 'SIDEPANEL_GET_TABS' }, (response) => {
    if (chrome.runtime.lastError || !response?.tabs) return
    tabsBar.innerHTML = ''
    for (const tab of response.tabs as Array<{
      tabId: number
      title: string
      url: string
      isActive: boolean
    }>) {
      const chip = document.createElement('div')
      chip.className = 'tab-chip' + (tab.isActive ? ' active' : '')
      chip.title = tab.url
      chip.textContent = tab.title || tab.url
      chip.dataset.tabId = String(tab.tabId)
      tabsBar.appendChild(chip)
    }
  })
}

refreshTabs()
setInterval(refreshTabs, 5000)

// ─── Message rendering ────────────────────────────────────────────────────────

function addMessage(role: 'user' | 'assistant' | 'tool' | 'error', text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `message ${role}`
  el.textContent = text
  messagesEl.appendChild(el)
  el.scrollIntoView({ behavior: 'smooth', block: 'end' })
  return el
}

function showThinking(): void {
  if (thinkingEl) return
  thinkingEl = document.createElement('div')
  thinkingEl.className = 'thinking'
  thinkingEl.innerHTML = '<span></span><span></span><span></span>'
  messagesEl.appendChild(thinkingEl)
  thinkingEl.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

function hideThinking(): void {
  thinkingEl?.remove()
  thinkingEl = null
}

// ─── Agent response handler ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg: { kind: string; payload?: unknown }) => {
  if (msg.kind === 'AGENT_RESPONSE') {
    const payload = msg.payload as {
      type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done'
      content?: string
      tool?: string
      args?: unknown
      result?: unknown
      error?: string
    }

    hideThinking()

    switch (payload.type) {
      case 'text':
        if (payload.content) addMessage('assistant', payload.content)
        break
      case 'tool_call':
        addMessage('tool', `⚙ ${payload.tool}(${JSON.stringify(payload.args)})`)
        showThinking()
        break
      case 'tool_result':
        hideThinking()
        break
      case 'error':
        addMessage('error', `Error: ${payload.error}`)
        isRunning = false
        sendBtn.disabled = false
        break
      case 'done':
        isRunning = false
        sendBtn.disabled = false
        break
    }
  }
})

// ─── Send task ────────────────────────────────────────────────────────────────

function sendTask(): void {
  const text = inputEl.value.trim()
  if (!text || isRunning) return

  addMessage('user', text)
  inputEl.value = ''
  inputEl.style.height = 'auto'
  isRunning = true
  sendBtn.disabled = true
  showThinking()

  // Get active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0]
    chrome.runtime.sendMessage({
      kind: 'SIDEPANEL_TASK',
      payload: {
        task: text,
        tabId: activeTab?.id,
        url: activeTab?.url,
        title: activeTab?.title,
      },
    })
  })
}

sendBtn.addEventListener('click', sendTask)

inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendTask()
  }
})

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto'
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`
})
