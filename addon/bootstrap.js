/* global Zotero, Services, Components, ChromeUtils */
var chromeHandle;

function install() {}
function uninstall() {}

async function startup({ id, version, rootURI }) {
	await Zotero.initializationPromise;

	const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
		.getService(Components.interfaces.amIAddonManagerStartup);
	const manifestURI = Services.io.newURI(rootURI + "manifest.json");
	chromeHandle = aomStartup.registerChrome(manifestURI, [
		["content", "zotero-claude-code", rootURI + "content/"],
	]);

	for (const file of ["markdown.js", "claude-process.js", "store.js", "context.js", "chat-view.js", "plugin.js"]) {
		Services.scriptloader.loadSubScript(rootURI + "content/" + file);
	}
	ZCC.Plugin.init({ id, version, rootURI });
	await ZCC.Plugin.start();
}

function onMainWindowLoad({ window }) {
	ZCC.Plugin.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	ZCC.Plugin.removeFromWindow(window);
}

function shutdown() {
	try {
		ZCC.Plugin.stop();
	}
	finally {
		chromeHandle?.destruct();
		chromeHandle = null;
		ZCC = undefined;
	}
}
