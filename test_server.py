#!/usr/bin/env python3
"""
test_server.py — Comprehensive tests for CivicGuide server.py

Run with:
    python -m pytest test_server.py -v
    # or without pytest:
    python test_server.py

Coverage:
    - POST /api/gemini  : happy path, missing key, bad JSON, empty prompt,
                          unknown language, json mode flag, Gemini HTTP errors,
                          malformed Gemini response, network exception
    - GET routing       : / → index.html redirect, unknown POST route → 404
    - _send_json        : correct headers, status codes, body encoding
    - LANG_NAMES map    : all supported languages + unknown fallback
    - STATIC_DIR        : public/ present vs absent
    - PORT env var      : default and custom
"""

import io
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch, call
import urllib.error
import http.client

# ---------------------------------------------------------------------------
# Helpers to build a fake handler without a real socket / HTTP server
# ---------------------------------------------------------------------------

def make_handler(env_overrides=None):
    """
    Import server with optional env overrides and return the handler class.
    Re-imports to pick up module-level globals (GEMINI_API_KEY, STATIC_DIR).
    """
    env = {**os.environ, **(env_overrides or {})}
    with patch.dict(os.environ, env, clear=True):
        # Force re-evaluation of module globals
        if "server" in sys.modules:
            del sys.modules["server"]
        import server as srv
    return srv.CivicGuideHandler, srv


def build_handler(body_bytes=b"", path="/api/gemini", method="POST", env=None):
    """
    Instantiate CivicGuideHandler with a fake socket/request so we can call
    do_POST / do_GET / _handle_gemini directly without a live server.
    """
    HandlerClass, srv = make_handler(env or {"GEMINI_API_KEY": "test-key-123"})

    # Fake request socket — provides rfile with body bytes
    fake_request = MagicMock()
    fake_request.makefile.return_value = io.BytesIO(body_bytes)

    # Fake wfile to capture output
    wfile = io.BytesIO()

    handler = HandlerClass.__new__(HandlerClass)
    handler.path       = path
    handler.command    = method
    handler.rfile      = io.BytesIO(body_bytes)
    handler.wfile      = wfile
    handler.headers    = {
        "Content-Length": str(len(body_bytes)),
        "Content-Type":   "application/json",
    }
    handler.server     = MagicMock()
    handler.connection = MagicMock()
    handler.request    = fake_request
    handler.client_address = ("127.0.0.1", 9999)

    # Capture _send_json calls for easy assertion
    sent = []
    def fake_send_json(data, status=200):
        sent.append({"data": data, "status": status})
    handler._send_json = fake_send_json
    handler._sent      = sent

    return handler, srv


def post_body(**kwargs):
    return json.dumps(kwargs).encode()


# ---------------------------------------------------------------------------
# 1. Environment / module-level globals
# ---------------------------------------------------------------------------

class TestModuleGlobals(unittest.TestCase):

    def test_default_port(self):
        _, srv = make_handler({"GEMINI_API_KEY": "k"})
        self.assertEqual(srv.PORT, 8080)

    def test_custom_port(self):
        _, srv = make_handler({"GEMINI_API_KEY": "k", "PORT": "9090"})
        self.assertEqual(srv.PORT, 9090)

    def test_gemini_key_read_from_env(self):
        _, srv = make_handler({"GEMINI_API_KEY": "abc123"})
        self.assertEqual(srv.GEMINI_API_KEY, "abc123")

    def test_gemini_key_missing_defaults_to_empty(self):
        env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            if "server" in sys.modules:
                del sys.modules["server"]
            import server as srv
        self.assertEqual(srv.GEMINI_API_KEY, "")

    def test_static_dir_public_when_exists(self):
        with patch("os.path.isdir", return_value=True):
            if "server" in sys.modules:
                del sys.modules["server"]
            import server as srv
        self.assertEqual(srv.STATIC_DIR, "public")

    def test_static_dir_dot_when_no_public(self):
        with patch("os.path.isdir", return_value=False):
            if "server" in sys.modules:
                del sys.modules["server"]
            import server as srv
        self.assertEqual(srv.STATIC_DIR, ".")

    def test_lang_names_all_supported(self):
        _, srv = make_handler({"GEMINI_API_KEY": "k"})
        self.assertEqual(srv.LANG_NAMES["en"], "English")
        self.assertEqual(srv.LANG_NAMES["hi"], "Hindi")
        self.assertEqual(srv.LANG_NAMES["es"], "Spanish")
        self.assertEqual(srv.LANG_NAMES["fr"], "French")

    def test_lang_names_has_exactly_four(self):
        _, srv = make_handler({"GEMINI_API_KEY": "k"})
        self.assertEqual(len(srv.LANG_NAMES), 4)


