# Image Search for ZCodium

Connect your own network image-search MCP service. This plugin includes no search backend or local image library, requires no ZCode account, and has no default server.

## Setup

The plugin is disabled by default. Open the **Image Search** plugin's settings:

1. Enter the service's complete HTTP MCP endpoint in **MCP URL**, including its path. ZCodium does not append a path.
2. If the service uses a token, enter its complete **Authorization** header, for example `Bearer YOUR_TOKEN`. This field is masked. Leave it empty for public endpoints or standard MCP OAuth; an empty field sends no Authorization header.
3. Save the configuration and enable the plugin. Start a new session to load the configured tools.

For example, a self-managed endpoint might be `https://images.example.com/mcp`. Use the URL supplied by your service, not its homepage. For services requiring other headers or custom OAuth settings, use the application's general MCP configuration.

Until a URL is configured, the plugin makes no connection attempts. Missing required settings are reported by the plugin configuration UI. If a connection fails, check the endpoint and credentials, then retry from MCP settings.

## Usage

Ask for images in natural language. Available tools and search results come from your chosen service; the plugin registers them under its `image_search` MCP server. Requests time out after 90 seconds.

Search queries and configured credentials go to that service. There is no automatic official authentication, subscription lookup, or fallback search provider.
