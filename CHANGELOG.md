# Changelog

## Unreleased

### Added

- User preferences in `~/.config/semantic-review/config.json`, including default backend, model, and effort settings.
- OpenAI Responses API support alongside Anthropic and the existing CLI backends.
- Self-contained HTML exports with review comments and clipboard feedback when the reviewer clicks **Done**.

### Changed

- Anthropic API requests now use native HTTP instead of the Anthropic SDK.
