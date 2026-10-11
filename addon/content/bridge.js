/* global Zotero, ZCC */
// Zotero tools for Claude, served from inside Zotero.
//
// Claude Code talks to MCP servers over HTTP. Zotero already runs a local HTTP server (the one
// the browser connector uses), so the plugin registers an endpoint on it and tells Claude Code
// about it with --mcp-config. No extra programs, no node, nothing to install: Claude can search
// the library, read notes and highlights, and (if the user allows it) write notes and highlights.
ZCC.Bridge = (() => {
	const PREF = "extensions.zotero-claude-code.";
	const PATH = "/claude-code/mcp";
	const SERVER_NAME = "zotero_plugin";
	const PROTOCOL_VERSION = "2025-03-26";
	const COLORS = {
		yellow: "#ffd400", red: "#ff6666", green: "#5fb236", blue: "#2ea8e5",
		purple: "#a28ae5", magenta: "#e56eee", orange: "#f19837", gray: "#aaaaaa", grey: "#aaaaaa",
	};

	let token = null;
	let registered = false;

	const pref = (name) => Zotero.Prefs.get(PREF + name, true);
	const writesAllowed = () => !!pref("allowWrite");

	function randomToken() {
		try {
			return Zotero.Utilities.randomString(40);
		}
		catch (e) {
			let s = "";
			while (s.length < 40) s += Math.random().toString(36).slice(2);
			return s.slice(0, 40);
		}
	}

	function port() {
		const p = parseInt(Zotero.Server?.port || Zotero.Prefs.get("httpServer.port")) || 23119;
		return p;
	}

	function url() {
		return `http://127.0.0.1:${port()}${PATH}`;
	}

	// ---- tool definitions ----

	const READ_TOOLS = [
		{
			name: "search_library",
			description: "Search the user's Zotero library. Matches titles, creators and years by default; scope \"everything\" also searches full text, notes and tags. Returns items with their key, metadata and the path of the full-text PDF when there is one. Read a PDF with the Read tool afterwards.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "Words to search for" },
					scope: { type: "string", enum: ["metadata", "everything"], description: "Default \"metadata\"" },
					limit: { type: "integer", description: "Maximum number of results (default 20, max 100)" },
				},
				required: ["query"],
				additionalProperties: false,
			},
		},
		{
			name: "get_item",
			description: "Full details of one library item by its key (as returned by search_library or shown in <zotero_context>): metadata, abstract, tags, collections, attachments with file paths, and the number of notes and annotations.",
			inputSchema: {
				type: "object",
				properties: { key: { type: "string", description: "Item key, e.g. \"1_ABCD1234\" or \"ABCD1234\"" } },
				required: ["key"],
				additionalProperties: false,
			},
		},
		{
			name: "list_notes",
			description: "The user's notes attached to an item, as plain text.",
			inputSchema: {
				type: "object",
				properties: { key: { type: "string" } },
				required: ["key"],
				additionalProperties: false,
			},
		},
		{
			name: "list_annotations",
			description: "The user's highlights, underlines and comments in an item's PDF, in page order.",
			inputSchema: {
				type: "object",
				properties: { key: { type: "string" } },
				required: ["key"],
				additionalProperties: false,
			},
		},
		{
			name: "get_context",
			description: "What the user is looking at right now: the paper open in the reader, the items selected in the library, and every paper open in a reader tab or window.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
		},
	];

	const WRITE_TOOLS = [
		{
			name: "create_note",
			description: "Create a note in Zotero, written in Markdown. Attach it to an item with key, or leave key out for a standalone note. Only use this when the user asked for a note.",
			inputSchema: {
				type: "object",
				properties: {
					key: { type: "string", description: "Item to attach the note to (optional)" },
					title: { type: "string", description: "First line of the note" },
					content: { type: "string", description: "Note body in Markdown" },
				},
				required: ["content"],
				additionalProperties: false,
			},
		},
		{
			name: "add_highlight",
			description: "Highlight a passage in an item's PDF, exactly as the user would with the highlighter. Give the passage's text as it appears in the PDF (a sentence or two; whitespace and line breaks do not matter). The PDF is opened in the reader if it is not already. Only use this when the user asked for a highlight.",
			inputSchema: {
				type: "object",
				properties: {
					key: { type: "string", description: "Item key" },
					text: { type: "string", description: "The passage to highlight, copied from the PDF" },
					page: { type: "integer", description: "1-based page number to search first (optional)" },
					color: { type: "string", description: "yellow (default), red, green, blue, purple, magenta, orange, gray, or a #rrggbb value" },
					comment: { type: "string", description: "Comment attached to the highlight (optional)" },
				},
				required: ["key", "text"],
				additionalProperties: false,
			},
		},
	];

	function tools() {
		return writesAllowed() ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS;
	}

	// Tool names as Claude Code sees them, for --allowedTools
	function allowedToolNames() {
		return tools().map(t => `mcp__${SERVER_NAME}__${t.name}`);
	}

	// ---- items ----

	function itemKey(item) {
		return item.libraryID + "_" + item.key;
	}

	function itemFromKey(key) {
		key = String(key || "").trim();
		let m = key.match(/^(\d+)_([A-Z0-9]{8})$/i);
		let item = null;
		if (m) item = Zotero.Items.getByLibraryAndKey(parseInt(m[1]), m[2].toUpperCase());
		else if (/^[A-Z0-9]{8}$/i.test(key)) item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, key.toUpperCase());
		if (!item) throw new Error(`No item with key "${key}". Use search_library to find the key.`);
		return item;
	}

	function creators(item) {
		try {
			return item.getCreators().map(c => [c.firstName, c.lastName || c.name].filter(Boolean).join(" ")).filter(Boolean);
		}
		catch (e) {
			return [];
		}
	}

	async function pdfPath(item) {
		try {
			const attachment = item.isAttachment() ? item : await item.getBestAttachment();
			if (!attachment) return null;
			return await attachment.getFilePathAsync() || null;
		}
		catch (e) {
			return null;
		}
	}

	async function describe(item, { full = false } = {}) {
		if (item.isAttachment() && item.parentItem) item = item.parentItem;
		const field = (name) => {
			try {
				return item.getField(name) || "";
			}
			catch (e) {
				return "";
			}
		};
		const abstract = field("abstractNote");
		const out = {
			key: itemKey(item),
			itemType: item.itemType,
			title: field("title"),
			creators: creators(item),
			year: field("year"),
			venue: field("publicationTitle") || field("proceedingsTitle") || field("repository") || field("bookTitle") || "",
			doi: field("DOI"),
			url: field("url"),
			abstract: full ? abstract : (abstract.length > 300 ? abstract.slice(0, 300) + "…" : abstract),
			tags: item.getTags().map(t => t.tag),
			pdf: await pdfPath(item),
		};
		if (full) {
			out.dateAdded = item.dateAdded;
			out.collections = item.getCollections().map(id => Zotero.Collections.get(id)?.name).filter(Boolean);
			out.attachments = [];
			const attachmentIDs = item.isRegularItem() ? item.getAttachments() : [];
			for (const id of attachmentIDs) {
				const a = Zotero.Items.get(id);
				if (!a) continue;
				let path = null;
				try {
					path = await a.getFilePathAsync() || null;
				}
				catch (e) {}
				out.attachments.push({ title: a.getField("title"), contentType: a.attachmentContentType, path });
			}
			out.noteCount = item.isRegularItem() ? item.getNotes().length : 0;
			out.annotationCount = 0;
			for (const id of attachmentIDs) {
				const a = Zotero.Items.get(id);
				if (a?.isPDFAttachment?.()) out.annotationCount += a.getAnnotations().length;
			}
			for (const extra of ["volume", "issue", "pages", "publisher", "date", "language"]) {
				if (field(extra)) out[extra] = field(extra);
			}
		}
		return out;
	}

	async function searchLibrary({ query, scope = "metadata", limit = 20 }) {
		query = String(query || "").trim();
		if (!query) throw new Error("query is required");
		limit = Math.max(1, Math.min(100, parseInt(limit) || 20));
		const ids = [];
		for (const library of Zotero.Libraries.getAll()) {
			if (library.libraryType === "feed") continue;
			const s = new Zotero.Search();
			s.libraryID = library.libraryID;
			s.addCondition(scope === "everything" ? "quicksearch-everything" : "quicksearch-titleCreatorYear", "contains", query);
			s.addCondition("deleted", "false");
			try {
				ids.push(...await s.search());
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		const results = [];
		for (const item of await Zotero.Items.getAsync(ids)) {
			if (!item.isRegularItem()) continue;
			results.push(item);
		}
		results.sort((a, b) => (b.dateModified || "").localeCompare(a.dateModified || ""));
		const out = [];
		for (const item of results.slice(0, limit)) out.push(await describe(item));
		return { count: results.length, items: out };
	}

	function noteText(note) {
		const html = note.getNote() || "";
		const text = html
			.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]+>/g, "");
		return Zotero.Utilities.unescapeHTML(text).replace(/\n{3,}/g, "\n\n").trim();
	}

	async function listNotes({ key }) {
		const item = itemFromKey(key);
		const notes = [];
		const ids = item.isNote() ? [item.id] : item.isRegularItem() ? item.getNotes() : [];
		for (const id of ids) {
			const note = Zotero.Items.get(id);
			if (note) notes.push({ key: itemKey(note), dateModified: note.dateModified, text: noteText(note) });
		}
		return { count: notes.length, notes };
	}

	function pdfAttachments(item) {
		if (item.isAttachment()) return item.isPDFAttachment?.() ? [item] : [];
		if (!item.isRegularItem()) return [];
		return item.getAttachments().map(id => Zotero.Items.get(id)).filter(a => a?.isPDFAttachment?.());
	}

	async function listAnnotations({ key }) {
		const item = itemFromKey(key);
		const out = [];
		for (const attachment of pdfAttachments(item)) {
			const annotations = attachment.getAnnotations().slice();
			annotations.sort((a, b) => (a.annotationSortIndex || "").localeCompare(b.annotationSortIndex || ""));
			for (const a of annotations) {
				out.push({
					type: a.annotationType,
					page: a.annotationPageLabel,
					text: a.annotationText || "",
					comment: a.annotationComment || "",
					color: a.annotationColor,
					tags: a.getTags().map(t => t.tag),
				});
			}
		}
		return { count: out.length, annotations: out };
	}

	async function getContext() {
		const current = ZCC.Context.currentItem();
		const out = { currentPaper: current ? await describe(current) : null, selectedItems: [], openPapers: [] };
		try {
			const selected = (Zotero.getActiveZoteroPane()?.getSelectedItems() || []).filter(i => i.isRegularItem() || i.isAttachment());
			for (const item of selected.slice(0, 50)) out.selectedItems.push(await describe(item));
		}
		catch (e) {}
		for (const reader of ZCC.Context.openReaders()) {
			const item = Zotero.Items.get(reader.itemID);
			if (item) out.openPapers.push(await describe(item));
		}
		if (current?.isAttachment?.() || current?.isRegularItem?.()) {
			const paper = await ZCC.Context.describe(current);
			if (paper?.page) out.currentPaper.page = paper.page;
		}
		return out;
	}

	// Create a Zotero note from Markdown, attached to an item or standalone
	async function saveNote({ parentItemID = null, title = "", markdown = "" }) {
		markdown = String(markdown || "").trim();
		if (!markdown) throw new Error("content is required");
		let parent = parentItemID ? Zotero.Items.get(parentItemID) : null;
		if (parent?.isAttachment?.() && parent.parentItem) parent = parent.parentItem;
		const doc = Zotero.getMainWindow().document;
		let html = ZCC.Markdown.toHTML(doc, markdown);
		if (title) html = `<h1>${Zotero.Utilities.htmlSpecialChars(String(title))}</h1>\n` + html;
		const note = new Zotero.Item("note");
		note.libraryID = parent ? parent.libraryID : Zotero.Libraries.userLibraryID;
		if (parent) note.parentID = parent.id;
		note.setNote(html);
		await note.saveTx();
		return note;
	}

	async function createNote({ key, title, content }) {
		if (!writesAllowed()) throw new Error("Writing notes is turned off. The user can allow it with the pencil button in the chat panel.");
		const parent = key ? itemFromKey(key) : null;
		const note = await saveNote({ parentItemID: parent?.id || null, title, markdown: content });
		return { ok: true, key: itemKey(note), attachedTo: note.parentID ? itemKey(Zotero.Items.get(note.parentID)) : null };
	}

	// ---- highlights ----

	function normalizeColor(color) {
		const c = String(color || "yellow").trim().toLowerCase();
		if (COLORS[c]) return COLORS[c];
		if (/^#[0-9a-f]{6}$/.test(c)) return c;
		return COLORS.yellow;
	}

	async function readerFor(attachment) {
		const find = () => ZCC.Context.openReaders().find(r => r.itemID === attachment.id);
		let reader = find();
		if (!reader) {
			reader = await Zotero.Reader.open(attachment.id, null, { openInBackground: true });
			// When the PDF has an unloaded tab (e.g. restored after a restart), Zotero selects that tab
			// and returns nothing; the tab's reader shows up a moment later.
			for (let i = 0; !reader && i < 60; i++) {
				await Zotero.Promise.delay(250);
				reader = find();
			}
			if (!reader) throw new Error("Could not open the PDF in the reader.");
		}
		if (reader._initPromise) await reader._initPromise;
		// The PDF view and its page data load after the reader itself
		for (let i = 0; i < 60; i++) {
			const view = reader._internalReader?._primaryView;
			if (view && (view._iframeWindow?.PDFViewerApplication?.pdfDocument || view._pdfPages?.length)) break;
			await Zotero.Promise.delay(250);
		}
		return reader;
	}

	// The reader keeps per-page text with the position of every character. Make sure a page is loaded.
	async function pageData(view, pageIndex) {
		let page = view._pdfPages?.[pageIndex];
		if (page?.chars?.length) return page;
		try {
			if (typeof view._ensureBasicPageData === "function") page = await view._ensureBasicPageData(pageIndex);
			else if (view._documentData?.ensurePage) page = await view._documentData.ensurePage(pageIndex);
		}
		catch (e) {
			Zotero.debug("Claude Code for Zotero: page data " + pageIndex + ": " + e);
		}
		return page || view._pdfPages?.[pageIndex] || null;
	}

	const collapse = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

	// Text of a page with all whitespace removed, plus a map from each character of that text
	// back to the chars array. Matching without whitespace makes line breaks, extra spaces before
	// punctuation ("reasoning , selecting") and ligatures irrelevant.
	// `dehyphenate` drops a hyphen that ends a line, so "trans-\nformer" matches "transformer".
	// (Hyphens the reader already marks as ignorable are always dropped.)
	function pageText(chars, { dehyphenate = false } = {}) {
		let text = "";
		const map = [];
		for (let i = 0; i < chars.length; i++) {
			const ch = chars[i];
			if (ch.ignorable) continue;
			const c = String(ch.c || "");
			const breaks = ch.lineBreakAfter || ch.paragraphBreakAfter;
			if (dehyphenate && breaks && c === "-" && i + 1 < chars.length) continue;
			for (const unit of c.toLowerCase()) {
				if (/\s/.test(unit)) continue;
				text += unit;
				map.push(i);
			}
		}
		return { text, map };
	}

	function findRange(chars, query) {
		const q = collapse(query).replace(/\s+/g, "");
		if (!q) return null;
		for (const dehyphenate of [false, true]) {
			const { text, map } = pageText(chars, { dehyphenate });
			let at = text.indexOf(q);
			let exact = true;
			if (at < 0 && q.length > 40) {
				// Fall back to the beginning of the passage; extend by the passage's length
				const head = q.slice(0, 40);
				at = text.indexOf(head);
				exact = false;
			}
			if (at < 0) continue;
			const end = Math.min(text.length, at + q.length);
			let first = -1;
			let last = -1;
			for (let i = at; i < end; i++) {
				if (map[i] >= 0) {
					if (first < 0) first = map[i];
					last = map[i];
				}
			}
			if (first < 0) continue;
			return { first, last, exact };
		}
		return null;
	}

	function rectsFor(chars, first, last) {
		const rects = [];
		let run = null;
		const push = () => {
			if (run) rects.push(run.map(v => Math.round(v * 1000) / 1000));
			run = null;
		};
		for (let i = first; i <= last; i++) {
			const ch = chars[i];
			if (!ch) continue;
			// Ignorable characters (e.g. a soft end-of-line hyphen) are left out of the text but,
			// like Zotero's own highlighter, still covered by the box. They often carry the line break.
			const lineEnds = ch.lineBreakAfter || ch.paragraphBreakAfter;
			if (ch.rect) {
				const r = ch.rect;
				const line = ch.inlineRect && (!ch.rotation || ch.rotation === 0) ? ch.inlineRect : r;
				const box = [r[0], line[1], r[2], line[3]];
				// No vertical overlap with the current box means a new line started
				if (run && (box[1] >= run[3] || box[3] <= run[1])) push();
				if (!run) run = box.slice();
				else {
					run[0] = Math.min(run[0], box[0]);
					run[1] = Math.min(run[1], box[1]);
					run[2] = Math.max(run[2], box[2]);
					run[3] = Math.max(run[3], box[3]);
				}
			}
			if (lineEnds) push();
		}
		push();
		return rects;
	}

	function sortIndex(pageIndex, offset, top) {
		const pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, "0");
		return `${pad(pageIndex, 5)}|${pad(offset, 6)}|${pad(top, 5)}`;
	}

	// The highlighted text as Zotero would store it: real spaces only (a word break before a comma
	// is not a space), soft end-of-line hyphens dropped.
	function matchedText(chars, first, last) {
		let text = "";
		for (let i = first; i <= last; i++) {
			const ch = chars[i];
			if (!ch) continue;
			if (ch.ignorable) continue;
			text += ch.c || "";
			if (ch.spaceAfter || ch.lineBreakAfter || ch.paragraphBreakAfter) text += " ";
		}
		return text.replace(/\s+/g, " ").trim();
	}

	async function addHighlight({ key, text, page, color, comment }) {
		if (!writesAllowed()) throw new Error("Adding highlights is turned off. The user can allow it with the pencil button in the chat panel.");
		if (!collapse(text)) throw new Error("text is required");
		const item = itemFromKey(key);
		const attachment = pdfAttachments(item)[0];
		if (!attachment) throw new Error("This item has no PDF attachment.");
		const reader = await readerFor(attachment);
		const view = reader._internalReader?._primaryView;
		if (!view) throw new Error("The reader is not ready yet. Try again in a moment.");
		const pdfDocument = view._iframeWindow?.PDFViewerApplication?.pdfDocument;
		const pageCount = pdfDocument?.numPages || view._pdfPages?.length || 0;
		if (!pageCount) throw new Error("The PDF has not finished loading. Try again in a moment.");

		// Search the requested page first, then the current page, then outward from there
		const order = [];
		const current = typeof reader.state?.pageIndex === "number" ? reader.state.pageIndex : (view._iframeWindow?.PDFViewerApplication?.page || 1) - 1;
		if (Number.isInteger(page) && page >= 1 && page <= pageCount) order.push(page - 1);
		for (let d = 0; d < pageCount; d++) {
			for (const idx of [current + d, current - d]) {
				if (idx >= 0 && idx < pageCount && !order.includes(idx)) order.push(idx);
			}
		}
		for (const pageIndex of order) {
			const data = await pageData(view, pageIndex);
			const chars = data?.chars;
			if (!chars?.length) continue;
			const range = findRange(chars, text);
			if (!range) continue;
			const rects = rectsFor(chars, range.first, range.last);
			if (!rects.length) continue;
			const viewBox = data.viewBox || [0, 0, 612, 792];
			const topRect = rects.slice().sort((a, b) => b[3] - a[3])[0];
			const top = (viewBox[3] - viewBox[1]) - topRect[3];
			let pageLabel = String(pageIndex + 1);
			try {
				pageLabel = (typeof view._getPageLabel === "function" ? view._getPageLabel(pageIndex, true) : view._pageLabels?.[pageIndex]) || pageLabel;
			}
			catch (e) {}
			const json = {
				key: Zotero.DataObjectUtilities.generateKey(),
				type: "highlight",
				color: normalizeColor(color),
				pageLabel: String(pageLabel),
				sortIndex: sortIndex(pageIndex, range.first, top),
				position: { pageIndex, rects },
				text: matchedText(chars, range.first, range.last),
				comment: String(comment || ""),
				tags: [],
			};
			const annotation = await Zotero.Annotations.saveFromJSON(attachment, json);
			return {
				ok: true,
				key: itemKey(annotation),
				page: json.pageLabel,
				text: json.text,
				exactMatch: range.exact,
				note: range.exact ? undefined : "Only the beginning of the passage was found; the highlight covers roughly the passage's length from there.",
			};
		}
		throw new Error("The passage was not found in the PDF. Copy it exactly as the PDF shows it, a sentence or so at a time.");
	}

	// ---- JSON-RPC over Zotero's HTTP server ----

	async function callTool(name, args) {
		args = args && typeof args === "object" ? args : {};
		switch (name) {
			case "search_library": return searchLibrary(args);
			case "get_item": return describe(itemFromKey(args.key), { full: true });
			case "list_notes": return listNotes(args);
			case "list_annotations": return listAnnotations(args);
			case "get_context": return getContext();
			case "create_note": return createNote(args);
			case "add_highlight": return addHighlight(args);
			default: throw new Error(`Unknown tool "${name}"`);
		}
	}

	async function handle(message) {
		const id = message.id;
		const reply = (result) => ({ jsonrpc: "2.0", id, result });
		const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
		switch (message.method) {
			case "initialize":
				return reply({
					protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
					capabilities: { tools: { listChanged: false } },
					serverInfo: { name: "zotero-claude-code", version: ZCC.Plugin.version() },
					instructions: "Tools for the user's Zotero library. Item keys look like \"1_ABCD1234\". PDFs are read with the Read tool using the path these tools return.",
				});
			case "ping":
				return reply({});
			case "tools/list":
				return reply({ tools: tools() });
			case "tools/call": {
				const name = message.params?.name;
				try {
					const result = await callTool(name, message.params?.arguments);
					return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }] });
				}
				catch (e) {
					Zotero.debug("Claude Code for Zotero: tool " + name + " failed: " + e);
					return reply({ content: [{ type: "text", text: String(e?.message || e) }], isError: true });
				}
			}
			default:
				if (id === undefined || id === null) return null; // a notification: nothing to answer
				return fail(-32601, "Method not found");
		}
	}

	function authorized(headers) {
		const h = headers || {};
		const value = h.authorization || h.Authorization || "";
		return !!token && value === "Bearer " + token;
	}

	function Endpoint() {}
	Endpoint.prototype = {
		supportedMethods: ["POST", "GET", "DELETE"],
		supportedDataTypes: ["application/json"],
		async init(request) {
			if (request.method !== "POST") return [405, "text/plain", "Only POST is supported"];
			if (!authorized(request.headers)) return [401, "text/plain", "Unauthorized"];
			let data = request.data;
			if (typeof data === "string") {
				try {
					data = JSON.parse(data);
				}
				catch (e) {
					return [400, "application/json", JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })];
				}
			}
			const messages = Array.isArray(data) ? data : [data];
			const answers = [];
			for (const message of messages) {
				if (!message || typeof message !== "object") continue;
				try {
					const answer = await handle(message);
					if (answer) answers.push(answer);
				}
				catch (e) {
					Zotero.logError(e);
					answers.push({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: String(e?.message || e) } });
				}
			}
			if (!answers.length) return [202, "text/plain", ""];
			return [200, "application/json", JSON.stringify(Array.isArray(data) ? answers : answers[0])];
		},
	};

	function start() {
		if (registered) return;
		if (!Zotero.Server?.Endpoints) {
			Zotero.debug("Claude Code for Zotero: Zotero's HTTP server is not available; library tools are off");
			return;
		}
		token = randomToken();
		Zotero.Server.Endpoints[PATH] = Endpoint;
		registered = true;
	}

	function stop() {
		if (registered && Zotero.Server?.Endpoints?.[PATH] === Endpoint) delete Zotero.Server.Endpoints[PATH];
		registered = false;
		token = null;
	}

	function available() {
		return registered && !!token;
	}

	// The --mcp-config value for a `claude` process
	function mcpConfig() {
		if (!available()) return null;
		return JSON.stringify({
			mcpServers: {
				[SERVER_NAME]: {
					type: "http",
					url: url(),
					headers: { Authorization: "Bearer " + token, "Zotero-Allowed-Request": "1" },
				},
			},
		});
	}

	return { start, stop, available, mcpConfig, allowedToolNames, SERVER_NAME, url, writesAllowed, saveNote, _test: { findRange, rectsFor, pageText, sortIndex, handle, matchedText, readerFor, pageData } };
})();
