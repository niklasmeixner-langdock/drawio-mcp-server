# drawio-mcp-server

An MCP (Model Context Protocol) server for **draw.io / diagrams.net** with an interactive, editable diagram UI.

It exposes tools to build a diagram from a structured description (nodes + edges) and render it on an embedded, **editable** draw.io canvas right inside the client — where the user can keep editing and export to PNG, SVG, or XML.

Modeled on [`googlemaps-mcp-server`](https://github.com/niklasmeixner-langdock/googlemaps-mcp-server): same MCP-App pattern (data tools return content, a UI tool returns an embedded interactive HTML resource), but **no authentication** — draw.io is fully client-side, so there are no API keys and no OAuth.

## Prerequisites

- Node.js 18+
- pnpm

## Setup

1. Install:

```bash
pnpm install
```

2. Build and run:

```bash
pnpm dev
```

The server starts on port `3000` and exposes the MCP endpoint at `/mcp`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Port to listen on (default: `3000`) |

## Endpoints

| Endpoint | Description |
|---|---|
| `/mcp` | MCP endpoint (GET, POST, DELETE) — no auth required |
| `/health` | Health check |

## MCP Tools

### `create_diagram`

Build a draw.io diagram from a structured description and return valid mxGraph XML.

**Parameters:**
- `nodes` (required) — array of `{ id, label?, shape?, x?, y?, width?, height?, fillColor?, strokeColor? }`. `shape` is one of `rectangle`, `rounded`, `ellipse`, `diamond`, `process`, `terminator`, `cylinder`, `cloud`, `hexagon`, `parallelogram`.
- `edges` — array of `{ source, target, label?, dashed? }` referencing node ids.
- `direction` — `vertical` (default) or `horizontal`, used by the auto-layout when positions are omitted.

Positions are auto-laid-out (layered, centered) when `x`/`y` are omitted — just describe what connects to what.

### `render_diagram`

Display an interactive, editable draw.io canvas. Renders ready-made mxGraph `xml` (typically the output of `create_diagram`); building from a description lives in `create_diagram`, so this tool only renders.

**Parameters:** `xml` (the diagram to render — omit to open a blank canvas), `title` (optional).

The rendered canvas supports live editing and exporting to **PNG** (re-editable, `xmlpng`), **SVG** (`xmlsvg`), and **XML** (`.drawio`).

> The canvas embeds the draw.io **web editor** (`embed.diagrams.net`) in a nested iframe. MCP Apps render in a sandboxed iframe whose CSP defaults to `frame-src 'none'`, so the editor resource declares `_meta.ui.csp.frameDomains` for `embed.diagrams.net` / `app.diagrams.net` — without it the canvas renders blank.

## Resources

### `ui://drawio/editor`

The interactive editor UI rendered by `render_diagram`, served as an MCP App resource. It embeds [`embed.diagrams.net`](https://www.drawio.com/doc/faq/embed-mode) and communicates with it over the JSON postMessage protocol.

## Client Configuration

```json
{
  "mcpServers": {
    "drawio": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For a deployed server, replace the URL with your public endpoint, e.g. `https://your-app.up.railway.app/mcp`.

## Deployment

The server is stateless and keyless — deploy the built `dist/` and run `pnpm start` behind any HTTPS host (Railway, Fly, etc.). The only configuration is the optional `PORT`.
