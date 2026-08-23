import { createRequire } from "node:module";
import { constants, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { access, mkdir, open, readFile, readdir, readlink, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { createHash, randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { execFile, execFileSync, spawn } from "node:child_process";
//#region lib/types/contract.js
/** Host/client RPC contract for one SidebarSession. */
const SIDEBAR_RPC_CHANNEL = "/codex-sidebar";
const SIDEBAR_SNAPSHOT_ENDPOINT = "sidebar/snapshot";
const SIDEBAR_DISPATCH_ENDPOINT = "sidebar/dispatch";
const SIDEBAR_FILE_READ_ENDPOINT = "sidebar/file-read";
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function decodeSnapshotRequest(payload) {
	if (!isRecord(payload)) return void 0;
	if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) return void 0;
	if (typeof payload.cwd !== "string") return void 0;
	if (typeof payload.busy !== "boolean") return void 0;
	return {
		sessionId: payload.sessionId,
		cwd: payload.cwd,
		busy: payload.busy,
		turnWrites: decodeTurnWrites(payload.turnWrites),
		roster: decodeRoster(payload.roster),
		logs: decodeLogs(payload.logs),
		...payload.light === true ? { light: true } : {}
	};
}
function decodeDispatchRequest(payload) {
	const base = decodeSnapshotRequest(payload);
	if (base === void 0 || !isRecord(payload) || !isRecord(payload.intent) || typeof payload.intent.type !== "string") return;
	return {
		...base,
		intent: payload.intent
	};
}
function decodeTurnWrites(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) return [];
	const writes = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		if (typeof item.path !== "string" || typeof item.before !== "string" || typeof item.after !== "string") continue;
		writes.push({
			path: item.path,
			before: item.before,
			after: item.after
		});
	}
	return writes;
}
function decodeRoster(value) {
	if (!Array.isArray(value)) return [];
	const roster = [];
	for (const item of value) {
		if (!isRecord(item)) continue;
		if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.cwd !== "string") continue;
		if (item.kind !== "main" && item.kind !== "subagent" && item.kind !== "side-chat") continue;
		roster.push({
			id: item.id,
			title: item.title,
			cwd: item.cwd,
			kind: item.kind,
			archived: item.archived === true,
			busy: item.busy === true
		});
	}
	return roster;
}
function decodeLogs(value) {
	if (!isRecord(value)) return {};
	const logs = {};
	for (const [id, events] of Object.entries(value)) {
		if (!Array.isArray(events)) continue;
		logs[id] = events.flatMap((event) => {
			if (!isRecord(event)) return [];
			if (typeof event.seq !== "number" || typeof event.turn !== "number" || typeof event.role !== "string") return [];
			if (event.role !== "user" && event.role !== "assistant" && event.role !== "tool-call" && event.role !== "tool-result") return [];
			const writes = Array.isArray(event.writes) ? event.writes.filter((path) => typeof path === "string" && path.length > 0) : [];
			return [{
				seq: event.seq,
				turn: event.turn,
				role: event.role,
				text: typeof event.text === "string" ? event.text : "",
				...typeof event.closed === "boolean" ? { closed: event.closed } : {},
				...writes.length === 0 ? {} : { writes }
			}];
		});
	}
	return logs;
}
//#endregion
//#region lib/types/browser.js
/** Browser 工具: navigable page + 批注. Does not start the project. */
const BROWSER_DEVICE_PRESETS = [
	{
		id: "fit",
		label: "适应窗口"
	},
	{
		id: "phone",
		label: "手机 390×844",
		width: 390,
		height: 844
	},
	{
		id: "tablet",
		label: "平板 768×1024",
		width: 768,
		height: 1024
	},
	{
		id: "laptop",
		label: "笔记本 1280×800",
		width: 1280,
		height: 800
	}
];
function browserDeviceViewport(device) {
	const preset = BROWSER_DEVICE_PRESETS.find((item) => item.id === device);
	return preset?.width === void 0 || preset.height === void 0 ? null : {
		width: preset.width,
		height: preset.height
	};
}
function normalizeBrowserDevice(value) {
	return value === "phone" || value === "tablet" || value === "laptop" ? value : "fit";
}
function emptyBrowser() {
	return hydrate$1({ url: "" });
}
function rememberBrowser(state) {
	return hydrate$1({
		...state,
		url: state.url ?? ""
	});
}
function hydrateBrowserPages(saved) {
	if (saved?.browsers !== void 0 && Object.keys(saved.browsers).length > 0) {
		const out = {};
		for (const [id, state] of Object.entries(saved.browsers)) out[id] = rememberBrowser(state);
		return out;
	}
	const tabs = saved?.tabs ?? [];
	const tab = tabs.find((item) => item.id === saved?.active && item.kind === "Browser") ?? tabs.find((item) => item.kind === "Browser");
	if (saved?.browser !== void 0 && tab !== void 0) return { [tab.id]: rememberBrowser(saved.browser) };
	return {};
}
function projectBrowser(state, _port) {
	return flags(hydrate$1(state));
}
function syncManagedBrowser(state, projection) {
	const current = hydrate$1(state);
	const changedDocument = current.documentId !== null && current.documentId !== projection.documentId;
	const ready = projection.status === "ready";
	const failed = projection.status === "error" || projection.status === "crashed";
	const changedUrl = projection.url.length > 0 && projection.url !== current.url;
	const history = changedUrl ? [...current.history.slice(0, current.index + 1), projection.url] : current.history;
	const index = changedUrl ? history.length - 1 : current.index;
	return flags({
		...current,
		url: projection.url || current.url,
		draft: projection.url || current.draft,
		status: ready ? "loaded" : failed ? "unreachable" : current.status,
		runtimeStatus: projection.status,
		documentId: projection.documentId,
		runtimeError: projection.error ?? null,
		page: ready ? {
			url: projection.url,
			title: projection.title || projection.url,
			elements: []
		} : failed ? null : current.page,
		history,
		index,
		...changedDocument ? {
			annotate: false,
			pendingMark: null,
			pendingSelector: null,
			pendingRect: null,
			pendingCaptureId: null,
			pendingDocumentId: null,
			pendingEvidence: null,
			notePos: null,
			noteDraft: "",
			editingId: null
		} : {}
	});
}
function reduceBrowser(state, intent, port) {
	const current = flags(hydrate$1(state));
	switch (intent.type) {
		case "open-url":
		case "browser-follow": {
			const url = intent.url;
			return {
				state: pushUrl(current, url, port),
				effects: []
			};
		}
		case "browser-back": {
			if (!current.canBack) return {
				state: current,
				effects: []
			};
			const index = current.index - 1;
			return {
				state: show(current, current.history[index] ?? "", port, current.history, index),
				effects: []
			};
		}
		case "browser-forward": {
			if (!current.canForward) return {
				state: current,
				effects: []
			};
			const index = current.index + 1;
			return {
				state: show(current, current.history[index] ?? "", port, current.history, index),
				effects: []
			};
		}
		case "browser-refresh":
			if (current.url.length === 0) return {
				state: current,
				effects: []
			};
			return {
				state: show(current, current.url, port, current.history, current.index),
				effects: []
			};
		case "browser-set-device": {
			const device = normalizeBrowserDevice(intent.device);
			return {
				state: flags({
					...current,
					device
				}),
				effects: []
			};
		}
		case "browser-open-external":
			if (current.url.length > 0) port?.openExternal(current.url);
			return {
				state: current,
				effects: []
			};
		case "browser-set-annotate": {
			const on = intent.on;
			if (!current.canAnnotate || !on) return {
				state: flags({
					...current,
					annotate: false,
					pendingMark: null,
					pendingSelector: null,
					pendingRect: null,
					pendingCaptureId: null,
					pendingDocumentId: null,
					pendingEvidence: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				}),
				effects: []
			};
			return {
				state: flags({
					...current,
					annotate: true
				}),
				effects: []
			};
		}
		case "browser-click-content": {
			if (!current.annotate || current.status !== "loaded") return {
				state: current,
				effects: []
			};
			const click = intent;
			if (typeof click.captureId !== "string" || click.captureId.length === 0 || typeof click.documentId !== "string" || click.documentId.length === 0) return {
				state: current,
				effects: []
			};
			const mark = click.mark;
			const x = click.x;
			const y = click.y;
			const selector = click.selector;
			const rect = click.rect;
			return {
				state: flags({
					...current,
					pendingMark: mark,
					pendingSelector: selector ?? null,
					pendingRect: rect ?? null,
					pendingCaptureId: click.captureId,
					pendingDocumentId: click.documentId,
					pendingEvidence: null,
					notePos: {
						x,
						y
					},
					noteDraft: "",
					editingId: null
				}),
				effects: []
			};
		}
		case "browser-set-note-draft": {
			const text = intent.text;
			return {
				state: flags({
					...current,
					noteDraft: text
				}),
				effects: []
			};
		}
		case "browser-dismiss-note": return {
			state: flags({
				...current,
				pendingMark: null,
				pendingSelector: null,
				pendingRect: null,
				pendingCaptureId: null,
				pendingDocumentId: null,
				pendingEvidence: null,
				notePos: null,
				noteDraft: "",
				editingId: null
			}),
			effects: []
		};
		default: return;
	}
}
function hydrate$1(state) {
	return {
		url: state.url,
		draft: state.draft ?? state.url,
		status: state.status ?? (state.url.length === 0 ? "empty" : "unreachable"),
		runtimeStatus: state.runtimeStatus ?? "idle",
		device: normalizeBrowserDevice(state.device),
		documentId: state.documentId ?? null,
		runtimeError: state.runtimeError ?? null,
		page: state.page ?? null,
		history: state.history ?? [],
		index: state.index ?? -1,
		canBack: false,
		canForward: false,
		canAnnotate: false,
		annotate: state.annotate ?? false,
		pendingMark: state.pendingMark ?? null,
		pendingSelector: state.pendingSelector ?? null,
		pendingRect: state.pendingRect ?? null,
		pendingCaptureId: state.pendingCaptureId ?? null,
		pendingDocumentId: state.pendingDocumentId ?? null,
		pendingEvidence: state.pendingEvidence ?? null,
		notePos: state.notePos ?? null,
		noteDraft: state.noteDraft ?? "",
		editingId: state.editingId ?? null,
		attachments: state.attachments ?? [],
		seq: state.seq ?? 0
	};
}
function flags(state) {
	return {
		...state,
		canBack: state.index > 0,
		canForward: state.index >= 0 && state.index < state.history.length - 1,
		canAnnotate: state.status === "loaded"
	};
}
function pushUrl(state, url, port) {
	const loaded = loadPage(url, port);
	if (loaded.url.length > 0 && loaded.url === state.url && state.index >= 0) return show(state, loaded.url, port, state.history, state.index);
	if (loaded.url.length === 0) return show(state, "", port, state.history, state.index);
	const history = [...state.history.slice(0, state.index + 1), loaded.url];
	return show(state, loaded.url, port, history, history.length - 1);
}
function show(state, url, port, history, index) {
	const loaded = loadPage(url, port);
	return flags({
		...state,
		...loaded,
		history,
		index,
		annotate: false,
		pendingMark: null,
		pendingSelector: null,
		pendingRect: null,
		pendingCaptureId: null,
		pendingDocumentId: null,
		pendingEvidence: null,
		notePos: null,
		noteDraft: "",
		editingId: null
	});
}
function normalizeUrl(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return trimmed;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
	if (/^(mailto|data|blob|about|javascript):/i.test(trimmed)) return trimmed;
	if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed) || /^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)) return `http://${trimmed}`;
	if (/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(trimmed)) return `https://${trimmed}`;
	return trimmed;
}
function liveHref(url) {
	const href = normalizeUrl(url);
	return /^https?:\/\//i.test(href) ? href : void 0;
}
function loadPage(url, port) {
	const trimmed = normalizeUrl(url.trim());
	if (trimmed.length === 0) return {
		url: "",
		draft: "",
		status: "empty",
		page: null
	};
	const page = port?.load(trimmed);
	if (page !== void 0) return {
		url: trimmed,
		draft: trimmed,
		status: "loaded",
		page
	};
	if (port === void 0 || liveHref(trimmed) !== void 0) return {
		url: trimmed,
		draft: trimmed,
		status: "loaded",
		page: {
			url: trimmed,
			title: trimmed,
			elements: [{
				selector: "body",
				text: trimmed
			}]
		}
	};
	return {
		url: trimmed,
		draft: trimmed,
		status: "unreachable",
		page: null
	};
}
//#endregion
//#region lib/types/host-browser.js
/** BrowserPort: synchronous chrome projection plus async managed-Page commands. */
function createHostBrowser(opts) {
	return {
		load(url) {
			if (opts.probe !== void 0) return loadFromProbe(url, opts.probe(url));
			if (liveHref(url) === void 0) return void 0;
			return liveSnapshot(url);
		},
		openExternal(url) {
			opts.openExternal?.(url);
		},
		isBusy: () => opts.isBusy(),
		...opts.managed === void 0 ? {} : {
			manage(tabId, url, action) {
				const tab = {
					sessionId: opts.managed?.sessionId ?? "",
					tabId
				};
				(action === "back" ? opts.managed?.runtime.back(tab) : action === "forward" ? opts.managed?.runtime.forward(tab) : action === "refresh" ? opts.managed?.runtime.reload(tab) : opts.managed?.runtime.ensure(tab, url))?.catch(() => void 0);
			},
			resize(tabId, width, height) {
				(opts.managed?.runtime.resize({
					sessionId: opts.managed.sessionId,
					tabId
				}, width, height))?.catch(() => void 0);
			},
			close(tabId) {
				opts.managed?.runtime.close({
					sessionId: opts.managed.sessionId,
					tabId
				});
			}
		}
	};
}
function loadFromProbe(url, result) {
	if (result.kind === "html") return pageSnapshot(url, result.html);
	if (liveHref(url) === void 0) return void 0;
	return liveSnapshot(url);
}
function liveSnapshot(url) {
	return {
		url,
		title: url,
		elements: [{
			selector: "body",
			text: url
		}]
	};
}
function pageSnapshot(url, html) {
	const title = firstCapture(html, /<title[^>]*>([^<]*)<\/title>/i) ?? url;
	const elements = [];
	const seen = /* @__PURE__ */ new Set();
	collectTag(elements, seen, html, "h1");
	collectTag(elements, seen, html, "h2");
	collectTag(elements, seen, html, "h3");
	collectTag(elements, seen, html, "button");
	collectTag(elements, seen, html, "a");
	collectIds(elements, seen, html);
	if (elements.length === 0) elements.push({
		selector: "body",
		text: stripTags(title)
	});
	return {
		url,
		title: stripTags(title),
		html: withBaseHref(url, html),
		elements
	};
}
function collectTag(elements, seen, html, tag) {
	const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
	let match;
	let index = 0;
	while ((match = pattern.exec(html)) !== null) {
		index += 1;
		const attrs = match[1] ?? "";
		const text = stripTags(match[2] ?? "");
		const id = attr(attrs, "id");
		const cls = attr(attrs, "class");
		const selector = id !== void 0 ? `${tag}#${id}` : cls !== void 0 ? `${tag}.${cls.split(/\s+/)[0]}` : `${tag}:nth-of-type(${index})`;
		pushElement(elements, seen, selector, text.length === 0 ? selector : text);
	}
}
function collectIds(elements, seen, html) {
	const pattern = /<([a-z0-9]+)\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi;
	let match;
	while ((match = pattern.exec(html)) !== null) {
		const tag = match[1] ?? "div";
		const id = match[2] ?? "";
		if (id.length === 0) continue;
		pushElement(elements, seen, `${tag}#${id}`, id);
	}
}
function pushElement(elements, seen, selector, text) {
	if (seen.has(selector)) return;
	seen.add(selector);
	elements.push({
		selector,
		text
	});
}
function attr(attrs, name) {
	const value = new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(attrs)?.[1]?.trim();
	return value === void 0 || value.length === 0 ? void 0 : value;
}
function withBaseHref(url, html) {
	const cap = 2e5;
	const body = html.length > cap ? html.slice(0, cap) : html;
	if (/<base\b/i.test(body)) return body;
	const tag = `<base href="${url.replace(/"/g, "&quot;")}">`;
	if (/<head[\s>]/i.test(body)) return body.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
	return `${tag}${body}`;
}
function firstCapture(html, pattern) {
	const text = pattern.exec(html)?.[1]?.trim();
	return text === void 0 || text.length === 0 ? void 0 : text;
}
function stripTags(value) {
	return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
//#endregion
//#region lib/types/browser-guard.js
/** Cheap URL/title checks so the managed Browser cannot nest DSH Web or sit on Cloudflare PoW. */
const LOOPBACK = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"localhost",
	"::1",
	"[::1]",
	"0.0.0.0"
]);
const SELF_PORTS = /* @__PURE__ */ new Set(["3080", "3082"]);
const SELF_HOSTS = /* @__PURE__ */ new Set(["dsh.noirbright.top", "dshlab.noirbright.top"]);
const HARNESS_SELF_BLOCK_MESSAGE = "拒绝在托管 Browser 打开 DSH Web 自身，避免 GUI 套娃空转";
const CHALLENGE_BLOCK_MESSAGE = "Cloudflare 挑战页会打满 CPU，已停止加载";
function harnessSelfBlockReason(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
	const host = parsed.hostname.toLowerCase();
	const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
	if (SELF_HOSTS.has(host)) return HARNESS_SELF_BLOCK_MESSAGE;
	if (LOOPBACK.has(host) && SELF_PORTS.has(port)) return HARNESS_SELF_BLOCK_MESSAGE;
}
function isChallengePage(url, title) {
	if (title.trim() === "Just a moment...") return true;
	try {
		const parsed = new URL(url);
		return parsed.searchParams.has("__cf_chl_rt_tk") || parsed.searchParams.has("__cf_chl_tk");
	} catch {
		return url.includes("__cf_chl");
	}
}
const PLAYWRIGHT_IGNORE_DEFAULT_ARGS = [
	"--disable-dev-shm-usage",
	"--disable-background-timer-throttling",
	"--disable-backgrounding-occluded-windows",
	"--disable-renderer-backgrounding"
];
const DEFAULT_VIEWPORT = Object.freeze({
	width: 720,
	height: 860
});
const NAVIGATION_TIMEOUT_MS = 3e4;
const EVIDENCE_QUALITY = 85;
const DEFAULT_DEVICE_SCALE_FACTOR = 2;
var ManagedBrowserRuntime = class {
	profileDir;
	headless;
	#executablePath;
	#launch;
	#context;
	#pages = /* @__PURE__ */ new Map();
	#requestedViewports = /* @__PURE__ */ new Map();
	#captureSeq = 0;
	#onProjection;
	#onPopup;
	#now;
	#maxLivePages;
	#idleMs;
	#reaping = false;
	constructor(opts = {}) {
		this.profileDir = resolve(opts.profileDir ?? defaultProfileDir());
		this.headless = opts.headless ?? true;
		this.#executablePath = opts.executablePath;
		this.#launch = opts.launch ?? launchPlaywright;
		this.#onProjection = opts.onProjection;
		this.#onPopup = opts.onPopup;
		this.#now = opts.now ?? Date.now;
		this.#maxLivePages = opts.maxLivePages ?? 3;
		this.#idleMs = opts.idleMs ?? 12e4;
	}
	keyOf(tab) {
		return tab.sessionId + ":" + tab.tabId;
	}
	list() {
		return [...this.#pages.values()].map((record) => project(record));
	}
	projection(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		return record === void 0 ? void 0 : project(record);
	}
	async ensure(tab, url) {
		const blocked = harnessSelfBlockReason(url);
		if (blocked !== void 0) {
			if (this.#pages.has(this.keyOf(tab))) await this.close(tab);
			return {
				key: this.keyOf(tab),
				sessionId: tab.sessionId,
				tabId: tab.tabId,
				url,
				title: "",
				documentId: this.keyOf(tab) + ":blocked",
				status: "error",
				error: blocked
			};
		}
		const record = await this.#record(tab);
		if (record.status === "ready" && record.page.url() === url) {
			this.#touch(record);
			await this.reap();
			return project(record);
		}
		await this.#enqueue(record, async () => {
			record.status = "loading";
			record.url = url;
			delete record.error;
			delete record.blocked;
			this.#publish(record);
			try {
				await record.page.goto(url, {
					waitUntil: "domcontentloaded",
					timeout: NAVIGATION_TIMEOUT_MS
				});
				await this.#refresh(record);
			} catch (error) {
				this.#fail(record, error);
			}
		});
		this.#touch(record);
		await this.reap();
		return project(record);
	}
	async closeSession(sessionId) {
		const tabs = [...this.#pages.values()].filter((record) => record.tab.sessionId === sessionId).map((record) => record.tab);
		await Promise.all(tabs.map((tab) => this.close(tab)));
	}
	async reap() {
		if (this.#reaping) return;
		this.#reaping = true;
		try {
			const now = this.#now();
			for (const record of [...this.#pages.values()]) if (now - record.lastAccess >= this.#idleMs) await this.close(record.tab);
			const live = [...this.#pages.values()].sort((left, right) => left.lastAccess - right.lastAccess);
			while (live.length > this.#maxLivePages) {
				const oldest = live.shift();
				if (oldest !== void 0) await this.close(oldest.tab);
			}
		} finally {
			this.#reaping = false;
		}
	}
	touch(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record !== void 0) this.#touch(record);
	}
	async back(tab) {
		return this.#navigate(tab, (page) => page.goBack({
			waitUntil: "domcontentloaded",
			timeout: NAVIGATION_TIMEOUT_MS
		}));
	}
	async forward(tab) {
		return this.#navigate(tab, (page) => page.goForward({
			waitUntil: "domcontentloaded",
			timeout: NAVIGATION_TIMEOUT_MS
		}));
	}
	async reload(tab) {
		return this.#navigate(tab, (page) => page.reload({
			waitUntil: "domcontentloaded",
			timeout: NAVIGATION_TIMEOUT_MS
		}));
	}
	async resize(tab, width, height) {
		const key = this.keyOf(tab);
		const size = {
			width: clamp(Math.round(width), 320, 1920),
			height: clamp(Math.round(height), 240, 1440)
		};
		this.#requestedViewports.set(key, size);
		const record = this.#pages.get(key);
		if (record === void 0) return;
		const current = record.page.viewportSize();
		if (current?.width === size.width && current.height === size.height) return;
		await record.page.setViewportSize(size);
	}
	async snapshot(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return notReady();
		this.#touch(record);
		const nodes = await this.#nodes(record);
		return {
			url: record.url,
			title: record.title,
			driveable: true,
			documentId: record.documentId,
			nodes,
			text: formatTree(nodes, record.title)
		};
	}
	async outline(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return notReady();
		return {
			documentId: record.documentId,
			nodes: await this.#outlineNodes(record)
		};
	}
	async trackRect(tab, selector) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return notReady();
		const encoded = JSON.stringify(selector);
		const rect = await record.page.evaluate(String.raw`(() => {
      try {
        const element = document.querySelector(${encoded});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return null;
        return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      } catch { return null; }
    })()`);
		return {
			documentId: record.documentId,
			selector,
			rect
		};
	}
	async click(tab, ref) {
		return this.#act(tab, ref, (locator) => locator.click());
	}
	async fill(tab, ref, text) {
		return this.#act(tab, ref, (locator) => locator.fill(text));
	}
	async capture(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return notReady();
		const nodes = await this.#outlineNodes(record);
		const image = await record.page.screenshot({
			type: "jpeg",
			quality: EVIDENCE_QUALITY
		});
		const viewport = record.page.viewportSize() ?? DEFAULT_VIEWPORT;
		this.#captureSeq += 1;
		return {
			captureId: record.documentId + ":c" + this.#captureSeq,
			documentId: record.documentId,
			url: record.url,
			title: record.title,
			image: new Uint8Array(image),
			mediaType: "image/jpeg",
			width: viewport.width,
			height: viewport.height,
			nodes
		};
	}
	target(tab) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return void 0;
		return {
			page: record.page,
			cdp: record.cdp,
			documentId: record.documentId
		};
	}
	async close(tab) {
		const key = this.keyOf(tab);
		const record = this.#pages.get(key);
		this.#requestedViewports.delete(key);
		if (record === void 0) return;
		this.#pages.delete(key);
		await record.cdp.detach().catch(() => void 0);
		if (!record.page.isClosed()) await record.page.close().catch(() => void 0);
	}
	async dispose() {
		const pages = [...this.#pages.values()];
		this.#pages.clear();
		this.#requestedViewports.clear();
		await Promise.all(pages.map(async (record) => {
			await record.cdp.detach().catch(() => void 0);
			if (!record.page.isClosed()) await record.page.close().catch(() => void 0);
		}));
		const context = this.#context;
		this.#context = void 0;
		if (context !== void 0) await (await context).close().catch(() => void 0);
	}
	async #record(tab) {
		const key = this.keyOf(tab);
		const existing = this.#pages.get(key);
		if (existing !== void 0) return existing;
		const context = await this.#ensureContext();
		const page = await context.newPage();
		const requestedViewport = this.#requestedViewports.get(key);
		if (requestedViewport !== void 0) await page.setViewportSize(requestedViewport);
		const record = {
			tab,
			key,
			page,
			cdp: await context.newCDPSession(page),
			url: page.url(),
			title: "",
			status: "idle",
			documentSeq: 0,
			documentId: key + ":d0",
			refs: /* @__PURE__ */ new Map(),
			command: Promise.resolve(),
			lastAccess: this.#now()
		};
		page.on("framenavigated", (frame) => {
			if (frame !== page.mainFrame()) return;
			record.url = frame.url();
			if (record.blocked) {
				this.#publish(record);
				return;
			}
			record.documentSeq += 1;
			record.status = "loading";
			delete record.error;
			record.documentId = record.key + ":d" + record.documentSeq;
			record.refs.clear();
			this.#publish(record);
		});
		page.on("domcontentloaded", () => {
			this.#refresh(record).catch((error) => {
				this.#fail(record, error);
			});
		});
		page.on("crash", () => {
			record.status = "crashed";
			record.error = "Chromium page crashed";
			record.refs.clear();
			this.#publish(record);
		});
		page.on("close", () => {
			if (this.#pages.get(key) !== record) return;
			this.#pages.delete(key);
		});
		page.on("popup", (popup) => {
			this.#onPopup?.(tab, popup);
		});
		this.#pages.set(key, record);
		return record;
	}
	async #ensureContext() {
		const existing = this.#context;
		if (existing !== void 0) return existing;
		const pending = (async () => {
			const executablePath = await findBrowserExecutable(this.#executablePath);
			await mkdir(this.profileDir, {
				recursive: true,
				mode: 448
			});
			await clearStaleChromiumSingleton(this.profileDir);
			return this.#launch(this.profileDir, {
				executablePath,
				headless: this.headless,
				viewport: DEFAULT_VIEWPORT,
				deviceScaleFactor: DEFAULT_DEVICE_SCALE_FACTOR,
				ignoreDefaultArgs: PLAYWRIGHT_IGNORE_DEFAULT_ARGS
			});
		})();
		this.#context = pending;
		try {
			const context = await pending;
			context.on("close", () => {
				if (this.#context !== pending) return;
				this.#context = void 0;
				const records = [...this.#pages.values()];
				this.#pages.clear();
				for (const record of records) {
					record.status = "crashed";
					record.error = "Chromium context exited";
					record.refs.clear();
					this.#publish(record);
				}
			});
			return context;
		} catch (error) {
			if (this.#context === pending) this.#context = void 0;
			throw error;
		}
	}
	async #navigate(tab, command) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0) return void 0;
		await this.#enqueue(record, async () => {
			record.status = "loading";
			this.#publish(record);
			try {
				await command(record.page);
				await this.#refresh(record);
			} catch (error) {
				this.#fail(record, error);
			}
		});
		return project(record);
	}
	async #refresh(record) {
		record.url = record.page.url();
		record.title = await record.page.title().catch(() => record.url);
		if (record.blocked) {
			record.status = "error";
			this.#publish(record);
			return;
		}
		if (isChallengePage(record.url, record.title)) {
			record.blocked = true;
			record.status = "error";
			record.error = CHALLENGE_BLOCK_MESSAGE;
			this.#publish(record);
			await record.page.goto("about:blank").catch(() => void 0);
			record.status = "error";
			record.error = CHALLENGE_BLOCK_MESSAGE;
			this.#publish(record);
			return;
		}
		record.status = "ready";
		delete record.error;
		this.#publish(record);
	}
	#touch(record) {
		record.lastAccess = this.#now();
	}
	#fail(record, error) {
		record.status = "error";
		record.error = error instanceof Error ? error.message : String(error);
		record.refs.clear();
		this.#publish(record);
	}
	#publish(record) {
		this.#onProjection?.(project(record));
	}
	async #nodes(record) {
		const raw = await record.page.evaluate(SNAPSHOT_EXPRESSION);
		record.refs.clear();
		return raw.slice(0, 200).map((node, index) => {
			const ref = "@d" + record.documentSeq + "e" + (index + 1);
			record.refs.set(ref, {
				documentId: record.documentId,
				selector: node.selector
			});
			return {
				ref,
				role: node.role,
				name: node.name,
				selector: node.selector,
				...node.rect === void 0 ? {} : { rect: node.rect }
			};
		});
	}
	async #outlineNodes(record) {
		return (await record.page.evaluate(OUTLINE_EXPRESSION)).slice(0, 800).map((node, index) => ({
			ref: "@d" + record.documentSeq + "o" + (index + 1),
			role: node.role,
			name: node.name,
			selector: node.selector,
			...node.rect === void 0 ? {} : { rect: node.rect }
		}));
	}
	async #act(tab, ref, action) {
		const record = this.#pages.get(this.keyOf(tab));
		if (record === void 0 || record.status !== "ready") return notReady();
		this.#touch(record);
		const target = record.refs.get(ref);
		if (target === void 0) {
			if (/^@d\d+e\d+$/.test(ref)) return {
				ok: false,
				code: "stale-ref",
				message: "页面已导航，先重新 browser_snapshot"
			};
			return {
				ok: false,
				code: "unknown-ref",
				message: "找不到 " + ref + "，先 browser_snapshot 再操作"
			};
		}
		if (target.documentId !== record.documentId) return {
			ok: false,
			code: "stale-ref",
			message: "页面已导航，先重新 browser_snapshot"
		};
		try {
			await action(record.page.locator(target.selector));
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				code: "navigation-failed",
				message: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async #enqueue(record, command) {
		const run = record.command.then(command, command);
		record.command = run.catch(() => void 0);
		await run;
	}
};
async function findBrowserExecutable(explicit) {
	const candidates = explicit === void 0 ? await browserCandidates() : [explicit];
	for (const candidate of candidates) try {
		await access(candidate, constants.X_OK);
		return candidate;
	} catch {}
	throw new Error(explicit === void 0 ? "No Chrome/Chromium executable found; configure executablePath" : "Configured browser executable is not runnable: " + explicit);
}
async function browserCandidates() {
	const env = process.env;
	const cached = await installedPlaywrightChromiumCandidates(playwrightCacheRoot(env));
	return [
		env.DSH_CODEX_BROWSER_EXECUTABLE,
		...cached,
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		env.PROGRAMFILES === void 0 ? void 0 : join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
		env["PROGRAMFILES(X86)"] === void 0 ? void 0 : join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
	].filter((value) => value !== void 0 && value.length > 0);
}
async function installedPlaywrightChromiumCandidates(cacheRoot) {
	const revisions = (await readdir(cacheRoot, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name)).sort((left, right) => Number(right.name.slice(9)) - Number(left.name.slice(9)));
	const relativeExecutables = process.platform === "win32" ? [join("chrome-win64", "chrome.exe"), join("chrome-win", "chrome.exe")] : process.platform === "darwin" ? [join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"), join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")] : [join("chrome-linux64", "chrome"), join("chrome-linux", "chrome")];
	return revisions.flatMap((entry) => relativeExecutables.map((relative) => join(cacheRoot, entry.name, relative)));
}
function playwrightCacheRoot(env) {
	const configured = env.PLAYWRIGHT_BROWSERS_PATH;
	if (configured !== void 0 && configured.length > 0 && configured !== "0") return resolve(configured);
	return join(homedir(), ".cache", "ms-playwright");
}
const CHROMIUM_SINGLETON_FILES = [
	"SingletonLock",
	"SingletonSocket",
	"SingletonCookie"
];
async function clearStaleChromiumSingleton(profileDir) {
	let owner;
	try {
		owner = await readlink(join(profileDir, "SingletonLock"));
	} catch {
		return;
	}
	const prefix = hostname() + "-";
	if (!owner.startsWith(prefix)) return;
	const rawPid = owner.slice(prefix.length);
	if (!/^\d+$/.test(rawPid)) return;
	const pid = Number(rawPid);
	if (!Number.isSafeInteger(pid) || pid < 1) return;
	try {
		process.kill(pid, 0);
		return;
	} catch (error) {
		if (!hasErrorCode(error, "ESRCH")) return;
	}
	await Promise.all(CHROMIUM_SINGLETON_FILES.map(async (name) => {
		try {
			await unlink(join(profileDir, name));
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
		}
	}));
}
function hasErrorCode(error, code) {
	return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function defaultProfileDir() {
	const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "codex-sidebar", "chromium-profile");
}
async function launchPlaywright(profileDir, opts) {
	await mkdir(dirname(profileDir), {
		recursive: true,
		mode: 448
	});
	return await chromium.launchPersistentContext(profileDir, {
		executablePath: opts.executablePath,
		headless: opts.headless,
		viewport: opts.viewport,
		deviceScaleFactor: opts.deviceScaleFactor,
		ignoreDefaultArgs: opts.ignoreDefaultArgs
	});
}
function project(record) {
	return {
		key: record.key,
		sessionId: record.tab.sessionId,
		tabId: record.tab.tabId,
		url: record.url,
		title: record.title,
		documentId: record.documentId,
		status: record.status,
		...record.error === void 0 ? {} : { error: record.error }
	};
}
function notReady() {
	return {
		ok: false,
		code: "not-ready",
		message: "托管浏览器页面尚未加载完成"
	};
}
function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}
function formatTree(nodes, title) {
	const lines = ["document \"" + title.replace(/"/g, "\"") + "\""];
	for (const node of nodes) lines.push("  " + node.role + " \"" + node.name.replace(/"/g, "\"") + "\" [ref=" + node.ref + "]");
	return lines.join("\n");
}
const OUTLINE_EXPRESSION = String.raw`(() => {
  const skipped = new Set(['HTML','BODY','SCRIPT','STYLE','META','LINK','BR','NOSCRIPT','TEMPLATE','SOURCE','PATH','G','DEFS','CLIPPATH']);
  const semantic = new Set(['A','BUTTON','INPUT','TEXTAREA','SELECT','IMG','SVG','VIDEO','CANVAS','H1','H2','H3','H4','H5','H6','P','LI','TD','TH','LABEL','SUMMARY']);
  const selectorOf = (el) => {
    if (el.id) {
      const selector = '#' + CSS.escape(el.id);
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const test = el.getAttribute('data-testid');
    if (test) {
      const selector = '[data-testid="' + CSS.escape(test) + '"]';
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement && parts.length < 8) {
      const parent = current.parentElement;
      const same = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [current];
      parts.unshift(current.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(current) + 1) + ')');
      const selector = parts.join(' > ');
      if (document.querySelectorAll(selector).length === 1) return selector;
      current = parent;
    }
    return parts.join(' > ');
  };
  const roles = {A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',IMG:'image',SVG:'image',VIDEO:'video',CANVAS:'canvas',H1:'heading',H2:'heading',H3:'heading',H4:'heading',H5:'heading',H6:'heading',P:'paragraph',LI:'listitem',TD:'cell',TH:'columnheader',LABEL:'label',SUMMARY:'button'};
  return Array.from(document.querySelectorAll('*')).flatMap((el) => {
    if (skipped.has(el.tagName)) return [];
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return [];
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return [];
    const rawName = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('value') || '';
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (name.length === 0 && !semantic.has(el.tagName) && !el.hasAttribute('role')) return [];
    const role = el.getAttribute('role') || roles[el.tagName] || el.tagName.toLowerCase();
    return [{ role, name: name || role, selector: selectorOf(el), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }];
  });
})()`;
const SNAPSHOT_EXPRESSION = String.raw`(() => {
  const all = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],h1,h2,h3'));
  const selectorOf = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const test = el.getAttribute('data-testid');
    if (test) return '[data-testid="' + CSS.escape(test) + '"]';
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(name) + '"]';
    const parent = el.parentElement;
    const same = parent ? Array.from(parent.children).filter((child) => child.tagName === el.tagName) : [el];
    return el.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
  };
  return all.flatMap((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return [];
    const role = el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',H1:'heading',H2:'heading',H3:'heading'}[el.tagName] || el.tagName.toLowerCase());
    const name = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('value') || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    return [{ role, name, selector: selectorOf(el), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }];
  });
})()`;
//#endregion
//#region lib/types/managed-browser-evidence.js
/** Temporary Browser captures and draft screenshot evidence sidecars. */
const TEMP_CAPTURE_TTL_MS = 6e5;
const MAX_EVIDENCE_BYTES = 5242880;
var ManagedBrowserEvidenceStore = class {
	root;
	#runtime;
	#now;
	#captures = /* @__PURE__ */ new Map();
	#committed = /* @__PURE__ */ new Map();
	constructor(runtime, opts = {}) {
		this.#runtime = runtime;
		this.#now = opts.now ?? Date.now;
		const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
		this.root = resolve(opts.root ?? join(dshHome, "codex-sidebar", "draft-evidence"));
	}
	async capture(tab) {
		this.#pruneTemporary();
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const result = await this.#runtime.capture(tab);
			if (!("captureId" in result)) throw new Error(result.ok ? "Browser capture returned no image" : result.message);
			if (this.#runtime.projection(tab)?.documentId !== result.documentId) continue;
			if (result.image.byteLength > MAX_EVIDENCE_BYTES) throw new Error("Browser screenshot exceeds the 5 MB attachment limit");
			this.#captures.set(result.captureId, {
				tab,
				capture: result,
				expiresAt: this.#now() + TEMP_CAPTURE_TTL_MS
			});
			return metadata(result);
		}
		throw new Error("Browser navigated while capturing evidence; try again");
	}
	async commit(sessionId, captureId) {
		this.#pruneTemporary();
		const committed = this.#committed.get(captureId);
		if (committed !== void 0) {
			if (committed.sessionId !== sessionId) throw new Error("Browser capture belongs to a different session");
			return committed.evidence;
		}
		const temporary = this.#captures.get(captureId);
		if (temporary === void 0 || temporary.tab.sessionId !== sessionId) throw new Error("Browser capture is missing or expired");
		const capture = temporary.capture;
		const id = createHash("sha256").update(capture.image).digest("hex").slice(0, 32);
		const sessionDir = createHash("sha256").update(sessionId).digest("hex").slice(0, 20);
		const ref = sessionDir + "/" + id + ".jpg";
		const finalPath = this.#path(ref);
		const tempPath = finalPath + ".tmp-" + process.pid + "-" + Date.now();
		await mkdir(resolve(this.root, sessionDir), {
			recursive: true,
			mode: 448
		});
		await writeFile(tempPath, capture.image, { mode: 384 });
		await rename(tempPath, finalPath).catch(async (error) => {
			await rm(tempPath, { force: true });
			if (error.code !== "EEXIST") throw error;
		});
		this.#captures.delete(captureId);
		const evidence = {
			id,
			captureId,
			documentId: capture.documentId,
			ref,
			mediaType: capture.mediaType,
			width: capture.width,
			height: capture.height
		};
		this.#committed.set(captureId, {
			sessionId,
			evidence
		});
		return evidence;
	}
	async read(sessionId, evidence) {
		const sessionDir = createHash("sha256").update(sessionId).digest("hex").slice(0, 20);
		if (!evidence.ref.startsWith(sessionDir + "/")) throw new Error("Browser evidence belongs to a different session");
		const bytes = await readFile(this.#path(evidence.ref));
		if (bytes.byteLength > MAX_EVIDENCE_BYTES) throw new Error("Stored Browser screenshot exceeds the 5 MB attachment limit");
		return {
			mediaType: "image/jpeg",
			data: bytes.toString("base64")
		};
	}
	discard(captureId) {
		this.#captures.delete(captureId);
	}
	async remove(evidence) {
		await rm(this.#path(evidence.ref), { force: true });
	}
	#path(ref) {
		if (!/^[a-f0-9]{20}\/[a-f0-9]{32}\.jpg$/.test(ref)) throw new Error("Invalid Browser evidence ref");
		const path = resolve(this.root, ref);
		if (!path.startsWith(this.root + sep)) throw new Error("Browser evidence path escaped its root");
		return path;
	}
	#pruneTemporary() {
		const now = this.#now();
		for (const [id, item] of this.#captures) if (item.expiresAt < now) this.#captures.delete(id);
	}
};
function metadata(capture) {
	return {
		captureId: capture.captureId,
		documentId: capture.documentId,
		url: capture.url,
		title: capture.title,
		mediaType: capture.mediaType,
		width: capture.width,
		height: capture.height,
		nodes: capture.nodes
	};
}
const TICKET_TTL_MS = 3e4;
const MAX_BUFFERED_BYTES = 524288;
const HIGH_DENSITY_SCALE = 1.5;
const MANAGED_BROWSER_STREAM_MAX_WIDTH = 2560;
const MANAGED_BROWSER_STREAM_MAX_HEIGHT = 2048;
var ManagedBrowserStream = class {
	#runtime;
	#now;
	#ticketTtlMs;
	#tickets = /* @__PURE__ */ new Map();
	#server = new WebSocketServer({ noServer: true });
	#sockets = /* @__PURE__ */ new Set();
	#tabSockets = /* @__PURE__ */ new Map();
	constructor(opts) {
		this.#runtime = opts.runtime;
		this.#now = opts.now ?? Date.now;
		this.#ticketTtlMs = opts.ticketTtlMs ?? TICKET_TTL_MS;
	}
	issue(tab) {
		this.#pruneTickets();
		const ticket = randomBytes(24).toString("base64url");
		const expiresAt = this.#now() + this.#ticketTtlMs;
		this.#tickets.set(ticket, {
			tab,
			expiresAt
		});
		return {
			ticket,
			expiresAt,
			path: "/__dcs/browser-stream?ticket=" + encodeURIComponent(ticket)
		};
	}
	handleUpgrade(req, socket, head) {
		const tab = this.#authorize(req);
		if (tab === void 0) {
			rejectUpgrade(socket, 403, "Forbidden");
			return;
		}
		const target = this.#runtime.target(tab);
		if (target === void 0) {
			rejectUpgrade(socket, 409, "Browser page is not ready");
			return;
		}
		this.#server.handleUpgrade(req, socket, head, (ws) => {
			this.#server.emit("connection", ws, req);
			this.#attach(ws, tab, target.cdp);
		});
	}
	async dispose() {
		for (const socket of this.#sockets) socket.close(1001, "Plugin disposed");
		this.#sockets.clear();
		this.#tabSockets.clear();
		this.#tickets.clear();
		await new Promise((resolve) => {
			this.#server.close(() => resolve());
		});
	}
	consume(ticket) {
		const record = this.#tickets.get(ticket);
		this.#tickets.delete(ticket);
		if (record === void 0 || record.expiresAt < this.#now()) return void 0;
		return record.tab;
	}
	#authorize(req) {
		const host = req.headers.host;
		const origin = req.headers.origin;
		if (host === void 0 || origin === void 0 || !sameOriginHost(origin, host)) return void 0;
		let ticket = null;
		try {
			ticket = new URL(req.url ?? "", "http://" + host).searchParams.get("ticket");
		} catch {
			return;
		}
		if (ticket === null || ticket.length === 0) return void 0;
		return this.consume(ticket);
	}
	async #attach(socket, tab, cdp) {
		const tabKey = this.#runtime.keyOf(tab);
		const previous = this.#tabSockets.get(tabKey);
		if (previous !== void 0 && previous.readyState === WebSocket.OPEN) previous.close(4001, "Replaced by a newer stream");
		this.#tabSockets.set(tabKey, socket);
		this.#sockets.add(socket);
		this.#runtime.touch(tab);
		let sequence = 0;
		let lastFrameAt = 0;
		let lastProjection = "";
		let captureInFlight = false;
		let pendingCapture;
		const sendProjection = () => {
			if (socket.readyState !== WebSocket.OPEN) return;
			const projection = this.#runtime.projection(tab);
			if (projection === void 0) return;
			const signature = projection.documentId + ":" + projection.status + ":" + projection.url + ":" + projection.title;
			if (signature === lastProjection) return;
			lastProjection = signature;
			socket.send(JSON.stringify({
				type: "state",
				projection
			}));
		};
		const sendFrame = (jpeg, width, height) => {
			if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
			sequence += 1;
			socket.send(encodeBrowserStreamFrame({
				version: 1,
				sequence,
				sentAt: this.#now(),
				width,
				height,
				jpeg
			}), { binary: true });
		};
		const captureFrame = async (request) => {
			try {
				const data = screenshotData(await cdp.send("Page.captureScreenshot", {
					format: "jpeg",
					quality: 80,
					fromSurface: true,
					captureBeyondViewport: false,
					clip: {
						x: 0,
						y: 0,
						width: request.width,
						height: request.height,
						scale: browserStreamCaptureScale(request.width, request.height)
					}
				}));
				if (data === void 0) throw new Error("Browser screenshot returned no data");
				sendFrame(Buffer.from(data, "base64"), request.width, request.height);
			} catch {
				sendFrame(Buffer.from(request.fallback, "base64"), request.width, request.height);
			}
		};
		const requestFrame = (request) => {
			if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
			const now = this.#now();
			if (now - lastFrameAt < 100) return;
			if (captureInFlight) {
				pendingCapture = request;
				return;
			}
			lastFrameAt = now;
			captureInFlight = true;
			captureFrame(request).finally(() => {
				captureInFlight = false;
				const pending = pendingCapture;
				pendingCapture = void 0;
				if (pending !== void 0) requestFrame(pending);
			});
		};
		const onFrame = (value) => {
			const payload = value;
			sendProjection();
			if (typeof payload.sessionId === "number") cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => void 0);
			if (typeof payload.data !== "string") return;
			const width = finiteDimension(payload.metadata?.deviceWidth, 720);
			const height = finiteDimension(payload.metadata?.deviceHeight, 860);
			requestFrame({
				width,
				height,
				fallback: payload.data
			});
		};
		let detached = false;
		const detach = async () => {
			if (detached) return;
			detached = true;
			cdp.off("Page.screencastFrame", onFrame);
			this.#sockets.delete(socket);
			pendingCapture = void 0;
			if (this.#tabSockets.get(tabKey) !== socket) return;
			this.#tabSockets.delete(tabKey);
			await cdp.send("Page.stopScreencast").catch(() => void 0);
		};
		cdp.on("Page.screencastFrame", onFrame);
		socket.on("message", (data, isBinary) => {
			if (isBinary) return;
			this.#onMessage(socket, tab, cdp, data.toString()).catch(() => void 0);
		});
		socket.once("close", () => {
			detach();
		});
		socket.once("error", () => {
			detach();
		});
		try {
			await cdp.send("Page.startScreencast", {
				format: "jpeg",
				quality: 80,
				maxWidth: MANAGED_BROWSER_STREAM_MAX_WIDTH,
				maxHeight: MANAGED_BROWSER_STREAM_MAX_HEIGHT,
				everyNthFrame: 2
			});
			socket.send(JSON.stringify({
				type: "ready",
				version: 1
			}));
			sendProjection();
		} catch (error) {
			socket.close(1011, error instanceof Error ? error.message.slice(0, 120) : "Cannot start screencast");
		}
	}
	async #onMessage(socket, tab, cdp, raw) {
		const message = JSON.parse(raw);
		if (message.type === "outline") {
			const outline = await this.#runtime.outline(tab);
			if ("nodes" in outline && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
				type: "outline",
				documentId: outline.documentId,
				nodes: outline.nodes.filter((node) => node.rect !== void 0)
			}));
			return;
		}
		if (message.type === "resize" && typeof message.width === "number" && typeof message.height === "number") {
			await this.#runtime.resize(tab, message.width, message.height);
			return;
		}
		if (message.type !== "input" || !validInput(message.input)) return;
		await dispatchInput(cdp, message.input);
		if (message.input.type === "wheel" && message.input.selector !== void 0) {
			const tracked = await this.#runtime.trackRect(tab, message.input.selector);
			if ("rect" in tracked && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
				type: "tracked-rect",
				...tracked
			}));
		}
	}
	#pruneTickets() {
		const now = this.#now();
		for (const [ticket, record] of this.#tickets) if (record.expiresAt < now) this.#tickets.delete(ticket);
	}
};
function encodeBrowserStreamFrame(frame) {
	const header = Buffer.allocUnsafe(17);
	header.writeUInt8(frame.version, 0);
	header.writeUInt32BE(frame.sequence, 1);
	header.writeDoubleBE(frame.sentAt, 5);
	header.writeUInt16BE(frame.width, 13);
	header.writeUInt16BE(frame.height, 15);
	return new Uint8Array(Buffer.concat([header, Buffer.from(frame.jpeg)]));
}
async function dispatchInput(cdp, input) {
	if (input.type === "wheel") {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: input.x,
			y: input.y,
			deltaX: input.deltaX,
			deltaY: input.deltaY
		});
		return;
	}
	if (input.type === "down" || input.type === "up" || input.type === "move") {
		const pressed = input.type === "down" || input.type === "move" && input.pressed === true;
		await cdp.send("Input.dispatchMouseEvent", {
			type: input.type === "down" ? "mousePressed" : input.type === "up" ? "mouseReleased" : "mouseMoved",
			x: input.x,
			y: input.y,
			button: pressed ? "left" : input.type === "up" ? "left" : "none",
			buttons: pressed ? 1 : 0,
			...input.type === "move" ? {} : { clickCount: 1 }
		});
		return;
	}
	if (input.type === "text") {
		await cdp.send("Input.insertText", { text: input.text });
		return;
	}
	if (input.type === "keyDown" || input.type === "keyUp") await cdp.send("Input.dispatchKeyEvent", {
		type: input.type === "keyDown" ? "keyDown" : "keyUp",
		key: input.key,
		code: input.code,
		modifiers: input.modifiers ?? 0
	});
}
function validInput(value) {
	if (typeof value !== "object" || value === null || !("type" in value)) return false;
	const type = value.type;
	if (type === "text") return typeof value.text === "string";
	if (type === "keyDown" || type === "keyUp") {
		const input = value;
		return typeof input.key === "string" && typeof input.code === "string";
	}
	const input = value;
	if (typeof input.x !== "number" || typeof input.y !== "number") return false;
	if (type === "wheel") {
		const wheel = value;
		return typeof wheel.deltaX === "number" && typeof wheel.deltaY === "number" && (wheel.selector === void 0 || typeof wheel.selector === "string");
	}
	return type === "down" || type === "up" || type === "move";
}
function sameOriginHost(origin, host) {
	try {
		const url = new URL(origin);
		return (url.protocol === "http:" || url.protocol === "https:") && url.host === host;
	} catch {
		return false;
	}
}
function browserStreamCaptureScale(width, height) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
	return Math.max(.1, Math.min(HIGH_DENSITY_SCALE, MANAGED_BROWSER_STREAM_MAX_WIDTH / width, MANAGED_BROWSER_STREAM_MAX_HEIGHT / height));
}
function screenshotData(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const data = value.data;
	return typeof data === "string" && data.length > 0 ? data : void 0;
}
function finiteDimension(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? Math.min(65535, Math.max(1, Math.round(value))) : fallback;
}
function rejectUpgrade(socket, status, message) {
	socket.end("HTTP/1.1 " + status + " " + message + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
	socket.destroy();
}
//#endregion
//#region lib/types/browser-drive.js
/** Document-scoped automation contract for Host-managed Browser Pages. */
/** Side Chat Forks and subagents do not drive the 主会话 Browser. */
function callerMayDrive(header) {
	if (header === void 0) return false;
	if (header.parentSession !== void 0 && header.parentSession.length > 0) return false;
	if (header.origin === "subagent") return false;
	return true;
}
//#endregion
//#region lib/types/host-browser-tools.js
/** 主会话 tools that drive Host-managed Chromium Browser Tabs. */
const BROWSER_DRIVE_TOOLS = [
	"browser_tabs",
	"browser_open",
	"browser_snapshot",
	"browser_click",
	"browser_fill"
];
function createManagedBrowserDriveService(runtime) {
	const guard = (caller) => callerMayDrive(caller) ? void 0 : {
		ok: false,
		code: "forbidden",
		message: "只有当前主会话的舵主能操作侧栏 Browser"
	};
	const listed = (session) => {
		const snapshot = session.snapshot(false);
		return snapshot.tabs.flatMap((tab) => {
			if (tab.kind !== "Browser") return [];
			const url = snapshot.browsers[tab.id]?.url || tab.target;
			if (url.length === 0) return [];
			const projection = runtime.projection({
				sessionId: snapshot.sessionId,
				tabId: tab.id
			});
			return [{
				tabId: tab.id,
				url: liveHref(url) ?? url,
				title: projection?.title || tab.title,
				driveable: true,
				connected: projection?.status === "ready"
			}];
		});
	};
	const tabOf = (session, tabId) => {
		const tabs = listed(session);
		if (tabId !== void 0 && tabId.length > 0) return tabs.find((tab) => tab.tabId === tabId);
		const active = session.snapshot(false).active;
		return tabs.find((tab) => tab.tabId === active) ?? tabs[0];
	};
	const act = async (session, tabId, action, ref, text) => {
		const tab = tabOf(session, tabId);
		if (tab === void 0) return {
			ok: false,
			code: "no-browser",
			message: "侧栏还没有 Browser Tab，先 browser_open 一个地址"
		};
		const key = {
			sessionId: session.snapshot(false).sessionId,
			tabId: tab.tabId
		};
		if (runtime.projection(key)?.status !== "ready") await runtime.ensure(key, tab.url);
		if (action === "snapshot") {
			const result = await runtime.snapshot(key);
			if ("nodes" in result) return {
				ok: true,
				snapshot: result
			};
			return result.ok ? { ok: true } : managedFailure(result);
		}
		const result = action === "click" ? await runtime.click(key, ref ?? "") : await runtime.fill(key, ref ?? "", text ?? "");
		return result.ok ? { ok: true } : managedFailure(result);
	};
	return {
		tabs(caller, session) {
			return guard(caller) ?? {
				ok: true,
				tabs: listed(session)
			};
		},
		async open(caller, session, url) {
			const denied = guard(caller);
			if (denied !== void 0) return denied;
			const href = liveHref(url);
			if (href === void 0) return {
				ok: false,
				code: "navigation-failed",
				message: "需要 http 或 https 地址"
			};
			const blocked = harnessSelfBlockReason(href);
			if (blocked !== void 0) return {
				ok: false,
				code: "navigation-failed",
				message: blocked
			};
			session.dispatch({
				type: "open-url",
				url: href,
				reveal: false
			});
			const tab = listed(session).find((item) => item.url === href) ?? listed(session)[0];
			if (tab === void 0) return {
				ok: false,
				code: "no-browser",
				message: "无法打开 Browser Tab"
			};
			const projection = await runtime.ensure({
				sessionId: session.snapshot(false).sessionId,
				tabId: tab.tabId
			}, href);
			if (projection.status !== "ready") return {
				ok: false,
				code: "navigation-failed",
				message: projection.error ?? "页面加载失败"
			};
			return {
				ok: true,
				tab: {
					...tab,
					title: projection.title || tab.title,
					connected: true
				}
			};
		},
		async snapshot(caller, session, tabId) {
			return guard(caller) ?? act(session, tabId, "snapshot");
		},
		async click(caller, session, ref, tabId) {
			return guard(caller) ?? act(session, tabId, "click", ref);
		},
		async fill(caller, session, ref, text, tabId) {
			return guard(caller) ?? act(session, tabId, "fill", ref, text);
		}
	};
}
function managedFailure(result) {
	return {
		ok: false,
		code: result.code,
		message: result.message
	};
}
//#endregion
//#region lib/types/register-browser-tools.js
/** Register 主会话 Browser drive tools. */
const BROWSER_DRIVE_GUIDANCE = [
	"侧栏 Browser 是当前主会话的托管 Chromium，用人的同一只 Tab，支持本机和公网站。",
	"操作它只用 browser_tabs / browser_open / browser_snapshot / browser_click / browser_fill。",
	"不要用 computer-use、Orca、桌面截图、系统 Chrome，也不要用 bash sleep / 提权沙箱来等页面。",
	"browser_open 会静默打开，不必先拉开侧栏；随后 browser_snapshot 获取当前 document-scoped ref。",
	"不要用托管 Browser 打开 DSH Web 自己（127.0.0.1:3080/3082 或 dsh 前端域名），那会 GUI 套娃空转。",
	"页面导航后旧 ref 会失效，重新 snapshot。Side Chat / Fork 不能用这组工具。"
].join("\n");
const RESULT_SCHEMA = {
	type: "object",
	additionalProperties: true,
	properties: { ok: { type: "boolean" } }
};
function registerBrowserDriveTools(tools, service, sessionOf, before) {
	const disposers = [];
	const render = (_args, value) => [{
		type: "text",
		text: JSON.stringify(value)
	}];
	function tool(name, description, parameters, execute) {
		disposers.push(tools.register({
			name,
			description,
			parameters,
			output: {
				schema: RESULT_SCHEMA,
				render
			},
			isConcurrencySafe: name === "browser_tabs" ? () => true : void 0,
			execute
		}));
	}
	tool("browser_tabs", "列出当前主会话侧栏 Browser Tab。操作托管页面必须用这组 browser_* 工具，禁止 computer-use / Orca / 桌面截图。Fork / Side Chat 不能用。", {
		type: "object",
		properties: {},
		additionalProperties: false
	}, async (_args, exec) => {
		await before?.();
		const session = sessionOf(exec);
		if (session === void 0) return missingSession();
		return service.tabs(headerOf(exec), session);
	});
	tool("browser_open", "在侧栏托管 Browser 打开本机或公网 URL（静默，不必拉开侧栏），随后可 snapshot/click/fill。禁止用 computer-use 代替。", {
		type: "object",
		additionalProperties: false,
		properties: { url: {
			type: "string",
			description: "要打开的地址"
		} },
		required: ["url"]
	}, async (args, exec) => {
		await before?.();
		const session = sessionOf(exec);
		if (session === void 0) return missingSession();
		return service.open(headerOf(exec), session, String(args.url ?? ""));
	});
	tool("browser_snapshot", "读取侧栏托管页面的可交互树，返回 document-scoped ref。open 之后直接调用本工具，它会等待连接。禁止 sleep、禁止 computer-use。", {
		type: "object",
		additionalProperties: false,
		properties: { tabId: {
			type: "string",
			description: "Browser Tab id，省略则用当前 Tab"
		} }
	}, async (args, exec) => {
		await before?.();
		const session = sessionOf(exec);
		if (session === void 0) return missingSession();
		return service.snapshot(headerOf(exec), session, optionalString(args.tabId));
	});
	tool("browser_click", "点击最近一次 browser_snapshot 的 document-scoped ref。导航后需重新 snapshot。禁止 computer-use。", {
		type: "object",
		additionalProperties: false,
		properties: {
			ref: {
				type: "string",
				description: "snapshot 里的 @eN"
			},
			tabId: {
				type: "string",
				description: "Browser Tab id"
			}
		},
		required: ["ref"]
	}, async (args, exec) => {
		await before?.();
		const session = sessionOf(exec);
		if (session === void 0) return missingSession();
		return service.click(headerOf(exec), session, String(args.ref ?? ""), optionalString(args.tabId));
	});
	tool("browser_fill", "向最近一次 snapshot 的输入框 ref 填文本；导航后需重新 snapshot。禁止 computer-use 打字。", {
		type: "object",
		additionalProperties: false,
		properties: {
			ref: {
				type: "string",
				description: "snapshot 里的 @eN"
			},
			text: {
				type: "string",
				description: "要填入的文本"
			},
			tabId: {
				type: "string",
				description: "Browser Tab id"
			}
		},
		required: ["ref", "text"]
	}, async (args, exec) => {
		await before?.();
		const session = sessionOf(exec);
		if (session === void 0) return missingSession();
		return service.fill(headerOf(exec), session, String(args.ref ?? ""), String(args.text ?? ""), optionalString(args.tabId));
	});
	const disposeGuard = tools.guard?.((exec) => {
		if (!BROWSER_DRIVE_TOOLS.includes(exec.name)) return void 0;
		if (callerMayDrive(exec.agent?.session?.header)) return void 0;
		return "只有当前主会话的舵主能操作侧栏 Browser";
	});
	if (disposeGuard !== void 0) disposers.push(disposeGuard);
	return () => {
		for (const dispose of disposers.reverse()) dispose();
	};
}
function headerOf(exec) {
	return exec.agent?.session?.header;
}
function missingSession() {
	return {
		ok: false,
		code: "no-browser",
		message: "没有当前主会话，无法操作侧栏 Browser"
	};
}
function optionalString(value) {
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
//#endregion
//#region lib/types/git-status.js
/** One git status per repo generation. Shared by Files stats and Review. */
const TTL_MS = 1500;
function defaultGitExec$1(args, cwd) {
	return execFileSync("git", [...args], {
		cwd,
		encoding: "utf8",
		stdio: [
			"ignore",
			"pipe",
			"ignore"
		]
	});
}
function createGitRepo(exec = defaultGitExec$1) {
	const cache = /* @__PURE__ */ new Map();
	let execs = 0;
	function run(args, cwd) {
		execs += 1;
		return exec(args, cwd);
	}
	function load(cwd) {
		const gen = generation(cwd);
		const now = Date.now();
		const hit = cache.get(cwd);
		if (hit !== void 0 && hit.gen === gen && now - hit.at < TTL_MS) return hit;
		const next = {
			gen,
			at: now,
			status: readStatus(run, cwd)
		};
		cache.set(cwd, next);
		return next;
	}
	return {
		execCount: () => execs,
		clear() {
			cache.clear();
			execs = 0;
		},
		status(cwd) {
			if (cwd.length === 0) return emptyStatus();
			return load(cwd).status;
		},
		inGit(cwd) {
			return cwd.length > 0 && load(cwd).status.inside;
		},
		changes(cwd) {
			if (cwd.length === 0) return emptyChanges();
			const rec = load(cwd);
			if (rec.changes !== void 0) return rec.changes;
			rec.changes = buildChanges(run, cwd, rec.status);
			return rec.changes;
		},
		numstat(cwd) {
			if (cwd.length === 0) return {};
			const rec = load(cwd);
			if (rec.numstat !== void 0) return rec.numstat;
			rec.numstat = buildNumstat(run, cwd, rec.status);
			return rec.numstat;
		},
		branches(cwd) {
			if (cwd.length === 0) return {
				current: "",
				names: []
			};
			const rec = load(cwd);
			if (rec.branches !== void 0) return rec.branches;
			rec.branches = buildBranches(run, cwd, rec.status);
			return rec.branches;
		}
	};
}
const gitRepo = createGitRepo();
function emptyStatus() {
	return {
		inside: false,
		branch: "",
		entries: []
	};
}
function emptyChanges() {
	return {
		uncommitted: [],
		staged: [],
		unstaged: []
	};
}
function generation(cwd) {
	try {
		return String(statSync(join(cwd, ".git", "HEAD")).mtimeMs);
	} catch {
		return "none";
	}
}
function readStatus(run, cwd) {
	let raw = "";
	try {
		raw = run([
			"status",
			"--porcelain=v2",
			"--branch",
			"-z"
		], cwd);
	} catch {
		return emptyStatus();
	}
	let branch = "";
	const entries = [];
	for (const rec of raw.split("\0")) {
		if (rec.length === 0) continue;
		if (rec.startsWith("# branch.head ")) {
			const name = rec.slice(14).trim();
			if (name !== "(detached)") branch = name;
			continue;
		}
		if (rec.startsWith("? ")) {
			entries.push({
				path: rec.slice(2),
				x: "?",
				y: "?",
				untracked: true
			});
			continue;
		}
		if (rec.startsWith("1 ") || rec.startsWith("2 ")) {
			const parsed = parseTracked(rec);
			if (parsed !== void 0) entries.push(parsed);
		}
	}
	return {
		inside: true,
		branch,
		entries
	};
}
function parseTracked(rec) {
	const parts = rec.split(" ");
	if (parts.length < 9) return void 0;
	const xy = parts[1] ?? "";
	if (xy.length < 2) return void 0;
	const pathField = rec.startsWith("2 ") ? rec.slice(rec.lastIndexOf(" ") + 1) : parts[8] ?? "";
	const path = pathField.includes("	") ? pathField.slice(pathField.indexOf("	") + 1) : pathField;
	if (path.length === 0) return void 0;
	return {
		path,
		x: xy[0] ?? ".",
		y: xy[1] ?? ".",
		untracked: false
	};
}
function buildChanges(run, cwd, status) {
	if (!status.inside) return emptyChanges();
	const uncommitted = [];
	const staged = [];
	const unstaged = [];
	for (const entry of status.entries) {
		if (entry.untracked) {
			const work = readWork$1(cwd, entry.path);
			pushChange(unstaged, entry.path, "", work);
			pushChange(uncommitted, entry.path, "", work);
			continue;
		}
		const head = gitShow(run, cwd, "HEAD:" + entry.path);
		const index = gitShow(run, cwd, ":" + entry.path);
		const work = entry.y === "D" ? "" : readWork$1(cwd, entry.path);
		if (entry.x !== "." && entry.x !== "?") pushChange(staged, entry.path, head, entry.x === "D" ? "" : index);
		if (entry.y !== "." && entry.y !== "?") {
			const before = index.length > 0 ? index : head;
			pushChange(unstaged, entry.path, before, entry.y === "D" ? "" : work);
		}
		const workAfter = entry.x === "D" && entry.y === "." || entry.y === "D" ? "" : work;
		pushChange(uncommitted, entry.path, head, workAfter);
	}
	return {
		uncommitted,
		staged,
		unstaged
	};
}
function buildNumstat(run, cwd, status) {
	const out = {};
	if (!status.inside) return out;
	let text = "";
	try {
		text = run([
			"diff",
			"--numstat",
			"HEAD"
		], cwd);
	} catch {
		text = "";
	}
	for (const line of text.split("\n")) {
		const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
		if (match === null) continue;
		const path = numstatPath$1(match[3] ?? "");
		if (path.length === 0) continue;
		out[path] = {
			added: match[1] === "-" ? 0 : Number(match[1]),
			removed: match[2] === "-" ? 0 : Number(match[2])
		};
	}
	for (const entry of status.entries) {
		if (!entry.untracked || out[entry.path] !== void 0) continue;
		if (entry.path === "node_modules" || entry.path.startsWith("node_modules/")) continue;
		out[entry.path] = {
			added: 0,
			removed: 0
		};
	}
	return out;
}
function buildBranches(run, cwd, status) {
	if (!status.inside) return {
		current: "",
		names: []
	};
	try {
		const text = run(["branch", "--format=%(refname:short)	%(HEAD)"], cwd);
		const names = [];
		let current = status.branch;
		for (const line of text.split("\n")) {
			if (line.length === 0) continue;
			const tab = line.indexOf("	");
			const name = tab === -1 ? line : line.slice(0, tab);
			const head = tab === -1 ? "" : line.slice(tab + 1);
			if (name.length === 0) continue;
			names.push(name);
			if (head === "*") current = name;
		}
		return {
			current,
			names
		};
	} catch {
		return {
			current: status.branch,
			names: status.branch.length === 0 ? [] : [status.branch]
		};
	}
}
function gitShow(run, cwd, spec) {
	try {
		return run(["show", spec], cwd);
	} catch {
		return "";
	}
}
function readWork$1(cwd, path) {
	try {
		return readFileSync(join(cwd, path), "utf8");
	} catch {
		return "";
	}
}
function pushChange(into, path, before, after) {
	if (before === after) return;
	into.push({
		path,
		before,
		after
	});
}
function numstatPath$1(raw) {
	return (raw.includes(" => ") ? raw.slice(raw.lastIndexOf(" => ") + 4) : raw).replace(/^"(.*)"$/, "$1");
}
const PER_DIR = 80;
const SKIP_WALK = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	"dist",
	"lib",
	"coverage",
	".next",
	".cache",
	"out",
	"build",
	"target",
	"third_party",
	".dart_tool",
	".pnpm",
	"__pycache__",
	"vendor"
]);
const SKIP_SHOW = /* @__PURE__ */ new Set([".git"]);
const SHOW_COLLAPSED = /* @__PURE__ */ new Set([
	"node_modules",
	"out",
	"build",
	"third_party",
	".dart_tool",
	"vendor"
]);
function collectTree(root, signal) {
	if (root.length === 0) return [];
	const nodes = [];
	const queue = [root];
	while (queue.length > 0 && nodes.length < 400) {
		signal?.throwIfAborted();
		const dir = queue.shift();
		if (dir === void 0) break;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		consumeDir(root, dir, entries, nodes, queue);
	}
	return nodes;
}
async function collectTreeAsync(root, signal) {
	if (root.length === 0) return [];
	const nodes = [];
	const queue = [root];
	while (queue.length > 0 && nodes.length < 400) {
		signal?.throwIfAborted();
		const dir = queue.shift();
		if (dir === void 0) break;
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		consumeDir(root, dir, entries, nodes, queue);
	}
	return nodes;
}
function consumeDir(root, dir, entries, nodes, queue) {
	entries.sort((a, b) => a.name.localeCompare(b.name));
	const subdirs = [];
	let addedHere = 0;
	for (const entry of entries) {
		if (nodes.length >= 400) break;
		if (SKIP_SHOW.has(entry.name)) continue;
		const full = join(dir, entry.name);
		const rel = relative(root, full).split(sep).join("/");
		if (entry.isDirectory()) {
			if (SKIP_WALK.has(entry.name)) {
				if (SHOW_COLLAPSED.has(entry.name)) nodes.push({
					path: rel,
					name: entry.name,
					kind: "dir"
				});
				continue;
			}
			subdirs.push(full);
			continue;
		}
		if (!entry.isFile()) continue;
		if (addedHere >= PER_DIR) continue;
		nodes.push({
			path: rel,
			name: entry.name
		});
		addedHere += 1;
	}
	if (addedHere === 0 && subdirs.length === 0 && dir !== root) {
		const name = relative(root, dir).split(sep).pop() ?? dir;
		nodes.push({
			path: relative(root, dir).split(sep).join("/"),
			name,
			kind: "dir"
		});
	}
	for (const sub of subdirs) {
		if (nodes.length >= 400) break;
		queue.push(sub);
	}
}
//#endregion
//#region lib/types/host-files.js
/** Read-only workspace FilesPort backed by the 主会话 cwd. */
function createFsFiles(cwdOf) {
	return {
		read(path) {
			const cwd = cwdOf();
			const full = isAbsolute(path) ? path : cwd.length === 0 ? void 0 : join(cwd, path);
			if (full === void 0) return void 0;
			try {
				if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path)) {
					const buf = readFileSync(full);
					return "data:" + imageMime$1(path) + ";base64," + buf.toString("base64");
				}
				return readFileSync(full, "utf8");
			} catch {
				return;
			}
		},
		tree() {
			return collectTree(cwdOf());
		},
		change(path) {
			const cwd = cwdOf();
			if (cwd.length === 0 || path.length === 0) return void 0;
			const after = readWork(cwd, path);
			let before = "";
			try {
				before = defaultGitExec$1(["show", "HEAD:" + path], cwd);
			} catch {
				before = "";
			}
			if (before === after) return void 0;
			return {
				before,
				after
			};
		},
		stats() {
			return gitRepo.numstat(cwdOf());
		}
	};
}
function imageMime$1(path) {
	const lower = path.toLowerCase();
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	return "image/jpeg";
}
function readWork(cwd, path) {
	try {
		return readFileSync(join(cwd, path), "utf8");
	} catch {
		return "";
	}
}
//#endregion
//#region lib/types/host-persist.js
/** Persist one SidebarSession JSON blob per 主会话 id. */
const LEGACY_ROOT = join(homedir(), ".dsh-codex-sidebar", "sessions");
function sidebarPersistRoot(env = process.env) {
	const home = env.DSH_HOME ?? join(homedir(), ".dsh");
	return join(home, "codex-sidebar", "sessions");
}
function createFilePersist(root, legacyRootOverride) {
	const targetRoot = root ?? sidebarPersistRoot();
	const legacyRoot = legacyRootOverride ?? (root === void 0 && targetRoot !== LEGACY_ROOT ? LEGACY_ROOT : void 0);
	mkdirSync(targetRoot, { recursive: true });
	const latest = /* @__PURE__ */ new Map();
	const timers = /* @__PURE__ */ new Map();
	let chain = Promise.resolve();
	const flushOne = async (sessionId) => {
		const snapshot = latest.get(sessionId);
		if (snapshot === void 0) return;
		latest.delete(sessionId);
		await mkdir(targetRoot, { recursive: true });
		await writeSnapshotAsync(targetRoot, sessionId, snapshot);
	};
	const flush = async () => {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		const ids = [.../* @__PURE__ */ new Set([...latest.keys()])];
		chain = chain.then(async () => {
			for (const id of ids) await flushOne(id);
		}, async () => {
			for (const id of ids) await flushOne(id);
		});
		await chain;
		if (latest.size > 0) await flush();
	};
	return {
		load(sessionId) {
			const pending = latest.get(sessionId);
			if (pending !== void 0) return pending;
			const current = readSnapshot(targetRoot, sessionId);
			if (current !== void 0) return current;
			if (legacyRoot === void 0) return void 0;
			const legacy = readSnapshot(legacyRoot, sessionId);
			if (legacy === void 0) return void 0;
			writeSnapshot(targetRoot, sessionId, legacy);
			return legacy;
		},
		save(sessionId, snapshot) {
			latest.set(sessionId, snapshot);
			const prev = timers.get(sessionId);
			if (prev !== void 0) clearTimeout(prev);
			timers.set(sessionId, setTimeout(() => {
				timers.delete(sessionId);
				chain = chain.then(() => flushOne(sessionId), () => flushOne(sessionId));
			}, 500));
			timers.get(sessionId)?.unref?.();
		},
		flush
	};
}
function writeSnapshot(root, sessionId, snapshot) {
	const file = sessionFile(sessionId);
	const target = join(root, file);
	const temp = join(root, "." + file + "." + process.pid + ".tmp");
	writeFileSync(temp, JSON.stringify(snapshot));
	renameSync(temp, target);
}
async function writeSnapshotAsync(root, sessionId, snapshot) {
	const file = sessionFile(sessionId);
	const target = join(root, file);
	const temp = join(root, "." + file + "." + process.pid + "." + Date.now() + ".tmp");
	await writeFile(temp, JSON.stringify(snapshot));
	await rename(temp, target);
}
function readSnapshot(root, sessionId) {
	try {
		const raw = readFileSync(join(root, sessionFile(sessionId)), "utf8");
		return JSON.parse(raw);
	} catch {
		return;
	}
}
function sessionFile(sessionId) {
	if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error("invalid sidebar session id");
	return sessionId + ".json";
}
//#endregion
//#region lib/types/annotation.js
/** Build and label stacked 批注 without dumping page innerText. */
function noteBody(draft) {
	return draft.trim();
}
function parsePathLine(mark) {
	const i = mark.lastIndexOf(":");
	if (i <= 0) return { path: mark };
	const raw = mark.slice(i + 1);
	if (!/^\d+$/.test(raw)) return { path: mark };
	const line = Number(raw);
	if (line < 1) return { path: mark };
	return {
		path: mark.slice(0, i),
		line
	};
}
function fileCaption(mark) {
	const { path, line } = parsePathLine(mark);
	const name = path.split("/").pop() ?? path;
	return line === void 0 ? name : `${name}:${line}`;
}
function hydrateAnnotation(item) {
	const source = item.source ?? (item.id.startsWith("b") ? "browser" : item.id.startsWith("r") ? "review" : "files");
	return {
		...item,
		source,
		text: item.text ?? "",
		from: item.from ?? ""
	};
}
function fromFileMark(id, draft, mark, rect, selection) {
	const { path, line } = parsePathLine(mark);
	return {
		id,
		text: noteBody(draft),
		from: fileCaption(mark),
		source: "files",
		selector: mark,
		path,
		...line === void 0 ? {} : { line },
		...rect === void 0 ? {} : { rect },
		...selection === void 0 ? {} : { selection }
	};
}
function fromReviewMark(id, draft, mark) {
	const { path, line } = parsePathLine(mark);
	return {
		id,
		text: noteBody(draft),
		from: fileCaption(mark),
		source: "review",
		selector: mark,
		path,
		...line === void 0 ? {} : { line }
	};
}
function fromBrowserPending(id, draft, pending) {
	const selector = pending.pendingSelector;
	const rect = pending.pendingRect;
	return {
		id,
		text: noteBody(draft),
		from: pending.pendingMark,
		source: "browser",
		url: pending.url,
		...pending.evidence === void 0 ? {} : { evidence: pending.evidence },
		...selector === null || selector.length === 0 ? {} : { selector },
		...rect === null ? {} : { rect }
	};
}
const SNIPPET_MAX_CHARS = 2e3;
function toMarkView(item) {
	return {
		id: item.id,
		from: item.from,
		source: item.source,
		...item.selector === void 0 ? {} : { selector: item.selector },
		...item.path === void 0 ? {} : { path: item.path },
		...item.line === void 0 ? {} : { line: item.line },
		...item.url === void 0 ? {} : { url: item.url },
		...item.rect === void 0 ? {} : { rect: item.rect },
		...item.selection === void 0 ? {} : { selection: item.selection },
		...item.evidence === void 0 ? {} : { evidenceId: item.evidence.id }
	};
}
function fileSnippet(source, line, radius = 10, maxChars = SNIPPET_MAX_CHARS) {
	const rows = source.split("\n");
	if (line === void 0 || line < 1) return clipSnippet(source, maxChars);
	const start = Math.max(0, line - 1 - radius);
	const end = Math.min(rows.length, line + radius);
	return clipSnippet(rows.slice(start, end).map((text, index) => start + index + 1 + "|" + text).join("\n"), maxChars);
}
function clipSnippet(text, maxChars) {
	if (text.length <= maxChars) return text;
	return text.slice(0, Math.max(0, maxChars - 1)) + "…";
}
//#endregion
//#region lib/types/send-text.js
/** Turn stacked 批注 into human-facing prompt text and model-facing evidence. */
function formatHumanSend(text, attachments) {
	const body = text.trim();
	const notes = attachments.map((item) => item.text.trim()).filter((note) => note.length > 0);
	if (body.length > 0 && !attachments.some((item) => item.text.trim() === body)) return body;
	if (notes.length === 1) return notes[0] ?? "";
	if (notes.length > 1) return notes.map((note, index) => index + 1 + ". " + note).join("\n");
	if (attachments.length === 0) return body;
	return attachments.map((item, index) => "批注 " + (index + 1) + " · " + item.from).join("\n");
}
const formatSend = formatHumanSend;
function formatEvidenceSend(attachments, snippets = {}) {
	return attachments.map((item, index) => formatEvidenceMark(item, index + 1, snippets)).filter((row) => row.length > 0).join("\n\n");
}
function formatEvidenceMark(item, n, snippets) {
	const lines = ["批注 " + n + " · " + item.from];
	if (item.selector !== void 0 && item.selector.length > 0 && item.selector !== item.from) lines.push("`" + item.selector + "`");
	if (item.url !== void 0 && item.url.length > 0) lines.push(item.url);
	const snippet = snippetFor(item, snippets);
	if (snippet !== void 0 && snippet.length > 0) {
		lines.push("```");
		lines.push(snippet);
		lines.push("```");
	}
	return lines.join("\n");
}
function snippetFor(item, snippets) {
	if (item.path === void 0) return void 0;
	if (item.line !== void 0) {
		const keyed = snippets[item.path + ":" + item.line];
		if (keyed !== void 0) return keyed;
	}
	return snippets[item.path];
}
function formatDelivery(text, sourceTab, sourceSession) {
	const label = "[投递 · Side Chat " + sourceTab + " · 主会话 " + sourceSession + "]";
	const body = text.trim();
	if (body.length === 0) return label;
	return label + "\n" + body;
}
var AnnotationSendStore = class {
	#pending = /* @__PURE__ */ new Map();
	#byMessage = /* @__PURE__ */ new Map();
	#now;
	#ttlMs;
	constructor(opts = {}) {
		this.#now = opts.now ?? Date.now;
		this.#ttlMs = opts.ttlMs ?? 3e4;
	}
	stage(batch) {
		this.#prune();
		const next = {
			...batch,
			expiresAt: this.#now() + this.#ttlMs
		};
		const queue = this.#pending.get(batch.sessionId) ?? [];
		queue.push(next);
		this.#pending.set(batch.sessionId, queue);
		return next;
	}
	unstage(sessionId) {
		this.#pending.delete(sessionId);
	}
	/** Replace the unbound queue with one batch (or clear it). Immediate-stage uses this. */
	replacePending(sessionId, batch) {
		this.#pending.delete(sessionId);
		if (batch === null) return void 0;
		return this.stage(batch);
	}
	bindInserted(sessionId, message) {
		this.#prune();
		if (!isUserSource(message.source)) return;
		const queue = this.#pending.get(sessionId);
		if (queue === void 0 || queue.length === 0) return;
		const batch = queue.shift();
		if (batch === void 0) return;
		if (queue.length === 0) this.#pending.delete(sessionId);
		this.#byMessage.set(message.id, batch);
	}
	takeForMessage(messageId) {
		this.#prune();
		const batch = this.#byMessage.get(messageId);
		if (batch === void 0) return void 0;
		this.#byMessage.delete(messageId);
		return batch;
	}
	#prune() {
		const now = this.#now();
		for (const [id, queue] of this.#pending) {
			const kept = queue.filter((batch) => batch.expiresAt >= now);
			if (kept.length === 0) this.#pending.delete(id);
			else this.#pending.set(id, kept);
		}
	}
};
function isUserSource(source) {
	if (typeof source !== "object" || source === null) return false;
	return source.kind === "user";
}
function snippetsFor(attachments, read) {
	const out = {};
	if (read === void 0) return out;
	for (const item of attachments) {
		if (item.path === void 0) continue;
		const key = item.line === void 0 ? item.path : item.path + ":" + item.line;
		if (out[key] !== void 0) continue;
		const text = read(item.path);
		if (text === void 0) continue;
		out[key] = fileSnippet(text, item.line);
	}
	return out;
}
function enrichUserMessage(message, batch) {
	if (message.content.filter((block) => block.type === "image").length + batch.images.length > 20) throw new Error("A prompt can contain at most 20 images");
	const evidence = [];
	if (batch.evidenceText.length > 0) evidence.push({
		type: "text",
		text: batch.evidenceText
	});
	for (const image of batch.images) evidence.push({
		type: "image",
		attachment: image.attachment
	});
	const source = typeof message.source === "object" && message.source !== null ? {
		...message.source,
		annotations: batch.marks
	} : {
		kind: "user",
		annotations: batch.marks
	};
	return {
		...message,
		content: [...message.content, ...evidence],
		source
	};
}
function applyAnnotationEnrichment(messages, store) {
	return messages.map((message) => {
		const batch = store.takeForMessage(message.id);
		if (batch === void 0) return message;
		return enrichUserMessage(message, batch);
	});
}
async function buildStagedBatch(sessionId, attachments, ports) {
	if (ports.agentLive !== void 0 && !ports.agentLive(sessionId)) throw new Error("主会话 Agent is not live");
	if (attachments.length === 0) throw new Error("No 批注 to stage");
	const images = [];
	for (const item of attachments) {
		if (item.source !== "browser" || item.evidence === void 0) continue;
		if (ports.readEvidence === void 0 || ports.saveImage === void 0) continue;
		const jpeg = await ports.readEvidence(sessionId, item.evidence);
		const bytes = Buffer.from(jpeg.data, "base64");
		const attachment = await ports.saveImage({
			data: bytes,
			mediaType: "image/jpeg",
			name: "browser-" + item.evidence.id + ".jpg"
		});
		images.push({
			evidenceId: item.evidence.id,
			attachment
		});
	}
	if (images.length > 20) throw new Error("A prompt can contain at most 20 images");
	return {
		sessionId,
		attachments: attachments.map((item) => ({ ...item })),
		marks: attachments.map(toMarkView),
		images,
		evidenceText: formatEvidenceSend(attachments, snippetsFor(attachments, ports.readFile))
	};
}
function decodeAnnotationList(value) {
	if (!Array.isArray(value) || value.length === 0) return void 0;
	const out = [];
	for (const item of value) {
		const decoded = decodeAnnotation(item);
		if (decoded === void 0) return void 0;
		out.push(decoded);
	}
	return out;
}
function decodeAnnotation(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const rec = value;
	if (typeof rec.id !== "string" || rec.id.length === 0) return void 0;
	const evidence = decodeEvidence$1(rec.evidence);
	if (rec.evidence !== void 0 && evidence === void 0) return void 0;
	return hydrateAnnotation({
		id: rec.id,
		...typeof rec.text === "string" ? { text: rec.text } : {},
		...typeof rec.from === "string" ? { from: rec.from } : {},
		...rec.source === "files" || rec.source === "browser" || rec.source === "review" ? { source: rec.source } : {},
		...typeof rec.selector === "string" ? { selector: rec.selector } : {},
		...typeof rec.path === "string" ? { path: rec.path } : {},
		...typeof rec.line === "number" ? { line: rec.line } : {},
		...typeof rec.url === "string" ? { url: rec.url } : {},
		...evidence === void 0 ? {} : { evidence }
	});
}
function decodeEvidence$1(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const rec = value;
	if (typeof rec.id !== "string" || typeof rec.captureId !== "string" || typeof rec.documentId !== "string" || typeof rec.ref !== "string" || rec.mediaType !== "image/jpeg" || typeof rec.width !== "number" || typeof rec.height !== "number") return void 0;
	return {
		id: rec.id,
		captureId: rec.captureId,
		documentId: rec.documentId,
		ref: rec.ref,
		mediaType: "image/jpeg",
		width: rec.width,
		height: rec.height
	};
}
function installAnnotationSend(ctx, store) {
	const offInsert = ctx.on("agent/inbox/inserted", ((payload) => {
		store.bindInserted(String(payload.agent.id), payload.message);
	}));
	const offPre = ctx.on("agent/pre-step", (async (_payload, next) => {
		const decision = await next();
		if (decision.kind !== "enter" || !Array.isArray(decision.messages)) return decision;
		return {
			...decision,
			messages: applyAnnotationEnrichment(decision.messages, store)
		};
	}));
	return () => {
		offInsert();
		offPre();
	};
}
//#endregion
//#region lib/types/review.js
/** Review 工具: read-only 本轮变更 / working tree. Ticket 02 owns this file. */
/** Keep composer fields, skip git-backed files/scopes until Review is open. */
function rememberReview(state) {
	return {
		...hydrate(state),
		files: [],
		openDiff: null,
		scopes: emptyScopes(),
		branches: {
			current: "",
			names: []
		}
	};
}
function emptyReview() {
	return {
		mode: "turn",
		scopes: emptyScopes(),
		branch: "",
		branches: {
			current: "",
			names: []
		},
		openPath: null,
		pendingMark: null,
		noteDraft: "",
		editingId: null,
		attachments: [],
		seq: 0,
		files: [],
		openDiff: null
	};
}
function projectReview(state, port) {
	const base = hydrate(state);
	const branches = port?.branches?.() ?? {
		current: "",
		names: []
	};
	const branch = base.branch.length > 0 && branches.names.includes(base.branch) ? base.branch : branches.current;
	const vsOther = branch.length > 0 && branch !== branches.current;
	const turn = port?.turnWrites() ?? [];
	const uncommitted = vsOther && port?.against ? port.against(branch) : port?.workingTree() ?? [];
	const staged = vsOther ? [] : port?.staged?.() ?? [];
	const unstaged = vsOther ? uncommitted : port?.unstaged?.() ?? [];
	const files = changesForMode(base.mode, {
		turn,
		uncommitted,
		staged,
		unstaged
	}).map(toFile);
	const openDiff = files.find((file) => file.path === base.openPath) ?? null;
	return {
		...base,
		files,
		openDiff,
		branch,
		branches,
		scopes: {
			turn: tally(turn),
			uncommitted: tally(uncommitted),
			staged: tally(staged),
			unstaged: tally(unstaged)
		}
	};
}
function changesForMode(mode, bags) {
	if (mode === "uncommitted" || mode === "tree") return bags.uncommitted;
	if (mode === "staged") return bags.staged;
	if (mode === "unstaged") return bags.unstaged;
	return bags.turn;
}
function tally(changes) {
	let added = 0;
	let removed = 0;
	for (const change of changes) {
		const diff = lineStats(change.before, change.after);
		added += diff.added;
		removed += diff.removed;
	}
	return {
		added,
		removed
	};
}
function emptyScopes() {
	const zero = {
		added: 0,
		removed: 0
	};
	return {
		turn: zero,
		uncommitted: zero,
		staged: zero,
		unstaged: zero
	};
}
function reduceReview(state, intent, port) {
	const current = hydrate(state);
	switch (intent.type) {
		case "review-switch": {
			const mode = intent.mode;
			if (mode !== "turn" && mode !== "tree" && mode !== "uncommitted" && mode !== "staged" && mode !== "unstaged") return {
				state: current,
				effects: []
			};
			return {
				state: {
					...current,
					mode: normalizeMode$1(mode),
					openPath: null,
					pendingMark: null,
					noteDraft: "",
					editingId: null
				},
				effects: []
			};
		}
		case "review-set-branch": {
			const branch = intent.branch;
			return {
				state: {
					...current,
					branch,
					openPath: null,
					pendingMark: null,
					noteDraft: "",
					editingId: null
				},
				effects: []
			};
		}
		case "review-toggle-file": {
			const path = intent.path;
			const openPath = current.openPath === path ? null : path;
			return {
				state: {
					...current,
					openPath,
					pendingMark: openPath === null ? null : current.pendingMark,
					noteDraft: openPath === null ? "" : current.noteDraft,
					editingId: openPath === null ? null : current.editingId
				},
				effects: []
			};
		}
		case "review-gutter": {
			const mark = intent.mark;
			return {
				state: {
					...current,
					pendingMark: mark,
					noteDraft: "",
					editingId: null
				},
				effects: []
			};
		}
		case "review-set-note-draft": {
			const text = intent.text;
			return {
				state: {
					...current,
					noteDraft: text
				},
				effects: []
			};
		}
		case "review-dismiss-note": return {
			state: {
				...current,
				pendingMark: null,
				noteDraft: "",
				editingId: null
			},
			effects: []
		};
		default: return;
	}
}
function normalizeMode$1(mode) {
	if (mode === "tree" || mode === "uncommitted") return "uncommitted";
	if (mode === "staged" || mode === "unstaged") return mode;
	return "turn";
}
function hydrate(state) {
	return {
		mode: normalizeMode$1(state.mode),
		scopes: state.scopes ?? emptyScopes(),
		branch: state.branch ?? "",
		branches: state.branches ?? {
			current: "",
			names: []
		},
		openPath: state.openPath ?? null,
		pendingMark: state.pendingMark ?? null,
		noteDraft: state.noteDraft ?? "",
		editingId: state.editingId ?? null,
		attachments: state.attachments ?? [],
		seq: state.seq ?? 0,
		files: state.files ?? [],
		openDiff: state.openDiff ?? null
	};
}
const MAX_DIFF_LINES$1 = 4e3;
const MAX_DIFF_CELLS$1 = 25e4;
const CONTEXT = 3;
function sharedEnds(oldLines, newLines) {
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
	let suffix = 0;
	while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix += 1;
	return {
		prefix,
		suffix
	};
}
function tooLarge(oldCount, newCount) {
	return oldCount > MAX_DIFF_LINES$1 || newCount > MAX_DIFF_LINES$1 || (oldCount + 1) * (newCount + 1) > MAX_DIFF_CELLS$1;
}
function countMarks(lines) {
	let added = 0;
	let removed = 0;
	for (const line of lines) {
		if (line.kind === "add") added += 1;
		if (line.kind === "del") removed += 1;
	}
	return {
		added,
		removed
	};
}
function shiftLineNos(lines, offset) {
	return lines.map((line) => ({
		...line,
		oldNo: line.oldNo === null ? null : line.oldNo + offset,
		newNo: line.newNo === null ? null : line.newNo + offset
	}));
}
/** Keep ctx only near an add/del so two distant edits do not paint the whole file. */
function compactHunk(lines, context) {
	const keep = new Array(lines.length).fill(false);
	for (let i = 0; i < lines.length; i += 1) {
		if (lines[i]?.kind === "ctx") continue;
		const from = Math.max(0, i - context);
		const to = Math.min(lines.length - 1, i + context);
		for (let j = from; j <= to; j += 1) keep[j] = true;
	}
	const out = [];
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (keep[i] === true && line !== void 0) out.push(line);
	}
	return out;
}
/** +/− for badges. Strip shared ends, then LCS only the unique middle. */
function lineStats(before, after) {
	const oldLines = splitLines$1(before);
	const newLines = splitLines$1(after);
	const { prefix, suffix } = sharedEnds(oldLines, newLines);
	const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
	const newMid = newLines.slice(prefix, newLines.length - suffix);
	if (oldMid.length === 0 && newMid.length === 0) return {
		added: 0,
		removed: 0
	};
	if (tooLarge(oldMid.length, newMid.length)) return {
		added: newMid.length,
		removed: oldMid.length
	};
	return countMarks(lineDiff(oldMid, newMid));
}
function fileDiff(before, after) {
	const oldLines = splitLines$1(before);
	const newLines = splitLines$1(after);
	const { prefix, suffix } = sharedEnds(oldLines, newLines);
	const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
	const newMid = newLines.slice(prefix, newLines.length - suffix);
	if (tooLarge(oldMid.length, newMid.length)) return {
		added: newMid.length,
		removed: oldMid.length,
		hunk: "@@ diff truncated: file too large @@",
		lines: []
	};
	const mid = shiftLineNos(lineDiff(oldMid, newMid), prefix);
	const stats = countMarks(mid);
	const preFrom = Math.max(0, prefix - CONTEXT);
	const lines = [];
	for (let i = preFrom; i < prefix; i += 1) lines.push({
		kind: "ctx",
		text: oldLines[i] ?? "",
		oldNo: i + 1,
		newNo: i + 1
	});
	lines.push(...compactHunk(mid, CONTEXT));
	const sufCount = Math.min(CONTEXT, suffix);
	const sufOld = oldLines.length - suffix;
	const sufNew = newLines.length - suffix;
	for (let i = 0; i < sufCount; i += 1) lines.push({
		kind: "ctx",
		text: oldLines[sufOld + i] ?? "",
		oldNo: sufOld + i + 1,
		newNo: sufNew + i + 1
	});
	return {
		...stats,
		hunk: hunkHeader(lines),
		lines
	};
}
function toFile(change) {
	const slash = change.path.lastIndexOf("/");
	const name = slash === -1 ? change.path : change.path.slice(slash + 1);
	const dir = slash === -1 ? "" : change.path.slice(0, slash);
	return {
		path: change.path,
		name,
		dir,
		...fileDiff(change.before, change.after)
	};
}
function splitLines$1(text) {
	if (text.length === 0) return [];
	const parts = text.split("\n");
	if (parts[parts.length - 1] === "") parts.pop();
	return parts;
}
function lineDiff(oldLines, newLines) {
	const n = oldLines.length;
	const m = newLines.length;
	const dp = [];
	for (let i = 0; i <= n; i += 1) {
		const row = [];
		for (let j = 0; j <= m; j += 1) row.push(0);
		dp.push(row);
	}
	for (let i = n - 1; i >= 0; i -= 1) {
		const row = dp[i];
		const next = dp[i + 1];
		if (row === void 0 || next === void 0) continue;
		for (let j = m - 1; j >= 0; j -= 1) if (oldLines[i] === newLines[j]) row[j] = (next[j + 1] ?? 0) + 1;
		else row[j] = Math.max(next[j] ?? 0, row[j + 1] ?? 0);
	}
	const lines = [];
	let i = 0;
	let j = 0;
	let oldNo = 1;
	let newNo = 1;
	while (i < n && j < m) {
		const a = oldLines[i];
		const b = newLines[j];
		if (a === void 0 || b === void 0) break;
		if (a === b) {
			lines.push({
				kind: "ctx",
				text: a,
				oldNo,
				newNo
			});
			i += 1;
			j += 1;
			oldNo += 1;
			newNo += 1;
			continue;
		}
		if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
			lines.push({
				kind: "del",
				text: a,
				oldNo,
				newNo: null
			});
			i += 1;
			oldNo += 1;
		} else {
			lines.push({
				kind: "add",
				text: b,
				oldNo: null,
				newNo
			});
			j += 1;
			newNo += 1;
		}
	}
	while (i < n) {
		const a = oldLines[i];
		if (a === void 0) break;
		lines.push({
			kind: "del",
			text: a,
			oldNo,
			newNo: null
		});
		i += 1;
		oldNo += 1;
	}
	while (j < m) {
		const b = newLines[j];
		if (b === void 0) break;
		lines.push({
			kind: "add",
			text: b,
			oldNo: null,
			newNo
		});
		j += 1;
		newNo += 1;
	}
	return lines;
}
function hunkHeader(lines) {
	if (lines.length === 0) return "@@ -0,0 +0,0 @@";
	const oldCount = lines.filter((line) => line.kind !== "add").length;
	const newCount = lines.filter((line) => line.kind !== "del").length;
	const firstOld = lines.find((line) => line.oldNo !== null)?.oldNo;
	const firstNew = lines.find((line) => line.newNo !== null)?.newNo;
	return `@@ -${oldCount === 0 ? 0 : firstOld ?? 0},${oldCount} +${newCount === 0 ? 0 : firstNew ?? 0},${newCount} @@`;
}
//#endregion
//#region lib/types/workspace-inspector.js
/** Async, bounded workspace projection for visible Files/Review tools. */
const CACHE_TTL_MS = 5e3;
const GIT_TIMEOUT_MS = 3e3;
const MAX_GIT_BUFFER = 4194304;
const MAX_PREVIEW_BYTES = 2097152;
const MAX_IMAGE_BYTES = 8388608;
const IMAGE_PATH = /\.(png|jpe?g|gif|webp|svg)$/i;
const MAX_DIFF_CELLS = 25e4;
const MAX_DIFF_LINES = 4e3;
const MAX_CACHE_ENTRIES = 100;
function createWorkspaceInspector(opts = {}) {
	const exec = opts.gitExec ?? defaultGitExec;
	const ttlMs = opts.ttlMs ?? CACHE_TTL_MS;
	const now = opts.now ?? Date.now;
	const gitCache = /* @__PURE__ */ new Map();
	const gitPending = /* @__PURE__ */ new Map();
	const refCache = /* @__PURE__ */ new Map();
	const refPending = /* @__PURE__ */ new Map();
	const detailCache = /* @__PURE__ */ new Map();
	const detailPending = /* @__PURE__ */ new Map();
	let execs = 0;
	async function run(args, cwd, signal) {
		execs += 1;
		return exec(args, cwd, signal);
	}
	async function git(cwd, signal) {
		if (cwd.length === 0) return emptyGit();
		const hit = gitCache.get(cwd);
		if (hit !== void 0 && now() - hit.at < ttlMs) return hit.value;
		const pending = gitPending.get(cwd);
		if (pending !== void 0) return pending;
		const created = loadGit(cwd, run, signal).then((value) => {
			putBounded(gitCache, cwd, {
				at: now(),
				value
			});
			return value;
		}).finally(() => {
			gitPending.delete(cwd);
		});
		gitPending.set(cwd, created);
		return created;
	}
	async function against(cwd, ref, signal) {
		const key = cwd + "\0" + ref;
		const hit = refCache.get(key);
		if (hit !== void 0 && now() - hit.at < ttlMs) return hit.value;
		const pending = refPending.get(key);
		if (pending !== void 0) return pending;
		const created = safeRun(run, [
			"diff",
			"--numstat",
			ref
		], cwd, signal).then(parseNumstat).then((value) => {
			putBounded(refCache, key, {
				at: now(),
				value
			});
			return value;
		}).finally(() => {
			refPending.delete(key);
		});
		refPending.set(key, created);
		return created;
	}
	async function detail(cwd, mode, branch, current, path, untracked, signal) {
		const key = [
			cwd,
			mode,
			branch,
			current,
			path
		].join("\0");
		const hit = detailCache.get(key);
		if (hit !== void 0 && now() - hit.at < ttlMs) return hit.value;
		const pending = detailPending.get(key);
		if (pending !== void 0) return pending;
		const created = loadDetail(cwd, mode, branch, current, path, untracked, run, signal).then((value) => {
			putBounded(detailCache, key, {
				at: now(),
				value
			});
			return value;
		}).finally(() => {
			detailPending.delete(key);
		});
		detailPending.set(key, created);
		return created;
	}
	async function tree(cwd, signal) {
		if (cwd.length === 0) return [];
		signal?.throwIfAborted();
		return collectTreeAsync(cwd, signal);
	}
	return {
		execCount: () => execs,
		clear() {
			gitCache.clear();
			gitPending.clear();
			refCache.clear();
			refPending.clear();
			detailCache.clear();
			detailPending.clear();
			execs = 0;
		},
		invalidate(cwd) {
			if (cwd === void 0 || cwd.length === 0) {
				gitCache.clear();
				gitPending.clear();
				refCache.clear();
				refPending.clear();
				detailCache.clear();
				detailPending.clear();
				return;
			}
			gitCache.delete(cwd);
			gitPending.delete(cwd);
			const prefix = cwd + "\0";
			for (const key of [...refCache.keys()]) if (key.startsWith(prefix)) refCache.delete(key);
			for (const key of [...refPending.keys()]) if (key.startsWith(prefix)) refPending.delete(key);
			for (const key of [...detailCache.keys()]) if (key.startsWith(prefix)) detailCache.delete(key);
			for (const key of [...detailPending.keys()]) if (key.startsWith(prefix)) detailPending.delete(key);
		},
		async project(snapshot, gate, signal) {
			if (snapshot.collapsed) return snapshot;
			const active = snapshot.tabs.find((tab) => tab.id === snapshot.active);
			if (active?.kind === "Review") {
				const repo = await git(gate.cwd, signal);
				const review = await projectReviewAsync(snapshot.review, gate.turnWrites ?? [], repo, gate.cwd, against, detail, signal);
				return {
					...snapshot,
					review
				};
			}
			if (active?.kind === "Files") {
				const nodes = await tree(gate.cwd, signal);
				const path = snapshot.files.path || nodes.find((node) => node.kind !== "dir")?.path || "";
				if (path.length > 0 && !nodes.some((node) => node.path === path)) nodes.push({
					path,
					name: path.split("/").pop() || path
				});
				const image = IMAGE_PATH.test(path);
				const preview = image ? void 0 : await readPreview(gate.cwd, path, signal);
				const hunk = image ? void 0 : snapshot.files.hunk ?? (path.length === 0 ? void 0 : await readChange(gate.cwd, path, preview, run, signal));
				const diff = hunk === void 0 || hunk.before === hunk.after ? null : boundedFileDiff(hunk.before, hunk.after);
				const tabs = path.length === 0 || path === snapshot.files.path ? snapshot.tabs : snapshot.tabs.map((tab) => tab.id === snapshot.active && tab.kind === "Files" ? {
					...tab,
					target: path,
					title: path.split("/").pop() || "Files"
				} : tab);
				return {
					...snapshot,
					tabs,
					files: {
						...snapshot.files,
						path,
						tree: nodes,
						preview,
						hunk: hunk ?? null,
						diff,
						view: diff === null ? "preview" : snapshot.files.view
					},
					fileStats: {}
				};
			}
			return snapshot;
		}
	};
}
async function loadGit(cwd, run, signal) {
	const [statusText, branchesText, uncommittedText, stagedText, unstagedText] = await Promise.all([
		safeRun(run, [
			"status",
			"--porcelain=v2",
			"--branch",
			"-z"
		], cwd, signal),
		safeRun(run, ["branch", "--format=%(refname:short)	%(HEAD)"], cwd, signal),
		safeRun(run, [
			"diff",
			"--numstat",
			"HEAD"
		], cwd, signal),
		safeRun(run, [
			"diff",
			"--cached",
			"--numstat"
		], cwd, signal),
		safeRun(run, ["diff", "--numstat"], cwd, signal)
	]);
	if (statusText.length === 0 && branchesText.length === 0) return emptyGit();
	const status = parseStatus(statusText);
	const uncommitted = parseNumstat(uncommittedText);
	const unstaged = parseNumstat(unstagedText);
	const fresh = await untrackedStats(cwd, status.untracked, signal);
	for (const path of status.untracked) {
		uncommitted[path] ??= fresh[path] ?? {
			added: 0,
			removed: 0
		};
		unstaged[path] ??= fresh[path] ?? {
			added: 0,
			removed: 0
		};
	}
	const branches = parseBranches(branchesText, status.branch);
	return {
		inside: true,
		branch: branches.current,
		branches: branches.names,
		untracked: status.untracked,
		uncommitted,
		staged: parseNumstat(stagedText),
		unstaged
	};
}
async function untrackedStats(cwd, paths, signal) {
	const out = {};
	const list = [...paths];
	let cursor = 0;
	const worker = async () => {
		while (cursor < list.length) {
			const path = list[cursor];
			cursor += 1;
			if (path === void 0) continue;
			const text = await readPreview(cwd, path, signal);
			if (text === void 0 || text.startsWith("data:") || text.startsWith("[File too large")) out[path] = {
				added: 0,
				removed: 0,
				binary: true
			};
			else out[path] = {
				added: lineCount(text),
				removed: 0
			};
		}
	};
	await Promise.all(Array.from({ length: Math.min(4, list.length) }, () => worker()));
	return out;
}
async function projectReviewAsync(state, turnWrites, repo, cwd, against, detail, signal) {
	const mode = normalizeMode(state.mode);
	const branch = state.branch.length > 0 && repo.branches.includes(state.branch) ? state.branch : repo.branch;
	const vsOther = branch.length > 0 && branch !== repo.branch;
	const other = vsOther ? await against(cwd, branch, signal) : void 0;
	const turnFiles = turnWrites.map(toReviewSummary);
	const files = filesForMode(mode, {
		turn: turnFiles,
		uncommitted: summaries(other ?? repo.uncommitted),
		staged: vsOther ? [] : summaries(repo.staged),
		unstaged: summaries(other ?? repo.unstaged)
	});
	let openDiff = null;
	if (state.openPath !== null) {
		const summary = files.find((file) => file.path === state.openPath);
		if (summary !== void 0) {
			if (mode === "turn") {
				const change = turnWrites.find((item) => item.path === state.openPath);
				if (change !== void 0) openDiff = {
					...summary,
					...boundedFileDiff(change.before, change.after)
				};
			} else {
				const loaded = await detail(cwd, mode, branch, repo.branch, state.openPath, repo.untracked, signal);
				if (loaded !== null) openDiff = {
					...summary,
					...loaded
				};
			}
		}
	}
	return {
		...state,
		mode,
		branch,
		branches: {
			current: repo.branch,
			names: repo.branches
		},
		files,
		openDiff,
		scopes: {
			turn: tallyFiles(turnFiles),
			uncommitted: tallyStats(other ?? repo.uncommitted),
			staged: vsOther ? {
				added: 0,
				removed: 0
			} : tallyStats(repo.staged),
			unstaged: tallyStats(other ?? repo.unstaged)
		}
	};
}
function filesForMode(mode, bags) {
	if (mode === "uncommitted") return bags.uncommitted;
	if (mode === "staged") return bags.staged;
	if (mode === "unstaged") return bags.unstaged;
	return bags.turn;
}
function normalizeMode(mode) {
	return mode === "tree" ? "uncommitted" : mode;
}
function toReviewSummary(change) {
	const slash = change.path.lastIndexOf("/");
	const stats = fastLineStats(change.before, change.after);
	return {
		path: change.path,
		name: slash === -1 ? change.path : change.path.slice(slash + 1),
		dir: slash === -1 ? "" : change.path.slice(0, slash),
		added: stats.added,
		removed: stats.removed,
		hunk: "",
		lines: []
	};
}
function summaries(stats) {
	return Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)).map(([path, value]) => {
		const slash = path.lastIndexOf("/");
		return {
			path,
			name: slash === -1 ? path : path.slice(slash + 1),
			dir: slash === -1 ? "" : path.slice(0, slash),
			added: value.added,
			removed: value.removed,
			hunk: "",
			lines: []
		};
	});
}
function tallyFiles(files) {
	return files.reduce((out, file) => ({
		added: out.added + file.added,
		removed: out.removed + file.removed
	}), {
		added: 0,
		removed: 0
	});
}
function tallyStats(stats) {
	return Object.values(stats).reduce((out, value) => ({
		added: out.added + value.added,
		removed: out.removed + value.removed
	}), {
		added: 0,
		removed: 0
	});
}
async function loadDetail(cwd, mode, branch, current, path, untracked, run, signal) {
	if (untracked.has(path) && mode !== "staged") {
		const text = await readPreview(cwd, path, signal);
		if (text === void 0 || text.startsWith("data:")) return null;
		return boundedFileDiff("", text);
	}
	const args = [
		"diff",
		"--no-ext-diff",
		"--no-color",
		"--unified=3"
	];
	if (mode === "staged") args.push("--cached");
	if (branch.length > 0 && branch !== current) args.push(branch);
	else if (mode === "uncommitted") args.push("HEAD");
	args.push("--", path);
	return parsePatch(await safeRun(run, args, cwd, signal));
}
function parsePatch(patch) {
	const lines = [];
	let hunk = "";
	let oldNo = 0;
	let newNo = 0;
	for (const raw of patch.split("\n")) {
		const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (match !== null) {
			if (hunk.length === 0) hunk = raw;
			oldNo = Number(match[1]);
			newNo = Number(match[2]);
			continue;
		}
		if (hunk.length === 0 || raw.startsWith(" No newline")) continue;
		if (raw.startsWith("+") && !raw.startsWith("+++")) {
			lines.push({
				kind: "add",
				text: raw.slice(1),
				oldNo: null,
				newNo
			});
			newNo += 1;
		} else if (raw.startsWith("-") && !raw.startsWith("---")) {
			lines.push({
				kind: "del",
				text: raw.slice(1),
				oldNo,
				newNo: null
			});
			oldNo += 1;
		} else if (raw.startsWith(" ")) {
			lines.push({
				kind: "ctx",
				text: raw.slice(1),
				oldNo,
				newNo
			});
			oldNo += 1;
			newNo += 1;
		}
	}
	if (hunk.length === 0) return null;
	return {
		added: lines.filter((line) => line.kind === "add").length,
		removed: lines.filter((line) => line.kind === "del").length,
		hunk,
		lines
	};
}
function boundedFileDiff(before, after) {
	const oldLines = splitLines(before);
	const newLines = splitLines(after);
	if (oldLines.length <= MAX_DIFF_LINES && newLines.length <= MAX_DIFF_LINES && (oldLines.length + 1) * (newLines.length + 1) <= MAX_DIFF_CELLS) return fileDiff(before, after);
	const lines = [];
	const limit = 2e3;
	for (let index = 0; index < Math.min(oldLines.length, limit); index += 1) lines.push({
		kind: "del",
		text: oldLines[index] ?? "",
		oldNo: index + 1,
		newNo: null
	});
	for (let index = 0; index < Math.min(newLines.length, limit); index += 1) lines.push({
		kind: "add",
		text: newLines[index] ?? "",
		oldNo: null,
		newNo: index + 1
	});
	return {
		added: newLines.length,
		removed: oldLines.length,
		hunk: "@@ diff truncated: file too large @@",
		lines
	};
}
async function readChange(cwd, path, after, run, signal) {
	if (path.length === 0 || after?.startsWith("data:") || after?.startsWith("[File too large")) return void 0;
	const before = await safeRun(run, ["show", "HEAD:" + path], cwd, signal);
	const next = after ?? "";
	if (before === next || before.length === 0 && next.length === 0) return void 0;
	return {
		before,
		after: next
	};
}
async function readPreview(cwd, path, signal) {
	if (path.length === 0 || cwd.length === 0 && !isAbsolute(path)) return void 0;
	const full = safePath(cwd, path);
	if (full === void 0) return void 0;
	try {
		signal?.throwIfAborted();
		const info = await stat(full);
		if (!info.isFile()) return void 0;
		const image = IMAGE_PATH.test(path);
		const limit = image ? MAX_IMAGE_BYTES : MAX_PREVIEW_BYTES;
		if (info.size > limit) return "[File too large to preview: " + info.size + " bytes]";
		const handle = await open(full, "r");
		try {
			const buffer = Buffer.alloc(Number(info.size));
			await handle.read(buffer, 0, buffer.length, 0);
			signal?.throwIfAborted();
			if (image) return "data:" + imageMime(path) + ";base64," + buffer.toString("base64");
			return buffer.toString("utf8");
		} finally {
			await handle.close();
		}
	} catch {
		return;
	}
}
function safePath(cwd, path) {
	const root = resolve(cwd);
	const full = resolve(isAbsolute(path) ? path : join(root, path));
	return isAbsolute(path) || full === root || full.startsWith(root + sep) ? full : void 0;
}
function parseStatus(raw) {
	let branch = "";
	const untracked = /* @__PURE__ */ new Set();
	for (const rec of raw.split("\0")) if (rec.startsWith("# branch.head ")) {
		const name = rec.slice(14).trim();
		if (name !== "(detached)") branch = name;
	} else if (rec.startsWith("? ")) untracked.add(rec.slice(2));
	return {
		branch,
		untracked
	};
}
function parseBranches(raw, fallback) {
	let current = fallback;
	const names = [];
	for (const line of raw.split("\n")) {
		if (line.length === 0) continue;
		const [name = "", head = ""] = line.split("	");
		if (name.length === 0) continue;
		names.push(name);
		if (head === "*") current = name;
	}
	return {
		current,
		names
	};
}
function parseNumstat(raw) {
	const out = {};
	for (const line of raw.split("\n")) {
		const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
		if (match === null) continue;
		const path = numstatPath(match[3] ?? "");
		if (path.length === 0) continue;
		out[path] = {
			added: match[1] === "-" ? 0 : Number(match[1]),
			removed: match[2] === "-" ? 0 : Number(match[2]),
			...match[1] === "-" || match[2] === "-" ? { binary: true } : {}
		};
	}
	return out;
}
function numstatPath(raw) {
	return (raw.includes(" => ") ? raw.slice(raw.lastIndexOf(" => ") + 4) : raw).replace(/^"(.*)"$/, "$1");
}
function emptyGit() {
	return {
		inside: false,
		branch: "",
		branches: [],
		untracked: /* @__PURE__ */ new Set(),
		uncommitted: {},
		staged: {},
		unstaged: {}
	};
}
async function safeRun(run, args, cwd, signal) {
	try {
		return await run(args, cwd, signal);
	} catch {
		return "";
	}
}
function defaultGitExec(args, cwd, signal) {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile("git", [...args], {
			cwd,
			encoding: "utf8",
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: MAX_GIT_BUFFER,
			signal
		}, (error, stdout) => {
			if (error !== null) rejectPromise(error);
			else resolvePromise(stdout);
		});
	});
}
function splitLines(text) {
	if (text.length === 0) return [];
	const lines = text.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}
