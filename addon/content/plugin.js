/* global Zotero, ZCC */
ZCC.Plugin = (() => {
	const PANE_ID = "zotero-claude-code-chat";
	const CHROME = "chrome://zotero-claude-code/content/";
	const SVG_NS = "http://www.w3.org/2000/svg";

	let pluginID = null;
	let notifierID = null;
	let chatWindow = null;
	let windowView = null;
	const sidebarViews = new Set();
	const cleanups = [];

	function init({ id }) {
		pluginID = id;
	}

	async function start() {
		Zotero.ClaudeCode = api;

		Zotero.PreferencePanes.register({
			pluginID,
			src: CHROME + "preferences.xhtml",
			scripts: [CHROME + "preferences.js"],
			label: "Claude Code",
			image: CHROME + "icons/icon20.svg",
		});

		Zotero.ItemPaneManager.registerSection({
			paneID: PANE_ID,
			pluginID,
			header: { l10nID: "zcc-section-header", icon: CHROME + "icons/icon16.svg" },
			sidenav: { l10nID: "zcc-section-sidenav", icon: CHROME + "icons/icon20.svg" },
			sectionButtons: [{
				type: "popout",
				icon: CHROME + "icons/popout16.svg",
				l10nID: "zcc-section-popout",
				onClick: () => openWindow(),
			}],
			onInit: ({ body }) => {
				const view = ZCC.ChatView.mount(body, {
					mode: "sidebar",
					onPopOut: pos => openWindow(pos),
					onDock: () => dock(),
					onShowWindow: () => openWindow(),
					isPoppedOut: () => isWindowOpen(),
				});
				body._zccView = view;
				sidebarViews.add(view);
			},
			onDestroy: ({ body }) => {
				const view = body._zccView;
				if (view) {
					sidebarViews.delete(view);
					view.destroy();
				}
			},
			onItemChange: ({ item, setEnabled }) => {
				setEnabled(true);
				if (item && Zotero.Prefs.get("extensions.zotero-claude-code.followReader", true)) {
					ZCC.Store.activate(item);
				}
			},
			onRender: () => {},
		});

		Zotero.Reader.registerEventListener("renderToolbar", onRenderToolbar, pluginID);
		Zotero.Reader.registerEventListener("renderTextSelectionPopup", onRenderSelectionPopup, pluginID);
		cleanups.push(() => {
			Zotero.Reader.unregisterEventListener("renderToolbar", onRenderToolbar);
			Zotero.Reader.unregisterEventListener("renderTextSelectionPopup", onRenderSelectionPopup);
		});

		notifierID = Zotero.Notifier.registerObserver({
			notify: (event, type, ids) => {
				if (type === "tab" && event === "select" && ids?.[0]) ZCC.Context.onTabSelect(ids[0]);
			},
		}, ["tab"], "zotero-claude-code");

		cleanups.push(ZCC.Context.onChange(() => ZCC.Store.followCurrent()));

		// Readers that were already open before the plugin started (some may still be loading)
		addButtonToOpenReaders();
		for (const delay of [1500, 4000, 10000]) {
			const timer = Zotero.getMainWindow()?.setTimeout(addButtonToOpenReaders, delay);
			if (timer) cleanups.push(() => Zotero.getMainWindow()?.clearTimeout(timer));
		}

		for (const win of Zotero.getMainWindows()) {
			if (win.ZoteroPane) addToWindow(win);
		}
		await ZCC.Store.followCurrent();
	}

	// ---- main window additions ----

	function addToWindow(win) {
		const doc = win.document;
		win.MozXULElement.insertFTLIfNeeded("zotero-claude-code.ftl");
		if (!doc.getElementById("zcc-stylesheet")) {
			const link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
			link.id = "zcc-stylesheet";
			link.rel = "stylesheet";
			link.href = CHROME + "chat.css";
			doc.documentElement.appendChild(link);
		}
		const tools = doc.getElementById("menu_ToolsPopup");
		if (tools && !doc.getElementById("zcc-menu-open")) {
			const item = doc.createXULElement("menuitem");
			item.id = "zcc-menu-open";
			item.setAttribute("data-l10n-id", "zcc-menu-open-chat");
			item.addEventListener("command", () => openWindow());
			tools.appendChild(item);
		}
	}

	function removeFromWindow(win) {
		// Last main window closing means Zotero is quitting; don't let our window keep it alive
		const others = Zotero.getMainWindows().filter(w => w !== win && !w.closed);
		if (!others.length && isWindowOpen()) chatWindow.close();
		const doc = win.document;
		doc.getElementById("zcc-stylesheet")?.remove();
		doc.getElementById("zcc-menu-open")?.remove();
		doc.querySelector('link[href="zotero-claude-code.ftl"]')?.remove();
	}

	// ---- reader integration ----

	function svgIcon(doc) {
		const svg = doc.createElementNS(SVG_NS, "svg");
		// 20px like the reader's own toolbar icons
		svg.setAttribute("width", "20");
		svg.setAttribute("height", "20");
		svg.setAttribute("viewBox", "-2 -2 20 20");
		svg.setAttribute("fill", "none");
		const path = doc.createElementNS(SVG_NS, "path");
		// Speech bubble with a small spark
		path.setAttribute("d", "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z");
		path.setAttribute("stroke", "currentColor");
		path.setAttribute("stroke-width", "1.2");
		path.setAttribute("stroke-linejoin", "round");
		const spark = doc.createElementNS(SVG_NS, "path");
		spark.setAttribute("d", "M8 5v3M6.5 6.5h3");
		spark.setAttribute("stroke", "currentColor");
		spark.setAttribute("stroke-width", "1.2");
		spark.setAttribute("stroke-linecap", "round");
		svg.append(path, spark);
		return svg;
	}

	function readerButton(reader, doc) {
		const btn = doc.createElement("button");
		btn.className = "toolbar-button zcc-reader-button";
		btn.setAttribute("title", "Claude Code");
		btn.setAttribute("tabindex", "-1");
		btn.append(svgIcon(doc));
		btn.addEventListener("click", () => openForReader(reader));
		return btn;
	}

	function onRenderToolbar(event) {
		const { reader, doc, append } = event;
		ZCC.Context.track(reader);
		append(readerButton(reader, doc));
	}

	// Readers restored at Zotero startup render their toolbar before our listener exists.
	// Put the button into the same slot renderToolbar would have used.
	function addButtonToOpenReaders() {
		for (const reader of ZCC.Context.openReaders()) {
			ZCC.Context.track(reader);
			const doc = reader._iframeWindow?.document;
			const slot = doc?.querySelector(".toolbar .end .custom-sections");
			if (slot && !slot.querySelector(".zcc-reader-button")) slot.append(readerButton(reader, doc));
		}
	}

	function onRenderSelectionPopup(event) {
		const { reader, doc, params, append } = event;
		const text = params?.annotation?.text;
		if (!text) return;
		const btn = doc.createElement("button");
		btn.className = "toolbar-button wide-button zcc-ask-button";
		btn.textContent = String(Zotero.locale || "").startsWith("zh") ? "问 Claude" : "Ask Claude";
		btn.addEventListener("click", () => askAbout(reader, text));
		append(btn);
	}

	async function focusReaderPaper(reader) {
		ZCC.Context.track(reader);
		ZCC.Store.setPinned(false);
		const item = Zotero.Items.get(reader.itemID);
		await ZCC.Store.activate(item, { force: true });
	}

	async function openForReader(reader) {
		await focusReaderPaper(reader);
		openWindow();
	}

	function visibleSidebarView(doc) {
		for (const view of sidebarViews) {
			if (view.root.ownerDocument === doc && view.root.getClientRects().length > 0) return view;
		}
		return null;
	}

	async function askAbout(reader, text) {
		await focusReaderPaper(reader);
		ZCC.ChatView.setQuote(text);
		if (isWindowOpen()) {
			chatWindow.focus();
			windowView?.focus();
			return;
		}
		// Reading in a tab with the sidebar showing: use it. Otherwise open the window.
		const inTab = reader._window === Zotero.getMainWindow();
		const view = inTab && visibleSidebarView(reader._window.document);
		if (view) view.focus();
		else openWindow();
	}

	// ---- separate window ----

	function isWindowOpen() {
		return !!(chatWindow && !chatWindow.closed);
	}

	function openWindow(pos) {
		if (isWindowOpen()) {
			chatWindow.focus();
			return chatWindow;
		}
		const main = Zotero.getMainWindow();
		let features = "chrome,resizable,dialog=no";
		if (pos) features += `,left=${Math.round(pos.x - 40)},top=${Math.round(pos.y - 20)}`;
		chatWindow = main.openDialog(CHROME + "chat-window.xhtml", "zotero-claude-code-chat", features);
		refreshSidebars();
		return chatWindow;
	}

	// Called by chat-window.js after the window's document has loaded
	function mountWindow(win) {
		chatWindow = win;
		// A remembered size can be absurd (e.g. a long title stretched the first window).
		// Keep anything up to most of the screen; reset only obvious accidents.
		const avail = win.screen.availWidth;
		if (win.outerWidth > Math.max(1200, avail * 0.9)) {
			win.resizeTo(480, Math.min(900, win.screen.availHeight - 40));
		}
		windowView?.destroy();
		const container = win.document.getElementById("zcc-container");
		const view = ZCC.ChatView.mount(container, {
			mode: "window",
			onDock: () => dock(),
		});
		windowView = view;
		view.focus();
		win.addEventListener("unload", () => {
			view.destroy();
			if (windowView === view) windowView = null;
			if (chatWindow === win) chatWindow = null;
			refreshSidebars();
		}, { once: true });
		refreshSidebars();
	}

	function dock() {
		if (isWindowOpen()) chatWindow.close();
		chatWindow = null;
		refreshSidebars();
	}

	function refreshSidebars() {
		for (const view of sidebarViews) view.render();
	}

	function stop() {
		for (const fn of cleanups.splice(0)) {
			try {
				fn();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
		try {
			Zotero.ItemPaneManager.unregisterSection(PANE_ID);
		}
		catch (e) {}
		if (isWindowOpen()) chatWindow.close();
		for (const view of sidebarViews) view.destroy();
		sidebarViews.clear();
		ZCC.Store.shutdown();
		for (const win of Zotero.getMainWindows()) removeFromWindow(win);
		delete Zotero.ClaudeCode;
	}

	const api = {
		openWindow,
		dock,
		askAbout,
		_mountWindow: mountWindow,
		detectClaude: () => ZCC.Claude.detect(),
		_settingsChanged: () => {
			ZCC.Claude.resetCache();
			ZCC.Store.settingsChanged();
		},
		_debug: () => ({ ZCC }),
	};

	return { init, start, stop, addToWindow, removeFromWindow, openWindow };
})();