# ---------------------------------------------------------------------------
# 2. POST routing
# ---------------------------------------------------------------------------

class TestRouting(unittest.TestCase):

    def test_post_unknown_route_returns_404(self):
        handler, _ = build_handler(b"{}", path="/not/a/route")
        handler.do_POST()
        self.assertEqual(handler._sent[0]["status"], 404)
        self.assertIn("error", handler._sent[0]["data"])

    def test_post_api_gemini_calls_handle_gemini(self):
        handler, _ = build_handler(post_body(prompt="test"), path="/api/gemini")
        handler._handle_gemini = MagicMock()
        handler.do_POST()
        handler._handle_gemini.assert_called_once()

    def test_get_root_redirects_to_index(self):
        handler, _ = build_handler(path="/")
        with patch("http.server.SimpleHTTPRequestHandler.do_GET") as mock_get:
            handler.do_GET()
            self.assertEqual(handler.path, "/index.html")
            mock_get.assert_called_once()

    def test_get_other_path_unchanged(self):
        handler, _ = build_handler(path="/styles.css")
        with patch("http.server.SimpleHTTPRequestHandler.do_GET") as mock_get:
            handler.do_GET()
            self.assertEqual(handler.path, "/styles.css")
            mock_get.assert_called_once()


# ---------------------------------------------------------------------------
# 3. _handle_gemini — guard clauses
# ---------------------------------------------------------------------------

class TestHandleGeminiGuards(unittest.TestCase):

    def test_missing_api_key_returns_500(self):
        handler, _ = build_handler(
            post_body(prompt="hello"),
            env={"GEMINI_API_KEY": ""}
        )
        # Patch module-level key to empty
        with patch("server.GEMINI_API_KEY", ""):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 500)
        self.assertIn("GEMINI_API_KEY", handler._sent[0]["data"]["error"])

    def test_invalid_json_body_returns_400(self):
        handler, _ = build_handler(b"not json at all")
        with patch("server.GEMINI_API_KEY", "test-key"):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 400)
        self.assertIn("Invalid JSON", handler._sent[0]["data"]["error"])

    def test_empty_prompt_returns_400(self):
        handler, _ = build_handler(post_body(prompt="   "))
        with patch("server.GEMINI_API_KEY", "test-key"):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 400)
        self.assertIn("prompt", handler._sent[0]["data"]["error"])

    def test_missing_prompt_field_returns_400(self):
        handler, _ = build_handler(post_body(language="en"))
        with patch("server.GEMINI_API_KEY", "test-key"):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 400)

    def test_empty_body_returns_400(self):
        handler, _ = build_handler(b"{}")
        with patch("server.GEMINI_API_KEY", "test-key"):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 400)


# ---------------------------------------------------------------------------
# 4. _handle_gemini — happy path
# ---------------------------------------------------------------------------

GEMINI_OK_RESPONSE = {
    "candidates": [{
        "content": {
            "parts": [{"text": "The election process has five key stages."}]
        }
    }]
}


def mock_urlopen(response_dict):
    """Returns a context manager mock that yields a readable response."""
    resp_bytes = json.dumps(response_dict).encode()
    mock_resp = MagicMock()
    mock_resp.read.return_value = resp_bytes
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


