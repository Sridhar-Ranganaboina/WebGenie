"""
Agent loop — orchestrates LLM reasoning + browser tool calls.

Architecture:
  1. User sends a task via the side panel
  2. Agent builds a prompt with the current page snapshot
  3. LLM responds with text and/or tool calls
  4. Tool calls are dispatched to the browser extension via the native host
  5. Results are fed back into the conversation
  6. Loop continues until LLM says "stop" or max iterations is reached
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Generator
from typing import Any, TYPE_CHECKING

from llm import LLMClient
from tools import TOOLS, BrowserToolkit

if TYPE_CHECKING:
    from host import NativeHost

logger = logging.getLogger("agent")

SYSTEM_PROMPT = """\
You are WebGenie — an AI browser automation agent.

You have access to tools that control a real web browser. You can:
- Navigate to URLs, go back/forward, reload pages
- Take snapshots of page elements (including cross-origin iframes)
- Click, type, hover, scroll, select options
- Execute JavaScript in any frame
- Take screenshots
- Read page content and links
- Manage tabs, windows, bookmarks, and history
- Store and recall information in memory

# Guidelines
- Always call `take_snapshot` before interacting with a page to see current elements
- Element IDs in snapshots look like [42] — use that number for click/type/etc.
- For elements inside iframes, the snapshot includes the frame_id — pass it to actions
- If an action fails, try a different approach (scroll to element, use coordinates, etc.)
- Be concise. Report what you did, not what you are about to do.
- If a task is complete, say so clearly and stop calling tools.
- Max 30 steps per task.
"""

MAX_STEPS = 30


class Agent:
    def __init__(self, send_command: Any) -> None:
        self.llm = LLMClient()
        self.toolkit = BrowserToolkit()
        self._send_command = send_command
        self._host: "NativeHost | None" = None
        self._cmd_counter = 0
        self._counter_lock = threading.Lock()

    def set_host(self, host: "NativeHost") -> None:
        self._host = host

    def _next_cmd_id(self) -> str:
        with self._counter_lock:
            self._cmd_counter += 1
            return f"cmd-{self._cmd_counter}"

    def _dispatch(self, cmd: dict[str, Any]) -> dict[str, Any]:
        """Send a command to the extension and wait for the result."""
        if self._host is None:
            raise RuntimeError("Host not set — call set_host() before running tasks")
        cmd_id = self._next_cmd_id()
        cmd["id"] = cmd_id
        self._send_command(cmd)
        return self._host.get_action_result(cmd_id, timeout=30.0)

    def run_task(
        self,
        task: str,
        tab_id: int | None = None,
        url: str = "",
        title: str = "",
    ) -> Generator[dict[str, Any], None, None]:
        """
        Run an agent task. Yields streamed update dicts:
          {"type": "text", "content": "..."}
          {"type": "tool_call", "tool": "...", "args": {...}}
          {"type": "tool_result", "tool": "...", "result": {...}}
          {"type": "error", "error": "..."}
          {"type": "done"}
        """
        logger.info("Starting task: %s (tab=%s url=%s)", task[:80], tab_id, url)

        if tab_id:
            self.toolkit.set_default_tab(tab_id)

        # Build initial context
        context = f"Current page: {title or url or 'unknown'}"
        if url:
            context += f"\nURL: {url}"

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{context}\n\nTask: {task}"},
        ]

        steps = 0
        while steps < MAX_STEPS:
            steps += 1
            logger.info("Step %d/%d", steps, MAX_STEPS)

            try:
                response = self.llm.chat(messages, tools=TOOLS)
            except Exception as exc:
                logger.exception("LLM call failed")
                yield {"type": "error", "error": f"LLM error: {exc}"}
                return

            finish = self.llm.finish_reason(response)
            tool_calls = self.llm.extract_tool_calls(response)
            text = self.llm.extract_text(response)

            if text:
                yield {"type": "text", "content": text}

            # Add assistant message to history
            choice = response.get("choices", [{}])[0]
            messages.append(choice.get("message", {"role": "assistant", "content": text}))

            if finish == "stop" or (not tool_calls):
                yield {"type": "done"}
                return

            # Execute all tool calls
            for tc in tool_calls:
                fn = tc.get("function", {})
                tool_name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}

                yield {"type": "tool_call", "tool": tool_name, "args": args}
                logger.info("Tool call: %s(%s)", tool_name, json.dumps(args)[:200])

                try:
                    cmd = self.toolkit.build_command(tool_name, args)
                    result = self._dispatch(cmd)
                except Exception as exc:
                    result = {"success": False, "error": str(exc)}
                    logger.exception("Tool %s failed", tool_name)

                logger.info("Tool result: %s", json.dumps(result)[:300])
                yield {"type": "tool_result", "tool": tool_name, "result": result}

                # Add tool result to conversation
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "content": json.dumps(result),
                })

        # Max steps reached
        yield {"type": "text", "content": f"Reached maximum steps ({MAX_STEPS}). Task may be incomplete."}
        yield {"type": "done"}
