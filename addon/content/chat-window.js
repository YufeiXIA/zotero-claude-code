/* global Zotero */
// The window asks the plugin to mount the chat view once its own document has loaded.
// (Listeners added by the opener can be lost when the initial about:blank page is replaced.)
window.addEventListener("load", () => {
	Zotero.ClaudeCode?._mountWindow(window);
}, { once: true });
