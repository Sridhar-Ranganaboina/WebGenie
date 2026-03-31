"""
Tests for the native messaging protocol (read/write framing) and
NativeHost message dispatch.
"""

from __future__ import annotations

import io
import json
import struct
import threading
from typing import Any
from unittest.mock import MagicMock, patch, call

import pytest


# ─── Framing helpers (mirrors host.py) ───────────────────────────────────────

def encode_message(msg: dict[str, Any]) -> bytes:
    data = json.dumps(msg).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def decode_message(stream: io.BytesIO) -> dict[str, Any] | None:
    raw = stream.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack("<I", raw)[0]
    data = stream.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode("utf-8"))


# ─── Tests for message framing ────────────────────────────────────────────────

class TestMessageFraming:
    def test_encode_decode_roundtrip(self):
        original = {"id": "abc-123", "type": "PING", "payload": {"time": 1234567890}}
        encoded = encode_message(original)
        decoded = decode_message(io.BytesIO(encoded))
        assert decoded == original

    def test_empty_payload(self):
        msg = {"id": "x", "type": "PONG", "payload": {}}
        encoded = encode_message(msg)
        decoded = decode_message(io.BytesIO(encoded))
        assert decoded == msg

    def test_large_payload(self):
        large = {"id": "big", "type": "PAGE_STATE", "payload": {"data": "x" * 50_000}}
        encoded = encode_message(large)
        decoded = decode_message(io.BytesIO(encoded))
        assert decoded["payload"]["data"] == "x" * 50_000

    def test_unicode_content(self):
        msg = {"id": "u", "type": "TASK_START", "payload": {"task": "こんにちは 🌍"}}
        encoded = encode_message(msg)
        decoded = decode_message(io.BytesIO(encoded))
        assert decoded["payload"]["task"] == "こんにちは 🌍"

    def test_length_prefix_is_little_endian(self):
        msg = {"id": "le", "type": "PING", "payload": {}}
        encoded = encode_message(msg)
        data_len = len(json.dumps(msg).encode("utf-8"))
        # First 4 bytes should be little-endian length
        assert struct.unpack("<I", encoded[:4])[0] == data_len

    def test_empty_stream_returns_none(self):
        result = decode_message(io.BytesIO(b""))
        assert result is None

    def test_truncated_stream_returns_none(self):
        result = decode_message(io.BytesIO(b"\x05\x00\x00\x00"))  # says 5 bytes but has 0
        assert result is None


# ─── Tests for NativeHost dispatch ────────────────────────────────────────────

class TestNativeHostPing:
    def test_ping_sends_pong(self):
        """PING message must be answered with PONG immediately."""
        from host import NativeHost

        sent: list[dict] = []

        with patch("host.send_message", side_effect=lambda m: sent.append(m)):
            host = NativeHost()
            host.handle_message({"id": "ping-1", "type": "PING", "payload": {}})

        assert any(m["type"] == "PONG" for m in sent), f"No PONG in: {sent}"

    def test_pong_preserves_original_id(self):
        from host import NativeHost

        sent: list[dict] = []

        with patch("host.send_message", side_effect=lambda m: sent.append(m)):
            host = NativeHost()
            host.handle_message({"id": "ping-xyz", "type": "PING", "payload": {}})

        pong = next(m for m in sent if m["type"] == "PONG")
        assert pong["id"] == "ping-xyz"


class TestNativeHostActionResult:
    def test_action_result_unblocks_waiting_thread(self):
        from host import NativeHost

        host = NativeHost()
        result_holder: list[dict] = []

        def waiter():
            result = host.get_action_result("cmd-42", timeout=2.0)
            result_holder.append(result)

        t = threading.Thread(target=waiter)
        t.start()

        # Simulate extension sending back a result
        import time
        time.sleep(0.1)
        host.handle_message({
            "id": "ignored",
            "type": "ACTION_RESULT",
            "payload": {"id": "cmd-42", "success": True, "data": "ok"},
        })

        t.join(timeout=3.0)
        assert not t.is_alive(), "Thread should have unblocked"
        assert result_holder[0]["success"] is True

    def test_action_result_timeout_returns_error(self):
        from host import NativeHost

        host = NativeHost()
        result = host.get_action_result("cmd-never", timeout=0.1)
        assert result["success"] is False
        assert "Timed out" in result["error"]

    def test_multiple_pending_results_resolved_correctly(self):
        """Two commands waiting simultaneously must get their own results."""
        from host import NativeHost

        host = NativeHost()
        results: dict[str, dict] = {}
        barrier = threading.Barrier(3)  # 2 waiters + main

        def wait_for(cmd_id: str):
            barrier.wait()
            r = host.get_action_result(cmd_id, timeout=3.0)
            results[cmd_id] = r

        t1 = threading.Thread(target=wait_for, args=("cmd-A",))
        t2 = threading.Thread(target=wait_for, args=("cmd-B",))
        t1.start()
        t2.start()
        barrier.wait()

        import time
        time.sleep(0.05)

        host.handle_message({"id": "x", "type": "ACTION_RESULT", "payload": {"id": "cmd-B", "success": True, "val": 2}})
        host.handle_message({"id": "x", "type": "ACTION_RESULT", "payload": {"id": "cmd-A", "success": True, "val": 1}})

        t1.join(3.0)
        t2.join(3.0)

        assert results["cmd-A"]["val"] == 1
        assert results["cmd-B"]["val"] == 2


class TestNativeHostTaskStart:
    def test_task_start_runs_agent_in_background(self):
        """TASK_START must not block the message loop."""
        from host import NativeHost

        host = NativeHost()

        task_started = threading.Event()
        task_completed = threading.Event()
        agent_updates: list[dict] = []

        def fake_run_task(**kwargs):
            task_started.set()
            yield {"type": "text", "content": "Working…"}
            yield {"type": "done"}
            task_completed.set()

        sent: list[dict] = []

        with patch("host.send_message", side_effect=lambda m: sent.append(m)), \
             patch.object(host.agent, "run_task", side_effect=fake_run_task):
            # This should return immediately (non-blocking)
            start_time = __import__("time").time()
            host.handle_message({
                "id": "task-1",
                "type": "TASK_START",
                "payload": {"task": "Go to Google", "tabId": 1, "url": "about:blank", "title": ""},
            })
            elapsed = __import__("time").time() - start_time

        assert elapsed < 0.5, f"handle_message blocked for {elapsed:.2f}s"
        assert task_started.wait(timeout=2.0), "Agent task never started"
        assert task_completed.wait(timeout=5.0), "Agent task never completed"

    def test_task_start_forwards_agent_updates(self):
        from host import NativeHost

        host = NativeHost()
        sent: list[dict] = []
        done = threading.Event()

        def fake_run_task(**kwargs):
            yield {"type": "text", "content": "Hello"}
            yield {"type": "done"}
            done.set()

        with patch("host.send_message", side_effect=lambda m: sent.append(m)), \
             patch.object(host.agent, "run_task", side_effect=fake_run_task):
            host.handle_message({
                "id": "task-2",
                "type": "TASK_START",
                "payload": {"task": "test", "tabId": 1, "url": "", "title": ""},
            })

        assert done.wait(timeout=3.0)
        agent_responses = [m for m in sent if m.get("type") == "AGENT_RESPONSE"]
        assert len(agent_responses) >= 1
        payloads = [r["payload"] for r in agent_responses]
        assert any(p["type"] == "text" for p in payloads)
        assert any(p["type"] == "done" for p in payloads)
