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

	return { track, onTabSelect, onChange, currentItem, currentReader, openReaders, describe, refresh, block };
})();
