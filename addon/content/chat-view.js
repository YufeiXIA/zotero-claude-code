/* global Zotero, ChromeUtils, IOUtils, ZCC */
// The chat UI. The same view is mounted in the item pane section and in the separate window.
ZCC.ChatView = (() => {
	const el = (doc, tag, cls, text) => ZCC.Markdown.el(doc, tag, cls, text);

	const STRINGS = {
		en: {
			noPaper: "No paper selected",
			noPaperHint: "Open a PDF or select an item, and the chat follows it.",
			library: "Your library",
			libraryHint: "Ask about your library as a whole. Select items in the library to point Claude at them.",
			selectedCount: "{n} selected",
			page: "p. {n}",
			placeholder: "Ask about this paper…  (@ to add a paper, / for commands, paste a screenshot)",
			placeholderLibrary: "Ask about your library…  (@ to add a paper, / for commands)",
			send: "Send",
			stop: "Stop",
			newChat: "New chat",
			history: "Earlier chats about this",
			historyEmpty: "No earlier chats.",
			untitled: "(no messages)",
			deleteChat: "Delete this chat",
			confirmDelete: "Delete this chat? This cannot be undone.",
			pin: "Stay on this paper",
			unpin: "Follow the paper I'm reading",
			popOut: "Open in a separate window (or drag this bar out)",
			dock: "Move back to the sidebar",
			dragHint: "Drag out to open a separate window",
			thinking: "Thinking…",
			you: "You",
			claude: "Claude",
			interrupted: "Stopped.",
			quote: "Selected text",
			removeQuote: "Remove",
			poppedOut: "The chat is open in its own window.",
			showWindow: "Show window",
			bringBack: "Bring it back here",
			emptyTitle: "Ask anything about this paper",
			emptyLibrary: "Ask anything about your library",
			emptyGeneral: "Ask anything",
			copy: "Copy",
			copied: "Copied",
			saveNote: "Save as note",
			savedNote: "Saved to Zotero",
			saveNoteFailed: "Could not save the note",
			modelTitle: "Model (switching keeps the conversation)",
			effortTitle: "Reasoning effort",
			effortDefault: "effort: auto",
			modePaper: "This paper",
			modeLibrary: "Library",
			modeTitle: "Chat about the paper you are reading, or about your whole library",
			writeOn: "Claude may write notes and highlights (click to turn off)",
			writeOff: "Claude is read-only (click to let it write notes and highlights)",
			attach: "Attach an image",
			removeImage: "Remove image",
			imageTooLarge: "That image is larger than 4 MB; please use a smaller one.",
			refsTitle: "Papers attached with @",
			noResults: "No matching papers",
			searching: "Searching…",
			quickTitle: "Quick actions",
			commands: "Commands",
			appearance: "Appearance: color and text size (Ctrl+= / Ctrl+- also work)",
			themeLabel: "Color",
			sizeLabel: "Text size",
			theme_auto: "Auto",
			theme_light: "Light",
			theme_warm: "Warm",
			theme_dark: "Dark",
			zoteroTheme: "Use this warm look for all of Zotero",
			smaller: "Smaller text",
			larger: "Larger text",
			today: "Today",
			yesterday: "Yesterday",
		},
		zh: {
			noPaper: "未选中论文",
			noPaperHint: "打开一篇 PDF 或选中一个条目，对话会自动跟过去。",
			library: "我的文献库",
			libraryHint: "针对整个文献库提问。在文献库里选中条目，Claude 会优先看它们。",
			selectedCount: "已选 {n} 条",
			page: "第 {n} 页",
			placeholder: "问点关于这篇论文的问题…（@ 引用其他论文，/ 快捷命令，可直接粘贴截图）",
			placeholderLibrary: "问点关于文献库的问题…（@ 引用论文，/ 快捷命令）",
			send: "发送",
			stop: "停止",
			newChat: "新对话",
			history: "之前的对话",
			historyEmpty: "还没有别的对话。",
			untitled: "（空对话）",
			deleteChat: "删除这段对话",
			confirmDelete: "删除这段对话？删除后无法恢复。",
			pin: "固定在这篇论文",
			unpin: "跟随我正在读的论文",
			popOut: "在独立窗口中打开（也可以把这一栏拖出去）",
			dock: "放回侧边栏",
			dragHint: "拖出去可以打开独立窗口",
			thinking: "思考中…",
			you: "你",
			claude: "Claude",
			interrupted: "已停止。",
			quote: "选中的文字",
			removeQuote: "移除",
			poppedOut: "对话已在独立窗口中打开。",
			showWindow: "显示窗口",
			bringBack: "放回这里",
			emptyTitle: "关于这篇论文，问什么都行",
			emptyLibrary: "关于你的文献库，问什么都行",
			emptyGeneral: "问什么都行",
			copy: "复制",
			copied: "已复制",
			saveNote: "存为笔记",
			savedNote: "已存入 Zotero",
			saveNoteFailed: "笔记保存失败",
			modelTitle: "模型（切换后对话会接着聊）",
			effortTitle: "推理强度",
			effortDefault: "强度：自动",
			modePaper: "本篇",
			modeLibrary: "文献库",
			modeTitle: "围绕正在读的论文聊，还是围绕整个文献库聊",
			writeOn: "允许 Claude 写笔记和加高亮（点击关闭）",
			writeOff: "Claude 只读（点击允许它写笔记和加高亮）",
			attach: "添加图片",
			removeImage: "移除图片",
			imageTooLarge: "这张图片超过 4 MB，请换一张小一点的。",
			refsTitle: "用 @ 引用的论文",
			noResults: "没有匹配的论文",
			searching: "搜索中…",
			quickTitle: "快捷操作",
			commands: "命令",
			appearance: "外观：配色和字号（也可以用 Ctrl+= / Ctrl+-）",
			themeLabel: "配色",
			sizeLabel: "字号",
			theme_auto: "自动",
			theme_light: "浅色",
			theme_warm: "暖色",
			theme_dark: "深色",
			zoteroTheme: "Zotero 整体也用这套暖色",
			smaller: "字号调小",
			larger: "字号调大",
			today: "今天",
			yesterday: "昨天",
		},
	};

	function lang() {
		return String(Zotero.locale || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
	}

	function t(key, vars) {
		let s = STRINGS[lang()][key] ?? STRINGS.en[key];
		if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace("{" + k + "}", v);
		return s;
	}

	// Quick actions and / commands. `write` ones need the write toggle; `library` ones make
	// most sense in library mode (they are offered everywhere, the wording adapts).
	const COMMANDS = [
		{ id: "summarize", en: ["Summarize", "Summarize this paper: the question, the method, the main findings and the limitations, in a few short paragraphs. Give page numbers for the findings."], zh: ["总结", "总结这篇论文：研究问题、方法、主要发现和局限，分几个短段落写，并给出主要发现所在的页码。"] },
		{ id: "method", en: ["Explain the method", "Explain the method step by step in plain words, as if to a student who knows the basics of the field."], zh: ["讲解方法", "用通俗的话一步步讲解方法部分，就当是给一个懂领域基础的学生讲。"] },
		{ id: "findings", en: ["Key findings", "List the key findings, each with the page where it is stated and the evidence behind it."], zh: ["主要发现", "列出主要发现，每条给出所在页码和支撑它的证据。"] },
		{ id: "limits", en: ["Limitations", "What are the limitations and the open questions this paper leaves? Distinguish what the authors admit from what you see."], zh: ["局限与问题", "这篇论文有哪些局限和遗留问题？分清哪些是作者自己承认的，哪些是你看出来的。"] },
		{ id: "page", en: ["This page", "Explain what is on the page I am on."], zh: ["这一页", "解释我现在这一页讲了什么。"] },
		{ id: "translate", en: ["Translate this page", "Translate the page I am on into English, keeping the paragraph structure. Keep technical terms in the original language in parentheses the first time they appear."], zh: ["翻译这一页", "把我现在这一页翻译成中文，保持段落结构。术语第一次出现时在括号里保留原文。"] },
		{ id: "related", en: ["Related in my library", "Which papers in my Zotero library are related to this one? Search the library, then explain how each relates."], zh: ["库里的相关论文", "我的 Zotero 文献库里有哪些和这篇相关的论文？先搜索文献库，再说明每篇是怎么相关的。"], library: true },
		{ id: "note", en: ["Reading note → Zotero", "Write a structured reading note for this paper (problem, method, findings, my takeaways, questions), then save it to Zotero as a note on this item with create_note."], zh: ["写阅读笔记并存入 Zotero", "为这篇论文写一份结构化阅读笔记（问题、方法、发现、要点、疑问），然后用 create_note 把它作为这篇论文的笔记存进 Zotero。"], write: true },
		{ id: "highlight", en: ["Highlight key sentences", "Highlight the three sentences that state the paper's main claims, using add_highlight, and tell me which ones you chose."], zh: ["高亮关键句", "用 add_highlight 把陈述论文主要结论的三句话加上高亮，然后告诉我你选了哪几句。"], write: true },
	];

	function customCommands() {
		const out = [];
		const raw = Zotero.Prefs.get(PREF + "customCommands", true) || "";
		for (const line of String(raw).split("\n")) {
			const m = line.match(/^\s*([^|:]{1,40}?)\s*[|:]\s*(.+?)\s*$/);
			if (m) out.push({ id: "custom-" + out.length, label: m[1], prompt: m[2], custom: true });
		}
		return out;
	}

	function commands({ includeWrite }) {
		const l = lang();
		const list = COMMANDS
			.filter(c => includeWrite || !c.write)
			.map(c => ({ id: c.id, label: c[l][0], prompt: c[l][1], write: !!c.write }));
		return [...list, ...customCommands()];
	}

	const PREF = "extensions.zotero-claude-code.";
	const THEMES = ["auto", "light", "warm", "dark"];
	const DEFAULT_FONT_SIZE = 13;
	const MIN_FONT_SIZE = 11;
	const MAX_FONT_SIZE = 22;
	const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
	const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

	function fontSize() {
		const value = parseInt(Zotero.Prefs.get(PREF + "fontSize", true));
		return Number.isFinite(value) ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value)) : DEFAULT_FONT_SIZE;
	}

	function setFontSize(size) {
		Zotero.Prefs.set(PREF + "fontSize", Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size))), true);
	}

	// A passage the user picked in the reader, waiting to be sent
	let pendingQuote = null;
	const quoteListeners = new Set();

	function setQuote(text) {
		pendingQuote = text ? String(text).trim() : null;
		for (const fn of quoteListeners) fn();
	}

	function button(doc, cls, label, title, onClick) {
		const b = el(doc, "button", "zcc-btn " + cls, label);
		if (title) b.setAttribute("title", title);
		b.addEventListener("click", (event) => {
			event.stopPropagation();
			onClick(event);
		});
		return b;
	}

	function bytesToBase64(bytes) {
		let binary = "";
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
		return btoa(binary);
	}

	function dateLabel(ts) {
		const d = new Date(ts);
		const now = new Date();
		const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
		if (sameDay(d, now)) return t("today") + " " + time;
		const yesterday = new Date(now);
		yesterday.setDate(now.getDate() - 1);
		if (sameDay(d, yesterday)) return t("yesterday") + " " + time;
		return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
	}

	/**
	 * @param {HTMLElement} container
	 * @param {{mode: "sidebar"|"window", onPopOut?: Function, onDock?: Function, onShowWindow?: Function, isPoppedOut?: Function}} options
	 */
	function mount(container, options) {
		const doc = container.ownerDocument;
		const win = doc.defaultView;
		const rendered = new WeakMap();

		const root = el(doc, "div", "zcc-root");
		root.dataset.mode = options.mode;

		// ---- header: paper title + actions. In the sidebar it doubles as the drag handle. ----
		const header = el(doc, "div", "zcc-header");
		const paperBox = el(doc, "div", "zcc-paper");
		const paperTitle = el(doc, "div", "zcc-paper-title");
		const paperMeta = el(doc, "div", "zcc-paper-meta");
		paperBox.append(paperTitle, paperMeta);
		const actions = el(doc, "div", "zcc-actions");
		const pinBtn = button(doc, "zcc-icon-btn zcc-pin", "📌", "", () => {
			const conv = ZCC.Store.getActive();
			if (ZCC.Store.isPinned()) {
				ZCC.Store.setPinned(false);
				ZCC.Store.followCurrent();
			}
			else if (conv) {
				ZCC.Store.setPinned(true);
			}
		});
		const historyBtn = button(doc, "zcc-icon-btn zcc-history", "🕘", t("history"), () => togglePopup("history"));
		const newBtn = button(doc, "zcc-icon-btn", "＋", t("newChat"), () => ZCC.Store.newThread(ZCC.Store.getActive()));
		const moveBtn = options.mode === "sidebar"
			? button(doc, "zcc-icon-btn", "⧉", t("popOut"), () => options.onPopOut?.())
			: button(doc, "zcc-icon-btn", "⇲", t("dock"), () => options.onDock?.());
		const aaBtn = button(doc, "zcc-icon-btn zcc-aa", "Aa", t("appearance"), () => {
			appearanceBar.hidden = !appearanceBar.hidden;
			aaBtn.classList.toggle("zcc-active", !appearanceBar.hidden);
		});
		actions.append(aaBtn, historyBtn, pinBtn, newBtn, moveBtn);
		header.append(paperBox, actions);

		// ---- appearance bar: theme and font size, saved as prefs and shared by every view ----
		const appearanceBar = el(doc, "div", "zcc-appearance");
		appearanceBar.hidden = true;
		const themeSeg = el(doc, "div", "zcc-seg");
		const themeButtons = {};
		for (const theme of THEMES) {
			const b = button(doc, "", t("theme_" + theme), "", () => Zotero.Prefs.set(PREF + "theme", theme, true));
			themeButtons[theme] = b;
			themeSeg.append(b);
		}
		const sizeSeg = el(doc, "div", "zcc-seg");
		const sizeValue = el(doc, "span", "zcc-size-value");
		sizeSeg.append(
			button(doc, "", "A−", t("smaller"), () => setFontSize(fontSize() - 1)),
			sizeValue,
			button(doc, "", "A+", t("larger"), () => setFontSize(fontSize() + 1)),
		);
		const zoteroThemeLabel = el(doc, "label", "zcc-zotero-theme");
		const zoteroThemeBox = el(doc, "input");
		zoteroThemeBox.setAttribute("type", "checkbox");
		zoteroThemeBox.addEventListener("change", () => Zotero.Prefs.set(PREF + "zoteroTheme", zoteroThemeBox.checked, true));
		zoteroThemeLabel.append(zoteroThemeBox, doc.createTextNode(" " + t("zoteroTheme")));
		appearanceBar.append(el(doc, "span", null, t("themeLabel")), themeSeg, el(doc, "span", null, t("sizeLabel")), sizeSeg, zoteroThemeLabel);

		// ---- messages, pending quote, quick actions, composer ----
		const messages = el(doc, "div", "zcc-messages");
		const quoteBox = el(doc, "div", "zcc-quote");
		const quick = el(doc, "div", "zcc-quick");
		quick.setAttribute("title", t("quickTitle"));

		const composerWrap = el(doc, "div", "zcc-composer-wrap");
		const popup = el(doc, "div", "zcc-popup");
		popup.hidden = true;
		const composer = el(doc, "div", "zcc-composer");
		const attachments = el(doc, "div", "zcc-attachments");
		attachments.hidden = true;
		const input = el(doc, "textarea", "zcc-input");
		input.setAttribute("rows", "3");
		const bar = el(doc, "div", "zcc-composer-bar");

		const modeSeg = el(doc, "div", "zcc-seg zcc-mode");
		modeSeg.setAttribute("title", t("modeTitle"));
		const modeButtons = {
			paper: button(doc, "", t("modePaper"), "", () => ZCC.Store.setMode("paper")),
			library: button(doc, "", t("modeLibrary"), "", () => ZCC.Store.setMode("library")),
		};
		modeSeg.append(modeButtons.paper, modeButtons.library);
		const writeBtn = button(doc, "zcc-icon-btn zcc-write", "✎", "", () => {
			Zotero.Prefs.set(PREF + "allowWrite", !Zotero.Prefs.get(PREF + "allowWrite", true), true);
			ZCC.Store.settingsChanged();
		});
		const attachBtn = button(doc, "zcc-icon-btn", "📎", t("attach"), () => pickImages());
		const modelSelect = el(doc, "select", "zcc-select zcc-model");
		modelSelect.setAttribute("title", t("modelTitle"));
		const effortSelect = el(doc, "select", "zcc-select zcc-effort");
		effortSelect.setAttribute("title", t("effortTitle"));
		const sendBtn = button(doc, "zcc-send", t("send"), "", () => submit());
		bar.append(modeSeg, writeBtn, attachBtn, el(doc, "span", "zcc-spacer"), modelSelect, effortSelect, sendBtn);
		composer.append(attachments, input, bar);
		composerWrap.append(popup, composer);

		const popped = el(doc, "div", "zcc-popped");
		popped.append(
			el(doc, "div", "zcc-popped-text", t("poppedOut")),
			button(doc, "", t("showWindow"), "", () => options.onShowWindow?.()),
			button(doc, "", t("bringBack"), "", () => options.onDock?.()),
		);

		root.append(header, appearanceBar, messages, quoteBox, quick, composerWrap, popped);
		container.append(root);

		// ---- model and effort menus, fed by Claude Code's own model list ----

		function fillSelect(select, options, current) {
			const all = options.some(o => o.id === current) ? options : [...options, { id: current, label: current }];
			select.replaceChildren();
			for (const opt of all) {
				const o = el(doc, "option", null, opt.label);
				o.value = opt.id;
				if (opt.title) o.setAttribute("title", opt.title);
				if (opt.id === current) o.selected = true;
				select.append(o);
			}
		}

		function renderModelMenus() {
			const modelPref = (Zotero.Prefs.get(PREF + "model", true) || "").trim();
			const entry = ZCC.Models.find(modelPref);
			const current = entry ? entry.id : modelPref;
			fillSelect(modelSelect, ZCC.Models.list().map(m => ({ id: m.id, label: m.label, title: m.description })), current);
			const effortPref = (Zotero.Prefs.get(PREF + "effort", true) || "").trim();
			const efforts = ZCC.Models.effortsFor(current);
			fillSelect(effortSelect, [{ id: "", label: t("effortDefault") }, ...efforts.map(e => ({ id: e, label: e }))], effortPref);
		}

		modelSelect.addEventListener("change", () => {
			Zotero.Prefs.set(PREF + "model", modelSelect.value, true);
			const efforts = ZCC.Models.effortsFor(modelSelect.value);
			if (effortSelect.value && !efforts.includes(effortSelect.value)) Zotero.Prefs.set(PREF + "effort", "", true);
			ZCC.Store.settingsChanged();
			renderModelMenus();
		});
		effortSelect.addEventListener("change", () => {
			Zotero.Prefs.set(PREF + "effort", effortSelect.value, true);
			ZCC.Store.settingsChanged();
		});
		const unsubscribeModels = ZCC.Models.onChange(renderModelMenus);
		renderModelMenus();
		ZCC.Models.load();

		// ---- appearance ----

		function applyAppearance() {
			const theme = Zotero.Prefs.get(PREF + "theme", true) || "auto";
			if (theme === "auto") delete root.dataset.theme;
			else root.dataset.theme = theme;
			for (const [name, b] of Object.entries(themeButtons)) b.classList.toggle("zcc-active", name === theme);
			zoteroThemeBox.checked = !!Zotero.Prefs.get(PREF + "zoteroTheme", true);
			const size = fontSize();
			root.style.setProperty("--zcc-font-size", size + "px");
			sizeValue.textContent = size + "px";
			// Paint the window itself too, so no stripe of the old color shows at the edges
			if (options.mode === "window") {
				doc.documentElement.style.background = win.getComputedStyle(root).getPropertyValue("--zcc-bg");
			}
		}

		// Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel change the font size, like in a browser
		root.addEventListener("keydown", (event) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
			if (event.key === "=" || event.key === "+") setFontSize(fontSize() + 1);
			else if (event.key === "-") setFontSize(fontSize() - 1);
			else if (event.key === "0") setFontSize(DEFAULT_FONT_SIZE);
			else return;
			event.preventDefault();
			event.stopPropagation();
		});
		root.addEventListener("wheel", (event) => {
			if (!(event.ctrlKey || event.metaKey)) return;
			event.preventDefault();
			setFontSize(fontSize() + (event.deltaY < 0 ? 1 : -1));
		}, { passive: false });

		const prefObservers = [
			Zotero.Prefs.registerObserver(PREF + "theme", applyAppearance, true),
			Zotero.Prefs.registerObserver(PREF + "fontSize", applyAppearance, true),
			Zotero.Prefs.registerObserver(PREF + "zoteroTheme", applyAppearance, true),
			Zotero.Prefs.registerObserver(PREF + "allowWrite", () => {
				renderQuick();
				render();
			}, true),
			Zotero.Prefs.registerObserver(PREF + "customCommands", () => renderQuick(), true),
		];
		applyAppearance();

		// ---- attachments: papers added with @ and pasted images ----

		let pendingRefs = [];
		let pendingImages = [];

		function renderAttachments() {
			attachments.replaceChildren();
			attachments.hidden = !pendingRefs.length && !pendingImages.length;
			for (const paper of pendingRefs) {
				const chip = el(doc, "span", "zcc-ref-chip");
				chip.setAttribute("title", paper.title);
				chip.append(el(doc, "span", "zcc-ref-at", "@"), el(doc, "span", "zcc-ref-text", paper.title));
				chip.append(button(doc, "zcc-chip-x", "×", t("removeQuote"), () => {
					pendingRefs = pendingRefs.filter(p => p !== paper);
					renderAttachments();
				}));
				attachments.append(chip);
			}
			for (const image of pendingImages) {
				const thumb = el(doc, "span", "zcc-thumb");
				const img = el(doc, "img");
				img.src = `data:${image.media_type};base64,${image.data}`;
				thumb.append(img, button(doc, "zcc-chip-x", "×", t("removeImage"), () => {
					pendingImages = pendingImages.filter(i => i !== image);
					renderAttachments();
				}));
				attachments.append(thumb);
			}
		}

		function addRef(paper) {
			if (!paper || pendingRefs.some(p => p.key === paper.key)) return;
			pendingRefs.push(paper);
			renderAttachments();
		}

		async function addImageFile(file) {
			if (!file || !IMAGE_TYPES.includes(file.type)) return;
			if (file.size > MAX_IMAGE_BYTES) {
				win.alert(t("imageTooLarge"));
				return;
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			pendingImages.push({ media_type: file.type, data: bytesToBase64(bytes) });
			renderAttachments();
		}

		async function pickImages() {
			try {
				const { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");
				const fp = new FilePicker();
				fp.init(win, t("attach"), fp.modeOpenMultiple);
				fp.appendFilters(fp.filterImages ?? 0x08);
				if (await fp.show() !== fp.returnOK) return;
				for (const path of fp.files) {
					const ext = path.split(".").pop().toLowerCase();
					const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext];
					if (!type) continue;
					const bytes = await IOUtils.read(path);
					if (bytes.length > MAX_IMAGE_BYTES) {
						win.alert(t("imageTooLarge"));
						continue;
					}
					pendingImages.push({ media_type: type, data: bytesToBase64(bytes) });
				}
				renderAttachments();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}

		input.addEventListener("paste", (event) => {
			const files = [...(event.clipboardData?.files || [])].filter(f => IMAGE_TYPES.includes(f.type));
			if (!files.length) return;
			event.preventDefault();
			for (const file of files) addImageFile(file);
		});
		for (const target of [composer, messages]) {
			target.addEventListener("dragover", (event) => {
				if ([...(event.dataTransfer?.types || [])].includes("Files")) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
				}
			});
			target.addEventListener("drop", (event) => {
				const files = [...(event.dataTransfer?.files || [])].filter(f => IMAGE_TYPES.includes(f.type));
				if (!files.length) return;
				event.preventDefault();
				for (const file of files) addImageFile(file);
				input.focus();
			});
		}

		// ---- popup: / commands, @ papers, chat history ----

		let popupKind = null;
		let popupItems = [];
		let popupIndex = 0;
		let searchTimer = null;
		let searchSeq = 0;

		function closePopup() {
			popupKind = null;
			popupItems = [];
			popup.hidden = true;
			popup.replaceChildren();
			historyBtn.classList.remove("zcc-active");
		}

		function renderPopupList(items, { emptyText, onPick, extra } = {}) {
			popup.replaceChildren();
			popupItems = items;
			popupIndex = Math.min(popupIndex, Math.max(0, items.length - 1));
			if (!items.length) {
				popup.append(el(doc, "div", "zcc-popup-empty", emptyText || t("noResults")));
			}
			items.forEach((item, i) => {
				const row = el(doc, "div", "zcc-popup-item" + (i === popupIndex ? " zcc-selected" : "") + (item.current ? " zcc-current" : ""));
				row.append(el(doc, "div", "zcc-popup-title", item.title));
				if (item.subtitle) row.append(el(doc, "div", "zcc-popup-sub", item.subtitle));
				if (extra) {
					const node = extra(item);
					if (node) row.append(node);
				}
				row.addEventListener("mousedown", event => event.preventDefault()); // keep the textarea focused
				row.addEventListener("click", (event) => {
					event.stopPropagation();
					onPick(item);
				});
				popup.append(row);
			});
			popup.hidden = false;
		}

		function showCommands(filter) {
			popupKind = "commands";
			const f = String(filter || "").trim().toLowerCase();
			const items = commands({ includeWrite: !!Zotero.Prefs.get(PREF + "allowWrite", true) })
				.filter(c => !f || c.label.toLowerCase().includes(f) || c.id.includes(f) || c.prompt.toLowerCase().includes(f))
				.map(c => ({ title: (c.write ? "✎ " : "/") + c.label, subtitle: c.prompt, command: c }));
			renderPopupList(items, { onPick: (item) => {
				input.value = item.command.prompt;
				closePopup();
				input.focus();
				input.setSelectionRange(input.value.length, input.value.length);
			} });
		}

		function showPapers(query) {
			popupKind = "papers";
			const seq = ++searchSeq;
			if (!popupItems.length) renderPopupList([], { emptyText: t("searching"), onPick: () => {} });
			if (searchTimer) win.clearTimeout(searchTimer);
			searchTimer = win.setTimeout(async () => {
				let papers = [];
				try {
					papers = await ZCC.Context.searchItems(query, 8);
				}
				catch (e) {
					Zotero.logError(e);
				}
				if (seq !== searchSeq || popupKind !== "papers") return;
				const conv = ZCC.Store.getActive();
				const items = papers
					.filter(p => p.key !== conv?.paper?.key)
					.map(p => ({ title: p.title, subtitle: [p.creators, p.year].filter(Boolean).join(", "), paper: p }));
				renderPopupList(items, { onPick: (item) => {
					addRef(item.paper);
					// Remove the "@query" the user typed
					const caret = input.selectionStart;
					const before = input.value.slice(0, caret).replace(/(^|\s)@[^\s@]*$/, "$1");
					input.value = before + input.value.slice(caret);
					closePopup();
					input.focus();
					input.setSelectionRange(before.length, before.length);
				} });
			}, 150);
		}

		function showHistory() {
			popupKind = "history";
			historyBtn.classList.add("zcc-active");
			const conv = ZCC.Store.getActive();
			const items = ZCC.Store.threads(conv).map(th => ({
				title: th.title || t("untitled"),
				subtitle: dateLabel(th.updatedAt) + (th.messages.length ? ` · ${Math.ceil(th.messages.length / 2)}` : ""),
				thread: th,
				current: th === conv?.thread,
			}));
			popupIndex = Math.max(0, items.findIndex(i => i.current));
			renderPopupList(items, {
				emptyText: t("historyEmpty"),
				onPick: (item) => {
					closePopup();
					ZCC.Store.switchThread(conv, item.thread.id);
				},
				extra: (item) => button(doc, "zcc-chip-x", "×", t("deleteChat"), () => {
					if (!win.confirm(t("confirmDelete"))) return;
					closePopup();
					ZCC.Store.deleteThread(conv, item.thread.id);
				}),
			});
		}

		function togglePopup(kind) {
			if (popupKind === kind) closePopup();
			else if (kind === "history") showHistory();
		}

		// Decide from the text around the caret whether a / or @ popup should be open
		function updateTriggers() {
			const caret = input.selectionStart;
			const before = input.value.slice(0, caret);
			if (/^\/[^\s/]*$/.test(input.value) && caret === input.value.length) {
				popupIndex = popupKind === "commands" ? popupIndex : 0;
				showCommands(input.value.slice(1));
				return;
			}
			const at = before.match(/(^|\s)@([^\s@]*)$/);
			if (at) {
				if (popupKind !== "papers") {
					popupIndex = 0;
					popupItems = [];
				}
				showPapers(at[2]);
				return;
			}
			if (popupKind === "commands" || popupKind === "papers") closePopup();
		}

		input.addEventListener("input", updateTriggers);
		input.addEventListener("click", () => {
			if (popupKind === "papers" || popupKind === "commands") updateTriggers();
		});
		const onDocMouseDown = (event) => {
			if (!popup.hidden && !popup.contains(event.target) && event.target !== historyBtn && event.target !== input) closePopup();
		};
		doc.addEventListener("mousedown", onDocMouseDown);

		// ---- behaviour ----

		function submit() {
			const conv = ZCC.Store.getActive();
			if (!conv) return;
			if (conv.busy) {
				ZCC.Store.stop(conv);
				return;
			}
			const text = input.value;
			const quote = pendingQuote;
			if (!text.trim() && !quote && !pendingImages.length) return;
			const refs = pendingRefs;
			const images = pendingImages;
			input.value = "";
			pendingRefs = [];
			pendingImages = [];
			renderAttachments();
			closePopup();
			setQuote(null);
			ZCC.Store.send(conv, text, { quote, images, refs });
		}

		input.addEventListener("keydown", (event) => {
			if (!popup.hidden && popupKind) {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					if (!popupItems.length) return;
					popupIndex = (popupIndex + (event.key === "ArrowDown" ? 1 : popupItems.length - 1)) % popupItems.length;
					[...popup.querySelectorAll(".zcc-popup-item")].forEach((row, i) => row.classList.toggle("zcc-selected", i === popupIndex));
					popup.querySelector(".zcc-selected")?.scrollIntoView({ block: "nearest" });
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					closePopup();
					return;
				}
				if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && popupItems.length) {
					event.preventDefault();
					popup.querySelectorAll(".zcc-popup-item")[popupIndex]?.click();
					return;
				}
			}
			// Don't send while an IME (e.g. Chinese pinyin) is composing
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
				event.preventDefault();
				submit();
			}
		});
		// Keep Zotero's item-pane shortcuts from eating our keystrokes
		input.addEventListener("keypress", event => event.stopPropagation());

		if (options.mode === "sidebar") {
			header.setAttribute("draggable", "true");
			header.setAttribute("title", t("dragHint"));
			let start = null;
			let last = null;
			header.addEventListener("dragstart", (event) => {
				event.dataTransfer.setData("text/plain", "zotero-claude-code-chat");
				event.dataTransfer.effectAllowed = "move";
				start = { x: event.screenX, y: event.screenY };
				last = { ...start };
			});
			header.addEventListener("drag", (event) => {
				if (event.screenX || event.screenY) last = { x: event.screenX, y: event.screenY };
			});
			header.addEventListener("dragend", (event) => {
				const end = (event.screenX || event.screenY) ? { x: event.screenX, y: event.screenY } : last;
				const dropped = event.dataTransfer.dropEffect !== "none";
				const cancelled = event.dataTransfer.mozUserCancelled;
				if (!start || !end || dropped || cancelled) return;
				const moved = Math.hypot(end.x - start.x, end.y - start.y);
				if (moved > 100) options.onPopOut?.({ x: end.x, y: end.y });
			});
		}

		// ---- rendering ----

		function renderHeader(conv) {
			const paper = conv?.paper;
			if (conv?.isLibrary) {
				paperTitle.textContent = t("library");
				paperTitle.setAttribute("title", t("libraryHint"));
				let n = 0;
				try {
					n = (Zotero.getActiveZoteroPane()?.getSelectedItems() || []).filter(i => i.isRegularItem()).length;
				}
				catch (e) {}
				paperMeta.textContent = n ? t("selectedCount", { n }) : "";
			}
			else {
				paperTitle.textContent = paper ? paper.title : t("noPaper");
				paperTitle.setAttribute("title", paper ? paper.title : t("noPaperHint"));
				const meta = [];
				if (paper?.creators) meta.push(paper.creators);
				if (paper?.year) meta.push(paper.year);
				if (paper?.page) meta.push(t("page", { n: paper.page }));
				paperMeta.textContent = meta.join(" · ");
			}
			const isPinned = ZCC.Store.isPinned();
			pinBtn.classList.toggle("zcc-active", isPinned);
			pinBtn.setAttribute("title", isPinned ? t("unpin") : t("pin"));
			pinBtn.hidden = !!conv?.isLibrary;
			const threads = ZCC.Store.threads(conv);
			historyBtn.classList.toggle("zcc-has-items", threads.length > 1);
		}

		function renderEmpty(conv) {
			const box = el(doc, "div", "zcc-empty");
			const title = conv?.isLibrary ? t("emptyLibrary") : conv?.paper ? t("emptyTitle") : t("emptyGeneral");
			box.append(el(doc, "div", "zcc-empty-title", title));
			if (conv?.isLibrary) box.append(el(doc, "div", "zcc-empty-hint", t("libraryHint")));
			else if (!conv?.paper) box.append(el(doc, "div", "zcc-empty-hint", t("noPaperHint")));
			return box;
		}

		function renderQuick() {
			quick.replaceChildren();
			const conv = ZCC.Store.getActive();
			const write = !!Zotero.Prefs.get(PREF + "allowWrite", true);
			const list = commands({ includeWrite: write }).filter(c => !(conv?.isLibrary && ["page", "translate"].includes(c.id)));
			for (const c of list) {
				quick.append(button(doc, "zcc-chip" + (c.write ? " zcc-chip-write" : ""), c.label, c.prompt, () => {
					input.value = c.prompt;
					submit();
				}));
			}
			quick.hidden = !list.length || (!conv?.paper && !conv?.isLibrary);
		}

		function signature(msg) {
			return [msg.text.length, msg.tools?.map(x => x.summary + x.done + !!x.failed).join("|"), msg.thinking, msg.streaming, msg.error, msg.interrupted].join("~");
		}

		async function saveAsNote(conv, msg, btn) {
			try {
				const list = conv.messages;
				const idx = list.indexOf(msg);
				const question = idx > 0 ? list[idx - 1] : null;
				const title = (question?.text || question?.quote || "").replace(/\s+/g, " ").trim().slice(0, 80);
				await ZCC.Bridge.saveNote({ parentItemID: conv.paper?.itemID || null, title, markdown: msg.text });
				btn.textContent = t("savedNote");
			}
			catch (e) {
				Zotero.logError(e);
				btn.textContent = t("saveNoteFailed");
			}
			win.setTimeout(() => (btn.textContent = t("saveNote")), 2000);
		}

		function renderMessage(conv, msg) {
			const node = el(doc, "div", "zcc-msg zcc-" + msg.role);
			const who = el(doc, "div", "zcc-who", msg.role === "user" ? t("you") : t("claude"));
			node.append(who);
			if (msg.role === "user") {
				if (msg.refs?.length) {
					const refs = el(doc, "div", "zcc-msg-refs");
					for (const r of msg.refs) refs.append(el(doc, "span", "zcc-ref-chip zcc-ref-static", "@" + r.title));
					node.append(refs);
				}
				if (msg.images?.length) {
					const row = el(doc, "div", "zcc-msg-images");
					for (const image of msg.images) {
						const img = el(doc, "img", "zcc-msg-image");
						try {
							img.src = image.path ? Zotero.File.pathToFileURI(image.path) : `data:${image.media_type};base64,${image.data}`;
						}
						catch (e) {}
						row.append(img);
					}
					node.append(row);
				}
				if (msg.quote) node.append(el(doc, "blockquote", "zcc-msg-quote", msg.quote));
				if (msg.text) node.append(el(doc, "div", "zcc-user-text", msg.text));
				return node;
			}
			if (msg.tools?.length) {
				const tools = el(doc, "div", "zcc-tools");
				for (const tool of msg.tools) {
					const row = el(doc, "div", "zcc-tool" + (tool.done ? " zcc-done" : "") + (tool.failed ? " zcc-failed" : ""));
					row.append(el(doc, "span", "zcc-tool-dot"), el(doc, "span", "zcc-tool-text", tool.summary));
					tools.append(row);
				}
				node.append(tools);
			}
			if (msg.text) node.append(ZCC.Markdown.render(doc, msg.text));
			if (msg.streaming && msg.thinking) node.append(el(doc, "div", "zcc-thinking", t("thinking")));
			if (msg.error) node.append(el(doc, "div", "zcc-error", msg.error));
			if (msg.interrupted) node.append(el(doc, "div", "zcc-note", t("interrupted")));
			if (!msg.streaming && msg.text) {
				const foot = el(doc, "div", "zcc-msg-foot");
				const copy = button(doc, "zcc-mini", t("copy"), "", () => {
					Zotero.Utilities.Internal.copyTextToClipboard(msg.text);
					copy.textContent = t("copied");
					win.setTimeout(() => (copy.textContent = t("copy")), 1200);
				});
				foot.append(copy);
				const note = button(doc, "zcc-mini", t("saveNote"), "", () => saveAsNote(conv, msg, note));
				foot.append(note);
				node.append(foot);
			}
			return node;
		}

		let lastThreadId = null;

		function renderMessages(conv) {
			const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
			const list = conv?.messages || [];
			const threadId = conv ? conv.key + "/" + conv.thread?.id : null;
			if (!conv || threadId !== lastThreadId || list.length === 0) {
				messages.replaceChildren();
				lastThreadId = threadId;
			}
			if (list.length === 0) {
				messages.append(renderEmpty(conv));
				return;
			}
			// Drop nodes for messages that no longer exist (e.g. after "new chat")
			const live = new Set(list);
			for (const child of [...messages.children]) {
				if (!child._zccMsg || !live.has(child._zccMsg)) child.remove();
			}
			let prev = null;
			for (const msg of list) {
				const sig = signature(msg);
				const cached = rendered.get(msg);
				let node = cached?.node;
				if (!cached || cached.sig !== sig || !node.isConnected) {
					const fresh = renderMessage(conv, msg);
					fresh._zccMsg = msg;
					if (node?.isConnected) node.replaceWith(fresh);
					node = fresh;
					rendered.set(msg, { node, sig });
				}
				if (node.previousElementSibling !== prev || !node.isConnected) {
					if (prev) prev.after(node);
					else messages.prepend(node);
				}
				prev = node;
			}
			if (nearBottom) messages.scrollTop = messages.scrollHeight;
		}

		function renderQuote() {
			quoteBox.replaceChildren();
			quoteBox.hidden = !pendingQuote;
			if (!pendingQuote) return;
			const head = el(doc, "div", "zcc-quote-head");
			head.append(el(doc, "span", null, t("quote")), button(doc, "zcc-mini", "×", t("removeQuote"), () => setQuote(null)));
			quoteBox.append(head, el(doc, "div", "zcc-quote-text", pendingQuote));
		}

		function renderComposer(conv) {
			const busy = !!conv?.busy;
			sendBtn.textContent = busy ? t("stop") : t("send");
			sendBtn.classList.toggle("zcc-stop", busy);
			input.setAttribute("placeholder", conv?.isLibrary ? t("placeholderLibrary") : t("placeholder"));
			const mode = ZCC.Store.mode();
			for (const [name, b] of Object.entries(modeButtons)) b.classList.toggle("zcc-active", name === mode);
			const write = !!Zotero.Prefs.get(PREF + "allowWrite", true);
			writeBtn.classList.toggle("zcc-active", write);
			writeBtn.setAttribute("title", write ? t("writeOn") : t("writeOff"));
			const bridge = ZCC.Bridge.available();
			writeBtn.hidden = !bridge;
			modeSeg.hidden = !bridge;
			// Another view (or the settings pane) may have changed the prefs
			const modelPref = (Zotero.Prefs.get(PREF + "model", true) || "").trim();
			const modelValue = ZCC.Models.find(modelPref)?.id || modelPref;
			const effortPref = (Zotero.Prefs.get(PREF + "effort", true) || "").trim();
			if (modelSelect.value !== modelValue || effortSelect.value !== effortPref) renderModelMenus();
		}

		let lastConvKey = null;

		function render() {
			const poppedOut = options.mode === "sidebar" && options.isPoppedOut?.();
			root.classList.toggle("zcc-is-popped", !!poppedOut);
			const conv = ZCC.Store.getActive();
			if (conv?.key !== lastConvKey) {
				lastConvKey = conv?.key ?? null;
				if (popupKind === "history") closePopup();
				renderQuick();
			}
			renderHeader(conv);
			renderMessages(conv);
			renderQuote();
			renderComposer(conv);
		}

		const unsubscribe = ZCC.Store.subscribe(render);
		const onQuote = () => {
			renderQuote();
			if (pendingQuote) input.focus();
		};
		quoteListeners.add(onQuote);
		renderQuick();
		render();

		return {
			root,
			render,
			focus: () => input.focus(),
			destroy() {
				for (const observer of prefObservers) Zotero.Prefs.unregisterObserver(observer);
				unsubscribeModels();
				unsubscribe();
				quoteListeners.delete(onQuote);
				if (searchTimer) win.clearTimeout(searchTimer);
				doc.removeEventListener("mousedown", onDocMouseDown);
				root.remove();
			},
		};
	}

	return { mount, setQuote, t, commands };
})();
