# WebGenie Host

> Native Messaging Host **BRAIN** — LLM agent loop that controls the browser via the WebGenie Chrome Extension.

## Architecture

The host receives tasks from the Chrome extension side panel, runs an LLM agent loop, dispatches browser commands back to the extension, and streams results to the UI.

```
Extension ──stdio──► host.py ──► agent.py ──► llm.py (OpenAI/Anthropic/Ollama)
                         │            │
                         │            └──► tools.py (builds HostCommand dicts)
                         │
                         └──► NativeHost.get_action_result() (blocks until response)
```

## LLM Providers

Set one of these environment variables:

| Provider | Env var |
|----------|---------|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Ollama (local) | `OLLAMA_BASE_URL` (default: `http://localhost:11434/v1`) |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` |

Override model: `OLLAMA_MODEL=mistral`

## Installation

```bash
pip install -e ".[dev]"
python install.py           # installs com.webgenie.host.json manifest
```

After installation, update `allowed_origins` in the manifest with your extension ID.

## Running tests

```bash
pytest                     # all tests
pytest tests/test_tools.py # tool builder tests
pytest tests/test_agent.py # agent loop tests
pytest tests/test_host.py  # native messaging protocol tests
```

## Tools reference

See `tools.py` for the full list of 30+ tools available to the LLM agent.
