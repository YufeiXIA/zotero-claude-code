/* global Zotero, Services, ChromeUtils, IOUtils, PathUtils, ZCC */
// Models offered in the chat's model menu. Any other model name typed in Settings also works.
ZCC.Models = {
	list: [
		{ id: "claude-opus-5-5", label: "Claude Opus 5.5" },
		{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
		{ id: "claude-fable-5-1", label: "Claude Fable 5.1" },
		{ id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
	],
	efforts: ["", "low", "medium", "high", "xhigh", "max"],
};

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

	return { detect, executable, resetCache, Session };
})();
