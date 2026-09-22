# Image Search for ZCode

This plugin registers the official ZCode image search MCP server, so the agent can look up illustrations and reference images while producing documents, slides, posters, or web pages. It ships enabled by default.

## Components

- MCP server `image_search` (HTTP), exposed to the model as `mcp__image_search__<tool>`.
- Nothing else: no commands, skills, hooks, or agents. The plugin is a single `.mcp.json` declaration.

## Backend configuration

The server URL is built from the plugin's `imageSearchBaseUrl` user setting:

```
${user_config.imageSearchBaseUrl}/api/v1/mcp/server/image_search
```

- The setting defaults to `http://127.0.0.1:8787`, a loopback address for local development, and is declared in `.zcode-plugin/plugin.json`.
- Point it at the official ZCode API origin to use the hosted service again.

Authentication is injected by the client, not configured here: the declaration carries `auth.type: zcode_official` with provider `jwt_token`, so the signed-in user's official ZCode credentials are attached to each request and no manual token or API key is needed. Official credentials are only sent to an HTTPS origin that matches the runtime ZCode API origin (or a loopback origin explicitly trusted for development), which is why a hosted backend must be the ZCode API origin itself. Requests time out after 90 seconds (`timeoutMs: 90000`).

## Requirements

- A ZCode session signed in to an account whose plan reaches the configured backend.
- Network access from the client to that backend.
- Start a new ZCode session after installing or updating the plugin — MCP servers are registered when a session starts.

## Usage

Once installed, ask for images in natural language — for example "find a photo of a wind farm for the cover" — and the agent calls the image search tool. The plugin pairs with the `documents` and `presentations` plugins: it was split out of the aggregated documents plugin as an independent toggle, so install it alongside them when you want image search available during document production, and disable it when you do not.

## Notes

- The plugin only declares an MCP server; it ships no code and no other components. What the search returns comes from the backend at the configured base URL, so its availability and contents are that service's, not this plugin's.