function lineCount(text) {
	return splitLines(text).length;
}
function fastLineStats(before, after) {
	const oldLines = splitLines(before);
	const newLines = splitLines(after);
	let prefix = 0;
	while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
	let suffix = 0;
	while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix += 1;
	return {
		added: newLines.length - prefix - suffix,
		removed: oldLines.length - prefix - suffix
	};
}
function imageMime(path) {
	const lower = path.toLowerCase();
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	return "image/jpeg";
}
function putBounded(map, key, value) {
	map.delete(key);
	map.set(key, value);
	if (map.size <= MAX_CACHE_ENTRIES) return;
	const oldest = map.keys().next().value;
	if (oldest !== void 0) map.delete(oldest);
}
//#endregion
//#region lib/types/host-rpc.js
/** Decode sidebar RPC and run it against the per-主会话 registry. */
const SNAP_TTL_MS = 200;
const snapCache = /* @__PURE__ */ new Map();
const snapPending = /* @__PURE__ */ new Map();
const snapEpoch = /* @__PURE__ */ new Map();
async function handleSidebarRpcAsync(registry, endpoint, payload, services = {}) {
	try {
		if (endpoint === "sidebar/browser-stream-ticket" && services.managedBrowser !== void 0) {
			if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.tabId !== "string") return fail("invalid sidebar browser-stream-ticket request");
			if (services.browserStream === void 0) return fail("managed browser stream is unavailable");
			const snapshot = registry.forSession(payload.sessionId, {
				cwd: typeof payload.cwd === "string" ? payload.cwd : "",
				busy: payload.busy === true
			}).snapshot(false);
			const tab = snapshot.tabs.find((item) => item.id === payload.tabId && item.kind === "Browser");
			const url = snapshot.browsers[payload.tabId]?.url || tab?.target;
			if (tab === void 0 || url === void 0 || url.length === 0) return fail("unknown Browser Tab");
			const tabKey = {
				sessionId: payload.sessionId,
				tabId: payload.tabId
			};
			const projection = await services.managedBrowser.ensure(tabKey, url);
			if (projection.status !== "ready") return fail(projection.error ?? "Browser page is not ready");
			const viewport = browserDeviceViewport(snapshot.browsers[payload.tabId]?.device ?? "fit");
			if (viewport !== null) await services.managedBrowser.resize(tabKey, viewport.width, viewport.height);
			return {
				ok: true,
				value: services.browserStream.issue(tabKey)
			};
		}
		if (endpoint === "sidebar/browser-capture") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.tabId !== "string") return fail("invalid sidebar browser-capture request");
			if (services.browserEvidence === void 0) return fail("Browser evidence capture is unavailable");
			if (registry.forSession(payload.sessionId, {
				cwd: typeof payload.cwd === "string" ? payload.cwd : "",
				busy: payload.busy === true
			}).snapshot(false).tabs.find((item) => item.id === payload.tabId && item.kind === "Browser") === void 0) return fail("unknown Browser Tab");
			return {
				ok: true,
				value: await services.browserEvidence.capture({
					sessionId: payload.sessionId,
					tabId: payload.tabId
				})
			};
		}
		if (endpoint === "sidebar/browser-evidence-commit") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.captureId !== "string") return fail("invalid sidebar browser-evidence-commit request");
			if (services.browserEvidence === void 0) return fail("Browser evidence commit is unavailable");
			return {
				ok: true,
				value: await services.browserEvidence.commit(payload.sessionId, payload.captureId)
			};
		}
		if (endpoint === "sidebar/browser-evidence-read") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string") return fail("invalid sidebar browser-evidence-read request");
			const evidence = decodeEvidence(payload.evidence);
			if (evidence === void 0) return fail("invalid Browser evidence descriptor");
			if (services.browserEvidence === void 0) return fail("Browser evidence read is unavailable");
			return {
				ok: true,
				value: await services.browserEvidence.read(payload.sessionId, evidence)
			};
		}
		if (endpoint === "sidebar/stage-annotations") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string") return fail("invalid sidebar stage-annotations request");
			const attachments = decodeAnnotationList(payload.attachments);
			if (attachments === void 0) return fail("invalid 批注 list");
			if (services.annotationSend === void 0) return fail("annotation send is unavailable");
			const ports = services.annotationPortsFor?.(payload.sessionId) ?? {};
			if (attachments.length === 0) {
				services.annotationSend.replacePending(payload.sessionId, null);
				return {
					ok: true,
					value: { staged: true }
				};
			}
			const batch = await buildStagedBatch(payload.sessionId, attachments, ports);
			services.annotationSend.replacePending(payload.sessionId, batch);
			return {
				ok: true,
				value: { staged: true }
			};
		}
		if (endpoint === "sidebar/unstage-annotations") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string") return fail("invalid sidebar unstage-annotations request");
			services.annotationSend?.unstage(payload.sessionId);
			return {
				ok: true,
				value: { unstaged: true }
			};
		}
		if (endpoint === "sidebar/file-read") {
			if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.path !== "string") return fail("invalid sidebar file-read request");
			return {
				ok: true,
				value: { preview: await readPreview(typeof payload.cwd === "string" ? payload.cwd : "", payload.path) }
			};
		}
		if (endpoint === "sidebar/snapshot" || endpoint === "sidebar/dispatch") synchronizeManagedState(registry, payload, services);
		if (services.workspace !== void 0) {
			const projected = await handleWorkspaceRpc(registry, endpoint, payload, services.workspace);
			if (projected !== void 0) return projected;
		}
		return handleSidebarRpc(registry, endpoint, payload, services);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}
}
function handleSidebarRpc(registry, endpoint, payload, services = {}) {
	if (endpoint === "sidebar/browser-stream-ticket") {
		if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.tabId !== "string") return fail("invalid sidebar browser-stream-ticket request");
		if (services.browserStream === void 0) return fail("managed browser stream is unavailable");
		if (registry.forSession(payload.sessionId, {
			cwd: typeof payload.cwd === "string" ? payload.cwd : "",
			busy: payload.busy === true
		}).snapshot(false).tabs.find((item) => item.id === payload.tabId && item.kind === "Browser") === void 0) return fail("unknown Browser Tab");
		return {
			ok: true,
			value: services.browserStream.issue({
				sessionId: payload.sessionId,
				tabId: payload.tabId
			})
		};
	}
	if (endpoint === "sidebar/terminal-pull") {
		if (!isRecord(payload) || typeof payload.sessionId !== "string" || typeof payload.tabId !== "string") return fail("invalid sidebar terminal-pull request");
		const since = typeof payload.since === "number" ? payload.since : 0;
		return {
			ok: true,
			value: registry.forSession(payload.sessionId, {
				cwd: typeof payload.cwd === "string" ? payload.cwd : "",
				busy: payload.busy === true
			}).pullTerminal(payload.tabId, since)
		};
	}
	if (endpoint === "sidebar/snapshot") {
		const request = decodeSnapshotRequest(payload);
		if (request === void 0) return fail("invalid sidebar snapshot request");
		const box = registry.forSession(request.sessionId, request);
		return {
			ok: true,
			value: { snapshot: snapshotCached(request.sessionId, box.revision(), () => box.snapshot()) }
		};
	}
	if (endpoint === "sidebar/dispatch") {
		const request = decodeDispatchRequest(payload);
		if (request === void 0) return fail("invalid sidebar dispatch request");
		const box = registry.forSession(request.sessionId, request);
		const effects = box.dispatch(request.intent);
		invalidateSnapshot(request.sessionId);
		return {
			ok: true,
			value: {
				snapshot: box.snapshot(),
				effects
			}
		};
	}
	return fail(`unknown sidebar endpoint: ${endpoint}`);
}
async function handleWorkspaceRpc(registry, endpoint, payload, workspace) {
	if (endpoint === "sidebar/snapshot") {
		const request = decodeSnapshotRequest(payload);
		if (request === void 0) return fail("invalid sidebar snapshot request");
		const box = registry.forSession(request.sessionId, request);
		if (request.light === true) return {
			ok: true,
			value: { snapshot: box.snapshot(false) }
		};
		const base = box.snapshot(false);
		const revision = box.revision();
		const gateKey = projectionGateKey(request);
		return {
			ok: true,
			value: { snapshot: await snapshotCachedAsync(request.sessionId, revision, gateKey, () => projectOrBase(workspace, base, request), () => box.revision()) }
		};
	}
	if (endpoint === "sidebar/dispatch") {
		const request = decodeDispatchRequest(payload);
		if (request === void 0) return fail("invalid sidebar dispatch request");
		const box = registry.forSession(request.sessionId, request);
		const effects = box.dispatch(request.intent);
		invalidateSnapshot(request.sessionId);
		if (reviewWorkspaceIntent(request.intent)) workspace.invalidate(request.cwd);
		if (request.intent.type === "toggle-collapsed") return {
			ok: true,
			value: {
				snapshot: box.snapshot(false),
				effects
			}
		};
		return {
			ok: true,
			value: {
				snapshot: await projectOrBase(workspace, box.snapshot(false), request),
				effects
			}
		};
	}
}
async function projectOrBase(workspace, base, gate) {
	try {
		return await workspace.project(base, gate);
	} catch {
		return base;
	}
}
async function snapshotCachedAsync(sessionId, revision, gateKey, compute, currentRevision) {
	const hit = snapCache.get(sessionId);
	if (hit !== void 0 && hit.revision === revision && hit.gateKey === gateKey && Date.now() - hit.at < SNAP_TTL_MS) return hit.snapshot;
	const epoch = snapEpoch.get(sessionId) ?? 0;
	const pending = snapPending.get(sessionId);
	if (pending !== void 0 && pending.epoch === epoch && pending.revision === revision && pending.gateKey === gateKey) return pending.promise;
	let created;
	created = compute().then((snapshot) => {
		if ((snapEpoch.get(sessionId) ?? 0) === epoch && currentRevision() === revision) snapCache.set(sessionId, {
			at: Date.now(),
			revision,
			gateKey,
			snapshot
		});
		return snapshot;
	}).finally(() => {
		if (snapPending.get(sessionId)?.promise === created) snapPending.delete(sessionId);
	});
	snapPending.set(sessionId, {
		epoch,
		revision,
		gateKey,
		promise: created
	});
	return created;
}
function invalidateSnapshot(sessionId) {
	snapEpoch.set(sessionId, (snapEpoch.get(sessionId) ?? 0) + 1);
	snapCache.delete(sessionId);
	snapPending.delete(sessionId);
}
function synchronizeManagedState(registry, payload, services) {
	if (services.managedBrowser === void 0 || !isRecord(payload) || typeof payload.sessionId !== "string") return;
	const box = registry.forSession(payload.sessionId, {
		cwd: typeof payload.cwd === "string" ? payload.cwd : "",
		busy: payload.busy === true
	});
	let changed = false;
	for (const projection of services.managedBrowser.list()) {
		if (projection.sessionId !== payload.sessionId) continue;
		const current = box.snapshot(false).browsers[projection.tabId];
		if (current === void 0 || current.url === projection.url && current.documentId === projection.documentId && current.runtimeStatus === projection.status && current.runtimeError === (projection.error ?? null)) continue;
		box.dispatch({
			type: "browser-runtime-sync",
			tabId: projection.tabId,
			url: projection.url,
			title: projection.title,
			documentId: projection.documentId,
			status: projection.status,
			...projection.error === void 0 ? {} : { error: projection.error }
		});
		changed = true;
	}
	if (changed) invalidateSnapshot(payload.sessionId);
}
function decodeEvidence(value) {
	if (!isRecord(value)) return void 0;
	if (typeof value.id !== "string" || typeof value.captureId !== "string" || typeof value.documentId !== "string" || typeof value.ref !== "string" || value.mediaType !== "image/jpeg" || typeof value.width !== "number" || typeof value.height !== "number") return void 0;
	return {
		id: value.id,
		captureId: value.captureId,
		documentId: value.documentId,
		ref: value.ref,
		mediaType: value.mediaType,
		width: value.width,
		height: value.height
	};
}
function snapshotCached(sessionId, revision, compute) {
	const hit = snapCache.get(sessionId);
	const now = Date.now();
	if (hit !== void 0 && hit.gateKey === "" && hit.revision === revision && now - hit.at < SNAP_TTL_MS) return hit.snapshot;
	const snapshot = compute();
	snapCache.set(sessionId, {
		at: Date.now(),
		revision,
		gateKey: "",
		snapshot
	});
	return snapshot;
}
function projectionGateKey(request) {
	let hash = 2166136261;
	const add = (value) => {
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
	};
	add(request.cwd);
	add(request.busy ? "1" : "0");
	for (const write of request.turnWrites) {
		add(write.path);
		add(write.before);
		add(write.after);
	}
	return String(hash >>> 0);
}
function reviewWorkspaceIntent(intent) {
	return intent.type === "review-set-branch" || intent.type === "select-tab" || intent.type === "pick-tool" && intent.kind === "Review";
}
function fail(message) {
	return {
		ok: false,
		error: { message }
	};
}
//#endregion
//#region lib/types/host-side-chat.js
/** Host SideChatPort: live cwd read/search; log / 列出 / 投递 from the RPC gate. */
function createHostSideChat(opts) {
	return {
		attachedId: opts.sessionId,
		log(sessionId) {
			return opts.io.log(sessionId);
		},
		roster() {
			return opts.io.roster();
		},
		read(path) {
			return opts.files.read(path);
		},
		search(query) {
			const needle = query.trim().toLowerCase();
			if (needle.length === 0) return [];
			const hits = [];
			for (const node of opts.files.tree()) {
				const text = opts.files.read(node.path);
				if (text === void 0 || text.startsWith("data:")) continue;
				if (text.toLowerCase().includes(needle)) hits.push({
					path: node.path,
					text
				});
			}
			return hits;
		},
		deliver(payload) {
			const entry = opts.io.roster().find((row) => row.id === payload.to);
			if (entry === void 0) return {
				ok: false,
				error: "unknown"
			};
			if (entry.archived) return {
				ok: false,
				error: "archived"
			};
			if (entry.kind !== "main") return {
				ok: false,
				error: "rejected"
			};
			return {
				ok: true,
				queued: entry.busy
			};
		}
	};
}
//#endregion
//#region lib/types/terminal.js
/** Terminal 工具 slice: the human's pty, not the 舵主's command tool. */
/** Last N bytes kept in the live pty ring. TUI redraw storms must not freeze the host. */
const TERMINAL_OUTPUT_CAP = 256e3;
function clipTerminalOutput(output) {
	if (output.length <= 256e3) return output;
	return output.slice(output.length - TERMINAL_OUTPUT_CAP);
}
function emptyTerminal() {
	return { byTab: {} };
}
function projectTerminal(state) {
	const byTab = {};
	for (const [tabId, rec] of Object.entries(state.byTab ?? {})) byTab[tabId] = {
		cwd: rec.cwd,
		token: rec.token ?? tabId,
		output: rec.output ?? "",
		seq: rec.seq ?? 0,
		chunk: rec.chunk ?? ""
	};
	return { byTab };
}
function reduceTerminal(state, intent, port) {
	const typed = asTerminal(intent);
	if (typed === void 0) return void 0;
	const byTab = { ...state.byTab };
	switch (typed.type) {
		case "terminal-open": {
			const cwd = port === void 0 ? "" : port.cwd();
			const held = byTab[typed.tabId]?.token;
			const size = typed.cols !== void 0 && typed.rows !== void 0 ? {
				cols: typed.cols,
				rows: typed.rows
			} : void 0;
			const token = port === void 0 ? held ?? typed.tabId : port.create(typed.tabId, cwd, held, size);
			byTab[typed.tabId] = sync(typed.tabId, {
				cwd,
				token,
				output: "",
				seq: 0,
				chunk: ""
			}, port, 0);
			return {
				state: { byTab },
				effects: []
			};
		}
		case "terminal-write":
			if (byTab[typed.tabId] === void 0) return {
				state: { byTab },
				effects: []
			};
			port?.write(typed.tabId, typed.bytes);
			byTab[typed.tabId] = sync(typed.tabId, byTab[typed.tabId], port, void 0);
			return {
				state: { byTab },
				effects: []
			};
		case "terminal-refresh":
			if (byTab[typed.tabId] === void 0) return {
				state: { byTab },
				effects: []
			};
			byTab[typed.tabId] = sync(typed.tabId, byTab[typed.tabId], port, typed.since);
			return {
				state: { byTab },
				effects: []
			};
		case "terminal-resize":
			if (byTab[typed.tabId] === void 0) return {
				state: { byTab },
				effects: []
			};
			port?.resize?.(typed.tabId, typed.cols, typed.rows);
			return {
				state: { byTab },
				effects: []
			};
		case "terminal-destroy":
			if (byTab[typed.tabId] === void 0) return {
				state: { byTab },
				effects: []
			};
			port?.destroy(typed.tabId);
			delete byTab[typed.tabId];
			return {
				state: { byTab },
				effects: []
			};
	}
}
function sync(tabId, rec, port, since) {
	const base = {
		cwd: rec?.cwd ?? "",
		token: rec?.token ?? tabId,
		output: rec?.output ?? "",
		seq: rec?.seq ?? 0,
		chunk: rec?.chunk ?? ""
	};
	if (port === void 0) return base;
	if (port.pull !== void 0 && since !== void 0) {
		const pulled = port.pull(tabId, since);
		return {
			...base,
			seq: pulled.seq,
			chunk: pulled.chunk,
			output: ""
		};
	}
	const output = clipTerminalOutput(port.read(tabId));
	return {
		...base,
		output,
		seq: output.length,
		chunk: ""
	};
}
function asTerminal(intent) {
	if (intent.type !== "terminal-open" && intent.type !== "terminal-write" && intent.type !== "terminal-refresh" && intent.type !== "terminal-resize" && intent.type !== "terminal-destroy") return;
	return intent;
}
//#endregion
//#region lib/types/host-terminal.js
/** Host TerminalPort: one real pty per Tab, cwd is the 主会话 workspace. Reconnect by token. */
const require = createRequire(import.meta.url);
function createHostTerminal(cwdOf) {
	const byToken = /* @__PURE__ */ new Map();
	const tokenOf = /* @__PURE__ */ new Map();
	return {
		cwd: cwdOf,
		create(tabId, cwd, token, size) {
			const held = token !== void 0 ? byToken.get(token) : void 0;
			if (held !== void 0) {
				tokenOf.set(tabId, held.token);
				if (size !== void 0) held.child.resize(size.cols, size.rows);
				return held.token;
			}
			const current = tokenOf.get(tabId);
			if (current !== void 0 && byToken.has(current)) return current;
			const child = openHandle(cwd, size);
			const next = {
				child,
				buf: "",
				seq: 0,
				start: 0,
				token: "pty-" + (child.pid || tabId)
			};
			child.onData((data) => {
				append(next, data);
			});
			child.onExit(() => {
				byToken.delete(next.token);
				for (const [id, tok] of tokenOf) if (tok === next.token) tokenOf.delete(id);
			});
			byToken.set(next.token, next);
			tokenOf.set(tabId, next.token);
			return next.token;
		},
		write(tabId, bytes) {
			live(tabId)?.child.write(bytes);
		},
		resize(tabId, cols, rows) {
			if (cols < 2 || rows < 1) return;
			live(tabId)?.child.resize(cols, rows);
		},
		destroy(tabId) {
			const rec = live(tabId);
			if (rec === void 0) return;
			rec.child.kill();
			byToken.delete(rec.token);
			tokenOf.delete(tabId);
		},
		read(tabId) {
			return live(tabId)?.buf ?? "";
		},
		pull(tabId, since) {
			return pullFrom(live(tabId), since);
		}
	};
	function live(tabId) {
		const token = tokenOf.get(tabId);
		return token === void 0 ? void 0 : byToken.get(token);
	}
}
function append(rec, chunk) {
	rec.buf = clipTerminalOutput(rec.buf + chunk);
	rec.seq += chunk.length;
	rec.start = rec.seq - rec.buf.length;
}
function pullFrom(rec, since) {
	if (rec === void 0) return {
		seq: 0,
		chunk: ""
	};
	if (since < rec.start) return {
		seq: rec.seq,
		chunk: rec.buf
	};
	return {
		seq: rec.seq,
		chunk: rec.buf.slice(since - rec.start)
	};
}
function openHandle(cwd, size) {
	try {
		return openNodePty(cwd, size);
	} catch {
		return openScriptPty(cwd);
	}
}
function openNodePty(cwd, size) {
	const pty = require("node-pty");
	const shell = process.env["SHELL"] ?? "/bin/sh";
	const child = pty.spawn(shell, ["-i"], {
		name: "xterm-256color",
		cols: size?.cols ?? 80,
		rows: size?.rows ?? 24,
		cwd,
		env: {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor"
		}
	});
	return {
		pid: child.pid,
		write(data) {
			child.write(data);
		},
		resize(cols, rows) {
			child.resize(cols, rows);
		},
		kill() {
			child.kill();
		},
		onData(cb) {
			child.onData(cb);
		},
		onExit(cb) {
			child.onExit(() => {
				cb();
			});
		}
	};
}
function openScriptPty(cwd) {
	const shell = process.env["SHELL"] ?? "/bin/sh";
	const quoted = shell + " -i";
	const child = existsSync("/usr/bin/script") ? spawn("script", [
		"-qefc",
		quoted,
		"/dev/null"
	], {
		cwd,
		env: {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor"
		},
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	}) : spawn(shell, ["-i"], {
		cwd,
		env: {
			...process.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor"
		},
		stdio: [
			"pipe",
			"pipe",
			"pipe"
		]
	});
	return {
		pid: child.pid ?? 0,
		write(data) {
			child.stdin.write(data);
		},
		resize() {},
		kill() {
			child.kill();
		},
		onData(cb) {
			child.stdout.on("data", (buf) => {
				cb(buf.toString());
			});
			child.stderr.on("data", (buf) => {
				cb(buf.toString());
			});
		},
		onExit(cb) {
			child.on("exit", cb);
		}
	};
}
//#endregion
//#region lib/types/side-chat.js
/** Side Chat 工具: frozen Fork, 列出 / 察看 / 投递, read-only workspace. */
const SIDE_TYPES = /* @__PURE__ */ new Set([
	"side-send",
	"side-list",
	"side-inspect",
	"side-deliver",
	"side-read",
	"side-search",
	"side-write",
	"side-pty",
	"side-spawn",
	"side-draft",
	"side-bind-fork",
	"side-reply"
]);
function emptySideChat() {
	return { byTab: {} };
}
function emptySideTab() {
	return {
		forked: false,
		forkSeq: null,
		forkSessionId: null,
		fork: [],
		messages: [],
		listed: null,
		card: null,
		error: null,
		draft: ""
	};
}
function projectSideChat(state, _port) {
	return cloneState(normalize(state));
}
function reduceSideChat(state, intent, port) {
	if (!SIDE_TYPES.has(intent.type)) return void 0;
	const current = normalize(state);
	if (intent.type === "side-deliver") return deliver(current, intent, port);
	if (intent.type === "side-send") return send(current, intent, port);
	return {
		state: reduceKnown(current, intent, port),
		effects: []
	};
}
function reduceKnown(state, intent, port) {
	switch (intent.type) {
		case "side-draft": return patchTab(state, intent.tabId, (tab) => ({
			...tab,
			draft: intent.text
		}));
		case "side-send": return send(state, intent, port).state;
		case "side-bind-fork": return patchTab(state, intent.tabId, (tab) => ({
			...tab,
			forkSessionId: intent.sessionId,
			error: null
		}));
		case "side-reply": return reply(state, intent);
		case "side-list": return listSessions(state, intent, port);
		case "side-inspect": return inspect(state, intent, port);
		case "side-deliver": return deliver(state, intent, port).state;
		case "side-read": return readFile$1(state, intent, port);
		case "side-search": return searchFiles(state, intent, port);
		case "side-write": return patchTab(state, intent.tabId, (tab) => ({
			...tab,
			error: "Side Chat cannot write"
		}));
		case "side-pty": return patchTab(state, intent.tabId, (tab) => ({
			...tab,
			error: "Side Chat cannot run Terminal"
		}));
		case "side-spawn": return patchTab(state, intent.tabId, (tab) => ({
			...tab,
			error: "Side Chat cannot spawn"
		}));
	}
}
const PENDING_REPLY = "正在回答…";
function send(state, intent, port) {
	const text = intent.text.trim();
	if (text.length === 0) return {
		state,
		effects: []
	};
	const next = patchTab(state, intent.tabId, (tab) => {
		const first = !tab.forked;
		const fork = first ? cutFork(port?.log(port.attachedId) ?? []) : tab.fork;
		const forkSeq = first ? lastSeq(fork) : tab.forkSeq;
		return {
			...tab,
			forked: true,
			fork,
			forkSeq,
			draft: "",
			error: null,
			messages: [
				...tab.messages,
				{
					kind: "user",
					text
				},
				{
					kind: "side",
					text: PENDING_REPLY
				}
			]
		};
	});
	const tab = next.byTab[intent.tabId];
	return {
		state: next,
		effects: [{
			type: "side-ask",
			tabId: intent.tabId,
			text,
			atSeq: tab?.forkSeq ?? null
		}]
	};
}
function reply(state, intent) {
	return patchTab(state, intent.tabId, (tab) => {
		const messages = [...tab.messages];
		if (messages[messages.length - 1]?.kind === "side") messages[messages.length - 1] = {
			kind: "side",
			text: intent.text
		};
		else messages.push({
			kind: "side",
			text: intent.text
		});
		return {
			...tab,
			messages,
			error: null
		};
	});
}
function listSessions(state, intent, port) {
	const listed = mainsOf(port?.roster() ?? [], intent.phrase);
	return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		listed,
		error: null
	}));
}
function inspect(state, intent, port) {
	const roster = port?.roster() ?? [];
	const entry = roster.find((row) => row.id === intent.sessionId);
	if (entry !== void 0 && entry.kind !== "main") return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		error: "not a 主会话"
	}));
	const log = port?.log(intent.sessionId) ?? [];
	const card = makeCard(intent.sessionId, log, roster);
	return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		card,
		error: null
	}));
}
function deliver(state, intent, port) {
	const payload = {
		role: "sourced",
		to: intent.sessionId,
		text: intent.text,
		sourceTab: intent.tabId,
		sourceSession: port?.attachedId ?? ""
	};
	const result = port?.deliver(payload) ?? {
		ok: false,
		error: "unavailable"
	};
	const message = result.ok ? {
		kind: "delivery",
		to: intent.sessionId,
		text: intent.text,
		status: result.queued ? "queued" : "sent"
	} : {
		kind: "delivery",
		to: intent.sessionId,
		text: intent.text,
		status: "failed",
		error: result.error
	};
	const next = patchTab(state, intent.tabId, (tab) => ({
		...tab,
		error: null,
		messages: [...tab.messages, message]
	}));
	if (!result.ok) return {
		state: next,
		effects: []
	};
	return {
		state: next,
		effects: [{
			type: "deliver",
			to: payload.to,
			text: payload.text,
			sourceTab: payload.sourceTab,
			sourceSession: payload.sourceSession
		}]
	};
}
function readFile$1(state, intent, port) {
	const text = port?.read(intent.path);
	if (text === void 0) return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		error: "file not found"
	}));
	return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		error: null,
		messages: [...tab.messages, {
			kind: "read",
			path: intent.path,
			text
		}]
	}));
}
function searchFiles(state, intent, port) {
	const hits = port?.search(intent.query) ?? [];
	return patchTab(state, intent.tabId, (tab) => ({
		...tab,
		error: null,
		messages: [...tab.messages, {
			kind: "search",
			query: intent.query,
			hits
		}]
	}));
}
function cutFork(log) {
	const grouped = /* @__PURE__ */ new Map();
	const order = [];
	for (const event of log) {
		const bucket = grouped.get(event.turn);
		if (bucket === void 0) {
			grouped.set(event.turn, [event]);
			order.push(event.turn);
		} else bucket.push(event);
	}
	const out = [];
	for (const turn of order) {
		const events = grouped.get(turn) ?? [];
		const complete = events.some((event) => event.role === "assistant" && event.closed !== false);
		for (const event of events) {
			if (event.role === "assistant" && event.closed === false) continue;
			if (!complete && event.role === "assistant") continue;
			out.push(cloneEvent(event));
		}
	}
	return out;
}
function makeCard(sessionId, log, roster) {
	const entry = roster.find((row) => row.id === sessionId);
	const turn = log.reduce((max, event) => Math.max(max, event.turn), 0);
	const current = log.filter((event) => event.turn === turn);
	const files = [];
	for (const event of current) for (const path of event.writes ?? []) if (!files.includes(path)) files.push(path);
	const last = [...log].reverse().find((event) => event.role === "assistant" && event.closed !== false);
	const inFlight = current.some((event) => event.role === "assistant" && event.closed === false) || current.length > 0 && !current.some((event) => event.role === "assistant" && event.closed !== false);
	return {
		sessionId,
		title: entry?.title ?? sessionId,
		busy: entry?.busy ?? inFlight,
		turn,
		step: current.filter((event) => event.role === "tool-call").length,
		last: last?.text ?? "",
		files
	};
}
function mainsOf(roster, phrase) {
	const needle = phrase?.trim().toLowerCase() ?? "";
	return roster.filter((row) => row.kind === "main" && !row.archived).filter((row) => {
		if (needle.length === 0) return true;
		return row.title.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle) || row.cwd.toLowerCase().includes(needle);
	}).map((row) => ({
		id: row.id,
		title: row.title,
		cwd: row.cwd,
		busy: row.busy
	}));
}
function lastSeq(fork) {
	const last = fork[fork.length - 1];
	return last === void 0 ? null : last.seq;
}
function patchTab(state, tabId, update) {
	const current = state.byTab[tabId] ?? emptySideTab();
	return { byTab: {
		...state.byTab,
		[tabId]: update(current)
	} };
}
function normalize(state) {
	return { byTab: state.byTab ?? {} };
}
function cloneState(state) {
	const byTab = {};
	for (const [id, tab] of Object.entries(state.byTab)) byTab[id] = {
		...tab,
		forkSessionId: tab.forkSessionId ?? null,
		fork: tab.fork.map(cloneEvent),
		messages: tab.messages.map((msg) => cloneMessage(msg)),
		listed: tab.listed?.map((row) => ({ ...row })) ?? null,
		card: tab.card === null ? null : {
			...tab.card,
			files: [...tab.card.files]
		}
	};
	return { byTab };
}
function cloneEvent(event) {
	return {
		seq: event.seq,
		turn: event.turn,
		role: event.role,
		text: event.text,
		...event.closed === void 0 ? {} : { closed: event.closed },
		...event.writes === void 0 ? {} : { writes: [...event.writes] }
	};
}
function cloneMessage(msg) {
	if (msg.kind === "search") return {
		kind: "search",
		query: msg.query,
		hits: msg.hits.map((hit) => ({ ...hit }))
	};
	if (msg.kind === "delivery" && msg.status === "failed") return {
		kind: "delivery",
		to: msg.to,
		text: msg.text,
		status: "failed",
		error: msg.error
	};
	if (msg.kind === "delivery") return {
		kind: "delivery",
		to: msg.to,
		text: msg.text,
		status: msg.status
	};
	return { ...msg };
}
//#endregion
//#region lib/types/session.js
/** Deep module: 侧栏 chrome + Files 工具. Tests and the plugin cross this seam. */
const PALETTE = [
	"Review",
	"Terminal",
	"Browser",
	"Files"
];
const MAX_PERSISTED_HUNK_BYTES = 262144;
function retireSideChatTabs(tabs, active) {
	const kept = tabs.filter((tab) => tab.kind !== "Side Chat");
	return {
		tabs: kept,
		active: kept.some((tab) => tab.id === active) ? active : kept[0]?.id ?? null
	};
}
function createSidebarSession(opts) {
	const saved = opts.persist.load(opts.sessionId);
	let seq = saved ? saved.tabs.reduce((n, t) => Math.max(n, Number(t.id.slice(1)) || 0), 0) : 0;
	let attachments = (saved?.attachments ?? []).map(hydrateAnnotation);
	let deliveredMarks = (saved?.deliveredMarks ?? []).map(hydrateAnnotation).slice(-100);
	let queue = saved?.queue ?? [];
	let collapsed = saved?.collapsed ?? true;
	const retiredTabs = retireSideChatTabs(saved?.tabs ?? [], saved?.active ?? null);
	let tabs = retiredTabs.tabs;
	let active = retiredTabs.active;
	let files = saved?.files ?? {
		path: "",
		preview: void 0,
		tree: [],
		treeOpen: false,
		treeWidth: 240,
		view: "preview",
		hunk: null,
		diff: null,
		annotate: false,
		pendingMark: null,
		pendingRect: null,
		pendingSelection: null,
		notePos: null,
		noteDraft: "",
		editingId: null
	};
	files = {
		...files,
		tree: [],
		preview: void 0,
		treeOpen: false,
		treeWidth: clampTreeWidth(files.treeWidth),
		view: files.view === "diff" ? "diff" : "preview",
		hunk: files.hunk ?? null,
		diff: null,
		pendingRect: files.pendingRect ?? null,
		pendingSelection: files.pendingSelection ?? null,
		editingId: files.editingId ?? null
	};
	let review = saved?.review === void 0 ? emptyReview() : rememberReview(saved.review);
	let pages = hydrateBrowserPages(saved);
	let terminal = saved?.terminal ?? emptyTerminal();
	let sideChat = saved?.sideChat ?? emptySideChat();
	let stateRevision = 0;
	function nid() {
		seq += 1;
		return `t${seq}`;
	}
	function foldAttachments() {
		const extra = review.attachments.map(hydrateAnnotation);
		let dirty = review.attachments.length > 0;
		if (dirty) review = {
			...review,
			attachments: []
		};
		const next = { ...pages };
		for (const [id, state] of Object.entries(next)) {
			if (state.attachments.length === 0) continue;
			extra.push(...state.attachments.map(hydrateAnnotation));
			next[id] = {
				...state,
				attachments: []
			};
			dirty = true;
		}
		if (!dirty) return;
		pages = next;
		attachments = [...attachments, ...extra];
	}
	function saveNote(item, editingId) {
		foldAttachments();
		if (editingId === null) {
			attachments = [...attachments, item];
			return;
		}
		attachments = attachments.map((current) => current.id === editingId ? item : current);
	}
	function detachNote(id) {
		foldAttachments();
		attachments = attachments.filter((item) => item.id !== id);
	}
	function takeAttachments() {
		foldAttachments();
		const payload = attachments;
		attachments = [];
		deliver(payload);
		return payload;
	}
	function deliver(payload) {
		if (payload.length === 0) return;
		const known = new Set(deliveredMarks.map((item) => item.id));
		deliveredMarks = [...deliveredMarks, ...payload.filter((item) => !known.has(item.id))].slice(-100);
	}
	function projectFiles() {
		const path = files.path;
		const preview = path ? opts.files.read(path) : void 0;
		const change = files.hunk ?? (path ? opts.files.change?.(path) : void 0);
		const diff = change === void 0 || change.before === change.after ? null : fileDiff(change.before, change.after);
		const view = diff === null ? "preview" : files.view === "diff" ? "diff" : "preview";
		return {
			...files,
			tree: opts.files.tree(),
			preview,
			treeOpen: files.treeOpen ?? false,
			treeWidth: clampTreeWidth(files.treeWidth),
			view,
			diff
		};
	}
	function persist() {
		const snap = snapshot(false);
		const byTab = {};
		for (const [id, rec] of Object.entries(snap.terminal.byTab)) byTab[id] = {
			...rec,
			output: "",
			chunk: ""
		};
		opts.persist.save(opts.sessionId, {
			...snap,
			files: {
				...snap.files,
				tree: [],
				preview: void 0,
				hunk: persistedFileChange(snap.files.hunk),
				diff: null
			},
			fileStats: {},
			review: rememberReview(snap.review),
			terminal: { byTab }
		});
	}
	function wantFiles() {
		if (collapsed) return false;
		return tabs.find((tab) => tab.id === active)?.kind === "Files";
	}
	function wantReview() {
		if (collapsed) return false;
		return tabs.find((tab) => tab.id === active)?.kind === "Review";
	}
	function snapshot(project = true) {
		foldAttachments();
		const activeTab = tabs.find((t) => t.id === active);
		const showPalette = !activeTab || activeTab.kind === null;
		const currentBrowser = pages[browserTabId() ?? ""] ?? emptyBrowser();
		return {
			sessionId: opts.sessionId,
			collapsed,
			tabs: tabs.map((t) => ({ ...t })),
			active,
			showPalette,
			palette: PALETTE,
			files: project && wantFiles() ? projectFiles() : {
				...files,
				tree: files.tree ?? [],
				preview: files.preview,
				diff: files.diff ?? null
			},
			fileStats: {},
			review: project && wantReview() ? projectReview(review, opts.review) : rememberReview(review),
			browser: projectBrowser(currentBrowser, opts.browser),
			browsers: projectPages(),
			terminal: projectTerminal(terminal),
			sideChat: projectSideChat(sideChat, opts.sideChat),
			attachments: attachments.map((a) => ({ ...a })),
			deliveredMarks: deliveredMarks.map((a) => ({ ...a })),
			queue: queue.map((q) => ({
				text: q.text,
				attachments: q.attachments.map((a) => ({ ...a }))
			}))
		};
	}
	function expand() {
		collapsed = false;
	}
	function tabTitle(kind, target) {
		if (kind === "Terminal") return nextTerminalTitle(tabs);
		if (target.length === 0) return kind;
		if (kind === "Browser") return target.replace(/^https?:\/\//i, "").slice(0, 48) || target;
		return target.split("/").pop() ?? kind;
	}
	function sameTarget(kind, left, right) {
		if (left.length === 0 || right.length === 0) return left === right;
		if (kind === "Browser") return normalizeUrl(left) === normalizeUrl(right);
		return left === right;
	}
	function stampBrowserTab(url) {
		const tab = tabs.find((item) => item.id === active && item.kind === "Browser");
		if (tab === void 0 || url.length === 0) return;
		tab.target = url;
		tab.title = tabTitle("Browser", url);
	}
	function browserTabId() {
		return tabs.find((item) => item.id === active && item.kind === "Browser")?.id;
	}
	function projectPages() {
		const out = {};
		for (const [id, state] of Object.entries(pages)) out[id] = projectBrowser(state, opts.browser);
		return out;
	}
	function putBrowser(tabId, state) {
		pages = {
			...pages,
			[tabId]: state
		};
	}
	function applyBrowser(intent) {
		const id = browserTabId();
		if (id === void 0) return void 0;
		const next = reduceBrowser(pages[id] ?? emptyBrowser(), intent, opts.browser);
		if (next === void 0) return void 0;
		putBrowser(id, next.state);
		if (intent.type === "open-url" || intent.type === "browser-follow" || intent.type === "browser-back" || intent.type === "browser-forward" || intent.type === "browser-refresh") {
			stampBrowserTab(next.state.url);
			const action = intent.type === "browser-back" ? "back" : intent.type === "browser-forward" ? "forward" : intent.type === "browser-refresh" ? "refresh" : "open";
			opts.browser?.manage?.(id, next.state.url, action);
		}
		if (intent.type === "browser-set-device") {
			const viewport = browserDeviceViewport(next.state.device);
			if (viewport !== null) opts.browser?.resize?.(id, viewport.width, viewport.height);
		}
		return next.effects;
	}
	function restoreBrowserTargets() {
		tabs = tabs.map((tab) => {
			if (tab.kind !== "Browser" || tab.target.length > 0) return tab;
			const url = pages[tab.id]?.url ?? "";
			if (url.length === 0) return tab;
			return {
				...tab,
				target: url,
				title: tabTitle("Browser", url)
			};
		});
	}
	restoreBrowserTargets();
	function fillOrOpen(kind, target = "", reveal = true) {
		if (reveal) expand();
		if (target) {
			const reuse = tabs.find((t) => t.kind === kind && sameTarget(kind, t.target, target));
			if (reuse) {
				active = reuse.id;
				return;
			}
		}
		const current = tabs.find((t) => t.id === active);
		if (current?.kind === kind && (current.target.length === 0 || sameTarget(kind, current.target, target))) {
			if (target.length > 0) tabs = tabs.map((t) => t.id === current.id ? {
				...t,
				target,
				title: tabTitle(kind, target)
			} : t);
			return;
		}
		const empty = tabs.find((t) => t.id === active && t.kind === null);
		if (empty) {
			tabs = tabs.map((t) => t.id === empty.id ? {
				...t,
				kind,
				title: tabTitle(kind, target),
				target
			} : t);
			return;
		}
		const id = nid();
		const tab = {
			id,
			kind,
			target,
			title: tabTitle(kind, target)
		};
		tabs = [...tabs, tab];
		active = id;
	}
	function dispatch(intent) {
		stateRevision += 1;
		const effects = [];
		switch (intent.type) {
			case "pick-tool":
				fillOrOpen(intent.kind);
				break;
			case "open-terminal": {
				expand();
				const id = nid();
				const title = nextTerminalTitle(tabs);
				tabs = [...tabs, {
					id,
					kind: "Terminal",
					target: id,
					title
				}];
				active = id;
				break;
			}
			case "open-empty-tab":
				expand();
				{
					const id = nid();
					tabs = [...tabs, {
						id,
						kind: null,
						target: "",
						title: "New tab"
					}];
					active = id;
				}
				break;
			case "browser-runtime-sync": {
				const current = pages[intent.tabId];
				if (current === void 0) break;
				const next = syncManagedBrowser(current, intent);
				putBrowser(intent.tabId, next);
				tabs = tabs.map((tab) => tab.id === intent.tabId ? {
					...tab,
					target: next.url,
					title: intent.title || tabTitle("Browser", next.url)
				} : tab);
				break;
			}
			case "close-tab": {
				opts.browser?.close?.(intent.id);
				const next = tabs.filter((t) => t.id !== intent.id);
				if (pages[intent.id] !== void 0) {
					const copy = { ...pages };
					delete copy[intent.id];
					pages = copy;
				}
				if (next.length === 0) {
					tabs = [];
					active = null;
					collapsed = true;
				} else {
					tabs = next;
					if (active === intent.id) active = next[next.length - 1]?.id ?? null;
				}
				break;
			}
			case "select-tab": {
				const tab = tabs.find((t) => t.id === intent.id);
				if (tab === void 0) break;
				active = tab.id;
				if (tab.kind === "Files" && tab.target) files = {
					...files,
					path: tab.target,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				};
				if (tab.kind === "Browser" && tab.target.length > 0) {
					if (pages[tab.id] === void 0) {
						const loaded = reduceBrowser(emptyBrowser(), {
							type: "open-url",
							url: tab.target
						}, opts.browser);
						if (loaded !== void 0) putBrowser(tab.id, loaded.state);
					}
					const href = pages[tab.id]?.url || tab.target;
					if (href.length > 0) opts.browser?.manage?.(tab.id, href, "open");
				}
				const selectedBrowser = pages[tab.id];
				const viewport = tab.kind === "Browser" && selectedBrowser !== void 0 ? browserDeviceViewport(selectedBrowser.device) : null;
				if (viewport !== null) opts.browser?.resize?.(tab.id, viewport.width, viewport.height);
				break;
			}
			case "toggle-collapsed":
				collapsed = !collapsed;
				break;
			case "reorder-tabs": {
				const from = intent.from;
				const to = intent.to;
				if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) break;
				const next = [...tabs];
				const [moved] = next.splice(from, 1);
				if (moved === void 0) break;
				next.splice(to, 0, moved);
				tabs = next;
				break;
			}
			case "open-path":
				fillOrOpen("Files", intent.path);
				files = {
					...files,
					path: intent.path,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null,
					treeOpen: false,
					view: intent.view === "diff" ? "diff" : "preview",
					hunk: intent.before !== void 0 || intent.after !== void 0 ? {
						before: intent.before ?? "",
						after: intent.after ?? ""
					} : null
				};
				break;
			case "select-file":
				fillOrOpen("Files", intent.path);
				files = {
					...files,
					path: intent.path,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null,
					hunk: null
				};
				break;
			case "toggle-tree":
				files = {
					...files,
					treeOpen: !files.treeOpen
				};
				break;
			case "set-files-view":
				files = {
					...files,
					view: intent.view
				};
				break;
			case "set-tree-width":
				files = {
					...files,
					treeWidth: clampTreeWidth(intent.width)
				};
				break;
			case "set-annotate":
				files = {
					...files,
					annotate: intent.on,
					pendingMark: intent.on ? files.pendingMark : null,
					pendingRect: intent.on ? files.pendingRect : null,
					pendingSelection: intent.on ? files.pendingSelection : null,
					notePos: intent.on ? files.notePos : null,
					noteDraft: intent.on ? files.noteDraft : "",
					editingId: intent.on ? files.editingId : null
				};
				break;
			case "click-content":
				if (files.annotate) files = {
					...files,
					pendingMark: intent.mark,
					pendingRect: intent.rect ?? null,
					pendingSelection: intent.selection ?? null,
					notePos: {
						x: intent.x,
						y: intent.y
					},
					noteDraft: files.editingId === null ? "" : files.noteDraft,
					editingId: files.editingId
				};
				break;
			case "dismiss-note":
				files = {
					...files,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				};
				break;
			case "set-note-draft":
				files = {
					...files,
					noteDraft: intent.text
				};
				break;
			case "note-add":
				if (!files.pendingMark) break;
				saveNote(fromFileMark(files.editingId ?? nid(), files.noteDraft, files.pendingMark, files.pendingRect ?? void 0, files.pendingSelection ?? void 0), files.editingId);
				files = {
					...files,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				};
				break;
			case "note-send": {
				if (!files.pendingMark) break;
				const item = fromFileMark(files.editingId ?? nid(), files.noteDraft, files.pendingMark, files.pendingRect ?? void 0, files.pendingSelection ?? void 0);
				if (files.editingId !== null) detachNote(files.editingId);
				const text = noteBody(files.noteDraft);
				const payload = [item];
				deliver(payload);
				if (opts.isBusy()) {
					queue = [...queue, {
						text,
						attachments: payload
					}];
					effects.push({
						type: "queue",
						text,
						attachments: payload
					});
				} else effects.push({
					type: "send",
					text,
					attachments: payload
				});
				files = {
					...files,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				};
				break;
			}
			case "restore-attachments": {
				const known = new Set(attachments.map((item) => item.id));
				const incoming = intent.attachments.filter((item) => !known.has(item.id));
				attachments = [...attachments, ...incoming];
				const restored = new Set(incoming.map((item) => item.id));
				deliveredMarks = deliveredMarks.filter((item) => !restored.has(item.id));
				break;
			}
			case "composer-send": {
				const payload = takeAttachments();
				if (intent.text.trim().length === 0 && payload.length === 0) break;
				if (opts.isBusy()) {
					queue = [...queue, {
						text: intent.text,
						attachments: payload
					}];
					effects.push({
						type: "queue",
						text: intent.text,
						attachments: payload
					});
				} else effects.push({
					type: "send",
					text: intent.text,
					attachments: payload
				});
				break;
			}
			case "reveal-mark": {
				const item = hydrateAnnotation(intent.mark);
				expand();
				if (item.source === "files" && item.path !== void 0) {
					fillOrOpen("Files", item.path);
					files = {
						...files,
						path: item.path,
						annotate: true,
						pendingMark: item.selector ?? item.from,
						pendingRect: item.rect ?? null,
						pendingSelection: item.selection ?? null,
						notePos: null,
						noteDraft: "",
						editingId: null
					};
					break;
				}
				if (item.source === "browser") {
					const url = item.url ?? tabs.find((tab) => tab.kind === "Browser")?.target ?? "";
					fillOrOpen("Browser", url);
					const tabId = browserTabId();
					if (tabId === void 0) break;
					let current = pages[tabId] ?? emptyBrowser();
					if (current.url.length === 0 && url.length > 0) {
						current = reduceBrowser(current, {
							type: "open-url",
							url
						}, opts.browser)?.state ?? current;
						opts.browser?.manage?.(tabId, current.url, "open");
					}
					putBrowser(tabId, {
						...current,
						annotate: true,
						pendingMark: item.from,
						pendingSelector: item.selector ?? null,
						pendingRect: item.rect ?? null,
						pendingCaptureId: item.evidence?.captureId ?? null,
						pendingDocumentId: item.evidence?.documentId ?? null,
						pendingEvidence: item.evidence ?? null,
						notePos: null,
						noteDraft: "",
						editingId: null
					});
					break;
				}
				if (item.source === "review") {
					fillOrOpen("Review");
					review = {
						...review,
						openPath: item.path ?? review.openPath,
						pendingMark: item.selector ?? item.from,
						noteDraft: "",
						editingId: null
					};
				}
				break;
			}
			case "edit-attachment": {
				foldAttachments();
				const item = attachments.find((current) => current.id === intent.id);
				if (item === void 0) break;
				expand();
				const notePos = {
					x: intent.x ?? 180,
					y: intent.y ?? 72
				};
				if (item.source === "files" && item.path !== void 0) {
					fillOrOpen("Files", item.path);
					files = {
						...files,
						path: item.path,
						annotate: true,
						pendingMark: item.selector ?? item.from,
						pendingRect: item.rect ?? null,
						pendingSelection: item.selection ?? null,
						notePos,
						noteDraft: item.text,
						editingId: item.id
					};
					break;
				}
				if (item.source === "browser") {
					const url = item.url ?? tabs.find((tab) => tab.kind === "Browser")?.target ?? "";
					fillOrOpen("Browser", url);
					const tabId = browserTabId();
					if (tabId === void 0) break;
					let current = pages[tabId] ?? emptyBrowser();
					if (current.url.length === 0 && url.length > 0) {
						current = reduceBrowser(current, {
							type: "open-url",
							url
						}, opts.browser)?.state ?? current;
						opts.browser?.manage?.(tabId, current.url, "open");
					}
					putBrowser(tabId, {
						...current,
						annotate: true,
						pendingMark: item.from,
						pendingSelector: item.selector ?? null,
						pendingRect: item.rect ?? null,
						pendingCaptureId: item.evidence?.captureId ?? null,
						pendingDocumentId: item.evidence?.documentId ?? null,
						pendingEvidence: item.evidence ?? null,
						notePos,
						noteDraft: item.text,
						editingId: item.id
					});
					break;
				}
				if (item.source === "review") {
					fillOrOpen("Review");
					review = {
						...review,
						openPath: item.path ?? review.openPath,
						pendingMark: item.selector ?? item.from,
						noteDraft: item.text,
						editingId: item.id
					};
				}
				break;
			}
			case "remove-attachment":
				detachNote(intent.id);
				if (files.editingId === intent.id) files = {
					...files,
					pendingMark: null,
					pendingRect: null,
					pendingSelection: null,
					notePos: null,
					noteDraft: "",
					editingId: null
				};
				if (review.editingId === intent.id) review = {
					...review,
					pendingMark: null,
					noteDraft: "",
					editingId: null
				};
				for (const [id, current] of Object.entries(pages)) {
					if (current.editingId !== intent.id) continue;
					putBrowser(id, {
						...current,
						pendingMark: null,
						pendingSelector: null,
						pendingRect: null,
						notePos: null,
						noteDraft: "",
						editingId: null
					});
				}
				break;
			case "browser-note-add": {
				const id = browserTabId();
				const current = id === void 0 ? void 0 : pages[id];
				if (id === void 0 || current === void 0 || current.pendingMark === null) break;
				const evidence = intent.evidence ?? current.pendingEvidence;
				if (evidence === null || evidence === void 0) break;
				const nextSeq = current.editingId === null ? current.seq + 1 : current.seq;
				saveNote(fromBrowserPending(current.editingId ?? `b${nextSeq}`, current.noteDraft, {
					pendingMark: current.pendingMark,
					pendingSelector: current.pendingSelector,
					pendingRect: current.pendingRect,
					url: current.url,
					evidence
				}), current.editingId);
				putBrowser(id, {
					...current,
					seq: nextSeq,
					pendingMark: null,
					notePos: null,
					noteDraft: "",
					pendingSelector: null,
					pendingRect: null,
					pendingCaptureId: null,
					pendingDocumentId: null,
					pendingEvidence: null,
					editingId: null
				});
				break;
			}
			case "browser-note-send": {
				const id = browserTabId();
				const current = id === void 0 ? void 0 : pages[id];
				if (id === void 0 || current === void 0 || current.pendingMark === null) break;
				const evidence = intent.evidence ?? current.pendingEvidence;
				if (evidence === null || evidence === void 0) break;
				const nextSeq = current.editingId === null ? current.seq + 1 : current.seq;
				const item = fromBrowserPending(current.editingId ?? `b${nextSeq}`, current.noteDraft, {
					pendingMark: current.pendingMark,
					pendingSelector: current.pendingSelector,
					pendingRect: current.pendingRect,
					url: current.url,
					evidence
				});
				if (current.editingId !== null) detachNote(current.editingId);
				const text = noteBody(current.noteDraft);
				const payload = [item];
				deliver(payload);
				putBrowser(id, {
					...current,
					seq: nextSeq,
					pendingMark: null,
					notePos: null,
					noteDraft: "",
					pendingSelector: null,
					pendingRect: null,
					pendingCaptureId: null,
					pendingDocumentId: null,
					pendingEvidence: null,
					editingId: null
				});
				if (opts.browser?.isBusy() ?? opts.isBusy()) {
					queue = [...queue, {
						text,
						attachments: payload
					}];
					effects.push({
						type: "queue",
						text,
						attachments: payload
					});
				} else effects.push({
					type: "send",
					text,
					attachments: payload
				});
				break;
			}
			case "review-note-add": {
				if (review.pendingMark === null) break;
				const nextSeq = review.editingId === null ? review.seq + 1 : review.seq;
				saveNote(fromReviewMark(review.editingId ?? `r${nextSeq}`, review.noteDraft, review.pendingMark), review.editingId);
				review = {
					...review,
					seq: nextSeq,
					pendingMark: null,
					noteDraft: "",
					editingId: null
				};
				break;
			}
			case "review-note-send": {
				if (review.pendingMark === null) break;
				const nextSeq = review.editingId === null ? review.seq + 1 : review.seq;
				const item = fromReviewMark(review.editingId ?? `r${nextSeq}`, review.noteDraft, review.pendingMark);
				if (review.editingId !== null) detachNote(review.editingId);
				const text = noteBody(review.noteDraft);
				const payload = [item];
				deliver(payload);
				review = {
					...review,
					seq: nextSeq,
					pendingMark: null,
					noteDraft: "",
					editingId: null
				};
				if (opts.review?.isBusy() ?? opts.isBusy()) {
					queue = [...queue, {
						text,
						attachments: payload
					}];
					effects.push({
						type: "queue",
						text,
						attachments: payload
					});
				} else effects.push({
					type: "send",
					text,
					attachments: payload
				});
				break;
			}
			default: {
				if (intent.type === "open-url") fillOrOpen("Browser", normalizeUrl(intent.url), intent.reveal !== false);
				const nextReview = reduceReview(review, intent, opts.review);
				if (nextReview !== void 0) {
					review = nextReview.state;
					effects.push(...nextReview.effects);
					break;
				}
				const browserEffects = applyBrowser(intent);
				if (browserEffects !== void 0) {
					effects.push(...browserEffects);
					break;
				}
				const nextTerminal = reduceTerminal(terminal, intent, opts.terminal);
				if (nextTerminal !== void 0) {
					terminal = nextTerminal.state;
					effects.push(...nextTerminal.effects);
					break;
				}
				const nextSideChat = reduceSideChat(sideChat, intent, opts.sideChat);
				if (nextSideChat !== void 0) {
					sideChat = nextSideChat.state;
					effects.push(...nextSideChat.effects);
					break;
				}
				break;
			}
		}
		if (intent.type !== "terminal-refresh" && intent.type !== "terminal-write" && intent.type !== "terminal-resize") persist();
		return effects;
	}
	function pullTerminal(tabId, since) {
		return opts.terminal?.pull?.(tabId, since) ?? {
			seq: 0,
			chunk: ""
		};
	}
	return {
		snapshot,
		revision: () => stateRevision,
		dispatch,
		pullTerminal
	};
}
function nextTerminalTitle(list) {
	const n = list.filter((tab) => tab.kind === "Terminal").length + 1;
	return n === 1 ? "bash" : `bash ${n}`;
}
function persistedFileChange(change) {
	if (change === null) return null;
	if (Buffer.byteLength(change.before) + Buffer.byteLength(change.after) > MAX_PERSISTED_HUNK_BYTES) return null;
	return {
		before: change.before,
		after: change.after
	};
}
function clampTreeWidth(width) {
	return Math.min(420, Math.max(160, typeof width === "number" && Number.isFinite(width) ? Math.round(width) : 240));
}
//#endregion
//#region lib/types/registry.js
/** One SidebarSession per 主会话. */
function createRegistry(opts) {
	const live = /* @__PURE__ */ new Map();
	const cwd = /* @__PURE__ */ new Map();
	const busy = /* @__PURE__ */ new Map();
	const writes = /* @__PURE__ */ new Map();
	const roster = /* @__PURE__ */ new Map();
	const logs = /* @__PURE__ */ new Map();
	const filesFor = opts.filesFor ?? ((_id, io) => createFsFiles(io.cwdOf));
	return { forSession(sessionId, gate) {
		cwd.set(sessionId, gate.cwd);
		busy.set(sessionId, gate.busy);
		writes.set(sessionId, gate.turnWrites ?? []);
		roster.set(sessionId, gate.roster ?? []);
		logs.set(sessionId, gate.logs ?? {});
		const io = {
			cwdOf: () => cwd.get(sessionId) ?? "",
			isBusy: () => busy.get(sessionId) ?? false,
			turnWrites: () => writes.get(sessionId) ?? [],
			roster: () => roster.get(sessionId) ?? [],
			log: (id) => logs.get(sessionId)?.[id] ?? []
		};
		const existing = live.get(sessionId);
		if (existing) return existing;
		const created = createSidebarSession({
			sessionId,
			files: filesFor(sessionId, io),
			persist: opts.persist,
			isBusy: io.isBusy,
			...opts.reviewFor === void 0 ? {} : { review: opts.reviewFor(sessionId, io) },
			...opts.browserFor === void 0 ? {} : { browser: opts.browserFor(sessionId, io) },
			...opts.terminalFor === void 0 ? {} : { terminal: opts.terminalFor(sessionId, io) },
			...opts.sideChatFor === void 0 ? {} : { sideChat: opts.sideChatFor(sessionId, io) }
		});
		live.set(sessionId, created);
		return created;
	} };
}
//#endregion
//#region lib/types/index.js
/** Host half: one SidebarSession per 主会话, reached over Connection RPC. */
const name = "dsh-codex-sidebar";
const inject = ["connection"];
function apply(ctx) {
	const filesBySession = /* @__PURE__ */ new Map();
	const annotationSend = new AnnotationSendStore();
	let agentLive = (_id) => false;
	let saveImage;
	const managedBrowser = new ManagedBrowserRuntime();
	const managedStream = new ManagedBrowserStream({ runtime: managedBrowser });
	const managedEvidence = new ManagedBrowserEvidenceStore(managedBrowser);
	const persist = createFilePersist();
	const workspace = createWorkspaceInspector();
	ctx.effect(() => {
		const timer = setInterval(() => {
			managedBrowser.reap();
		}, 15e3);
		timer.unref();
		return () => {
			clearInterval(timer);
			persist.flush();
			Promise.all([managedStream.dispose(), managedBrowser.dispose()]);
		};
	}, "dsh-codex-sidebar: managed browser lifecycle");
	const registry = createRegistry({
		persist,
		filesFor: (sessionId, io) => {
			const files = createFsFiles(io.cwdOf);
			filesBySession.set(sessionId, files);
			return files;
		},
		browserFor: (sessionId, io) => createHostBrowser({
			isBusy: io.isBusy,
			managed: {
				runtime: managedBrowser,
				sessionId
			}
		}),
		terminalFor: (_sessionId, io) => createHostTerminal(io.cwdOf),
		sideChatFor: (sessionId, io) => createHostSideChat({
			sessionId,
			files: filesBySession.get(sessionId) ?? createFsFiles(io.cwdOf),
			io
		})
	});
	ctx.inject(["webServer"], (wired) => {
		if (wired.webServer === void 0) return;
		wired.effect(() => wired.webServer?.registerUpgrade({
			path: "/__dcs/browser-stream",
			handler: (req, socket, head) => {
				managedStream.handleUpgrade(req, socket, head);
			}
		}) ?? (() => {}), "dsh-codex-sidebar: managed browser stream");
	});
	ctx.inject(["connection"], (wired) => {
		if (wired.connection === void 0) return;
		wired.effect(() => wired.connection?.rpc.handle("/codex-sidebar", async (endpoint, payload) => {
			return handleSidebarRpcAsync(registry, endpoint, payload, {
				browserStream: managedStream,
				managedBrowser,
				browserEvidence: managedEvidence,
				annotationSend,
				workspace,
				annotationPortsFor: (sessionId) => ({
					readFile: (path) => filesBySession.get(sessionId)?.read(path),
					...saveImage === void 0 ? {} : { saveImage },
					readEvidence: (id, evidence) => managedEvidence.read(id, evidence),
					agentLive
				})
			});
		}, { authority: "loopback" }) ?? (() => {}), "dsh-codex-sidebar: sidebar RPC");
	});
	ctx.inject(["tools"], (wired) => {
		if (wired.tools === void 0) return;
		const service = createManagedBrowserDriveService(managedBrowser);
		wired.effect(() => registerBrowserDriveTools(wired.tools, service, (exec) => {
			const sessionId = exec.agent?.id;
			if (sessionId === void 0 || sessionId.length === 0) return void 0;
			return registry.forSession(sessionId, {
				cwd: exec.agent?.session?.header?.cwd ?? "",
				busy: exec.agent?.status === "running"
			});
		}), "dsh-codex-sidebar: Browser tools");
		console.info("[dsh-codex-sidebar] browser_tabs/open/snapshot/click/fill registered");
	});
	ctx.inject(["attachments"], (wired) => {
		if (wired.attachments === void 0) return;
		saveImage = (input) => wired.attachments.saveImage(input);
	});
	ctx.inject(["agents"], (wired) => {
		if (wired.agents === void 0) return;
		agentLive = (id) => wired.agents?.get(id) !== void 0;
		wired.effect(() => installAnnotationSend(wired, annotationSend), "dsh-codex-sidebar: annotation send");
	});
	ctx.inject(["systemPrompt"], (wired) => {
		if (wired.systemPrompt === void 0) return;
		wired.effect(() => wired.systemPrompt?.section({
			name: "codex-sidebar:browser-drive",
			order: 140,
			text: BROWSER_DRIVE_GUIDANCE
		}) ?? (() => {}), "dsh-codex-sidebar: Browser tool guidance");
	});
}
//#endregion
export { PALETTE, SIDEBAR_DISPATCH_ENDPOINT, SIDEBAR_FILE_READ_ENDPOINT, SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, apply, createRegistry, createSidebarSession, formatDelivery, formatEvidenceSend, formatHumanSend, formatSend, inject, name };
