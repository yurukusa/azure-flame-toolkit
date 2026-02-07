# Azure Flame Toolkit

**Autonomous AI toolkit for non-engineers.** Built entirely by [Claude Code](https://claude.com/claude-code) — by someone who cannot write a single line of code.

## What is this?

This toolkit enables Claude Code to autonomously operate a complete business workflow:
- **Game development** (13,000-line roguelike RPG)
- **Marketing** (Reddit posts, articles, social media)
- **Account management** (itch.io, YouTube, GitHub)
- **Analytics gathering**

All driven by a single `instructions.md` file written in plain language.

## Components

### chrome-bridge/
CDP-based browser automation via WebSocket. Enables Claude Code to:
- Navigate web pages
- Fill forms, click buttons
- Upload files
- Take screenshots
- Execute JavaScript in page context

**Architecture:**
```
Claude Code → client.js → WebSocket server → Chrome Extension → Chrome Browser
                                           → CDP Direct → Chrome DevTools Protocol
```

### claude-watch/
File-polling daemon that auto-triggers Claude Code sessions.
- Watches `instructions.md` for changes
- Extracts instruction-id to prevent re-execution
- Runs Claude Code with `--dangerously-skip-permissions`
- Records execution history

**Usage:**
```bash
claude-watch                          # Watch ~/instructions.md
claude-watch /path/to/instructions.md # Watch specific file
claude-watch --status                 # Check status
claude-watch --stop                   # Stop watching
```

## The Story

I am a non-engineer working in finance/HR at a childcare organization in Tokyo. I only speak Japanese and basic English — no programming languages.

Using Claude Code (Opus 4.6), I built:
- **DUNG: Azure Flame** — a 13,000-line roguelike RPG ([play on itch.io](https://yurukusa.itch.io/azure-flame-dungeon))
- **This toolkit** — enabling fully autonomous AI-driven workflows
- **Marketing pipeline** — articles, Reddit posts, video production, all automated

Every morning, I write what I want in `instructions.md`. Claude Code does the rest.

## Setup

### chrome-bridge
```bash
cd chrome-bridge
npm install
node server.js &

# Load extension/ directory into Chrome (chrome://extensions → Load unpacked)
# Then use:
node client.js navigate "https://example.com"
node client.js evaluate "document.title"
```

### claude-watch
```bash
cp claude-watch/claude-watch ~/bin/
chmod +x ~/bin/claude-watch

# Start in tmux
tmux new-session -d -s watch "claude-watch --fg ~/instructions.md"
```

## Built with Opus 4.6

This project is part of the [Built with Opus 4.6: a Claude Code hackathon](https://cerebralvalley.ai/e/claude-code-hackathon) by Cerebral Valley and Anthropic.

## License

MIT
