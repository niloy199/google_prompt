#!/usr/bin/env python3
# server.py — CivicGuide API Proxy
# Serves static files from ./public and proxies /api/gemini server-side.
# The GEMINI_API_KEY environment variable is never exposed to the browser.

import os
import json
import urllib.request
import urllib.error
from http.server import HTTPServer, SimpleHTTPRequestHandler
from functools import partial

PORT = int(os.environ.get("PORT", 8080))
'''GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")'''
SYSTEM_PROMPT_BASE = """You are the CivicGuide Election Assistant, an expert AI designed to help users understand election processes, voting systems, and civic duties globally.
Your tone should be helpful, objective, highly educational, and easy to understand.
You understand the nuances of various democratic systems worldwide (e.g., US Presidential, Indian Lok Sabha, UK Parliamentary, etc.) and can explain them clearly.
Use markdown to format your responses. Use bold text for key terms, and bullet points for lists. Keep your answers concise but informative.

CRITICAL INSTRUCTION: If the user explicitly asks to "START A ROLEPLAY SCENARIO", you must immediately generate a brief, interactive civic scenario. For example: "You are a polling station worker. A citizen arrives with an expired ID. According to standard election rules, what do you do?" Wait for the user to answer, then grade their response and explain the correct procedure before offering a new scenario.

If a user asks a question not related to civics, elections, or government processes, politely decline to answer and guide them back to election-related topics."""

LANG_NAMES = {"en": "English", "hi": "Hindi", "es": "Spanish", "fr": "French"}


STATIC_DIR = "public" if os.path.isdir("public") else "."


class CivicGuideHandler(SimpleHTTPRequestHandler):
    """Serves static files and handles /api/gemini POST requests."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # ------------------------------------------------------------------ #
    #  Routing                                                             #
    # ------------------------------------------------------------------ #

    def do_POST(self):
        if self.path == "/api/gemini":
            self._handle_gemini()
        else:
            self._send_json({"error": "Not found"}, status=404)

    def do_GET(self):
        # Let SimpleHTTPRequestHandler serve everything from public/
        # Map bare "/" to index.html
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    # ------------------------------------------------------------------ #
    #  Gemini proxy                                                        #
    # ------------------------------------------------------------------ #

    def _handle_gemini(self):
        if not GEMINI_API_KEY:
            self._send_json(
                {"error": "GEMINI_API_KEY environment variable is not set."}, status=500
            )
            return

        # Read and parse request body
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body."}, status=400)
            return

        prompt = body.get("prompt", "").strip()
        is_json_mode = bool(body.get("isJsonMode", False))
        language = body.get("language", "en")

        if not prompt:
            self._send_json({"error": "Missing required field: prompt"}, status=400)
            return

        lang_name = LANG_NAMES.get(language, "English")
        system_prompt = (
            SYSTEM_PROMPT_BASE
            + f"\n\nCRITICAL INSTRUCTION: You MUST communicate exclusively in {lang_name}."
        )

        generation_config = {"temperature": 0.3, "maxOutputTokens": 2048}
        if is_json_mode:
            generation_config["responseMimeType"] = "application/json"

        gemini_url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
        )

        payload = json.dumps(
            {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": generation_config,
            }
        ).encode()

        req = urllib.request.Request(
            gemini_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            self._send_json({"text": text})

        except urllib.error.HTTPError as e:
            err_body = json.loads(e.read())
            msg = err_body.get("error", {}).get("message", f"HTTP {e.code}")
            self._send_json({"error": msg}, status=502)

        except Exception as e:
            self._send_json({"error": str(e)}, status=500)

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Clean up default noisy logging
        print(f"[{self.address_string()}] {fmt % args}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), CivicGuideHandler)
    print(f"CivicGuide server running on port {PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()