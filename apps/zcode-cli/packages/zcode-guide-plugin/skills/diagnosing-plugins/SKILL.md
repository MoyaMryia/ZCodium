---
name: diagnosing-plugins
description: Use to diagnose and fix ZCode plugin and marketplace problems in the ZCode client. Applies when a plugin is not listed, adding a marketplace or installing a plugin fails, a plugin is enabled but its skills or commands are missing, a built-in plugin still appears after being disabled, a plugin is not enabled as expected, a plugin.json manifest has a parse error, a plugin name is invalid, a dependency is unresolved or blocked across marketplaces, or a sensitive configuration value cannot be entered in the interface. Provides the plugin lifecycle, manifest schema, how to manage plugins in the client, and a step-by-step localization and repair workflow.
---

# Diagnosing Plugin Configuration

The goal is one concrete fix per problem.

Plugins are managed in **Settings → Plugin Management** — the **Installed** tab for enable/disable, details, configuration and uninstall, and the **Discover** tab for browsing, installing and adding marketplaces through the **`+`** button.

> Three facts worth holding onto: enable/disable state lives under `plugins` in `~/.zcode/cli/config.json`; the official marketplace is `zcode-plugins-official`; and to clone marketplace repositories behind a proxy, ZCode reads the proxy from `ZCODE_HTTP_PROXY` — a bare `http_proxy` is ignored.

## 1. Lifecycle and where state is kept

- **Discovery sources**, first match winning: inline directories, bundled official plugins, the official plugin cache, then marketplace-installed plugins. The whole subsystem hangs off the `plugins.enabled` master switch.
- **Manifest location**, probed in order: `.zcode-plugin/plugin.json` first, then `.claude-plugin/plugin.json`, then `.codex-plugin/plugin.json`. A plugin's identity is `<name>@<marketplace>`.
- **Enable/disable resolution**: an explicit entry always wins; only with no entry at all does the plugin's own default-enabled status apply. A disabled plugin still shows in the list as disabled, but its components resolve to nothing.
- **Persistence**, all under `plugins` in `~/.zcode/cli/config.json`: the enable/disable map, per-plugin configuration values, and the suppressed-built-ins list. Since a built-in plugin ships inside the application and cannot be deleted, "uninstalling" one writes a suppression marker that hides it from discovery.
- **Built-in seeding**: on first launch, bundled official plugins are materialized into the plugin cache and registered in the official marketplace listing. That is idempotent and only re-materializes when content or version changes.

## 2. The manifest schema

- **plugin.json** requires `name`, matching `^[a-z0-9][a-z0-9._-]{0,127}$`. Optional: `version` (defaulting to `0.0.0`), `description`, `commands`, `skills`, `hooks`, `mcpServers`, and `userConfig`.
- **Recorded but never executed**: `agents`, `channels`, `lspServers`, `outputStyles`, `settings`.
- Component paths are validated: an absolute path, or one escaping the plugin root, is rejected as an invalid component path.
- **userConfig** accepts `type` of `string`, `number`, `boolean`, `directory` or `file`, with `title`, `description`, `default`, `required` and `sensitive`. A **sensitive value cannot currently be entered in the interface or persisted** to the configuration file.
- **marketplace.json** is `{ name, plugins[], pluginRoot?, allowCrossMarketplaceDependenciesOn? }`. Each `plugins[].source` may be a relative path string, or an object of kind `directory`, `github`, `git`, `url` or `git-subdir`. `npm` and `pip` are not supported.

## 3. Managing plugins in the client

- **Install**: on **Discover**, find the card and click **Get**; it then reads **Installed**. New plugins are enabled by default.
- **Enable / disable**: on **Installed**, toggle the switch on the row. Disabling strips all of its components from the session immediately.
- **Configure**: open the detail view and expand **Advanced** to fill in configuration values. Required fields are marked; sensitive fields cannot be entered there.
- **Uninstall**: from the detail view. A built-in plugin can only be disabled.
- **Add a marketplace**: the **`+`** button on Discover accepts a GitHub repository, a Git URL, a local directory or a file.

## 4. Pitfalls, by symptom

1. **Not listed at all.** Its marketplace was never added, so there is no installation record and no cache; or `plugins.enabled` is false. → Add the marketplace on Discover and install it, or set `plugins.enabled: true`.
2. **Marketplace add or install fails to clone.** An error such as `RPC failed`, `timed out` or `early EOF` after retries, because the clone never inherited the shell proxy. → **Set `ZCODE_HTTP_PROXY=http://host:port`** — ZCode reads the proxy only from that variable and ignores a bare `http_proxy`.
3. **Enabled, yet its skills or commands are missing.** A component path escapes the plugin root, the plugin is actually disabled, or it is not treated as enabled where the session reads it. → Open the detail view to see the invalid component, then make the manifest path relative and inside the plugin root.
4. **A built-in plugin still appears after being disabled, or comes back after uninstalling.** The suppression state was not applied where it was read. → Confirm the plugin id sits in the suppressed-built-ins list in `~/.zcode/cli/config.json`; restoring it removes that entry and re-seeds.
5. **Listed as enabled but a skill reports "not found" in the session.** The default-enabled set was not applied along the session's discovery path even though the listing says enabled. → Verify the plugin's skills are actually available in the session through **Settings → Skills** and the `/` menu, not merely that the plugin reads as enabled.
6. **Manifest parse error.** The JSON is invalid, is not an object, or `name` is missing or invalid. → Fix it into a valid object whose `name` matches the pattern.
7. **Invalid plugin name.** It breaks `^[a-z0-9][a-z0-9._-]{0,127}$`. → Rename.
8. **Unresolved or cross-marketplace dependency.** The dependency lives in a marketplace absent from `allowCrossMarketplaceDependenciesOn`, is missing, or forms a cycle. → Add the target marketplace to `allowCrossMarketplaceDependenciesOn`, install the missing dependency's marketplace, or break the cycle. Dependencies are written `name@marketplace`.
9. **Version reads 0.0.0, or updates are never detected.** Git and URL plugins often carry no top-level version, and official plugins track updates by commit. → Confirm both the installed record and the manifest entry carry their source revision.
10. **A sensitive configuration value cannot be set.** The field is disabled with a note about secure storage, because no secure credential store exists yet. → Drop `sensitive: true`, or supply the value out of band such as through an environment variable; it cannot be persisted today.
11. **A `filesystem`/`sea` source reports "unsupported".** A built-in plugin's cache path is missing or stale. → Re-seed the plugin by clearing its cache entry so it is re-materialized on the next launch.

## 5. Narrowing it down

1. **Is the subsystem on?** Check `plugins.enabled`; false means everything is empty.
2. **Look at the plugin.** On **Installed**, confirm it is present and enabled, and open its detail view for source, components and warnings.
3. **Classify by presence.** Entirely absent → a marketplace or installation problem, so confirm the marketplace was added and the plugin installed. Present but disabled → compare the enable state against the default. Present and enabled but broken at runtime → a component-path problem (pitfall 3) or a session-versus-listing divergence (pitfall 5).
4. **Built-in trouble.** Compare the suppressed-built-ins list with what the official marketplace offers, and confirm the plugin cache is current.
5. **Installation and network.** Reproduce the clone with the proxy set, confirming `ZCODE_HTTP_PROXY`, and watch for the retryable-error signatures.
6. **Session-versus-listing divergence.** If the plugin reads enabled but its capabilities are absent in the session, treat it as a discovery-path problem: confirm the skills and commands actually appear in the session via **Settings → Skills** and the `/` menu, rather than trusting the enabled flag alone.
