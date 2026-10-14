# TTSFM Architecture Overview

```
+----------------+       +--------------------+       +----------------------+
| Frontend (JS)  | <---> | Flask REST Endpoints| <---> | OpenAI.fm upstream   |
| Playground UI  |       | /api/* + /v1/audio  |       | reverse-engineered   |
+----------------+       +--------------------+       +----------------------+
        |                               ^
        v                               |
+----------------+       +--------------------+
| Socket.IO WS   | <---> | WebSocket Handler  |
| streaming UI   |       | (background tasks) |
+----------------+       +--------------------+
```

- **Synchronous Client (`TTSClient`)** – Used by both REST endpoints and the WebSocket handler. Each request gets an isolated client instance, preventing shared session races.
- **Async Client (`AsyncTTSClient`)** – Available to external consumers that want fully asynchronous workflows.
- **Utilities** – Shared helpers handle sanitisation, deterministic headers, and text splitting for both HTTP and WebSocket flows.

The repo ships with a Docker image that bundles the Flask app, Socket.IO server, and static assets. A per-request TTS client ensures concurrency safety; outgoing prompt tuning is opt-in through the `use_default_prompt` flag.

For more implementation details see:

- `ttsfm-web/app.py` – Flask routes, streaming combination logic, API key security.
- `ttsfm-web/websocket_handler.py` – Background task orchestration and streaming chunk delivery.
- `ttsfm/utils.py` – Sanitisation, deterministic headers, and text chunk helpers.