class TestHandleGeminiHappyPath(unittest.TestCase):

    def _run(self, body, urlopen_mock):
        handler, _ = build_handler(body)
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", return_value=urlopen_mock):
            handler._handle_gemini()
        return handler._sent

    def test_returns_text_from_gemini(self):
        sent = self._run(
            post_body(prompt="What is an election?"),
            mock_urlopen(GEMINI_OK_RESPONSE)
        )
        self.assertEqual(sent[0]["status"], 200)
        self.assertEqual(sent[0]["data"]["text"], "The election process has five key stages.")

    def test_english_language_default(self):
        handler, _ = build_handler(post_body(prompt="hello"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)) as mock_u:
            handler._handle_gemini()
        # urlopen was called — just assert no error
        self.assertEqual(handler._sent[0]["status"], 200)

    def test_hindi_language_accepted(self):
        handler, _ = build_handler(post_body(prompt="election kya hai", language="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 200)

    def test_unknown_language_falls_back_to_english(self):
        handler, _ = build_handler(post_body(prompt="hello", language="zz"))
        captured_payloads = []
        import urllib.request as _ureq
        original_request = _ureq.Request

        def capture_request(url, data=None, headers=None, method=None):
            captured_payloads.append(json.loads(data))
            return original_request(url, data=data, headers=headers or {}, method=method)

        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture_request), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        system_text = captured_payloads[0]["system_instruction"]["parts"][0]["text"]
        self.assertIn("English", system_text)

    def test_json_mode_adds_response_mime_type(self):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt="generate quiz", isJsonMode=True))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        gen_cfg = captured[0]["generationConfig"]
        self.assertEqual(gen_cfg.get("responseMimeType"), "application/json")

    def test_non_json_mode_omits_mime_type(self):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt="hello", isJsonMode=False))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        gen_cfg = captured[0]["generationConfig"]
        self.assertNotIn("responseMimeType", gen_cfg)

    def test_temperature_is_0_3(self):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        self.assertEqual(captured[0]["generationConfig"]["temperature"], 0.3)

    def test_prompt_is_forwarded_verbatim(self):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt="What is the Electoral College?"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        contents_text = captured[0]["contents"][0]["parts"][0]["text"]
        self.assertEqual(contents_text, "What is the Electoral College?")

    def test_prompt_is_stripped_of_whitespace(self):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt="  hello world  "))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        contents_text = captured[0]["contents"][0]["parts"][0]["text"]
        self.assertEqual(contents_text, "hello world")


# ---------------------------------------------------------------------------
# 5. _handle_gemini — Gemini error responses
# ---------------------------------------------------------------------------

class TestHandleGeminiErrors(unittest.TestCase):

    def _make_http_error(self, code, message):
        err_body = json.dumps({"error": {"message": message}}).encode()
        mock_err = urllib.error.HTTPError(
            url="https://gemini/", code=code,
            msg=message, hdrs={}, fp=io.BytesIO(err_body)
        )
        return mock_err

    def test_gemini_http_error_returns_502(self):
        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", side_effect=self._make_http_error(429, "Quota exceeded")):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 502)
        self.assertIn("Quota exceeded", handler._sent[0]["data"]["error"])

    def test_gemini_http_error_missing_message_uses_fallback(self):
        err_body = json.dumps({"error": {}}).encode()
        mock_err = urllib.error.HTTPError(
            url="https://gemini/", code=503,
            msg="Service Unavailable", hdrs={}, fp=io.BytesIO(err_body)
        )
        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", side_effect=mock_err):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 502)
        self.assertIn("503", handler._sent[0]["data"]["error"])

    def test_network_exception_returns_500(self):
        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", side_effect=Exception("Connection refused")):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 500)
        self.assertIn("Connection refused", handler._sent[0]["data"]["error"])

    def test_malformed_gemini_response_no_candidates(self):
        """Gemini returns 200 but with unexpected structure — KeyError → 500."""
        bad_response = {"candidates": []}   # empty candidates list
        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(bad_response)):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 500)

    def test_malformed_gemini_response_missing_text_key(self):
        bad_response = {"candidates": [{"content": {"parts": [{"no_text_key": "x"}]}}]}
        handler, _ = build_handler(post_body(prompt="hi"))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(bad_response)):
            handler._handle_gemini()
        self.assertEqual(handler._sent[0]["status"], 500)


