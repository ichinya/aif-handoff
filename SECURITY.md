# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in AIF Handoff, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email security concerns to the maintainers or use [GitHub's private vulnerability reporting](https://github.com/lee-to/aif-handoff/security/advisories/new).

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix release:** as soon as possible, depending on severity

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest `main` | Yes |

## Security Considerations

- The Agent SDK uses local `~/.claude/` credentials or an API key via `ANTHROPIC_API_KEY`
- The SQLite database is stored locally in `data/` — ensure appropriate file permissions
- The WebSocket endpoint has no authentication — intended for local development use
- Never commit `.env` files or API keys to the repository
