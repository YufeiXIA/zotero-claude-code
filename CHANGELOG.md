# Changelog

The release workflow copies the section for the version in `addon/manifest.json` into the GitHub release notes.

## 0.3.0

Claude can now use your Zotero library from inside Zotero, with nothing extra to install.

### New

- **Library tools.** The plugin serves a small MCP server from Zotero's own local HTTP server and hands it to Claude Code. Claude can search the library, read an item's details, notes and highlights, and see what you have open or selected.
- **Write switch (✎).** When on, Claude can also create notes (in Markdown) and add highlights to a PDF by quoting the passage. Off by default; Claude only writes when you ask.
- **This paper / Library mode.** Ask about the paper in front of you, or about your whole library, starting from the items you have selected.
- **@ references.** Type `@` to attach other papers from your library to a message.
- **Images.** Paste a screenshot, drop an image file, or use 📎.
- **Quick actions and / commands.** Summarize, explain the method, key findings, limitations, translate this page, related papers in my library, reading note saved to Zotero. Add your own in Settings.
- **Save as note** on every answer.
- **Several chats per paper** with a history menu (🕘).
- **Model menu from Claude Code.** The list is read from your Claude Code, so new models (Haiku 5.5 and later) appear by themselves; the effort menu follows the chosen model.

### Changed

- Conversation files use a new format with threads. Existing files are migrated automatically on first load.
- The default model setting is now the alias `opus` (same model as before).

### Install

Download `zotero-claude-code-0.3.0.xpi` and install it from Tools > Plugins in Zotero 7 or later. Existing installs update automatically.

---

一句话版本：Claude 现在能直接用你的 Zotero 文献库了（搜索、读笔记和高亮；打开 ✎ 后还能写笔记、加高亮），不用再装任何桥接程序。新增本篇/文献库模式、@ 引用论文、粘贴截图、快捷操作与 / 命令、一键存为笔记、每篇论文多段对话，模型菜单直接来自 Claude Code。

## 0.2.0

- Color themes for the chat (Auto, Light, Warm, Dark) and an adjustable text size.
- An optional warm color theme for all of Zotero.

## 0.1.0

- First release: chat with the paper you are reading, in the item pane or a separate window, through the Claude Code CLI.
