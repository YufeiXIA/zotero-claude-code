/* global Zotero, ZCC */
// The chat UI. The same view is mounted in the item pane section and in the separate window.
ZCC.ChatView = (() => {
	const el = (doc, tag, cls, text) => ZCC.Markdown.el(doc, tag, cls, text);

	const STRINGS = {
		en: {
			noPaper: "No paper selected",
			noPaperHint: "Open a PDF or select an item, and the chat follows it.",
			page: "p. {n}",
			placeholder: "Ask about this paper…  (Enter to send, Shift+Enter for a new line)",
			send: "Send",
			stop: "Stop",
			newChat: "New chat",
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
			emptyGeneral: "Ask anything",
			copy: "Copy",
			copied: "Copied",
			modelTitle: "Model (switching keeps the conversation)",
			effortTitle: "Reasoning effort",
			effortDefault: "effort: auto",
			suggestions: ["Summarize the main contribution", "Explain the method in plain words", "What are the limitations?", "What does this page say?"],
		},
		zh: {
			noPaper: "未选中论文",
			noPaperHint: "打开一篇 PDF 或选中一个条目，对话会自动跟过去。",
			page: "第 {n} 页",
			placeholder: "问点关于这篇论文的问题…（Enter 发送，Shift+Enter 换行）",
			send: "发送",
			stop: "停止",
			newChat: "新对话",
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
			emptyGeneral: "问什么都行",
			copy: "复制",
			copied: "已复制",
			modelTitle: "模型（切换后对话会接着聊）",
			effortTitle: "推理强度",
			effortDefault: "强度：自动",
			suggestions: ["总结这篇论文的核心贡献", "用通俗的话解释方法部分", "这篇论文有哪些局限？", "当前这一页讲了什么？"],
		},
	};

	function t(key, vars) {
		const lang = String(Zotero.locale || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
		let s = STRINGS[lang][key] ?? STRINGS.en[key];
		if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace("{" + k + "}", v);
		return s;
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

	// A <select> bound to one of our prefs. Changing it restarts idle Claude sessions so the
	// next message uses the new setting; the conversation itself carries on (--resume).
	function select(doc, cls, options, prefName, title) {
		const s = el(doc, "select", "zcc-select " + cls);
		s.setAttribute("title", title);
		const current = Zotero.Prefs.get("extensions.zotero-claude-code." + prefName, true) || "";
		const ids = options.map(o => o.id);
		const all = ids.includes(current) ? options : [...options, { id: current, label: current }];
		for (const opt of all) {
			const o = el(doc, "option", null, opt.label);
			o.value = opt.id;
			if (opt.id === current) o.selected = true;
			s.append(o);
		}
		s.addEventListener("change", () => {
			Zotero.Prefs.set("extensions.zotero-claude-code." + prefName, s.value, true);
			ZCC.Store.settingsChanged();
		});
		return s;
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

		// Header: paper title + actions. In the sidebar it doubles as the drag handle.
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
		const newBtn = button(doc, "zcc-icon-btn", "＋", t("newChat"), () => ZCC.Store.reset(ZCC.Store.getActive()));
		const moveBtn = options.mode === "sidebar"
			? button(doc, "zcc-icon-btn", "⧉", t("popOut"), () => options.onPopOut?.())
			: button(doc, "zcc-icon-btn", "⇲", t("dock"), () => options.onDock?.());
		actions.append(pinBtn, newBtn, moveBtn);
		header.append(paperBox, actions);

		const messages = el(doc, "div", "zcc-messages");
		const quoteBox = el(doc, "div", "zcc-quote");
		const composer = el(doc, "div", "zcc-composer");
		const input = el(doc, "textarea", "zcc-input");
		input.setAttribute("rows", "3");
		input.setAttribute("placeholder", t("placeholder"));
		const bar = el(doc, "div", "zcc-composer-bar");
		const modelSelect = select(doc, "zcc-model", ZCC.Models.list, "model", t("modelTitle"));
		const effortSelect = select(doc, "zcc-effort", ZCC.Models.efforts.map(e => ({ id: e, label: e ? e : t("effortDefault") })), "effort", t("effortTitle"));
		const sendBtn = button(doc, "zcc-send", t("send"), "", () => submit());
		bar.append(modelSelect, effortSelect, el(doc, "span", "zcc-spacer"), sendBtn);
		composer.append(input, bar);

		const popped = el(doc, "div", "zcc-popped");
		popped.append(
			el(doc, "div", "zcc-popped-text", t("poppedOut")),
			button(doc, "", t("showWindow"), "", () => options.onShowWindow?.()),
			button(doc, "", t("bringBack"), "", () => options.onDock?.()),
		);

		root.append(header, messages, quoteBox, composer, popped);
		container.append(root);

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
			if (!text.trim() && !quote) return;
			input.value = "";
			setQuote(null);
			ZCC.Store.send(conv, text, { quote });
		}

		input.addEventListener("keydown", (event) => {
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

		function renderHeader(conv) {
			const paper = conv?.paper;
			paperTitle.textContent = paper ? paper.title : t("noPaper");
			paperTitle.setAttribute("title", paper ? paper.title : t("noPaperHint"));
			const meta = [];
			if (paper?.creators) meta.push(paper.creators);
			if (paper?.year) meta.push(paper.year);
			if (paper?.page) meta.push(t("page", { n: paper.page }));
			paperMeta.textContent = meta.join(" · ");
			const isPinned = ZCC.Store.isPinned();
			pinBtn.classList.toggle("zcc-active", isPinned);
			pinBtn.setAttribute("title", isPinned ? t("unpin") : t("pin"));
		}

		function renderEmpty(conv) {
			const box = el(doc, "div", "zcc-empty");
			box.append(el(doc, "div", "zcc-empty-title", conv?.paper ? t("emptyTitle") : t("emptyGeneral")));
			if (!conv?.paper) box.append(el(doc, "div", "zcc-empty-hint", t("noPaperHint")));
			if (conv?.paper) {
				const chips = el(doc, "div", "zcc-chips");
				for (const s of t("suggestions")) {
					chips.append(button(doc, "zcc-chip", s, "", () => {
						input.value = s;
						submit();
					}));
				}
				box.append(chips);
			}
			return box;
		}

		function signature(msg) {
			return [msg.text.length, msg.tools?.map(x => x.summary + x.done + !!x.failed).join("|"), msg.thinking, msg.streaming, msg.error, msg.interrupted].join("~");
		}

		function renderMessage(msg) {
			const node = el(doc, "div", "zcc-msg zcc-" + msg.role);
			const who = el(doc, "div", "zcc-who", msg.role === "user" ? t("you") : t("claude"));
			node.append(who);
			if (msg.role === "user") {
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
				node.append(foot);
			}
			return node;
		}

		let lastConvKey = null;

		function renderMessages(conv) {
			const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
			const list = conv?.messages || [];
			if (!conv || conv.key !== lastConvKey || list.length === 0) {
				messages.replaceChildren();
				lastConvKey = conv?.key ?? null;
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
					const fresh = renderMessage(msg);
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
			// Another view (or the settings pane) may have changed the prefs
			for (const [s, name] of [[modelSelect, "model"], [effortSelect, "effort"]]) {
				const value = Zotero.Prefs.get("extensions.zotero-claude-code." + name, true) || "";
				if (s.value !== value && [...s.options].some(o => o.value === value)) s.value = value;
			}
		}

		function render() {
			const poppedOut = options.mode === "sidebar" && options.isPoppedOut?.();
			root.classList.toggle("zcc-is-popped", !!poppedOut);
			const conv = ZCC.Store.getActive();
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
		render();

		return {
			root,
			render,
			focus: () => input.focus(),
			destroy() {
				unsubscribe();
				quoteListeners.delete(onQuote);
				root.remove();
			},
		};
	}

	return { mount, setQuote, t };
})();
