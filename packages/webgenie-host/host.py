"""
Native Messaging Host — main entry point.

Protocol:
  Chrome extension → host: 4-byte little-endian length prefix + JSON UTF-8
  Host → Chrome extension: same format

This process is launched by Chrome when the extension requests native messaging.
"""

import json
import struct
import sys
import time
import threading
import logging
from pathlib import Path
from typing import Any

from agent import Agent
from tools import BrowserToolkit

_log_dir = Path.home() / ".webgenie" / "logs"
_log_dir.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[logging.FileHandler(_log_dir / "host.log"), logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger("host")


# ─── Native messaging framing ─────────────────────────────────────────────────

def read_message() -> dict[str, Any] | None:
    """Read one length-prefixed JSON message from stdin."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack("<I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    try:
        return json.loads(data.decode("utf-8"))
    except json.JSONDecodeError:
        return None


def send_message(msg: dict[str, Any]) -> None:
    """Write one length-prefixed JSON message to stdout."""
    data = json.dumps(msg).encode("utf-8")
    length = struct.pack("<I", len(data))
    sys.stdout.buffer.write(length + data)
    sys.stdout.buffer.flush()


# ─── Response helpers ─────────────────────────────────────────────────────────

def make_response(msg_id: str, msg_type: str, payload: Any) -> dict[str, Any]:
    return {"id": msg_id, "type": msg_type, "payload": payload}


def send_agent_update(msg_id: str, update: dict[str, Any]) -> None:
    send_message(make_response(msg_id, "AGENT_RESPONSE", update))


# ─── Host class ───────────────────────────────────────────────────────────────

class NativeHost:
    def __init__(self) -> None:
        self.agent = Agent(send_command=self._send_command_to_extension)
        self._pending_results: dict[str, Any] = {}
        self._result_events: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def _send_command_to_extension(self, cmd_payload: dict[str, Any]) -> None:
        """Called by Agent to dispatch browser commands."""
        send_message({"id": cmd_payload.get("id", ""), "type": "ACTION_COMMAND", "payload": cmd_payload})

    def handle_message(self, msg: dict[str, Any]) -> None:
        msg_id = msg.get("id", "")
        msg_type = msg.get("type", "")
        payload = msg.get("payload", {})

        logger.info("Received: %s (id=%s)", msg_type, msg_id)

        if msg_type == "PING":
            send_message(make_response(msg_id, "PONG", {"time": time.time()}))
            return

        if msg_type == "TASK_START":
            # Run in background thread so we can receive action results while running
            def run_task():
                try:
                    for update in self.agent.run_task(
                        task=payload.get("task", ""),
                        tab_id=payload.get("tabId"),
                        url=payload.get("url", ""),
                        title=payload.get("title", ""),
                    ):
                        send_agent_update(msg_id, update)
                except Exception as exc:
                    logger.exception("Task failed")
                    send_agent_update(msg_id, {"type": "error", "error": str(exc)})

            threading.Thread(target=run_task, daemon=True).start()
            return

        if msg_type == "ACTION_RESULT":
            # Extension responded to a browser command
            result_id = payload.get("id", msg_id)
            with self._lock:
                self._pending_results[result_id] = payload
                ev = self._result_events.get(result_id)
            if ev:
                ev.set()
            return

        logger.warning("Unhandled message type: %s", msg_type)

    def get_action_result(self, cmd_id: str, timeout: float = 30.0) -> dict[str, Any]:
        """Block until the extension sends back a result for the given command ID."""
        ev = threading.Event()
        with self._lock:
            self._result_events[cmd_id] = ev
            # Check if already arrived
            if cmd_id in self._pending_results:
                result = self._pending_results.pop(cmd_id)
                del self._result_events[cmd_id]
                return result

        triggered = ev.wait(timeout)
        with self._lock:
            self._result_events.pop(cmd_id, None)
            result = self._pending_results.pop(cmd_id, None)

        if not triggered or result is None:
            return {"success": False, "error": f"Timed out waiting for result (cmd={cmd_id})"}
        return result

    def run(self) -> None:
        """Main blocking loop."""
        # Give the agent a reference to this host for result retrieval
        self.agent.set_host(self)
        logger.info("WebGenie native host started")

        while True:
            msg = read_message()
            if msg is None:
                logger.info("stdin closed, exiting")
                break
            try:
                self.handle_message(msg)
            except Exception:
                logger.exception("Error handling message")


# ─── Entry point ─────────────────────────────────────────────────────────────

def main() -> None:
    host = NativeHost()
    host.run()


if __name__ == "__main__":
    main()
