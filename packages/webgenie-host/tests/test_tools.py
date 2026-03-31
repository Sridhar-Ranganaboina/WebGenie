"""
Tests for BrowserToolkit — command building from LLM tool-call arguments.
"""

from __future__ import annotations

import pytest

from tools import BrowserToolkit


@pytest.fixture
def toolkit() -> BrowserToolkit:
    return BrowserToolkit(default_tab_id=1)


class TestNavigationCommands:
    def test_navigate(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("navigate", {"url": "https://github.com", "tab_id": 3})
        assert cmd == {"cmd": "navigate", "tabId": 3, "url": "https://github.com"}

    def test_navigate_uses_default_tab(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("navigate", {"url": "https://github.com"})
        assert cmd["tabId"] == 1  # default

    def test_navigate_back(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("navigate_back", {"tab_id": 2})
        assert cmd == {"cmd": "navigate_back", "tabId": 2}

    def test_navigate_forward(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("navigate_forward", {})
        assert cmd["cmd"] == "navigate_forward"
        assert cmd["tabId"] == 1

    def test_reload(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("reload", {})
        assert cmd["cmd"] == "reload"

    def test_new_tab_no_url(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("new_tab", {})
        assert cmd == {"cmd": "new_tab", "url": None}

    def test_new_tab_with_url(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("new_tab", {"url": "https://example.com"})
        assert cmd["url"] == "https://example.com"

    def test_close_tab(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("close_tab", {"tab_id": 7})
        assert cmd == {"cmd": "close_tab", "tabId": 7}

    def test_list_tabs(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("list_tabs", {})
        assert cmd == {"cmd": "list_tabs"}


class TestSnapshotAndScreenshot:
    def test_take_snapshot(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("take_snapshot", {"tab_id": 5})
        assert cmd == {"cmd": "get_snapshot", "tabId": 5}

    def test_take_screenshot_defaults(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("take_screenshot", {})
        assert cmd["cmd"] == "get_screenshot"
        assert cmd["format"] == "png"

    def test_take_screenshot_jpeg(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("take_screenshot", {"format": "jpeg"})
        assert cmd["format"] == "jpeg"


class TestClickActions:
    def test_click_basic(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("click", {"element_id": 42})
        assert cmd["cmd"] == "execute_action"
        assert cmd["action"]["type"] == "click"
        assert cmd["action"]["elementId"] == 42
        assert cmd["action"]["button"] == "left"
        assert cmd["action"]["clickCount"] == 1

    def test_click_right_button(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("click", {"element_id": 5, "button": "right"})
        assert cmd["action"]["button"] == "right"

    def test_double_click(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("click", {"element_id": 5, "click_count": 2})
        assert cmd["action"]["clickCount"] == 2

    def test_click_with_frame_id(self, toolkit: BrowserToolkit):
        """Critical: cross-origin iframe clicks need frameId forwarded."""
        cmd = toolkit.build_command("click", {"element_id": 7, "frame_id": 15})
        assert cmd["frameId"] == 15

    def test_click_at_coordinates(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("click_at", {"x": 100, "y": 200})
        assert cmd["action"]["type"] == "click_at"
        assert cmd["action"]["x"] == 100
        assert cmd["action"]["y"] == 200

    def test_hover(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("hover", {"element_id": 3})
        assert cmd["action"]["type"] == "hover"
        assert cmd["action"]["elementId"] == 3


class TestTypingActions:
    def test_type_text(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("type_text", {"element_id": 10, "text": "hello"})
        assert cmd["action"]["type"] == "type"
        assert cmd["action"]["text"] == "hello"
        assert cmd["action"]["append"] is False

    def test_type_text_append(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("type_text", {"element_id": 10, "text": " world", "append": True})
        assert cmd["action"]["append"] is True

    def test_type_with_frame_id(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("type_text", {"element_id": 10, "text": "4242", "frame_id": 20})
        assert cmd["frameId"] == 20

    def test_clear_field(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("clear_field", {"element_id": 5})
        assert cmd["action"]["type"] == "clear"

    def test_press_key_enter(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("press_key", {"key": "Enter"})
        assert cmd["action"]["type"] == "press_key"
        assert cmd["action"]["key"] == "Enter"
        assert cmd["action"]["modifiers"] == []

    def test_press_key_with_modifiers(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("press_key", {"key": "a", "modifiers": ["ctrl"]})
        assert cmd["action"]["modifiers"] == ["ctrl"]

    def test_select_option(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("select_option", {"element_id": 8, "value": "Option A"})
        assert cmd["action"]["type"] == "select_option"
        assert cmd["action"]["value"] == "Option A"


class TestScrollActions:
    def test_scroll_down(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("scroll", {"direction": "down"})
        assert cmd["action"]["type"] == "scroll"
        assert cmd["action"]["direction"] == "down"
        assert cmd["action"]["amount"] == 300

    def test_scroll_custom_amount(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("scroll", {"direction": "up", "amount": 500})
        assert cmd["action"]["amount"] == 500

    def test_scroll_specific_element(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("scroll", {"direction": "down", "element_id": 12})
        assert cmd["action"]["elementId"] == 12

    def test_scroll_to_element(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("scroll_to_element", {"element_id": 15})
        assert cmd["action"]["type"] == "scroll_to_element"
        assert cmd["action"]["elementId"] == 15


class TestPageContent:
    def test_get_page_content_no_selector(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_page_content", {})
        assert cmd["cmd"] == "get_page_content"
        assert cmd["selector"] is None

    def test_get_page_content_with_selector(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_page_content", {"selector": "main"})
        assert cmd["selector"] == "main"

    def test_get_page_links(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_page_links", {})
        assert cmd["cmd"] == "get_page_links"

    def test_evaluate(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("evaluate", {"expression": "document.title"})
        assert cmd["cmd"] == "evaluate"
        assert cmd["expression"] == "document.title"

    def test_evaluate_with_frame(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("evaluate", {"expression": "1+1", "frame_id": 3})
        assert cmd["frameId"] == 3


class TestWaitFor:
    def test_wait_for_url(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("wait_for", {"condition_type": "url_contains", "text": "checkout"})
        assert cmd["cmd"] == "wait_for"
        assert cmd["condition"]["type"] == "url_contains"
        assert cmd["condition"]["text"] == "checkout"

    def test_wait_for_element_visible(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("wait_for", {"condition_type": "element_visible", "selector": ".modal"})
        assert cmd["condition"]["selector"] == ".modal"

    def test_wait_for_delay(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("wait_for", {"condition_type": "delay", "ms": 2000})
        assert cmd["condition"]["ms"] == 2000

    def test_wait_for_custom_timeout(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("wait_for", {"condition_type": "network_idle", "timeout_ms": 5000})
        assert cmd["timeoutMs"] == 5000


class TestHistoryAndBookmarks:
    def test_get_history(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_history", {"max_results": 10})
        assert cmd == {"cmd": "get_history", "maxResults": 10}

    def test_get_bookmarks_no_query(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_bookmarks", {})
        assert cmd["cmd"] == "get_bookmarks"
        assert cmd["query"] is None

    def test_get_bookmarks_with_query(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("get_bookmarks", {"query": "GitHub"})
        assert cmd["query"] == "GitHub"

    def test_add_bookmark(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("add_bookmark", {"title": "Google", "url": "https://google.com"})
        assert cmd == {"cmd": "add_bookmark", "title": "Google", "url": "https://google.com"}


class TestMemory:
    def test_memory_write(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("memory_write", {"key": "user_email", "value": "test@example.com"})
        assert cmd == {"cmd": "memory_write", "key": "user_email", "value": "test@example.com"}

    def test_memory_read(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("memory_read", {"key": "user_email"})
        assert cmd == {"cmd": "memory_read", "key": "user_email"}

    def test_memory_search(self, toolkit: BrowserToolkit):
        cmd = toolkit.build_command("memory_search", {"query": "email"})
        assert cmd == {"cmd": "memory_search", "query": "email"}


class TestUnknownTool:
    def test_unknown_tool_raises(self, toolkit: BrowserToolkit):
        with pytest.raises(ValueError, match="Unknown tool: nonexistent_tool"):
            toolkit.build_command("nonexistent_tool", {})


class TestDefaultTab:
    def test_set_default_tab(self):
        toolkit = BrowserToolkit()
        toolkit.set_default_tab(42)
        cmd = toolkit.build_command("reload", {})
        assert cmd["tabId"] == 42

    def test_explicit_tab_id_overrides_default(self):
        toolkit = BrowserToolkit(default_tab_id=1)
        cmd = toolkit.build_command("take_snapshot", {"tab_id": 99})
        assert cmd["tabId"] == 99
