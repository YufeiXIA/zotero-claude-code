/* global Zotero, Services, ChromeUtils, IOUtils, PathUtils, ZCC */
// Models offered in the chat's model menu. The list is read from Claude Code itself (so new
// models show up without a plugin update); FALLBACK is used until that has happened once.
ZCC.Models = (() => {
	const PREF = "extensions.zotero-claude-code.";
	const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
	const FALLBACK = [
		{ id: "opus", label: "Opus", description: "Opus 5.5 · Best for everyday, complex tasks", resolvedModel: "claude-opus-5-5", efforts: EFFORTS },
		{ id: "sonnet", label: "Sonnet", description: "Sonnet 5.5 · Efficient for routine tasks", resolvedModel: "claude-sonnet-5-5", efforts: EFFORTS },
		{ id: "fable", label: "Fable", description: "Fable 5.1 · Most capable for your hardest and longest-running tasks", resolvedModel: "claude-fable-5-1", efforts: EFFORTS },
		{ id: "haiku", label: "Haiku", description: "Haiku 5.5 · Fastest for quick answers", resolvedModel: "claude-haiku-5-5", efforts: EFFORTS },
	];
	let catalog = null;
	let loading = null;
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

	// Entries as Claude Code reports them in its `initialize` response
	function normalize(models) {
		const out = [];
		for (const m of models || []) {
			if (!m || typeof m.value !== "string" || m.value === "default") continue;
			const efforts = Array.isArray(m.supportedEffortLevels) && m.supportedEffortLevels.length
				? m.supportedEffortLevels.filter(e => typeof e === "string")
				: (m.supportsEffort === false ? [] : EFFORTS);
			out.push({
				id: m.value,
				label: m.displayName || m.value,
				description: m.description || "",
				resolvedModel: m.resolvedModel || "",
				efforts,
			});
		}
		return out;
	}

	function readCache() {
		try {
			const raw = Zotero.Prefs.get(PREF + "modelCatalog", true);
			const data = raw && JSON.parse(raw);
			if (Array.isArray(data?.models) && data.models.length) return data.models;
		}
		catch (e) {}
		return null;
	}

	function list() {
		if (catalog) return catalog;
		catalog = readCache();
		return catalog || FALLBACK;
	}

	// The menu entry for a value of the "model" pref: an alias ("opus"), a full model name
	// (matched against what the alias resolves to), or null if it is something we don't know.
	function find(value) {
		value = (value || "").trim();
		if (!value) return null;
		return list().find(m => m.id === value) || list().find(m => m.resolvedModel && m.resolvedModel === value) || null;
	}

	function effortsFor(value) {
		const entry = find(value);
		return entry ? entry.efforts : EFFORTS;
	}

	// Ask Claude Code for its model list. Cheap (one short-lived process); results are kept in
	// a pref so the menu is right immediately at the next start.
	async function load({ force = false } = {}) {
		if (loading) return loading;
		if (catalog && !force && catalog !== FALLBACK) return catalog;
		loading = (async () => {
			try {
				const models = normalize(await ZCC.Claude.modelCatalog());
				if (models.length) {
					catalog = models;
					Zotero.Prefs.set(PREF + "modelCatalog", JSON.stringify({ models, at: Date.now() }), true);
					emit();
				}
			}
			catch (e) {
				Zotero.debug("Claude Code for Zotero: could not read the model list: " + e);
			}
			finally {
				loading = null;
			}
			return list();
		})();
		return loading;
	}

	return { FALLBACK, EFFORTS, list, find, effortsFor, load, onChange };
})();

