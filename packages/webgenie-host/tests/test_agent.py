"""
Tests for the agent loop — covers tool dispatch, LLM interaction,
and result feeding.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from agent import Agent, SYSTEM_PROMPT, MAX_STEPS
from tools import BrowserToolkit


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_llm_text_response(text: str) -> dict[str, Any]:
    return {
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ]
    }


def make_llm_tool_response(tool_name: str, args: dict[str, Any], call_id: str = "call_1") -> dict[str, Any]:
    return {
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": json.dumps(args),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
    }


def make_mock_host(results: dict[str, Any] | None = None) -> MagicMock:
    """Create a mock NativeHost that returns preset results."""
    host = MagicMock()
    host.get_action_result.return_value = results or {"success": True}
    return host


def collect_updates(agent: Agent, task: str, tab_id: int = 1) -> list[dict[str, Any]]:
    return list(agent.run_task(task=task, tab_id=tab_id, url="https://example.com", title="Example"))


# ─── Tests ────────────────────────────────────────────────────────────────────

class TestAgentSimpleTask:
    def test_text_only_response_yields_text_and_done(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host())

        with patch.object(agent.llm, "chat", return_value=make_llm_text_response("Task complete!")):
            updates = collect_updates(agent, "What is the current page?")

        types = [u["type"] for u in updates]
        assert "text" in types
        assert "done" in types
        text_updates = [u for u in updates if u["type"] == "text"]
        assert text_updates[0]["content"] == "Task complete!"

    def test_done_always_emitted(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host())

        with patch.object(agent.llm, "chat", return_value=make_llm_text_response("Done")):
            updates = collect_updates(agent, "Simple task")

        assert updates[-1]["type"] == "done"

    def test_system_prompt_included_in_messages(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host())

        captured: list[list[dict]] = []

        def capture_chat(messages, tools=None, stream=False):
            captured.append(messages)
            return make_llm_text_response("ok")

        with patch.object(agent.llm, "chat", side_effect=capture_chat):
            collect_updates(agent, "test")

        assert captured[0][0]["role"] == "system"
        assert SYSTEM_PROMPT in captured[0][0]["content"]

    def test_task_and_url_in_user_message(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host())

        captured: list[list[dict]] = []

        def capture_chat(messages, tools=None, stream=False):
            captured.append(messages)
            return make_llm_text_response("ok")

        with patch.object(agent.llm, "chat", side_effect=capture_chat):
            list(agent.run_task(task="Click the button", tab_id=1, url="https://test.com", title="Test"))

        user_msg = captured[0][1]["content"]
        assert "Click the button" in user_msg
        assert "https://test.com" in user_msg


class TestAgentToolCalls:
    def test_single_tool_call_dispatched(self):
        sent_commands: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent_commands.append(cmd))
        agent.set_host(make_mock_host({"success": True, "snapshot": {}}))

        responses = [
            make_llm_tool_response("take_snapshot", {}),
            make_llm_text_response("Snapshot taken"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            updates = collect_updates(agent, "Take a snapshot")

        tool_updates = [u for u in updates if u["type"] == "tool_call"]
        assert len(tool_updates) == 1
        assert tool_updates[0]["tool"] == "take_snapshot"
        assert len(sent_commands) == 1
        assert sent_commands[0]["cmd"] == "get_snapshot"

    def test_tool_result_added_to_messages(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host({"success": True, "tabs": []}))

        captured_messages: list[list[dict]] = []

        def capture_chat(messages, tools=None, stream=False):
            captured_messages.append(list(messages))
            if len(captured_messages) == 1:
                return make_llm_tool_response("list_tabs", {})
            return make_llm_text_response("Done")

        with patch.object(agent.llm, "chat", side_effect=capture_chat):
            collect_updates(agent, "List all tabs")

        # Second call should include tool result
        second_call_messages = captured_messages[1]
        roles = [m["role"] for m in second_call_messages]
        assert "tool" in roles

    def test_navigate_tool_sends_correct_command(self):
        sent: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent.append(cmd))
        agent.set_host(make_mock_host({"success": True, "url": "https://github.com"}))

        responses = [
            make_llm_tool_response("navigate", {"url": "https://github.com", "tab_id": 5}),
            make_llm_text_response("Navigated"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            collect_updates(agent, "Go to GitHub", tab_id=5)

        assert sent[0]["cmd"] == "navigate"
        assert sent[0]["url"] == "https://github.com"
        assert sent[0]["tabId"] == 5

    def test_click_tool_includes_element_id(self):
        sent: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent.append(cmd))
        agent.set_host(make_mock_host({"success": True}))

        responses = [
            make_llm_tool_response("click", {"element_id": 42, "tab_id": 1}),
            make_llm_text_response("Clicked"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            collect_updates(agent, "Click button", tab_id=1)

        cmd = sent[0]
        assert cmd["cmd"] == "execute_action"
        assert cmd["action"]["type"] == "click"
        assert cmd["action"]["elementId"] == 42

    def test_click_with_frame_id(self):
        """Cross-origin iframe elements carry a frameId — must be forwarded."""
        sent: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent.append(cmd))
        agent.set_host(make_mock_host({"success": True}))

        responses = [
            make_llm_tool_response("click", {"element_id": 7, "tab_id": 1, "frame_id": 15}),
            make_llm_text_response("Clicked iframe element"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            collect_updates(agent, "Click login button in Stripe iframe", tab_id=1)

        cmd = sent[0]
        assert cmd["frameId"] == 15

    def test_type_text_tool(self):
        sent: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent.append(cmd))
        agent.set_host(make_mock_host({"success": True}))

        responses = [
            make_llm_tool_response("type_text", {"element_id": 10, "text": "hello world", "tab_id": 1}),
            make_llm_text_response("Typed"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            collect_updates(agent, "Type in the search box", tab_id=1)

        cmd = sent[0]
        assert cmd["action"]["type"] == "type"
        assert cmd["action"]["text"] == "hello world"
        assert cmd["action"]["elementId"] == 10

    def test_failed_tool_result_yields_error_in_result(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host({"success": False, "error": "Element not found"}))

        responses = [
            make_llm_tool_response("click", {"element_id": 99, "tab_id": 1}),
            make_llm_text_response("I couldn't click the element"),
        ]

        with patch.object(agent.llm, "chat", side_effect=responses):
            updates = collect_updates(agent, "Click", tab_id=1)

        result_updates = [u for u in updates if u["type"] == "tool_result"]
        assert len(result_updates) == 1
        assert result_updates[0]["result"]["success"] is False


class TestAgentMaxSteps:
    def test_stops_at_max_steps(self):
        """Agent must stop after MAX_STEPS even if LLM keeps calling tools."""
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host({"success": True}))

        # Always return a tool call
        with patch.object(
            agent.llm,
            "chat",
            return_value=make_llm_tool_response("list_tabs", {}),
        ):
            updates = collect_updates(agent, "Infinite loop task")

        assert updates[-1]["type"] == "done"
        tool_calls = [u for u in updates if u["type"] == "tool_call"]
        assert len(tool_calls) <= MAX_STEPS


class TestAgentLLMError:
    def test_llm_error_yields_error_update(self):
        agent = Agent(send_command=MagicMock())
        agent.set_host(make_mock_host())

        with patch.object(agent.llm, "chat", side_effect=Exception("API rate limit")):
            updates = collect_updates(agent, "task")

        assert any(u["type"] == "error" for u in updates)
        error_update = next(u for u in updates if u["type"] == "error")
        assert "API rate limit" in error_update["error"]


class TestAgentMultipleToolCalls:
    def test_multiple_tool_calls_in_one_response(self):
        """LLM can return multiple tool calls in a single response."""
        sent: list[dict] = []
        agent = Agent(send_command=lambda cmd: sent.append(cmd))
        agent.set_host(make_mock_host({"success": True}))

        multi_tool_response = {
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "list_tabs", "arguments": "{}"},
                            },
                            {
                                "id": "call_2",
                                "type": "function",
                                "function": {"name": "take_snapshot", "arguments": '{"tab_id": 1}'},
                            },
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        }

        with patch.object(
            agent.llm,
            "chat",
            side_effect=[multi_tool_response, make_llm_text_response("Done")],
        ):
            updates = collect_updates(agent, "List tabs and snapshot")

        tool_calls = [u for u in updates if u["type"] == "tool_call"]
        assert len(tool_calls) == 2
        assert len(sent) == 2
