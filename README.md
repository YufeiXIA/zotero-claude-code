# Claude Code for Zotero

English | [中文](README.zh-CN.md)

Chat with the paper you are reading in Zotero. The plugin runs the Claude Code CLI that is already installed on your computer, so the answers come from your own Claude account (Claude Opus 5.5 by default). The chat sits in Zotero's item pane, or in its own window that you can put on a second monitor.

<p align="center"><img src="docs/screenshot-chat.png" width="420" alt="The chat window answering a question about the open paper, with page citations"></p>

This is an unofficial project. It is not affiliated with Anthropic or with the Zotero project.

## What it does

- The chat follows the paper you are reading. Switch reader tabs or reader windows and the conversation switches with you. Each paper keeps its own history, and the history survives a Zotero restart.
- Claude reads the PDF itself. Each message tells it the file path and the page you are on, and it opens the pages it needs. Ask it to cite pages and it will.
- Select text in a PDF and click "Ask Claude" in the popup to ask about that passage.
- The panel lives in the item pane. Drag its title bar out of Zotero, or click the pop-out button, and it becomes a separate window. The reader toolbar also gets a button that opens the window.
- The model and reasoning effort menus sit under the input box. Changing the model keeps the conversation going.
- The chat has four color themes (Auto, Light, Warm, Dark) and an adjustable text size. If you like the warm look, one switch applies it to the rest of Zotero too: the library, item list, item pane and reader windows.
- By default Claude can only read: it can open files, search the text and look things up on the web, but it cannot edit files or run commands.

## Requirements

- Zotero 7 or later. Tested on Zotero 10.0.6 for Windows.
- Claude Code, installed and signed in. Claude Opus 5.5 needs Claude Code 2.1.280 or newer, so run `claude update` if you are not sure.

## Install