ZCC.Claude = (() => {
	const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
	const { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
	const PREF = "extensions.zotero-claude-code.";

	let cachedExe = null;

	async function exists(path) {
		try {
			return !!path && await IOUtils.exists(path);
		}
		catch (e) {
			return false;
		}
	}

	async function children(dir) {
		try {
			return await IOUtils.getChildren(dir);
		}
		catch (e) {
			return [];
		}
	}

	// Every place a Claude Code binary commonly lives
	async function candidates() {
		const env = Services.env;
		const list = [];
		const pathDirs = (env.get("PATH") || "").split(Zotero.isWin ? ";" : ":").filter(Boolean);
		if (Zotero.isWin) {
			const home = env.get("USERPROFILE");
			const appData = env.get("APPDATA");
			if (home) list.push(PathUtils.join(home, ".local", "bin", "claude.exe"));
			const npmDirs = [appData && PathUtils.join(appData, "npm"), ...pathDirs].filter(Boolean);
			for (const dir of npmDirs) {
				list.push(PathUtils.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
			}
			// Claude desktop app keeps its own copies: %APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe
			if (appData) {
				for (const versionDir of await children(PathUtils.join(appData, "Claude", "claude-code"))) {
					for (const hashDir of await children(versionDir)) {
						list.push(PathUtils.join(hashDir, "claude.exe"));
					}
				}
			}
			for (const dir of pathDirs) list.push(PathUtils.join(dir, "claude.exe"));
		}
		else {
			const home = env.get("HOME");
			if (home) {
				list.push(PathUtils.join(home, ".local", "bin", "claude"));
				list.push(PathUtils.join(home, ".claude", "local", "claude"));
			}
			list.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude");
			for (const dir of pathDirs) list.push(PathUtils.join(dir, "claude"));
		}
		const seen = new Set();
		const found = [];
		for (const path of list) {
			const key = Zotero.isWin ? path.toLowerCase() : path;
			if (seen.has(key)) continue;
			seen.add(key);
			if (await exists(path)) found.push(path);
		}
		return found;
	}

	async function run(exe, args, timeoutMs = 15000) {
		const proc = await Subprocess.call({ command: exe, arguments: args, stderr: "stdout" });
		let out = "";
		const read = (async () => {
			let chunk;
			while ((chunk = await proc.stdout.readString())) out += chunk;
		})();
		const timer = setTimeout(() => proc.kill(), timeoutMs);
		await read;
		await proc.wait();
		clearTimeout(timer);
		return out.trim();
	}

	function parseVersion(text) {
		const m = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
		return m ? m.slice(1).map(Number) : null;
	}

	function compare(a, b) {
		for (let i = 0; i < 3; i++) {
			if (a[i] !== b[i]) return a[i] - b[i];
		}
		return 0;
	}

	// Returns { path, version } of the newest Claude Code binary, or null
	async function detect() {
		let best = null;
		for (const path of await candidates()) {
			let version = null;
			try {
				version = parseVersion(await run(path, ["--version"]));
			}
			catch (e) {
				Zotero.debug("Claude Code for Zotero: cannot run " + path + ": " + e);
			}
			if (!version) continue;
			if (!best || compare(version, best.versionParts) > 0) {
				best = { path, version: version.join("."), versionParts: version };
			}
		}
		return best;
	}

	async function executable() {
		const configured = Zotero.Prefs.get(PREF + "claudePath", true);
		if (configured) {
			if (await exists(configured)) return configured;
			throw new Error(`Claude Code was not found at "${configured}". Fix the path in Settings → Claude Code, or clear it to detect automatically.`);
		}
		if (cachedExe && await exists(cachedExe)) return cachedExe;
		const best = await detect();
		if (!best) {
			throw new Error("Claude Code is not installed, or I could not find it. Install it from https://claude.com/claude-code, sign in once with `claude`, then try again. You can also set the path in Settings → Claude Code.");
		}
		cachedExe = best.path;
		return cachedExe;
	}

	// Start a short-lived `claude` process, send the stream-json `initialize` control request,
	// and return the `models` array from its response.
	async function modelCatalog(timeoutMs = 20000) {
		const exe = await executable();
		const proc = await Subprocess.call({
			command: exe,
			arguments: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--setting-sources", "local", "--strict-mcp-config"],
			environment: {},
			environmentAppend: true,
			stderr: "pipe",
		});
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			try {
				proc.kill();
			}
			catch (e) {}
		};
		const timer = setTimeout(finish, timeoutMs);
		// Drain stderr so a chatty process can never block on a full pipe
		(async () => {
			try {
				while (await proc.stderr.readString()) {}
			}
			catch (e) {}
		})();
		try {
			await proc.stdin.write(JSON.stringify({ type: "control_request", request_id: "zcc-init", request: { subtype: "initialize" } }) + "\n");
			let buffer = "";
			let chunk;
			while (!done && (chunk = await proc.stdout.readString())) {
				buffer += chunk;
				let newline;
				while ((newline = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (!line) continue;
					let event;
					try {
						event = JSON.parse(line);
					}
					catch (e) {
						continue;
					}
					if (event.type === "control_response") {
						const response = event.response?.response || event.response || {};
						if (event.response?.subtype === "error") throw new Error(event.response.error || "initialize failed");
						return response.models || [];
					}
				}
			}
			throw new Error("Claude Code exited before answering the initialize request");
		}
		finally {
			clearTimeout(timer);
			finish();
		}
	}

	function resetCache() {
		cachedExe = null;
	}

	// One long-lived `claude -p` process per conversation, speaking stream-json both ways
	class Session {
		constructor({ args, cwd, onEvent, onExit }) {
			this.args = args;
			this.cwd = cwd;
			this.onEvent = onEvent;
			this.onExit = onExit;
			this.proc = null;
			this.stderr = "";
			this.alive = false;
		}

		async start() {
			const exe = await executable();
			this.proc = await Subprocess.call({
				command: exe,
				arguments: this.args,
				workdir: this.cwd,
				environment: {},
				environmentAppend: true,
				stderr: "pipe",
			});
			this.alive = true;
			this._readStdout();
			this._readStderr();
			this.proc.wait().then(({ exitCode }) => {
				this.alive = false;
				this.onExit?.(exitCode, this.stderr.trim());
			});
		}

		async _readStdout() {
			let buffer = "";
			try {
				let chunk;
				while ((chunk = await this.proc.stdout.readString())) {
					buffer += chunk;
					let newline;
					while ((newline = buffer.indexOf("\n")) >= 0) {
						const line = buffer.slice(0, newline).trim();
						buffer = buffer.slice(newline + 1);
						if (!line) continue;
						let event;
						try {
							event = JSON.parse(line);
						}
						catch (e) {
							Zotero.debug("Claude Code for Zotero: non-JSON line: " + line.slice(0, 200));
							continue;
						}
						try {
							this.onEvent(event);
						}
						catch (e) {
							Zotero.logError(e);
						}
					}
				}
			}
			catch (e) {
				if (this.alive) Zotero.logError(e);
			}
		}

		async _readStderr() {
			try {
				let chunk;
				while ((chunk = await this.proc.stderr.readString())) {
					this.stderr = (this.stderr + chunk).slice(-8000);
				}
			}
			catch (e) {}
		}

		async send(content) {
			const message = { type: "user", message: { role: "user", content } };
			await this.proc.stdin.write(JSON.stringify(message) + "\n");
		}

		kill() {
			if (this.proc && this.alive) {
				this.alive = false;
				try {
					this.proc.kill();
				}
				catch (e) {}
			}
		}
	}

	return { detect, executable, resetCache, modelCatalog, Session };
})();
