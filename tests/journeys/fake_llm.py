"""A stand-in for the OpenAI-compatible model server the site talks to
(`LLM_BASE_URL`), for the browser journeys:

    python -m tests.journeys.fake_llm 8018

The router is always told `both`, and every answer is `ANSWER`, streamed a word
at a time as OpenAI's chunk events. The production clients of rag/llm.py talk to
it unchanged, which is the point: the journeys run the site's whole generation
path, and only the model behind it is fake.

The standard library only, as Onyx's mock LLM server and Open WebUI's queued
upstream are a few hundred lines of their own (outside the repository): a
fixture adds no dependency.
"""

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# The page tests/journeys/retrieval.py indexes, which every caller is answered
# from, cited by its marker as rag/answer.py asks a model to cite.
PAGE = "https://ingegneria.unifi.it/vp-185.html"

ANSWER = f"Lo sportello della segreteria è aperto il martedì [{PAGE}]."

ROUTE = {"target": "both", "query": "sportello segreteria", "fresh": False, "reason": "journeys"}


def _completion(content: str) -> dict[str, object]:
    message = {"role": "assistant", "content": content}
    return {
        "id": "journeys",
        "object": "chat.completion",
        "created": 0,
        "model": "journeys",
        "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
    }


def _chunk(delta: dict[str, str], finish_reason: str | None) -> bytes:
    event = {
        "id": "journeys",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "journeys",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(event)}\n\n".encode()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        # The address frontend/playwright.journeys.config.ts waits on.
        if self.path != "/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.end_headers()

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if not body.get("stream"):
            # The one non-streamed call the site makes is the router's.
            reply = json.dumps(_completion(json.dumps(ROUTE))).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)
            return
        # HTTP/1.0, the handler's default: the stream ends when the connection
        # closes, so it needs no length.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for word in re.findall(r"\S+\s*", ANSWER):
            self.wfile.write(_chunk({"content": word}, None))
            self.wfile.flush()
        self.wfile.write(_chunk({}, "stop"))
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, format: str, *args: object) -> None:
        """Silent: Django's own request lines say what the site asked for."""


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