# ---------------------------------------------------------------------------
# 6. _send_json
# ---------------------------------------------------------------------------

class TestSendJson(unittest.TestCase):

    def _make_real_handler(self):
        """Handler with a real wfile so we can inspect raw bytes written."""
        HandlerClass, _ = make_handler({"GEMINI_API_KEY": "k"})
        handler = HandlerClass.__new__(HandlerClass)
        handler.wfile         = io.BytesIO()
        handler.client_address = ("127.0.0.1", 0)
        handler.server        = MagicMock()
        handler.connection    = MagicMock()

        written_headers = {}
        written_status  = []

        def fake_send_response(code):
            written_status.append(code)

        def fake_send_header(k, v):
            written_headers[k] = v

        def fake_end_headers():
            pass

        handler.send_response  = fake_send_response
        handler.send_header    = fake_send_header
        handler.end_headers    = fake_end_headers
        handler._headers_written = written_headers
        handler._status_written  = written_status
        return handler

    def test_send_json_200_default(self):
        h = self._make_real_handler()
        h._send_json({"text": "hello"})
        self.assertEqual(h._status_written[0], 200)

    def test_send_json_custom_status(self):
        h = self._make_real_handler()
        h._send_json({"error": "bad"}, status=400)
        self.assertEqual(h._status_written[0], 400)

    def test_send_json_content_type_header(self):
        h = self._make_real_handler()
        h._send_json({"x": 1})
        self.assertEqual(h._headers_written["Content-Type"], "application/json")

    def test_send_json_body_is_valid_json(self):
        h = self._make_real_handler()
        h._send_json({"key": "value"})
        body = h.wfile.getvalue()
        parsed = json.loads(body)
        self.assertEqual(parsed["key"], "value")

    def test_send_json_content_length_matches_body(self):
        h = self._make_real_handler()
        payload = {"message": "test content length"}
        h._send_json(payload)
        body = h.wfile.getvalue()
        declared = int(h._headers_written["Content-Length"])
        self.assertEqual(declared, len(body))

    def test_send_json_empty_dict(self):
        h = self._make_real_handler()
        h._send_json({})
        body = json.loads(h.wfile.getvalue())
        self.assertEqual(body, {})


# ---------------------------------------------------------------------------
# 7. System prompt construction
# ---------------------------------------------------------------------------

class TestSystemPrompt(unittest.TestCase):

    def _capture_payload(self, prompt, language="en"):
        captured = []
        import urllib.request as ureq
        orig = ureq.Request

        def capture(url, data=None, headers=None, method=None):
            captured.append(json.loads(data))
            return orig(url, data=data, headers=headers or {}, method=method)

        handler, _ = build_handler(post_body(prompt=prompt, language=language))
        with patch("server.GEMINI_API_KEY", "test-key"), \
             patch("urllib.request.Request", side_effect=capture), \
             patch("urllib.request.urlopen", return_value=mock_urlopen(GEMINI_OK_RESPONSE)):
            handler._handle_gemini()

        return captured[0]["system_instruction"]["parts"][0]["text"]

    def test_system_prompt_contains_civicguide(self):
        text = self._capture_payload("hi")
        self.assertIn("CivicGuide", text)

    def test_system_prompt_contains_language_instruction_english(self):
        text = self._capture_payload("hi", "en")
        self.assertIn("English", text)

    def test_system_prompt_contains_language_instruction_hindi(self):
        text = self._capture_payload("hi", "hi")
        self.assertIn("Hindi", text)

    def test_system_prompt_contains_language_instruction_spanish(self):
        text = self._capture_payload("hi", "es")
        self.assertIn("Spanish", text)

    def test_system_prompt_contains_language_instruction_french(self):
        text = self._capture_payload("hi", "fr")
        self.assertIn("French", text)

    def test_system_prompt_contains_roleplay_instruction(self):
        text = self._capture_payload("START A ROLEPLAY SCENARIO")
        self.assertIn("ROLEPLAY", text)

    def test_system_prompt_contains_markdown_instruction(self):
        text = self._capture_payload("hi")
        self.assertIn("markdown", text.lower())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
