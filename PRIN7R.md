# Prin7r Integration

This fork is embedded by Prin7r as the local LLM routing module.

## Contract

- Repository: `https://github.com/prin7r/9router`
- Local module path in Prin7r: `modules/9router`
- Dashboard: `http://localhost:20128/dashboard`
- OpenAI-compatible endpoint: `http://localhost:20128/v1`
- Primary responsibilities: provider connection inventory, subscription quota visibility, fallback routing, OpenAI/Claude/Responses translation, and RTK token reduction.

## Prin7r Defaults

- Consolidated local keys remain in `/Users/keer/.nth-kir-keys.env`.
- Do not duplicate API keys or OAuth tokens in this repository.
- Prin7r models 9Router as a local runtime service plus an LLM router subscription.
- Command Code is treated as both a provider/subscription and a runnable harness in Prin7r.
- OpenCode remains a runnable harness, with OpenCode Go available as a subscription provider.

## Current Inspection Notes

- `opencode`, `opencode-go`, and `commandcode` already have specialized executors.
- `commandcode` already has request and response translators plus unit tests.
- The provider config had two `opencode` object keys; the earlier local `localhost:4096` entry was unreachable. It is now named `opencode-local` so the public/free OpenCode provider remains intact.

## Next Frontend Pass

The upstream dashboard is broad and provider-first. Prin7r should replace or heavily reshape the first screen into an operator dashboard:

- route health and active endpoint
- connected subscriptions and quota windows
- harness setup status for OpenCode, Command Code, Codex CLI, Claude Code, and OpenClaw
- per-agent model assignment
- one-click export of settings for Prin7r/OpenClaw agents