1. Download the latest `.xpi` file from the [Releases page](https://github.com/YufeiXIA/zotero-claude-code/releases).
2. In Zotero, open Tools > Plugins, click the gear icon and choose "Install Plugin From File...". Pick the `.xpi` file.
3. If you don't have Claude Code yet, install it from <https://claude.com/claude-code> and run `claude` once in a terminal to sign in.
4. Open a PDF and click the chat bubble on the right side of the reader toolbar.

The plugin looks for Claude Code in the usual places: an npm global install, the native installer's `~/.local/bin`, the copy bundled with the Claude desktop app, and your `PATH`. It uses the newest version it finds. If it picks the wrong one, set the path in Zotero's Settings under Claude Code.

## Daily use

Enter sends a message and Shift+Enter starts a new line. If you type with an input method (Chinese, Japanese and so on), pressing Enter to confirm a word will not send the message.

The buttons in the chat header:

| Button | What it does |
| --- | --- |
| Aa | Show the appearance bar: color theme (Auto, Light, Warm, Dark) and text size |
| 📌 | Keep the chat on this paper even when you open another one |
| ＋ | Start a new conversation for this paper |
| ⧉ / ⇲ | Move the chat into its own window, or back into the sidebar |

To give all of Zotero the same warm colors, tick "Use this warm look for all of Zotero" in the appearance bar, or use Tools > Warm Theme for Zotero. It changes only colors, follows Zotero's light and dark mode, and turning it off restores Zotero's own colors right away.

Text size also follows the usual browser keys while the chat has focus: Ctrl+= and Ctrl+- (or Ctrl and the mouse wheel) make it bigger or smaller, and Ctrl+0 resets it. The color theme and text size are shared by the sidebar and the window, and Zotero remembers them.

A two-monitor setup works well. In Zotero's Settings > General > Reader, turn on "Open files in new windows instead of tabs". PDFs then open in their own windows, so you can keep the reader on one screen and the chat window on the other. The chat window remembers where you put it.

You can also open the chat window from Tools > Claude Code Chat.

## Settings

Open Zotero's Settings and choose Claude Code.

| Setting | Default | Notes |
| --- | --- | --- |
| Claude Code executable | empty | Empty means detect automatically. "Detect" shows which binary and version it found. |
| Model | `claude-opus-5-5` | Any model name Claude Code accepts. The chat's model menu changes this too. |
| Effort | empty | `low`, `medium`, `high`, `xhigh` or `max`. Empty lets Claude Code decide. |
| Tools Claude may use without asking | `Read,Grep,Glob,WebSearch,WebFetch` | Everything not listed is refused. |
| Load my Claude Code user settings | on | Uses your `~/.claude` setup: CLAUDE.md, MCP servers and permission rules. Turn it off for a plain assistant. |
| Extra instructions | empty | Added to every conversation, for example "Answer in Chinese". |
| Follow the paper I'm reading | on | Off means the chat only changes when you pick a paper yourself. |
| Warm color theme for all of Zotero | off | Same switch as in the appearance bar and the Tools menu. |

Settings take effect on the next message. You don't need to restart Zotero.

## Working with LLM for Zotero

If you also use the [LLM for Zotero](https://github.com/yilewang/llm-for-zotero) plugin, you can give Claude its library tools. Register its MCP server with Claude Code (`claude mcp add ...`, see that plugin's documentation), keep "Load my Claude Code user settings" on, and add `mcp__zotero` to the allowed tools. Claude can then search your library, write notes and add highlights. Think before you allow tools that delete items or run commands.

## How it works

For each conversation the plugin starts one `claude -p` process with stream-json input and output, and keeps it alive between messages. It stops idle processes after 15 minutes. The next message starts a new process that resumes the same Claude Code session (`--resume`), so nothing is lost.

Every message begins with a short `<zotero_context>` block: title, authors, year, DOI, the path of the PDF and the page you are on. The first message of a conversation also includes the abstract. Claude Code's own Read tool opens the PDF. The plugin passes `--add-dir` for your Zotero storage folder so Claude is allowed to read it, and `--permission-mode dontAsk` so tools outside the allowed list are refused instead of waiting for a confirmation nobody can give.

Conversations are saved as JSON files in `<Zotero data directory>/claude-code/conversations/`. Delete that folder to clear all history.

## Privacy and safety

There is no server in between. The plugin talks to the `claude` process on your machine, and Claude Code talks to Anthropic exactly as it does when you use it in a terminal. That means your messages, the context block and any pages Claude reads are sent to Anthropic under your account.

Zotero's interface code runs with full access to your computer, so the plugin never inserts model output as HTML. A small Markdown renderer builds every element by hand and puts text in with `textContent`. Links open in your browser and only `http`, `https` and `mailto` links are clickable.

Adding `Edit`, `Write` or `Bash` to the allowed tools lets Claude change files or run commands without asking. Only do that if you really want it.

## Known limitations

- Math is shown as plain text in a math font. It is not typeset yet.
- Reader windows (the "open in new windows" mode) don't have Zotero's item pane, so use the chat window with them.
- Only Windows has been tested so far. The macOS and Linux code paths are there but unverified. Reports are welcome.
- If your CLAUDE.md gives Claude a persona or house rules, those show up in the answers too. Turn off "Load my Claude Code user settings" if you don't want that here.

## Building from source

```
python scripts/build.py
```

This writes `build/zotero-claude-code-<version>.xpi` and `build/update.json`. Zotero checks `update.json` for updates, so attach both files to the GitHub release tagged `v<version>`.

For development, skip the `.xpi`. Close Zotero, create a text file named `zotero-claude-code@yufeixia` in your Zotero profile's `extensions` folder that contains the full path of this repo's `addon` folder, delete the `extensions.lastAppBuildId` and `extensions.lastAppVersion` lines from the profile's `prefs.js`, and start Zotero. Enable the plugin once under Tools > Plugins. After that, restarting Zotero picks up your changes.

## See also

[Warm Theme for Zotero](https://github.com/YufeiXIA/zotero-warm-theme) is the same warm color theme as a small standalone plugin, for people who want the look without the chat.

## License

[MIT](LICENSE)
