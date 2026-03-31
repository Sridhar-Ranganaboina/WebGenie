"""
Browser tool definitions for the LLM agent.
Each tool maps to a HostCommand that the background service worker handles.
"""

from __future__ import annotations

import json
from typing import Any

# ─── Tool schema definitions (OpenAI function-calling format) ─────────────────

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "navigate",
            "description": "Navigate the active browser tab to a URL",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full URL including https://"},
                    "tab_id": {"type": "integer", "description": "Tab ID (optional, uses active tab if omitted)"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate_back",
            "description": "Go back in browser history",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "navigate_forward",
            "description": "Go forward in browser history",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reload",
            "description": "Reload the current page",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "new_tab",
            "description": "Open a new browser tab, optionally with a URL",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "close_tab",
            "description": "Close a browser tab",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": ["tab_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_tabs",
            "description": "List all open browser tabs",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take_snapshot",
            "description": (
                "Get an accessibility-tree snapshot of all elements on the active page "
                "including cross-origin iframes. Returns element IDs you can use with click, type, etc."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "click",
            "description": "Click an element by its snapshot ID",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer", "description": "ID from snapshot (the number in [N])"},
                    "frame_id": {"type": "integer", "description": "Frame ID if element is in an iframe"},
                    "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                    "click_count": {"type": "integer", "default": 1},
                },
                "required": ["element_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "click_at",
            "description": "Click at specific page coordinates",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
                },
                "required": ["x", "y"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "hover",
            "description": "Hover over an element",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer"},
                    "frame_id": {"type": "integer"},
                },
                "required": ["element_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Type text into a focused input or text field",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer"},
                    "frame_id": {"type": "integer"},
                    "text": {"type": "string"},
                    "append": {"type": "boolean", "default": False, "description": "Append to existing value instead of replacing"},
                },
                "required": ["element_id", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "clear_field",
            "description": "Clear the contents of an input field",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer"},
                    "frame_id": {"type": "integer"},
                },
                "required": ["element_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "press_key",
            "description": "Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown)",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "key": {"type": "string", "description": "Key name like Enter, Tab, Escape, ArrowDown, etc."},
                    "modifiers": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["ctrl", "shift", "alt", "meta"]},
                        "description": "Modifier keys to hold",
                    },
                    "frame_id": {"type": "integer"},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "select_option",
            "description": "Select an option from a <select> dropdown",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer"},
                    "frame_id": {"type": "integer"},
                    "value": {"type": "string", "description": "Option value or label text"},
                },
                "required": ["element_id", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scroll",
            "description": "Scroll the page or a specific element",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                    "amount": {"type": "integer", "default": 300, "description": "Pixels to scroll"},
                    "element_id": {"type": "integer", "description": "Element to scroll (default: page)"},
                    "frame_id": {"type": "integer"},
                },
                "required": ["direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scroll_to_element",
            "description": "Scroll an element into view",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "element_id": {"type": "integer"},
                    "frame_id": {"type": "integer"},
                },
                "required": ["element_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "take_screenshot",
            "description": "Take a screenshot of the current tab",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "format": {"type": "string", "enum": ["png", "jpeg"], "default": "png"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_page_content",
            "description": "Extract the page content as clean markdown text",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "selector": {"type": "string", "description": "CSS selector to scope extraction (e.g. 'main', 'article')"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_page_links",
            "description": "Extract all links from the current page",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "evaluate",
            "description": "Execute JavaScript in the page context and return the result",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "expression": {"type": "string", "description": "JavaScript to evaluate"},
                    "frame_id": {"type": "integer", "description": "Target specific frame"},
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "wait_for",
            "description": "Wait until a condition is met on the page",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "condition_type": {
                        "type": "string",
                        "enum": ["url_contains", "title_contains", "element_visible", "element_gone", "text_visible", "network_idle", "delay"],
                    },
                    "text": {"type": "string", "description": "Text to look for (url_contains, title_contains, text_visible)"},
                    "selector": {"type": "string", "description": "CSS selector (element_visible, element_gone)"},
                    "ms": {"type": "integer", "description": "Milliseconds to wait (delay)"},
                    "timeout_ms": {"type": "integer", "default": 15000},
                },
                "required": ["condition_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_element",
            "description": "Find an element by CSS selector",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "selector": {"type": "string"},
                    "frame_id": {"type": "integer"},
                },
                "required": ["selector"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_history",
            "description": "Get browser navigation history",
            "parameters": {
                "type": "object",
                "properties": {
                    "max_results": {"type": "integer", "default": 20},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_bookmarks",
            "description": "Get or search browser bookmarks",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query (optional)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_bookmark",
            "description": "Add a bookmark",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                },
                "required": ["title", "url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_console_logs",
            "description": "Get JavaScript console logs from the current page",
            "parameters": {
                "type": "object",
                "properties": {
                    "tab_id": {"type": "integer"},
                    "clear": {"type": "boolean", "default": False},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_write",
            "description": "Save a piece of information to persistent memory",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Memory key/name"},
                    "value": {"type": "string", "description": "Content to remember"},
                },
                "required": ["key", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_read",
            "description": "Read a stored memory by key",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"},
                },
                "required": ["key"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_search",
            "description": "Search all stored memories",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_windows",
            "description": "List all browser windows and their tabs",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


class BrowserToolkit:
    """Converts LLM tool-call arguments into HostCommand dicts."""

    def __init__(self, default_tab_id: int | None = None) -> None:
        self.default_tab_id = default_tab_id

    def set_default_tab(self, tab_id: int) -> None:
        self.default_tab_id = tab_id

    def _tab(self, args: dict[str, Any]) -> int:
        return args.get("tab_id") or self.default_tab_id or 0

    def build_command(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Build a HostCommand payload from a tool call."""
        tab_id = self._tab(args)

        match tool_name:
            case "navigate":
                return {"cmd": "navigate", "tabId": tab_id, "url": args["url"]}
            case "navigate_back":
                return {"cmd": "navigate_back", "tabId": tab_id}
            case "navigate_forward":
                return {"cmd": "navigate_forward", "tabId": tab_id}
            case "reload":
                return {"cmd": "reload", "tabId": tab_id}
            case "new_tab":
                return {"cmd": "new_tab", "url": args.get("url")}
            case "close_tab":
                return {"cmd": "close_tab", "tabId": args["tab_id"]}
            case "list_tabs":
                return {"cmd": "list_tabs"}
            case "take_snapshot":
                return {"cmd": "get_snapshot", "tabId": tab_id}
            case "click":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {
                        "type": "click",
                        "elementId": args["element_id"],
                        "button": args.get("button", "left"),
                        "clickCount": args.get("click_count", 1),
                    },
                }
            case "click_at":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "action": {"type": "click_at", "x": args["x"], "y": args["y"], "button": args.get("button", "left")},
                }
            case "hover":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {"type": "hover", "elementId": args["element_id"]},
                }
            case "type_text":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {
                        "type": "type",
                        "elementId": args["element_id"],
                        "text": args["text"],
                        "append": args.get("append", False),
                    },
                }
            case "clear_field":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {"type": "clear", "elementId": args["element_id"]},
                }
            case "press_key":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {
                        "type": "press_key",
                        "key": args["key"],
                        "modifiers": args.get("modifiers", []),
                    },
                }
            case "select_option":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {"type": "select_option", "elementId": args["element_id"], "value": args["value"]},
                }
            case "scroll":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {
                        "type": "scroll",
                        "direction": args["direction"],
                        "amount": args.get("amount", 300),
                        "elementId": args.get("element_id"),
                    },
                }
            case "scroll_to_element":
                return {
                    "cmd": "execute_action",
                    "tabId": tab_id,
                    "frameId": args.get("frame_id"),
                    "action": {"type": "scroll_to_element", "elementId": args["element_id"]},
                }
            case "take_screenshot":
                return {"cmd": "get_screenshot", "tabId": tab_id, "format": args.get("format", "png")}
            case "get_page_content":
                return {"cmd": "get_page_content", "tabId": tab_id, "selector": args.get("selector")}
            case "get_page_links":
                return {"cmd": "get_page_links", "tabId": tab_id}
            case "evaluate":
                return {"cmd": "evaluate", "tabId": tab_id, "expression": args["expression"], "frameId": args.get("frame_id")}
            case "wait_for":
                ctype = args["condition_type"]
                condition: dict[str, Any] = {"type": ctype}
                if ctype in ("url_contains", "title_contains", "text_visible"):
                    condition["text"] = args.get("text", "")
                elif ctype in ("element_visible", "element_gone"):
                    condition["selector"] = args.get("selector", "")
                elif ctype == "delay":
                    condition["ms"] = args.get("ms", 1000)
                return {"cmd": "wait_for", "tabId": tab_id, "condition": condition, "timeoutMs": args.get("timeout_ms", 15000)}
            case "find_element":
                return {"cmd": "find_element", "tabId": tab_id, "selector": args["selector"], "frameId": args.get("frame_id")}
            case "get_history":
                return {"cmd": "get_history", "maxResults": args.get("max_results", 20)}
            case "get_bookmarks":
                return {"cmd": "get_bookmarks", "query": args.get("query")}
            case "add_bookmark":
                return {"cmd": "add_bookmark", "title": args["title"], "url": args["url"]}
            case "get_console_logs":
                return {"cmd": "get_console_logs", "tabId": tab_id, "clear": args.get("clear", False)}
            case "memory_write":
                return {"cmd": "memory_write", "key": args["key"], "value": args["value"]}
            case "memory_read":
                return {"cmd": "memory_read", "key": args["key"]}
            case "memory_search":
                return {"cmd": "memory_search", "query": args["query"]}
            case "list_windows":
                return {"cmd": "list_windows"}
            case _:
                raise ValueError(f"Unknown tool: {tool_name}")
