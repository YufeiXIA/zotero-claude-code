/* global Zotero, document */
var ZCCPrefs = {
	init() {
		// Pref changes apply to the next message: restart idle Claude processes
		this._observer = Zotero.Prefs.registerObserver("extensions.zotero-claude-code.", () => {
			Zotero.ClaudeCode?._settingsChanged?.();
		}, true);
		window.addEventListener("unload", () => Zotero.Prefs.unregisterObserver(this._observer), { once: true });
	},

	async detect() {
		const out = document.getElementById("zcc-detect-result");
		out.textContent = "…";
		try {
			const found = await Zotero.ClaudeCode.detectClaude();
			if (!found) {
				out.textContent = "Claude Code was not found. Install it, run `claude` once to sign in, then try again.";
				return;
			}
			const input = document.getElementById("zcc-claude-path");
			input.value = found.path;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			Zotero.Prefs.set("extensions.zotero-claude-code.claudePath", found.path, true);
			out.textContent = `Found Claude Code ${found.version}`;
		}
		catch (e) {
			out.textContent = String(e.message || e);
		}
	},
};
