/* global Zotero */
// Markdown -> DOM renderer.
// Model output is untrusted and this code runs with chrome privileges, so we
// never use innerHTML: every node is created explicitly and text goes in via
// textContent.
var ZCC = {};

ZCC.Markdown = (() => {
	const HTML_NS = "http://www.w3.org/1999/xhtml";

	function el(doc, tag, cls, text) {
		const node = doc.createElementNS(HTML_NS, tag);
		if (cls) node.className = cls;
		if (text != null) node.textContent = text;
		return node;
	}

	function safeURL(href) {
		try {
			const url = new URL(href);
			return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
		}
		catch (e) {
			return null;
		}
	}

	function link(doc, text, href) {
		const url = safeURL(href);
		if (!url) return doc.createTextNode(text);
		const a = el(doc, "a", "zcc-link", text);
		a.setAttribute("href", url);
		a.setAttribute("title", url);
		a.addEventListener("click", (event) => {
			event.preventDefault();
			Zotero.launchURL(url);
		});
		return a;
	}

	// Ordered by priority. Each rule: [regex anchored at start, render(match) -> Node]
	function inlineRules(doc) {
		return [
			[/^`([^`\n]+)`/, m => el(doc, "code", "zcc-code-inline", m[1])],
			[/^\$\$([^$]+)\$\$/, m => el(doc, "span", "zcc-math", m[1])],
			[/^\$([^$\n]+?)\$/, m => el(doc, "span", "zcc-math", m[1])],
			[/^\\\((.+?)\\\)/, m => el(doc, "span", "zcc-math", m[1])],
			[/^\[([^\]\n]+)\]\(([^)\s]+)\)/, m => link(doc, m[1], m[2])],
			[/^(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/, m => link(doc, m[1], m[1])],
			[/^\*\*(?=\S)([\s\S]+?)\*\*/, m => wrap(doc, "strong", m[1])],
			[/^__(?=\S)([\s\S]+?)__/, m => wrap(doc, "strong", m[1])],
			[/^~~(?=\S)([\s\S]+?)~~/, m => wrap(doc, "del", m[1])],
			[/^\*(?=[^\s*])([^*\n]+?)\*/, m => wrap(doc, "em", m[1])],
			[/^_(?=[^\s_])([^_\n]+?)_(?![A-Za-z0-9])/, m => wrap(doc, "em", m[1])],
		];
	}

	function wrap(doc, tag, inner) {
		const node = el(doc, tag);
		appendInline(doc, node, inner);
		return node;
	}

	function appendInline(doc, parent, text) {
		const rules = inlineRules(doc);
		let buffer = "";
		const flush = () => {
			if (buffer) {
				parent.append(doc.createTextNode(buffer));
				buffer = "";
			}
		};
		let i = 0;
		while (i < text.length) {
			const rest = text.slice(i);
			// Only try rules where a construct can start
			if ("`$\\[h*_~".includes(rest[0])) {
				let matched = false;
				for (const [re, render] of rules) {
					const m = rest.match(re);
					if (m) {
						// "_" inside words (snake_case) is not emphasis
						if (rest[0] === "_" && /[A-Za-z0-9]$/.test(buffer)) break;
						flush();
						parent.append(render(m));
						i += m[0].length;
						matched = true;
						break;
					}
				}
				if (matched) continue;
			}
			if (rest[0] === "\n") {
				flush();
				parent.append(el(doc, "br"));
				i++;
				continue;
			}
			buffer += rest[0];
			i++;
		}
		flush();
	}

	const RE = {
		fence: /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/,
		heading: /^(#{1,6})\s+(.*)$/,
		hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
		quote: /^\s*>\s?(.*)$/,
		listItem: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
		tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
		mathBlock: /^\s*\$\$\s*$/,
	};

	function splitRow(line) {
		let s = line.trim();
		if (s.startsWith("|")) s = s.slice(1);
		if (s.endsWith("|")) s = s.slice(0, -1);
		return s.split("|").map(c => c.trim());
	}

	function render(doc, source) {
		const root = el(doc, "div", "zcc-md");
		const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];

			if (!line.trim()) {
				i++;
				continue;
			}

			let m = line.match(RE.fence);
			if (m) {
				const fence = m[1];
				const lang = m[2];
				const body = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith(fence)) {
					body.push(lines[i]);
					i++;
				}
				i++; // closing fence (or EOF while streaming)
				root.append(codeBlock(doc, body.join("\n"), lang));
				continue;
			}

			if (RE.mathBlock.test(line)) {
				const body = [];
				i++;
				while (i < lines.length && !RE.mathBlock.test(lines[i])) {
					body.push(lines[i]);
					i++;
				}
				i++;
				root.append(el(doc, "div", "zcc-math-block", body.join("\n")));
				continue;
			}

			m = line.match(RE.heading);
			if (m) {
				const h = el(doc, "h" + Math.min(m[1].length + 2, 6), "zcc-h");
				appendInline(doc, h, m[2].replace(/\s*#+\s*$/, ""));
				root.append(h);
				i++;
				continue;
			}

			if (RE.hr.test(line)) {
				root.append(el(doc, "hr"));
				i++;
				continue;
			}

			if (RE.quote.test(line)) {
				const body = [];
				while (i < lines.length && RE.quote.test(lines[i])) {
					body.push(lines[i].match(RE.quote)[1]);
					i++;
				}
				const q = el(doc, "blockquote");
				q.append(...render(doc, body.join("\n")).childNodes);
				root.append(q);
				continue;
			}

			if (line.includes("|") && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
				const header = splitRow(line);
				const rows = [];
				i += 2;
				while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
					rows.push(splitRow(lines[i]));
					i++;
				}
				root.append(table(doc, header, rows));
				continue;
			}

			if (RE.listItem.test(line)) {
				const items = [];
				while (i < lines.length) {
					const lm = lines[i].match(RE.listItem);
					if (lm) {
						items.push({ indent: lm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(lm[2]), start: parseInt(lm[2]), text: lm[3] });
						i++;
					}
					else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
						items[items.length - 1].text += "\n" + lines[i].trim();
						i++;
					}
					else {
						break;
					}
				}
				root.append(list(doc, items));
				continue;
			}

			// Paragraph: consume until a blank line or another block starts
			const para = [line];
			i++;
			while (i < lines.length && lines[i].trim()
				&& !RE.fence.test(lines[i]) && !RE.heading.test(lines[i])
				&& !RE.quote.test(lines[i]) && !RE.listItem.test(lines[i])
				&& !RE.mathBlock.test(lines[i]) && !RE.hr.test(lines[i])) {
				para.push(lines[i]);
				i++;
			}
			const p = el(doc, "p");
			appendInline(doc, p, para.join("\n"));
			root.append(p);
		}
		return root;
	}

	function codeBlock(doc, code, lang) {
		const wrapEl = el(doc, "div", "zcc-code-block");
		const bar = el(doc, "div", "zcc-code-bar");
		bar.append(el(doc, "span", "zcc-code-lang", lang || "text"));
		const copy = el(doc, "button", "zcc-code-copy", "Copy");
		copy.addEventListener("click", () => {
			Zotero.Utilities.Internal.copyTextToClipboard(code);
			copy.textContent = "Copied";
			doc.defaultView.setTimeout(() => (copy.textContent = "Copy"), 1200);
		});
		bar.append(copy);
		const pre = el(doc, "pre");
		pre.append(el(doc, "code", null, code));
		wrapEl.append(bar, pre);
		return wrapEl;
	}

	function table(doc, header, rows) {
		const scroll = el(doc, "div", "zcc-table-wrap");
		const t = el(doc, "table");
		const thead = el(doc, "thead");
		const tr = el(doc, "tr");
		for (const cell of header) {
			const th = el(doc, "th");
			appendInline(doc, th, cell);
			tr.append(th);
		}
		thead.append(tr);
		const tbody = el(doc, "tbody");
		for (const row of rows) {
			const r = el(doc, "tr");
			for (let c = 0; c < header.length; c++) {
				const td = el(doc, "td");
				appendInline(doc, td, row[c] ?? "");
				r.append(td);
			}
			tbody.append(r);
		}
		t.append(thead, tbody);
		scroll.append(t);
		return scroll;
	}

	function list(doc, items) {
		// Build nested lists from indentation
		const rootList = el(doc, items[0].ordered ? "ol" : "ul");
		if (items[0].ordered && items[0].start > 1) rootList.setAttribute("start", items[0].start);
		const stack = [{ indent: items[0].indent, node: rootList }];
		let lastLi = null;
		for (const item of items) {
			while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop();
			if (item.indent > stack[stack.length - 1].indent && lastLi) {
				const sub = el(doc, item.ordered ? "ol" : "ul");
				lastLi.append(sub);
				stack.push({ indent: item.indent, node: sub });
			}
			const li = el(doc, "li");
			appendInline(doc, li, item.text);
			stack[stack.length - 1].node.append(li);
			lastLi = li;
		}
		return rootList;
	}

	return { render, el };
})();
