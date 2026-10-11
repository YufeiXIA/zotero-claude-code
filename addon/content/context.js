/* global Zotero, ZCC */
// Works out which paper the user is looking at, and turns it into context for Claude.
ZCC.Context = (() => {
	let lastReader = null;
	const tracked = new WeakSet();
	const listeners = new Set();

	function onChange(fn) {
		listeners.add(fn);
		return () => listeners.delete(fn);
	}

	function emit() {
		for (const fn of listeners) {
			try {
				fn();
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
	}

	function setLastReader(reader) {
		if (!reader || reader === lastReader) return;
		lastReader = reader;
		emit();
	}

	// Called whenever a reader renders its toolbar, i.e. for every reader tab or window
	function track(reader) {
		if (!reader || tracked.has(reader)) return;
		tracked.add(reader);
		const mark = () => setLastReader(reader);
		try {
			reader._iframeWindow?.addEventListener("pointerdown", mark, true);
			reader._iframeWindow?.addEventListener("focus", mark);
			// Separate reader windows: activating the window counts as switching papers
			if (reader._window && reader._window !== Zotero.getMainWindow()) {
				reader._window.addEventListener("activate", mark);
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
		setLastReader(reader);
	}

	// Zotero tab switches in the main window
	function onTabSelect(tabID) {
		const reader = Zotero.Reader.getByTabID(tabID);
		if (reader) setLastReader(reader);
	}

	function openReaders() {
		return (Zotero.Reader._readers || []).filter(r => r.itemID);
	}

	function currentReader() {
		const readers = openReaders();
		if (lastReader && readers.includes(lastReader)) return lastReader;
		const win = Zotero.getMainWindow();
		const tabID = win?.Zotero_Tabs?.selectedID;
		const inTab = tabID && Zotero.Reader.getByTabID(tabID);
		if (inTab) return inTab;
		return readers[readers.length - 1] || null;
	}

	function selectedLibraryItem() {
		try {
			const items = Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
			return items.length === 1 ? items[0] : null;
		}
		catch (e) {
			return null;
		}
	}

	// The item the chat should be about right now
	function currentItem() {
		const reader = currentReader();
		if (reader) return Zotero.Items.get(reader.itemID);
		return selectedLibraryItem();
	}

	function shortCreators(item) {
		const creators = item.getCreators().filter(c => c.lastName || c.name);
		const names = creators.map(c => c.lastName || c.name);
		if (names.length === 0) return "";
		if (names.length <= 3) return names.join(", ");
		return names.slice(0, 3).join(", ") + " et al.";
	}

	// Plain-data description of a paper; safe to keep after the item changes
	async function describe(item) {
		if (!item) return null;
		let parent = null;
		let attachment = null;
		if (item.isAttachment()) {
			attachment = item;
			parent = item.parentItem || null;
		}
		else if (item.isRegularItem()) {
			parent = item;
			try {
				attachment = await item.getBestAttachment();
			}
			catch (e) {}
		}
		else {
			return null; // notes, annotations
		}
		const main = parent || attachment;
		const paper = {
			key: main.libraryID + "_" + main.key,
			itemID: main.id,
			attachmentID: attachment?.id ?? null,
			title: main.getField("title") || "(untitled)",
			creators: parent ? shortCreators(parent) : "",
			year: parent ? (parent.getField("year") || "") : "",
			doi: parent ? (parent.getField("DOI") || "") : "",
			url: parent ? (parent.getField("url") || "") : "",
			abstract: parent ? (parent.getField("abstractNote") || "") : "",
			venue: parent ? (parent.getField("publicationTitle") || parent.getField("proceedingsTitle") || parent.getField("repository") || "") : "",
			filePath: null,
			contentType: attachment?.attachmentContentType || null,
			page: null,
		};
		if (attachment) {
			try {
				paper.filePath = await attachment.getFilePathAsync() || null;
			}
			catch (e) {}
			try {
				const index = attachment.getAttachmentLastPageIndex();
				if (typeof index === "number" && attachment.attachmentContentType === "application/pdf") {
					paper.page = index + 1;
				}
			}
			catch (e) {}
		}
		return paper;
	}

	// Refresh the live bits (page number) of an existing description
	async function refresh(paper) {
		if (!paper?.attachmentID) return paper;
		const attachment = Zotero.Items.get(paper.attachmentID);
		if (!attachment) return paper;
		try {
			const index = attachment.getAttachmentLastPageIndex();
			if (typeof index === "number" && paper.contentType === "application/pdf") paper.page = index + 1;
		}
		catch (e) {}
		return paper;
	}

	function block(paper, { full }) {
		if (!paper) return "";
		const lines = ["<zotero_context>"];
		lines.push(`Paper: ${paper.title}`);
		if (paper.creators) lines.push(`Authors: ${paper.creators}`);
		const meta = [paper.year, paper.venue].filter(Boolean).join(", ");
		if (meta) lines.push(`Published: ${meta}`);
		if (paper.doi) lines.push(`DOI: ${paper.doi}`);
		if (paper.filePath) lines.push(`Full text file: ${paper.filePath}`);
		if (paper.page) lines.push(`The user is on page ${paper.page}.`);
		if (full && paper.abstract) lines.push(`Abstract: ${paper.abstract.slice(0, 2000)}`);
		lines.push(`Zotero item key: ${paper.key}`);
		lines.push("</zotero_context>");
		return lines.join("\n");
	}

	// Papers the user attached to a message with @
	function refsBlock(refs) {
		if (!refs?.length) return "";
		const lines = ["<referenced_papers>"];
		for (const paper of refs) {
			lines.push(`- ${paper.title}` + (paper.creators ? ` (${paper.creators}${paper.year ? ", " + paper.year : ""})` : paper.year ? ` (${paper.year})` : ""));
			if (paper.filePath) lines.push(`  Full text file: ${paper.filePath}`);
			lines.push(`  Zotero item key: ${paper.key}`);
		}
		lines.push("</referenced_papers>");
		return lines.join("\n");
	}

	// Library mode: what the user has selected and open, so Claude knows where to start
	function libraryBlock() {
		const lines = ["<zotero_library>", "The user is asking about their Zotero library as a whole. Use the zotero_plugin tools to search it and read items; read PDFs with the Read tool."];
		let selected = [];
		try {
			selected = (Zotero.getActiveZoteroPane()?.getSelectedItems() || []).filter(i => i.isRegularItem());
		}
		catch (e) {}
		if (selected.length) {
			lines.push(`Selected in the library (${selected.length}):`);
			for (const item of selected.slice(0, 20)) {
				lines.push(`- ${item.getField("title") || "(untitled)"}` + (shortCreators(item) ? ` (${shortCreators(item)}${item.getField("year") ? ", " + item.getField("year") : ""})` : "") + ` [key ${item.libraryID}_${item.key}]`);
			}
			if (selected.length > 20) lines.push(`… and ${selected.length - 20} more; use get_context for the full list.`);
		}
		const readers = openReaders();
		if (readers.length) {
			lines.push("Open in the reader:");
			for (const reader of readers.slice(0, 10)) {
				const item = Zotero.Items.get(reader.itemID);
				const main = item?.parentItem || item;
				if (main) lines.push(`- ${main.getField("title") || "(untitled)"} [key ${main.libraryID}_${main.key}]`);
			}
		}
		lines.push("</zotero_library>");
		return lines.join("\n");
	}

	// Quick search for the @ picker: regular items whose title/creator/year match
	async function searchItems(query, limit = 8) {
		query = String(query || "").trim();
		const ids = [];
		for (const library of Zotero.Libraries.getAll()) {
			if (library.libraryType === "feed") continue;
			const s = new Zotero.Search();
			s.libraryID = library.libraryID;
			if (query) s.addCondition("quicksearch-titleCreatorYear", "contains", query);
			s.addCondition("deleted", "false");
			try {
				ids.push(...await s.search());
			}
			catch (e) {}
			if (ids.length > 400) break;
		}
		const items = (await Zotero.Items.getAsync(ids)).filter(i => i.isRegularItem());
		items.sort((a, b) => (b.dateModified || "").localeCompare(a.dateModified || ""));
		const out = [];
		for (const item of items.slice(0, limit)) {
			const paper = await describe(item);
			if (paper) out.push(paper);
		}
		return out;
	}

	return { track, onTabSelect, onChange, currentItem, currentReader, openReaders, describe, refresh, block, refsBlock, libraryBlock, searchItems };
})();
