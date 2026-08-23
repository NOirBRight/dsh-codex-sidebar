window.__ModuleLoader__.load({
	id: "dsh-codex-sidebar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
		//#endregion
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/contract.ts
		const SIDEBAR_RPC_CHANNEL = "/codex-sidebar";
		const SIDEBAR_SNAPSHOT_ENDPOINT = "sidebar/snapshot";
		const SIDEBAR_DISPATCH_ENDPOINT = "sidebar/dispatch";
		const SIDEBAR_FILE_READ_ENDPOINT = "sidebar/file-read";
		const SIDEBAR_TERMINAL_PULL_ENDPOINT = "sidebar/terminal-pull";
		const SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT = "sidebar/browser-stream-ticket";
		const SIDEBAR_BROWSER_CAPTURE_ENDPOINT = "sidebar/browser-capture";
		const SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT = "sidebar/browser-evidence-commit";
		const SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT = "sidebar/stage-annotations";
		const SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT = "sidebar/unstage-annotations";
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region src/send-text.ts
		function formatDelivery(text, sourceTab, sourceSession) {
			const label = "[投递 · Side Chat " + sourceTab + " · 主会话 " + sourceSession + "]";
			const body = text.trim();
			if (body.length === 0) return label;
			return label + "\n" + body;
		}
		//#endregion
		//#region src/review.ts
		const MAX_DIFF_LINES = 4e3;
		const MAX_DIFF_CELLS = 25e4;
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
			return oldCount > MAX_DIFF_LINES || newCount > MAX_DIFF_LINES || (oldCount + 1) * (newCount + 1) > MAX_DIFF_CELLS;
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
		/** +/− for badges. Strip shared ends, then LCS only the unique middle. */
		function lineStats(before, after) {
			const oldLines = splitLines(before);
			const newLines = splitLines(after);
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
		function splitLines(text) {
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
		//#endregion
		//#region src/tool-open.ts
		/** How a 主会话 path click should open Files — plugin-side, not DSH core. */
		const WRITE_TOOL$1 = /^(write|edit|str_replace|strreplace|search_replace|apply_patch|notebook)/i;
		let collecting;
		const collectedCache = /* @__PURE__ */ new WeakMap();
		function viewForTool(toolName) {
			if (toolName !== void 0 && WRITE_TOOL$1.test(toolName)) return "diff";
			return "preview";
		}
		function statForLabel(stats, label) {
			const text = label.trim().replace(/\\/g, "/");
			if (text.length === 0) return void 0;
			if (stats[text] !== void 0) return stats[text];
			const keys = Object.keys(stats);
			const rel = keys.filter((key) => text === key || text.endsWith("/" + key) || key.endsWith("/" + text));
			if (rel.length === 1) {
				const key = rel[0];
				return key === void 0 ? void 0 : stats[key];
			}
			const base = text.split("/").pop() ?? text;
			const byBase = keys.filter((key) => (key.split("/").pop() ?? key) === base);
			if (byBase.length === 1) {
				const key = byBase[0];
				return key === void 0 ? void 0 : stats[key];
			}
		}
		/** Same row stats with a snapshot-local identity for exact path opening. */
		function rowHunksFromSnapshot(snapshot) {
			return indexedHunks(snapshot).map((hunk) => {
				const diff = lineStats(hunk.before, hunk.after);
				return {
					path: hunk.path,
					added: diff.added,
					removed: diff.removed,
					hunkId: hunk.hunkId,
					before: hunk.before,
					after: hunk.after
				};
			});
		}
		function queueRowStats(rows) {
			const pending = /* @__PURE__ */ new Map();
			for (const row of rows) {
				const list = pending.get(row.path) ?? [];
				list.push({
					added: row.added,
					removed: row.removed,
					...row.hunkId === void 0 ? {} : { hunkId: row.hunkId },
					...row.before === void 0 ? {} : { before: row.before },
					...row.after === void 0 ? {} : { after: row.after }
				});
				pending.set(row.path, list);
			}
			return pending;
		}
		function takeRowHunk(pending, label) {
			const text = label.trim().replace(/\\/g, "/");
			if (text.length === 0) return void 0;
			const keys = [...pending.keys()];
			const hit = keys.find((key) => key === text) ?? unique(keys.filter((key) => text.endsWith("/" + key) || key.endsWith("/" + text))) ?? unique(keys.filter((key) => (key.split("/").pop() ?? key) === (text.split("/").pop() ?? text)));
			if (hit === void 0) return void 0;
			const queue = pending.get(hit);
			if (queue === void 0 || queue.length === 0) return void 0;
			const next = queue.shift();
			if (queue.length === 0) pending.delete(hit);
			return next;
		}
		function unique(keys) {
			return keys.length === 1 ? keys[0] : void 0;
		}
		function reviewChangesFromSnapshot(snapshot) {
			const byPath = /* @__PURE__ */ new Map();
			for (const hunk of collectFromSnapshot(snapshot).hunks) {
				const prev = byPath.get(hunk.path);
				byPath.set(hunk.path, {
					path: hunk.path,
					before: prev === void 0 ? hunk.before : prev.before,
					after: hunk.after
				});
			}
			return [...byPath.values()];
		}
		function hunkForOpen(snapshot, path, tool, hunkId) {
			const hunks = indexedHunks(snapshot).filter((hunk) => statForLabel({ [hunk.path]: {
				added: 1,
				removed: 0
			} }, path) !== void 0);
			if (hunks.length === 0) return void 0;
			if (hunkId !== void 0) {
				const exact = hunks.find((hunk) => hunk.hunkId === hunkId);
				if (exact !== void 0) return {
					before: exact.before,
					after: exact.after
				};
			}
			const want = tool !== void 0 && /^write$/i.test(tool) ? "write" : tool !== void 0 && WRITE_TOOL$1.test(tool) ? "edit" : void 0;
			const picked = want === void 0 ? hunks : hunks.filter((hunk) => hunk.op === want);
			const use = picked.length > 0 ? picked : hunks;
			const last = use[use.length - 1];
			return last === void 0 ? void 0 : {
				before: last.before,
				after: last.after
			};
		}
		function indexedHunks(snapshot) {
			return collectFromSnapshot(snapshot).hunks.map((hunk, index) => ({
				...hunk,
				hunkId: String(index)
			}));
		}
		function collectFromSnapshot(snapshot) {
			const stats = {};
			const hunks = [];
			if (!isRecord(snapshot)) return {
				stats,
				hunks
			};
			const cached = collectedCache.get(snapshot);
			if (cached !== void 0) return cached;
			collecting = hunks;
			try {
				const seen = /* @__PURE__ */ new Set();
				absorbRoots(snapshot.nodes, "settled", stats, seen);
				absorbRoots(snapshot.runningCalls, "running", stats, seen);
				absorbTree(snapshot.nodes, stats, seen);
				absorbTree(snapshot.runningCalls, stats, seen);
				if (isRecord(snapshot.chat)) {
					absorbTree(snapshot.chat.nodes, stats, seen);
					if (isRecord(snapshot.chat.legacy)) absorbTree(snapshot.chat.legacy.nodes, stats, seen);
				}
			} finally {
				collecting = void 0;
			}
			const collected = {
				stats,
				hunks
			};
			collectedCache.set(snapshot, collected);
			return collected;
		}
		function absorbRoots(value, state, out, seen) {
			if (!Array.isArray(value)) return;
			for (const item of value) {
				if (!isRecord(item) || typeof item.callId !== "string") continue;
				if (state === "settled" ? item.kind !== "tool-result" : item.kind !== void 0) continue;
				absorbCall(item, state, out, seen);
			}
		}
		function absorbCall(call, state, out, seen) {
			if (seen.has(call)) return;
			seen.add(call);
			const start = collecting?.length ?? 0;
			if (state === "settled") {
				if (!absorbView(call.resultView, out)) absorbView(call.callView, out);
			} else absorbView(call.callView, out);
			absorbArgs(call, out);
			absorbPair(call, out);
			absorbResultText(call, out);
			collapseCallHunks(start);
			if (!Array.isArray(call.subCalls)) return;
			for (const child of call.subCalls) {
				if (!isRecord(child) || typeof child.callId !== "string") continue;
				if (child.kind === "tool-result") absorbCall(child, "settled", out, seen);
				else if (child.kind === void 0) absorbCall(child, "running", out, seen);
			}
		}
		function collapseCallHunks(start) {
			if (collecting === void 0 || collecting.length <= start) return;
			const slice = collecting.slice(start);
			const seen = /* @__PURE__ */ new Set();
			const kept = [];
			for (const hunk of slice) {
				if (seen.has(hunk.path)) continue;
				seen.add(hunk.path);
				kept.push(hunk);
			}
			collecting.splice(start, slice.length, ...kept);
		}
		function absorbView(value, out) {
			const hunks = diffHunks(value);
			if (hunks === void 0) return false;
			for (const hunk of hunks) {
				const before = hunk.oldText ?? "";
				noteHunk(hunk.path, before, hunk.newText, before.length === 0 ? "write" : "edit");
				mergeStat(out, hunk.path, lineStats(before, hunk.newText));
			}
			return true;
		}
		function absorbTree(value, out, seen) {
			if (value === null || typeof value !== "object") return;
			if (value instanceof Map) {
				for (const item of value.values()) absorbTree(item, out, seen);
				return;
			}
			if (Array.isArray(value)) {
				for (const item of value) absorbTree(item, out, seen);
				return;
			}
			if (!isRecord(value)) return;
			const first = !seen.has(value);
			if (first) {
				seen.add(value);
				if (isToolish(value)) {
					absorbView(value, out);
					absorbArgs(value, out);
					absorbPair(value, out);
					absorbResultText(value, out);
				}
			}
			absorbTree(value.subCalls, out, seen);
			absorbTree(value.children, out, seen);
			absorbTree(value.nodes, out, seen);
			absorbTree(value.content, out, seen);
			if (first) absorbTree(value.arguments, out, seen);
		}
		function isToolish(rec) {
			if (rec.kind === "tool-result" || rec.kind === "tool-call") return true;
			if (typeof rec.name === "string" && WRITE_TOOL$1.test(rec.name)) return true;
			if (str(rec.file_path) !== void 0 && (rec.old_string !== void 0 || rec.new_string !== void 0 || rec.content !== void 0)) return true;
			return false;
		}
		function absorbPair(rec, out) {
			const path = str(rec.path) ?? str(rec.file_path);
			if (path === void 0) return false;
			const after = rec.after ?? rec.newText ?? rec.new_string ?? rec.content;
			if (typeof after !== "string") return false;
			const before = rec.before ?? rec.oldText ?? rec.old_string;
			if (before !== null && before !== void 0 && typeof before !== "string") return false;
			if (before === void 0 && rec.content === void 0 && rec.new_string === void 0 && rec.after === void 0) return false;
			const beforeText = typeof before === "string" ? before : "";
			noteHunk(path, beforeText, after, rec.old_string !== void 0 || rec.new_string !== void 0 ? "edit" : rec.content !== void 0 || beforeText.length === 0 ? "write" : "edit");
			mergeStat(out, path, lineStats(beforeText, after));
			return true;
		}
		function noteHunk(path, before, after, op) {
			collecting?.push({
				path,
				before,
				after,
				op
			});
		}
		function absorbArgs(rec, out) {
			const nested = isRecord(rec.call) ? rec.call : void 0;
			const raw = str(rec.argsRaw) ?? (nested === void 0 ? void 0 : str(nested.argsRaw));
			if (raw !== void 0) absorbJson(raw, out);
			if (isRecord(rec.arguments)) absorbPair(rec.arguments, out);
			if (nested !== void 0 && isRecord(nested.arguments)) absorbPair(nested.arguments, out);
		}
		function absorbResultText(rec, out) {
			let hit = false;
			if (typeof rec.text === "string") hit = absorbJson(rec.text, out) || hit;
			if (!Array.isArray(rec.content)) return hit;
			for (const block of rec.content) {
				if (!isRecord(block) || typeof block.text !== "string") continue;
				hit = absorbJson(block.text, out) || hit;
			}
			return hit;
		}
		function absorbJson(raw, out) {
			const trimmed = raw.trim();
			if (trimmed.length === 0 || trimmed[0] !== "{") return false;
			if (trimmed.indexOf("file_path") < 0 && trimmed.indexOf("\"path\"") < 0) return false;
			try {
				const parsed = JSON.parse(trimmed);
				return isRecord(parsed) && absorbPair(parsed, out);
			} catch {
				return false;
			}
		}
		function mergeStat(out, path, diff) {
			const prev = out[path];
			out[path] = prev === void 0 ? {
				added: diff.added,
				removed: diff.removed
			} : {
				added: prev.added + diff.added,
				removed: prev.removed + diff.removed
			};
		}
		function str(value) {
			return typeof value === "string" && value.length > 0 ? value : void 0;
		}
		function diffHunks(value) {
			if (!isRecord(value) || value.card !== "diff" || !Array.isArray(value.diffs) || value.diffs.length === 0) return;
			const out = [];
			for (const hunk of value.diffs) {
				if (!isRecord(hunk)) return void 0;
				const { path, oldText, newText } = hunk;
				if (typeof path !== "string" || path.length === 0) return void 0;
				if (oldText !== null && typeof oldText !== "string") return void 0;
				if (typeof newText !== "string") return void 0;
				out.push({
					path,
					oldText,
					newText
				});
			}
			return out;
		}
		//#endregion
		//#region src/turn-writes.ts
		function turnWritesFromSession(snapshot) {
			const fromHunks = latestTurnChanges(snapshot);
			if (fromHunks.length > 0) return fromHunks;
			const fromLog = turnWritesFromLog(logEventsFrom(snapshot));
			if (fromLog.length > 0) return fromLog;
			return turnWritesFromLog(conversationNodesToEvents(snapshot));
		}
		function latestTurnChanges(snapshot) {
			const nodes = nodesOf(snapshot);
			if (nodes.length === 0) return reviewChangesFromSnapshot(snapshot);
			let maxTurn = 1;
			for (const node of nodes) if (isRecord(node) && typeof node.turn === "number" && node.turn > maxTurn) maxTurn = node.turn;
			return reviewChangesFromSnapshot({
				nodes: nodes.filter((node) => !isRecord(node) || typeof node.turn !== "number" || node.turn === maxTurn),
				runningCalls: isRecord(snapshot) ? snapshot.runningCalls : []
			});
		}
		function turnWritesFromLog(events) {
			if (events.length === 0) return [];
			const turn = Math.max(...events.map((event) => event.turn));
			const byPath = /* @__PURE__ */ new Map();
			for (const event of events) {
				if (event.turn !== turn) continue;
				for (const path of event.writes ?? []) {
					const prev = byPath.get(path);
					const after = event.after ?? (event.role === "tool-result" && event.text.length > 0 ? event.text : prev?.after ?? "");
					const before = prev?.before ?? event.before ?? "";
					byPath.set(path, {
						path,
						before,
						after
					});
				}
			}
			return [...byPath.values()];
		}
		function logEventsFrom(snapshot) {
			if (Array.isArray(snapshot)) return flattenEvents(snapshot);
			if (!isRecord(snapshot)) return [];
			if (Array.isArray(snapshot.log)) return flattenEvents(snapshot.log);
			if (Array.isArray(snapshot.messages)) return messagesToEvents(snapshot.messages);
			if (isRecord(snapshot.session) && Array.isArray(snapshot.session.messages)) return messagesToEvents(snapshot.session.messages);
			return [];
		}
		function flattenEvents(raw) {
			const events = [];
			for (const item of raw) {
				const event = asLogEvent(item);
				if (event !== void 0) events.push(event);
			}
			return events;
		}
		function asLogEvent(item) {
			if (!isRecord(item)) return void 0;
			if (typeof item.seq !== "number" || typeof item.turn !== "number" || typeof item.role !== "string") return;
			if (item.role !== "user" && item.role !== "assistant" && item.role !== "tool-call" && item.role !== "tool-result") return;
			const writes = stringList(item.writes);
			return {
				seq: item.seq,
				turn: item.turn,
				role: item.role,
				text: typeof item.text === "string" ? item.text : "",
				...typeof item.closed === "boolean" ? { closed: item.closed } : {},
				...writes.length === 0 ? {} : { writes }
			};
		}
		function messagesToEvents(messages) {
			const events = [];
			let turn = 0;
			let seq = 0;
			for (const message of messages) {
				if (!isRecord(message)) continue;
				const role = messageRole(message.role);
				if (role === "user") turn += 1;
				const writes = writesOf(message);
				const text = textOf(message);
				const closed = message.closed === false ? false : true;
				seq += 1;
				events.push({
					seq,
					turn: turn === 0 ? 1 : turn,
					role,
					text,
					...role === "assistant" ? { closed } : {},
					...writes.length === 0 ? {} : { writes }
				});
			}
			return events;
		}
		function messageRole(role) {
			if (role === "assistant" || role === "tool-call" || role === "tool-result") return role;
			if (role === "tool") return "tool-result";
			return "user";
		}
		function writesOf(message) {
			const direct = stringList(message.writes);
			if (direct.length > 0) return direct;
			const content = message.content;
			if (!Array.isArray(content)) return typeof message.path === "string" && message.path.length > 0 ? [message.path] : [];
			const paths = [];
			for (const block of content) {
				if (!isRecord(block)) continue;
				for (const path of stringList(block.writes)) if (!paths.includes(path)) paths.push(path);
				if (typeof block.path === "string" && block.path.length > 0 && !paths.includes(block.path)) paths.push(block.path);
			}
			return paths;
		}
		function textOf(message) {
			if (typeof message.text === "string") return message.text;
			const content = message.content;
			if (typeof content === "string") return content;
			if (!Array.isArray(content)) return "";
			const parts = [];
			for (const block of content) {
				if (typeof block === "string") {
					parts.push(block);
					continue;
				}
				if (!isRecord(block)) continue;
				if (typeof block.text === "string") parts.push(block.text);
			}
			return parts.join("");
		}
		function stringList(value) {
			if (!Array.isArray(value)) return [];
			const out = [];
			for (const item of value) if (typeof item === "string" && item.length > 0) out.push(item);
			return out;
		}
		const WRITE_TOOL = /^(write|edit|str_replace|strreplace|search_replace|apply_patch|notebook)/i;
		function logEventsFromSession(snapshot) {
			const direct = logEventsFrom(snapshot);
			if (direct.length > 0) return direct;
			return conversationNodesToEvents(snapshot);
		}
		function conversationNodesToEvents(snapshot) {
			const nodes = nodesOf(snapshot);
			const events = [];
			let seq = 0;
			for (const node of nodes) {
				if (!isRecord(node) || typeof node.kind !== "string") continue;
				seq += 1;
				const turn = typeof node.turn === "number" ? node.turn : 1;
				if (node.kind === "user") {
					events.push({
						seq,
						turn,
						role: "user",
						text: nodeText(node)
					});
					continue;
				}
				if (node.kind === "assistant") {
					events.push({
						seq,
						turn,
						role: "assistant",
						text: nodeText(node),
						closed: node.interrupted === true ? false : true
					});
					continue;
				}
				if (node.kind === "tool-result" || node.kind === "tool-call") emitTool(node, turn, events, () => {
					seq += 1;
					return seq;
				});
			}
			return events;
		}
		function emitTool(node, turn, events, nextSeq) {
			const call = isRecord(node.call) ? node.call : node;
			const name = typeof call.name === "string" ? call.name : typeof node.name === "string" ? node.name : "";
			const argsRaw = typeof call.argsRaw === "string" ? call.argsRaw : typeof node.argsRaw === "string" ? node.argsRaw : "";
			const writes = WRITE_TOOL.test(name) ? pathsFromArgs(argsRaw) : [];
			const kind = node.kind === "tool-call" ? "tool-call" : "tool-result";
			if (writes.length > 0 || WRITE_TOOL.test(name)) events.push({
				seq: nextSeq(),
				turn,
				role: kind,
				text: nodeText(node) || `${name} ${argsRaw}`.trim(),
				...writes.length === 0 ? {} : { writes }
			});
			if (!Array.isArray(node.subCalls)) return;
			for (const child of node.subCalls) if (isRecord(child)) emitTool(child, turn, events, nextSeq);
		}
		function nodesOf(snapshot) {
			if (!isRecord(snapshot)) return [];
			if (Array.isArray(snapshot.nodes)) return snapshot.nodes;
			if (isRecord(snapshot.chat) && isRecord(snapshot.chat.legacy) && Array.isArray(snapshot.chat.legacy.nodes)) return snapshot.chat.legacy.nodes;
			return [];
		}
		function nodeText(node) {
			if (typeof node.text === "string") return node.text;
			const blocks = Array.isArray(node.blocks) ? node.blocks : Array.isArray(node.content) ? node.content : [];
			const parts = [];
			for (const block of blocks) {
				if (!isRecord(block)) continue;
				if (typeof block.text === "string") parts.push(block.text);
			}
			return parts.join("");
		}
		function pathsFromArgs(raw) {
			if (raw.length === 0) return [];
			try {
				const args = JSON.parse(raw);
				if (!isRecord(args)) return [];
				const paths = [];
				for (const key of [
					"file_path",
					"path",
					"target_file",
					"target"
				]) {
					const value = args[key];
					if (typeof value === "string" && value.length > 0) paths.push(value);
				}
				return paths;
			} catch {
				return [];
			}
		}
		//#endregion
		//#region src/browser.ts
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
		/** 主会话 path takeover: http(s), loopback, and `example.com` — never `README.md`. */
		function isTakeoverUrl(raw) {
			const trimmed = raw.trim();
			if (trimmed.length === 0) return false;
			if (/^https?:\/\//i.test(trimmed)) return true;
			if (/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed)) return true;
			if (/^\d{1,3}(\.\d{1,3}){3}(:|\/|$)/.test(trimmed)) return true;
			if (isWorkspacePath(trimmed)) return false;
			return /^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(trimmed);
		}
		const FILE_EXT$1 = /^(tsx?|jsx?|mjs|cjs|md|json|css|html?|vue|svelte|py|rs|go|toml|ya?ml|svg|png|jpe?g|gif|webp|txt|map|lock)$/i;
		function isWorkspacePath(raw) {
			if (raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("~")) return true;
			if (/^[A-Za-z]:[\\/]/.test(raw)) return true;
			const noQuery = raw.split(/[?#]/)[0] ?? raw;
			if (looksLikeHost((noQuery.split("/")[0] ?? "").split(":")[0] ?? "")) return false;
			if (noQuery.includes("/") || noQuery.includes("\\")) return true;
			const base = noQuery.split(/[\\/]/).pop() ?? noQuery;
			const ext = base.includes(".") ? base.split(".").pop() ?? "" : "";
			return ext.length > 0 && FILE_EXT$1.test(ext);
		}
		function looksLikeHost(part) {
			if (/^(localhost|127\.0\.0\.1)$/i.test(part)) return true;
			if (!/^[\w.-]+\.[a-z]{2,}$/i.test(part)) return false;
			const tld = part.split(".").pop() ?? "";
			return !FILE_EXT$1.test(tld);
		}
		//#endregion
		//#region src/transcript-takeover.ts
		/** Link takeover is for the 主会话 transcript, not 侧栏 chrome or other columns. */
		function allowTranscriptTakeover(closest) {
			if (closest(".dcs-root, .dcs-col, [data-shell-overlay]")) return false;
			if (closest("[data-side=\"details\"], [data-side=\"sidebar\"]")) return false;
			if (closest("[data-side=\"center\"]")) return true;
			if (closest("[data-side]")) return false;
			return true;
		}
		//#endregion
		//#region src/client/tool-stats.ts
		/** Paint +N −M after the filename on each 主会话 edit/write tool row. */
		const MARK$2 = "dcs-tool-stat";
		const rowHunks = /* @__PURE__ */ new WeakMap();
		/** Return the exact transcript hunk bound to one rendered host tool row. */
		function hunkForToolRow(row) {
			return rowHunks.get(row);
		}
		function decorate$2(stats, root = document) {
			const pending = queueRowStats(stats);
			const rows = root.querySelectorAll("[data-tool]");
			for (const row of rows) {
				if (!(row instanceof HTMLElement)) continue;
				if (row.querySelector("[data-tool]")) continue;
				const tool = row.getAttribute("data-tool") ?? "";
				if (!WRITE_TOOL$1.test(tool)) continue;
				const pathBtn = pathButton(row);
				const label = pathBtn === void 0 ? pathLabel(row) : pathText(pathBtn);
				const stat = label === void 0 ? void 0 : takeRowHunk(pending, label);
				if (stat?.before === void 0 || stat.after === void 0) rowHunks.delete(row);
				else rowHunks.set(row, {
					before: stat.before,
					after: stat.after
				});
				if (stat?.hunkId === void 0) delete row.dataset.dcsHunkId;
				else row.dataset.dcsHunkId = stat.hunkId;
				const existing = row.querySelector(".dcs-tool-stat");
				if (stat === void 0 || stat.added === 0 && stat.removed === 0) {
					existing?.remove();
					continue;
				}
				const add = "+" + String(stat.added);
				const del = "−" + String(stat.removed);
				const signature = add + del;
				if (existing instanceof HTMLElement) {
					if (existing.dataset.dcs === signature) continue;
					existing.dataset.dcs = signature;
					existing.replaceChildren(span("add", add), span("del", del));
					placeStat(existing, pathBtn, row);
					continue;
				}
				const badge = document.createElement("span");
				badge.className = MARK$2;
				badge.dataset.dcs = signature;
				badge.append(span("add", add), span("del", del));
				placeStat(badge, pathBtn, row);
			}
		}
		function placeStat(badge, pathBtn, row) {
			if (pathBtn !== void 0) {
				if (badge.parentElement !== pathBtn) pathBtn.append(badge);
				return;
			}
			if (badge.parentElement !== row) row.append(badge);
		}
		function pathButton(row) {
			for (const button of row.querySelectorAll("button")) {
				const text = pathText(button);
				if (text.length === 0) continue;
				if (text === "+" || text === "…" || text === "...") continue;
				if (/^(edit|write|inspect|查看)$/i.test(text)) continue;
				if (text.includes("/") || /\.\w+$/.test(text)) return button;
			}
		}
		function pathLabel(row) {
			const texts = [];
			for (const button of row.querySelectorAll("button")) {
				const text = pathText(button);
				if (text.length === 0) continue;
				if (text === "+" || text === "…" || text === "...") continue;
				if (/^(edit|write|inspect|查看)$/i.test(text)) continue;
				texts.push(text);
			}
			return texts.find((text) => text.includes("/") || /\.\w+$/.test(text)) ?? texts[0];
		}
		function pathText(el) {
			const mark = el.querySelector(".dcs-tool-stat");
			const full = el.textContent ?? "";
			if (!(mark instanceof HTMLElement)) return full.trim();
			return full.replace(mark.textContent ?? "", "").trim();
		}
		function span(cls, text) {
			const node = document.createElement("span");
			node.className = cls;
			node.textContent = text;
			return node;
		}
		//#endregion
		//#region src/details-occupancy.ts
		/** details slot occupancy: shadow the shipped DetailsPanel (priority 0). */
		const DETAILS_SLOT = "details";
		const DETAILS_PRIORITY = -100;
		/** Every service read through ClientContext must be injected; otherwise its proxy throws at runtime. */
		const CLIENT_INJECT = [
			"slots",
			"locale",
			"connection",
			"layout",
			"sessions",
			"workspaces"
		];
		/** AppFrame owns the details track (`details: 0` closed). CSS vars do not open it. */
		function detailsTrackShouldOpen(collapsed) {
			return collapsed === false;
		}
		function applyDetailsTrack(layout, collapsed) {
			if (detailsTrackShouldOpen(collapsed)) layout.openDetails();
			else layout.closeDetails();
		}
		function occupyDetails(slots, face, panel, locale) {
			slots.inject(DETAILS_SLOT, () => {
				slots.register({
					name: DETAILS_SLOT,
					locale,
					priority: DETAILS_PRIORITY,
					inject: face
				}, panel);
			});
		}
		const DRAWER_VW = .7;
		const DRAWER_STORAGE_KEY = "dsh-codex-sidebar.drawer-width";
		const listeners = /* @__PURE__ */ new Set();
		let published;
		function clampDrawerWidth(px, viewport) {
			const view = Math.max(0, Math.round(viewport));
			const cap = Math.min(960, Math.round(view * DRAWER_VW), view);
			return Math.min(cap, Math.max(Math.min(320, cap), Number.isFinite(px) ? Math.round(px) : 560));
		}
		function readDrawerWidth(store, viewport) {
			const raw = store?.getItem(DRAWER_STORAGE_KEY);
			const n = raw === void 0 || raw === null || raw === "" ? 560 : Number(raw);
			return clampDrawerWidth(Number.isFinite(n) ? n : 560, viewport);
		}
		function writeDrawerWidth(store, px, viewport) {
			const next = clampDrawerWidth(px, viewport);
			try {
				store?.setItem(DRAWER_STORAGE_KEY, String(next));
			} catch {}
			return next;
		}
		function browserDrawerStore() {
			try {
				if (typeof localStorage === "undefined") return void 0;
				return localStorage;
			} catch {
				return;
			}
		}
		function peekDrawerWidth(viewport) {
			if (published !== void 0) return clampDrawerWidth(published, viewport);
			return readDrawerWidth(browserDrawerStore(), viewport);
		}
		function publishDrawerWidth(px, viewport) {
			published = writeDrawerWidth(browserDrawerStore(), px, viewport);
			for (const listener of listeners) listener(published);
			return published;
		}
		function subscribeDrawerWidth(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		//#endregion
		//#region src/client/host-frame.ts
		/** Read/write AppFrame grid tracks so the 侧栏 can squeeze the center column. */
		function sidebarTrackFromGrid(gridTemplateColumns) {
			return gridTemplateColumns.trim().match(/^(\d+(?:\.\d+)?px)\b/)?.[1];
		}
		function detailsTrackPx(collapsed, width) {
			if (collapsed !== false) return "0px";
			return `${Math.max(0, Math.round(width))}px`;
		}
		/** Drop a leftover 侧栏 track when New Session has no 主会话. */
		function clearDetailsTrackStyle(frame) {
			frame.style.setProperty("--dcs-details-track", "0px");
			frame.removeAttribute("data-dcs-open");
			frame.removeAttribute("data-dcs-pin");
		}
		/** Stamp plugin-owned markers on the host frame so CSS never matches CSS-module hashes. */
		function markHostFrame(frame) {
			const details = frame.querySelector("[data-shell-overlay]")?.previousElementSibling;
			if (details instanceof HTMLElement) details.setAttribute("data-dcs-details", "");
			const center = details instanceof HTMLElement ? details.previousElementSibling : null;
			const header = center instanceof HTMLElement ? center.querySelector("header") : null;
			if (header instanceof HTMLElement) header.setAttribute("data-dcs-header", "");
		}
		/** Locate the details column via the plugin marker, then the overlay's previous sibling. */
		function detailsColumnOf(frame) {
			if (frame === null || frame === void 0) return void 0;
			const marked = frame.querySelector("[data-dcs-details]");
			if (marked instanceof HTMLElement) return marked;
			const sibling = frame.querySelector("[data-shell-overlay]")?.previousElementSibling;
			return sibling instanceof HTMLElement ? sibling : void 0;
		}
		/** Pin the details track immediately so ResizeObserver cannot restore a stale open width. */
		function pinHostDetailsTrack(collapsed) {
			if (typeof document === "undefined") return;
			const frame = document.querySelector("[data-shell-overlay]")?.parentElement;
			if (!(frame instanceof HTMLElement)) return;
			markHostFrame(frame);
			const details = detailsTrackPx(collapsed, peekDrawerWidth(frame.getBoundingClientRect().width || window.innerWidth));
			if (frame.style.getPropertyValue("--dcs-details-track") !== details) frame.style.setProperty("--dcs-details-track", details);
			if (frame.getAttribute("data-dcs-pin") !== "") frame.setAttribute("data-dcs-pin", "");
			if (collapsed === false) frame.setAttribute("data-dcs-open", "");
			else frame.removeAttribute("data-dcs-open");
		}
		//#endregion
		//#region src/client/controller.ts
		const REFRESH_RETRY_MS = [
			0,
			100,
			250,
			500,
			1e3,
			2e3,
			3e3,
			5e3
		];
		var SidebarController = class {
			#store = { bySession: {} };
			#listeners = /* @__PURE__ */ new Set();
			#effectPrompt = /* @__PURE__ */ new Set();
			#stagedKey = /* @__PURE__ */ new Map();
			#userWatch = /* @__PURE__ */ new Set();
			#turnWritesCache = /* @__PURE__ */ new Map();
			#ctx;
			#rpc;
			#layout;
			#chain = /* @__PURE__ */ new Map();
			#depth = /* @__PURE__ */ new Map();
			#pathTakeover = false;
			#pendingCollapsed = /* @__PURE__ */ new Map();
			/** This client's details-track chrome. Host `collapsed` is not applied here. */
			#chromeCollapsed = /* @__PURE__ */ new Map();
			#hostCollapsed = /* @__PURE__ */ new Map();
			#refreshEpoch = /* @__PURE__ */ new Map();
			#filePreview = /* @__PURE__ */ new Map();
			constructor(ctx) {
				this.#ctx = ctx;
				this.#rpc = ctx.get("connection").rpc;
				this.#layout = ctx.layout;
			}
			getSnapshot = () => this.#store;
			subscribe = (listener) => {
				this.#listeners.add(listener);
				return () => {
					this.#listeners.delete(listener);
				};
			};
			snap(sessionId) {
				return this.#store.bySession[sessionId];
			}
			async browserCapture(sessionId, tabId) {
				const gate = this.#gate(sessionId);
				if (gate === void 0) return void 0;
				const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_CAPTURE_ENDPOINT, {
					...gate,
					tabId
				});
				if (!result.ok || !captureReply(result.value)) return void 0;
				return result.value;
			}
			async browserStreamTicket(sessionId, tabId) {
				const gate = this.#gate(sessionId);
				if (gate === void 0) return void 0;
				const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_STREAM_TICKET_ENDPOINT, {
					...gate,
					tabId
				});
				if (!result.ok || result.value === void 0 || typeof result.value !== "object" || result.value === null) return void 0;
				const value = result.value;
				if (typeof value.path !== "string" || typeof value.expiresAt !== "number") return void 0;
				return {
					path: value.path,
					expiresAt: value.expiresAt
				};
			}
			async pullTerminal(sessionId, tabId, since) {
				const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_TERMINAL_PULL_ENDPOINT, {
					sessionId,
					tabId,
					since
				});
				if (!result.ok || result.value === void 0 || typeof result.value !== "object" || result.value === null) return;
				const rec = result.value;
				if (typeof rec.seq !== "number" || typeof rec.chunk !== "string") return void 0;
				return {
					seq: rec.seq,
					chunk: rec.chunk
				};
			}
			async refresh(sessionId, signal) {
				return this.#enqueue(sessionId, async () => {
					const epoch = this.#refreshEpoch.get(sessionId) ?? 0;
					if (this.snap(sessionId) === void 0 && signal?.aborted !== true) {
						const lightGate = this.#gate(sessionId);
						if (lightGate !== void 0) try {
							const light = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, {
								...lightGate,
								logs: {},
								light: true
							});
							if (light.ok && isRecord(light.value) && isRecord(light.value.snapshot)) {
								if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return void 0;
								const snapshot = light.value.snapshot;
								this.#hostCollapsed.set(sessionId, snapshot.collapsed);
								const applied = this.#put(snapshot);
								this.#syncLayout(applied);
								this.#watchUserTurns(sessionId);
								this.#syncStaged(applied);
							}
						} catch {}
					}
					for (const delay of REFRESH_RETRY_MS) {
						if (signal?.aborted === true) return void 0;
						if (delay > 0) {
							await new Promise((resolve) => {
								setTimeout(resolve, delay);
							});
							if (signal?.aborted === true) return void 0;
						}
						const gate = this.#gate(sessionId);
						if (gate === void 0) return void 0;
						try {
							const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_SNAPSHOT_ENDPOINT, {
								...gate,
								logs: {}
							});
							if (!result.ok || !isRecord(result.value) || !isRecord(result.value.snapshot)) continue;
							if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return void 0;
							const snapshot = result.value.snapshot;
							this.#hostCollapsed.set(sessionId, snapshot.collapsed);
							const applied = this.#put(snapshot);
							this.#syncLayout(applied);
							this.#watchUserTurns(sessionId);
							this.#syncStaged(applied);
							return applied;
						} catch {}
					}
					return this.snap(sessionId);
				});
			}
			async readFilePreview(sessionId, path) {
				const key = sessionId + "\0" + path;
				const hit = this.#filePreview.get(key);
				if (hit !== void 0) return hit;
				const gate = this.#gate(sessionId);
				if (gate === void 0) return void 0;
				const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_FILE_READ_ENDPOINT, {
					sessionId,
					cwd: gate.cwd,
					path
				});
				if (!result.ok || !isRecord(result.value) || typeof result.value.preview !== "string") return void 0;
				if (this.#filePreview.size >= 4) {
					const first = this.#filePreview.keys().next().value;
					if (first !== void 0) this.#filePreview.delete(first);
				}
				this.#filePreview.set(key, result.value.preview);
				return result.value.preview;
			}
			async dispatch(sessionId, intent, applyEffects = true) {
				const toggle = intent.type === "toggle-collapsed";
				const epoch = this.#refreshEpoch.get(sessionId) ?? 0;
				const work = async () => {
					const gate = this.#gate(sessionId, !toggle && applyEffects);
					if (gate === void 0) return void 0;
					const prepared = await this.#withBrowserEvidence(sessionId, intent, gate);
					if (prepared === void 0) return void 0;
					const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_DISPATCH_ENDPOINT, {
						...gate,
						intent: prepared
					});
					if (!result.ok) return void 0;
					const reply = result.value;
					if ((this.#refreshEpoch.get(sessionId) ?? 0) !== epoch) return void 0;
					if (toggle) this.#pendingCollapsed.delete(sessionId);
					else this.#writeChrome(sessionId, reply.snapshot.collapsed);
					this.#hostCollapsed.set(sessionId, reply.snapshot.collapsed);
					const applied = this.#put(reply.snapshot);
					this.#syncLayout(applied);
					this.#watchUserTurns(sessionId);
					if (applyEffects) try {
						await this.#applyEffects(sessionId, reply.effects);
					} catch (error) {
						const restore = reply.effects.flatMap((effect) => effect.type === "send" || effect.type === "queue" ? effect.attachments : []);
						if (restore.length > 0) await this.dispatch(sessionId, {
							type: "restore-attachments",
							attachments: restore
						}, false);
						throw error;
					}
					if (!(applyEffects && reply.effects.some((effect) => effect.type === "send" || effect.type === "queue"))) this.#syncStaged(applied);
					return applied;
				};
				return this.#enqueue(sessionId, work);
			}
			async #withBrowserEvidence(sessionId, intent, gate) {
				if (intent.type !== "browser-note-add" && intent.type !== "browser-note-send") return intent;
				const snapshot = this.snap(sessionId);
				const tabId = snapshot?.active;
				const browser = tabId === null || tabId === void 0 ? void 0 : snapshot?.browsers[tabId];
				if (browser === void 0) return void 0;
				let evidence = browser.pendingEvidence;
				if (evidence === null) {
					if (browser.pendingCaptureId === null) return void 0;
					const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_BROWSER_EVIDENCE_COMMIT_ENDPOINT, {
						...gate,
						captureId: browser.pendingCaptureId
					});
					if (!result.ok || !browserEvidence(result.value)) return void 0;
					evidence = result.value;
				}
				if (browser.pendingDocumentId !== null && evidence.documentId !== browser.pendingDocumentId) return void 0;
				return {
					...intent,
					evidence
				};
			}
			#enqueue(sessionId, work) {
				if ((this.#depth.get(sessionId) ?? 0) > 0) return work();
				const prev = this.#chain.get(sessionId) ?? Promise.resolve();
				const run = async () => {
					this.#depth.set(sessionId, 1);
					try {
						return await work();
					} finally {
						this.#depth.set(sessionId, 0);
					}
				};
				const next = prev.then(run, run);
				this.#chain.set(sessionId, next.then(() => void 0, () => void 0));
				return next;
			}
			installPathTakeover() {
				if (this.#pathTakeover) return;
				const workspaces = this.#ctx.workspaces;
				if (workspaces === void 0 || typeof workspaces.openPath !== "function") return;
				this.#pathTakeover = true;
				const original = workspaces.openPath.bind(workspaces);
				let lastTool;
				let lastHunkId;
				let lastRowHunk;
				if (typeof document !== "undefined") {
					const captureToolContext = (target) => {
						const raw = target;
						const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
						const host = node instanceof Element ? node.closest("[data-tool]") : null;
						lastTool = host instanceof Element ? host.getAttribute("data-tool") ?? void 0 : void 0;
						lastHunkId = host instanceof HTMLElement ? host.dataset.dcsHunkId : void 0;
						lastRowHunk = host instanceof HTMLElement ? hunkForToolRow(host) : void 0;
					};
					document.addEventListener("pointerdown", (event) => {
						captureToolContext(event.target);
					}, true);
					document.addEventListener("click", (event) => {
						captureToolContext(event.target);
					}, true);
				}
				workspaces.openPath = async (path) => {
					const sessionId = this.#ctx.sessions.list.getSnapshot().current;
					if (sessionId === void 0) {
						await original(path);
						return;
					}
					if (isTakeoverUrl(path)) {
						await this.dispatch(String(sessionId), {
							type: "open-url",
							url: normalizeUrl(path)
						});
						return;
					}
					const cwd = this.#ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd ?? "";
					const view = viewForTool(lastTool);
					const binding = this.#ctx.sessions.binding(sessionId);
					const hunk = lastRowHunk ?? (binding === void 0 ? void 0 : hunkForOpen(binding.session.getSnapshot(), path, lastTool, lastHunkId));
					lastTool = void 0;
					lastHunkId = void 0;
					lastRowHunk = void 0;
					await this.dispatch(String(sessionId), {
						type: "open-path",
						path: relativize(path, cwd),
						view,
						...hunk === void 0 ? {} : {
							before: hunk.before,
							after: hunk.after
						}
					});
				};
				this.#installUrlClicks();
			}
			#installUrlClicks() {
				if (typeof document === "undefined") return;
				document.addEventListener("click", (event) => {
					if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					const raw = event.target;
					const node = raw instanceof Element ? raw : raw instanceof Node ? raw.parentElement : null;
					if (!(node instanceof Element)) return;
					const anchor = node.closest("a");
					if (anchor === null) return;
					if (!allowTranscriptTakeover((selector) => anchor.closest(selector))) return;
					const href = (anchor.getAttribute("href") ?? "").trim();
					if (!isTakeoverUrl(href)) return;
					event.preventDefault();
					event.stopPropagation();
					const sessionId = this.#ctx.sessions.list.getSnapshot().current;
					if (sessionId === void 0) return;
					this.dispatch(String(sessionId), {
						type: "open-url",
						url: normalizeUrl(href)
					});
				}, true);
			}
			#gate(sessionId, includeLogs = false) {
				const list = this.#ctx.sessions.list.getSnapshot();
				const summary = list.byId[sessionId];
				const sessionState = this.#ctx.sessions.binding(sessionId)?.session.getSnapshot();
				const busy = sessionState?.running === true;
				const roster = rosterFromList(list, archivedIds(this.#ctx));
				const logs = includeLogs ? logsFromList(this.#ctx, list.ids) : {};
				const cached = this.#turnWritesCache.get(sessionId);
				const turnWrites = cached?.source === sessionState ? cached.turnWrites : turnWritesFromSession(sessionState);
				if (sessionState !== cached?.source) this.#turnWritesCache.set(sessionId, {
					source: sessionState,
					turnWrites
				});
				return {
					sessionId,
					cwd: summary?.cwd ?? "",
					busy,
					turnWrites,
					roster,
					logs
				};
			}
			#put(snapshot) {
				const pending = this.#pendingCollapsed.get(snapshot.sessionId);
				const chrome = this.#chromeCollapsed.get(snapshot.sessionId);
				const next = {
					...snapshot,
					collapsed: pending ?? chrome ?? true
				};
				this.#store = { bySession: {
					...this.#store.bySession,
					[next.sessionId]: next
				} };
				for (const listener of this.#listeners) listener();
				return next;
			}
			/**
			* AppFrame columns are pinned by the overlay ColumnPin. Do not closeDetails
			* while the 侧栏 is open — that would collapse the third track.
			*/
			hideHostDetails = () => {
				this.#applyTrack(true);
			};
			/** Open this client's details track. Other surfaces keep their own chrome. */
			reveal(sessionId) {
				const snapshot = this.snap(sessionId);
				if (snapshot?.collapsed === false) {
					this.#applyTrack(false);
					return;
				}
				this.#writeChrome(sessionId, false);
				this.#noteCollapsed(sessionId, false);
				this.#applyTrack(false);
				if (snapshot !== void 0) this.#put({
					...snapshot,
					collapsed: false
				});
				if (this.#hostCollapsed.get(sessionId) !== false) this.dispatch(sessionId, { type: "toggle-collapsed" });
			}
			/** Close this client's details track without collapsing other surfaces. */
			hide(sessionId) {
				const snapshot = this.snap(sessionId);
				if (snapshot === void 0 || snapshot.collapsed !== false) {
					this.#applyTrack(true);
					return;
				}
				this.#writeChrome(sessionId, true);
				this.#noteCollapsed(sessionId, true);
				this.#applyTrack(true);
				this.#put({
					...snapshot,
					collapsed: true
				});
			}
			syncTrack(collapsed) {
				this.#applyTrack(collapsed === false ? false : true);
			}
			#writeChrome(sessionId, collapsed) {
				this.#chromeCollapsed.set(sessionId, collapsed);
			}
			#noteCollapsed(sessionId, collapsed) {
				this.#pendingCollapsed.set(sessionId, collapsed);
				if (this.snap(sessionId) !== void 0) this.#refreshEpoch.set(sessionId, (this.#refreshEpoch.get(sessionId) ?? 0) + 1);
			}
			#layoutFace() {
				return this.#ctx.layout ?? this.#layout;
			}
			#applyTrack(collapsed) {
				try {
					applyDetailsTrack(this.#layoutFace(), collapsed);
				} catch {}
				pinHostDetailsTrack(collapsed);
			}
			#syncLayout(snapshot) {
				this.#applyTrack(snapshot.collapsed);
			}
			async #stageAnnotations(sessionId, attachments) {
				if (attachments.length === 0) return;
				const result = await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_STAGE_ANNOTATIONS_ENDPOINT, {
					sessionId,
					attachments
				});
				if (!result.ok) throw new Error(result.error?.message ?? "Cannot stage 批注");
			}
			async #unstageAnnotations(sessionId) {
				try {
					await this.#rpc.call(SIDEBAR_RPC_CHANNEL, SIDEBAR_UNSTAGE_ANNOTATIONS_ENDPOINT, { sessionId });
				} catch {}
			}
			async #applyEffects(sessionId, effects) {
				for (const effect of effects) {
					if (effect.type === "deliver") {
						const target = this.#ctx.sessions.binding(effect.to);
						if (target === void 0) continue;
						const text = formatDelivery(effect.text, effect.sourceTab, effect.sourceSession);
						await target.session.prompt([{
							type: "text",
							text
						}], "queue");
						continue;
					}
					if (effect.type === "side-ask") continue;
					const binding = this.#ctx.sessions.binding(sessionId);
					if (binding === void 0) continue;
					const text = effect.text;
					if (text.length === 0) continue;
					await this.#stageAnnotations(sessionId, effect.attachments);
					this.#effectPrompt.add(sessionId);
					try {
						await binding.session.prompt([{
							type: "text",
							text
						}], "queue");
					} catch (error) {
						await this.#unstageAnnotations(sessionId);
						throw error;
					} finally {
						this.#effectPrompt.delete(sessionId);
					}
				}
				const leftover = this.snap(sessionId);
				if (leftover !== void 0) this.#syncStaged(leftover);
			}
			async #syncStaged(snapshot) {
				const key = snapshot.attachments.map((item) => item.id).join(",");
				if (this.#stagedKey.get(snapshot.sessionId) === key) return;
				this.#stagedKey.set(snapshot.sessionId, key);
				try {
					if (snapshot.attachments.length === 0) {
						await this.#unstageAnnotations(snapshot.sessionId);
						return;
					}
					await this.#stageAnnotations(snapshot.sessionId, snapshot.attachments);
				} catch {
					this.#stagedKey.delete(snapshot.sessionId);
				}
			}
			#watchUserTurns(sessionId) {
				if (this.#userWatch.has(sessionId)) return;
				const session = this.#ctx.sessions.binding(sessionId)?.session;
				if (session === void 0 || typeof session.subscribe !== "function" || typeof session.getSnapshot !== "function") return;
				this.#userWatch.add(sessionId);
				let last = userTurnCount(session.getSnapshot());
				session.subscribe(() => {
					if (this.#effectPrompt.has(sessionId)) {
						last = userTurnCount(session.getSnapshot());
						return;
					}
					const next = userTurnCount(session.getSnapshot());
					if (next > last && (this.snap(sessionId)?.attachments.length ?? 0) > 0) this.dispatch(sessionId, {
						type: "composer-send",
						text: ""
					}, false);
					last = next;
				});
			}
		};
		function userTurnCount(snapshot) {
			if (!isRecord(snapshot)) return 0;
			if (Array.isArray(snapshot.messages)) return snapshot.messages.filter((item) => isRecord(item) && (item.role === "user" || item.kind === "user")).length;
			const chat = isRecord(snapshot.chat) ? snapshot.chat : snapshot;
			const legacy = isRecord(chat.legacy) ? chat.legacy : chat;
			const nodes = isRecord(legacy) ? legacy.nodes : void 0;
			if (nodes instanceof Map) {
				let count = 0;
				for (const node of nodes.values()) if (isRecord(node) && (node.role === "user" || node.kind === "user")) count += 1;
				return count;
			}
			if (Array.isArray(nodes)) return nodes.filter((item) => isRecord(item) && (item.role === "user" || item.kind === "user")).length;
			return 0;
		}
		function captureReply(value) {
			return isRecord(value) && typeof value.captureId === "string" && typeof value.documentId === "string" && typeof value.url === "string" && typeof value.title === "string" && typeof value.width === "number" && typeof value.height === "number" && Array.isArray(value.nodes);
		}
		function browserEvidence(value) {
			return isRecord(value) && typeof value.id === "string" && typeof value.captureId === "string" && typeof value.documentId === "string" && typeof value.ref === "string" && value.mediaType === "image/jpeg" && typeof value.width === "number" && typeof value.height === "number";
		}
		function relativize(path, cwd) {
			if (cwd.length === 0) return path;
			const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
			if (path.startsWith(prefix)) return path.slice(prefix.length);
			if (path === cwd) return "";
			return path;
		}
		function archivedIds(ctx) {
			const snap = ctx.workspaces.list.getSnapshot();
			return new Set(snap.archivedSessionIds ?? []);
		}
		function rosterFromList(list, archived) {
			return list.ids.map((id) => {
				const row = list.byId[id];
				const kind = row?.origin === "subagent" || row?.parentId !== void 0 ? "subagent" : "main";
				return {
					id,
					title: row?.displayTitle ?? row?.title ?? id,
					cwd: row?.cwd ?? "",
					kind,
					archived: archived.has(id),
					busy: row?.running === true
				};
			});
		}
		function logsFromList(ctx, ids) {
			const logs = {};
			for (const id of ids) {
				const binding = ctx.sessions.binding(id);
				if (binding === void 0) continue;
				logs[id] = logEventsFromSession(binding.session.getSnapshot());
			}
			return logs;
		}
		//#endregion
		//#region src/client/css.ts
		/** Host-theme chrome. Prototype IA; DSH tokens instead of a light Codex island. */
		const SIDEBAR_CSS = `
@font-face {
  font-family: 'DCS Terminal Graphics';
  src: local('Noto Sans Mono'), local('DejaVu Sans Mono');
  font-style: normal;
  font-weight: 400;
  unicode-range: U+2500-259F, U+1FB00-1FBFF;
}
:root {
  --dcs-toggle-size: 32px;
  --dcs-toggle-pad: 8px;
  --dcs-tabbar-height: calc(var(--dcs-toggle-size) + var(--dcs-toggle-pad) * 2);
}
.dcs-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dcs-occupant-error {
  gap: 12px;
  padding: 16px;
  justify-content: center;
}
.dcs-occupant-error p {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
}
.dcs-occupant-error pre {
  margin: 0;
  max-height: 40%;
  overflow: auto;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.dcs-occupant-error button {
  align-self: flex-start;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dcs-col {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}
/* Keep the React tree warm across a manual hide/show. The Host layout track
   is already closed, so this only prevents a full Files/Browser/Terminal
   remount on the next reveal. */
.dcs-col[data-collapsed] {
  visibility: hidden;
  pointer-events: none;
}
.dcs-col > .dcs-root {
  flex: 1;
  min-height: 0;
  height: auto;
}
.dcs-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none !important;
  z-index: 4;
}
.dcs-overlay > .dcs-toggle {
  position: absolute;
  top: var(--dcs-toggle-pad);
  right: var(--dcs-toggle-pad);
  z-index: 6;
  pointer-events: auto;
}
body:has(.dcs-col-handle[data-dragging]) { user-select: none; cursor: col-resize; }
.dcs-col-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 5;
  width: 8px;
  margin-left: -4px;
  cursor: col-resize;
  touch-action: none;
  pointer-events: auto;
}
.dcs-col-handle::after {
  content: '';
  box-sizing: border-box;
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 32px;
  border-radius: 10px;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2-darkmode-thin);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity var(--ds-transition-duration-slow, 0.2s) var(--ds-ease-in-out, ease),
    background var(--ds-transition-duration-slow, 0.2s) var(--ds-ease-in-out, ease);
}
[data-dcs-details]:hover ~ [data-shell-overlay] .dcs-col-handle::after,
.dcs-col-handle:hover::after,
.dcs-col-handle[data-dragging]::after { opacity: 1; }
.dcs-col-handle:hover::after,
.dcs-col-handle[data-dragging]::after {
  background: var(--dsw-alias-button-floating-hover);
  border-color: var(--dsw-alias-border-l3);
}
.dcs-tabbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 calc(var(--dcs-toggle-size) + var(--dcs-toggle-pad)) 0 8px;
  box-sizing: border-box;
  height: var(--dcs-tabbar-height);
  min-height: var(--dcs-tabbar-height);
  flex-shrink: 0;
  overflow: visible;
  position: relative;
  z-index: 5;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.dcs-tab-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 0;
  box-sizing: content-box;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dcs-tab-scroll::-webkit-scrollbar {
  display: none;
  height: 0;
  width: 0;
}
.dcs-tab-scroll::-webkit-scrollbar:vertical {
  display: none;
  width: 0;
}
.dcs-tab-scroll::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
.dcs-root button.dcs-tab,
button.dcs-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  min-height: 28px;
  max-height: 28px;
  margin: 0;
  padding: 0 8px;
  border-radius: 7px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1;
  max-width: 148px;
  flex-shrink: 0;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  overflow: visible;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
}
.dcs-tab-scroll[data-reordering],
.dcs-tab-scroll[data-reordering] button.dcs-tab,
button.dcs-tab[data-drag] { cursor: grabbing; }
button.dcs-tab[data-drag] { opacity: 0.45; }
.dcs-tab .dcs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-tab .dcs-x { opacity: 0; color: var(--dsw-alias-label-tertiary); display: grid; place-items: center; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; }
button.dcs-tab:hover, button.dcs-tab[data-on] { color: var(--dsw-alias-label-primary); }
button.dcs-tab:hover:not([data-on]) { background: var(--dsw-alias-interactive-bg-hover); }
button.dcs-tab[data-on] {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
  box-shadow: none;
}
button.dcs-tab:hover .dcs-x, button.dcs-tab[data-on] .dcs-x { opacity: 1; }
.dcs-add {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: auto;
}
.dcs-root button.dcs-plus,
button.dcs-plus {
  width: var(--dcs-toggle-size); height: var(--dcs-toggle-size); min-height: var(--dcs-toggle-size); margin: 0; padding: 0; border: 0; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; display: grid; place-items: center; border-radius: 8px;
  flex-shrink: 0; appearance: none; -webkit-appearance: none; box-sizing: border-box;
}
button.dcs-plus:hover, button.dcs-plus[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dcs-add-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 248px;
  padding: 6px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv2);
  z-index: 8;
}
.dcs-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}
.dcs-add-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-add-row svg { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dcs-add-row .dcs-label { flex: 1; font-size: 13.5px; font-weight: 500; letter-spacing: -0.015em; }
.dcs-add-row .dcs-sc { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-weight: 500; white-space: nowrap; }
.dcs-body { flex: 1; overflow: auto; min-height: 0; position: relative; }
.dcs-body[data-center] { display: flex; align-items: center; justify-content: center; }
.dcs-body[data-fill] { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.dcs-palette { width: 300px; display: flex; flex-direction: column; gap: 1px; }
.dcs-pal-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px; border-radius: 10px; cursor: pointer;
  color: var(--dsw-alias-label-primary); border: 0; background: transparent; text-align: left; width: 100%;
}
.dcs-pal-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-pal-row svg { color: var(--dsw-alias-label-secondary); flex-shrink: 0; }
.dcs-pal-row .dcs-label { flex: 1; font-size: 14.5px; font-weight: 500; letter-spacing: -0.015em; }
.dcs-pal-row .dcs-sc {
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  padding: 3px 9px; border-radius: 999px; font-weight: 500;
}
.dcs-files { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; width: 100%; height: 100%; position: relative; overflow: hidden; }
.dcs-files-split { display: flex; flex: 1; min-height: 0; min-width: 0; overflow: hidden; }
.dcs-preview { flex: 1; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); }
.dcs-preview[data-split] { border-right: 1px solid var(--dsw-alias-border-l2); }
.dcs-fh {
  height: 36px; display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 0 14px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box;
  font-size: 12.5px; color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1); flex-shrink: 0;
}
.dcs-crumbs {
  flex: 1; min-width: 0; display: flex; align-items: center;
  overflow: hidden; white-space: nowrap;
}
.dcs-crumb-wrap { display: inline-flex; align-items: center; min-width: 0; }
.dcs-crumb, .dcs-crumb-file {
  border: 0; background: transparent; padding: 0; cursor: pointer;
  font: inherit; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-crumb { color: var(--dsw-alias-label-tertiary); }
.dcs-crumb:hover { color: var(--dsw-alias-label-primary); }
.dcs-crumb-file { color: var(--dsw-alias-label-primary); font-weight: 500; flex-shrink: 0; max-width: none; }
.dcs-crumb-sep { margin: 0 5px; color: var(--dsw-alias-label-tertiary); }
.dcs-fh-search {
  width: 160px; height: 26px; padding: 0 8px; border-radius: 6px; flex-shrink: 0;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); outline: none; font-size: 12.5px;
}
.dcs-fh-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; margin-left: auto; padding-right: 2px; }
.dcs-fh-menu { position: relative; }
.dcs-fh-pop {
  position: absolute; top: 30px; right: 0; z-index: 8; min-width: 132px; padding: 4px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px; box-shadow: var(--dsw-shadow-lv2);
}
.dcs-fh-pop button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  padding: 8px 10px; border-radius: 7px; font-size: 13px; cursor: pointer;
  color: var(--dsw-alias-label-primary);
}
.dcs-fh-pop button[data-on] { background: var(--dsw-alias-bg-layer-2); }
.dcs-tool {
  width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary);
  display: grid; place-items: center; flex-shrink: 0; overflow: visible; box-sizing: border-box;
}
.dcs-tool svg { display: block; overflow: visible; width: 14px; height: 14px; }
.dcs-tool:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-tool[data-on] { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
.dcs-fh-actions .dcs-tool[data-on] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dcs-code {
  position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; font-family: var(--ds-font-family-code);
  font-size: 12.5px; line-height: 1.6; padding: 8px 12px 12px;
}
.dcs-tok-kw { color: #7c3aed; }
.dcs-tok-str { color: #0f766e; }
.dcs-tok-com { color: var(--dsw-alias-label-tertiary); font-style: italic; }
.dcs-tok-num { color: #c2410c; }
.dcs-tok-punc { color: #64748b; }
[data-theme='dark'] .dcs-tok-kw, .dcs-root:not([data-theme]) .dcs-tok-kw { color: #c4b5fd; }
[data-theme='dark'] .dcs-tok-str { color: #5eead4; }
[data-theme='dark'] .dcs-tok-num { color: #fdba74; }
[data-theme='dark'] .dcs-tok-punc { color: #94a3b8; }
.dcs-fseg {
  display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  flex-shrink: 0; align-items: stretch; margin-right: 6px; padding: 2px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2); box-sizing: border-box;
}
.dcs-fseg button {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  min-width: 0; border: 0; background: transparent; padding: 4px 10px; border-radius: 6px;
  font-size: 11px; line-height: 16px; cursor: pointer; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; box-sizing: border-box;
}
.dcs-fseg button:hover:not([data-on]) { color: var(--dsw-alias-label-primary); }
.dcs-fseg button[data-on] {
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 500;
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2);
}
.dcs-fseg .dcs-addn { color: #16a34a; }
.dcs-fseg .dcs-deln { color: #dc2626; }
.dcs-path-link {
  cursor: pointer; color: var(--dsw-alias-color-accent, var(--dsw-alias-label-primary));
  text-decoration: underline; text-underline-offset: 2px; text-decoration-thickness: 1px;
}
.dcs-path-link:hover { opacity: 0.82; }
.dcs-code { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.dcs-fd {
  flex: 1; min-width: 0; min-height: 0; width: 100%; overflow: auto; box-sizing: border-box;
  font-family: var(--ds-font-family-code); font-size: 12.5px; line-height: 1.55;
  padding: 8px 10px 16px;
}
.dcs-fd-hunk {
  padding: 5px 10px; color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2); font-size: 11px; border-radius: 6px 6px 0 0;
}
.dcs-fd-line {
  display: grid; grid-template-columns: 2.6em 1em minmax(0, 1fr);
  align-items: start; min-width: 0; line-height: 1.55;
}
.dcs-fd-line[data-kind="add"] { background: color-mix(in srgb, #16a34a 14%, transparent); }
.dcs-fd-line[data-kind="del"] { background: color-mix(in srgb, #dc2626 14%, transparent); }
.dcs-fd-line[data-annotated] { box-shadow: inset 3px 0 #38bdf8; }
.dcs-fd-line[data-selected] { background: color-mix(in srgb, #38bdf8 16%, transparent); }
.dcs-fd-ln {
  display: flex; align-items: center; justify-content: flex-end; gap: 2px;
  text-align: right; padding: 0 6px 0 0; color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums; user-select: none; line-height: inherit;
}
.dcs-fd-ln[data-kind="del"] { color: #dc2626; }
.dcs-fd-ln[data-kind="add"] { color: #16a34a; }
.dcs-fd-sign { color: var(--dsw-alias-label-tertiary); line-height: inherit; }
.dcs-fd-sign[data-kind="add"] { color: #16a34a; }
.dcs-fd-sign[data-kind="del"] { color: #dc2626; }
.dcs-fd-code {
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  min-width: 0; padding-right: 12px; color: var(--dsw-alias-label-primary);
  line-height: inherit;
}
.dcs-code[data-media] { padding: 0; }
.dcs-media-surface {
  position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto;
  display: flex; align-items: center; justify-content: center;
}
.dcs-md {
  position: relative; flex: 1; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 18px 20px 36px; font-size: 13.5px; line-height: 1.6;
  font-family: var(--dsw-font-family, inherit);
  color: var(--dsw-alias-label-primary);
}
.dcs-md h1, .dcs-md h2, .dcs-md h3 { font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; }
.dcs-md h1 { margin: 0 0 16px; font-size: 22px; }
.dcs-md h2 { margin: 24px 0 12px; font-size: 18px; }
.dcs-md h3 { margin: 20px 0 10px; font-size: 15px; }
.dcs-md p { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); }
.dcs-md ul, .dcs-md ol { margin: 0 0 14px; padding-left: 24px; color: var(--dsw-alias-label-secondary); }
.dcs-md li { margin: 3px 0; }
.dcs-md blockquote { margin: 0 0 14px; padding: 7px 12px; border-left: 3px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); }
.dcs-md hr { margin: 20px 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.dcs-md a { color: var(--dsw-alias-state-business-primary); text-decoration: none; }
.dcs-md a:hover { text-decoration: underline; }
.dcs-md-code { padding: 1px 5px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code); font-size: 0.92em; overflow-wrap: anywhere; }
.dcs-md-pre { margin: 0 0 14px; padding: 12px 14px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-family: var(--ds-font-family-code); font-size: 12.5px; line-height: 1.55; }
.dcs-md-table-wrap { margin: 8px 0 18px; overflow-x: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dcs-md table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 1.45; }
.dcs-md th, .dcs-md td { max-width: 420px; padding: 8px 10px; text-align: left; vertical-align: top; border-right: 1px solid var(--dsw-alias-border-l2); border-bottom: 1px solid var(--dsw-alias-border-l2); overflow-wrap: anywhere; }
.dcs-md th { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dcs-md td { color: var(--dsw-alias-label-secondary); }
.dcs-md th:last-child, .dcs-md td:last-child { border-right: 0; }
.dcs-md tbody tr:last-child td { border-bottom: 0; }
.dcs-code[data-mark] { cursor: crosshair; }
.dcs-code[data-annotated] { box-shadow: inset 3px 0 #38bdf8; }
.dcs-code[data-selected] { box-shadow: inset 3px 0 #38bdf8; }
.dcs-line { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; }
.dcs-line[data-annotated] { background: color-mix(in srgb, #38bdf8 10%, transparent); }
.dcs-line[data-selected] { background: color-mix(in srgb, #38bdf8 16%, transparent); }
.dcs-line .dcs-n {
  min-width: 40px; display: flex; align-items: center; justify-content: flex-end; gap: 2px;
  text-align: right; padding-right: 12px; color: var(--dsw-alias-label-tertiary); user-select: none;
}
.dcs-line-badge {
  flex: none; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 1;
}
::highlight(dcs-file-selection) {
  background: #f15b4a; color: #fff;
}
.dcs-file-surface-badges {
  position: absolute; inset: 0; z-index: 4; pointer-events: none;
}
.dcs-file-anchor-outline {
  position: absolute; box-sizing: border-box; pointer-events: none;
  border: 2px solid #38bdf8; border-radius: 3px;
  background: color-mix(in srgb, #38bdf8 10%, transparent);
}
.dcs-file-anchor-outline[data-pending] {
  border-style: dashed; background: color-mix(in srgb, #38bdf8 16%, transparent);
}
.dcs-file-anchor-badge {
  position: absolute; z-index: 1; pointer-events: auto;
  transform: translate(-50%, -100%); margin-top: -3px;
}
.dcs-line .dcs-t { color: var(--dsw-alias-label-primary); white-space: pre; padding-right: 16px; }
.dcs-missing {
  padding: 24px 18px;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 13px;
}
.dcs-files-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  background: var(--dsw-alias-bg-base);
}
.dcs-tree {
  position: relative; flex: 0 0 auto; min-width: 160px; max-width: 42%;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l2);
  overflow: hidden;
}
.dcs-tree-handle {
  position: relative; z-index: 4; flex: 0 0 16px; width: 16px; margin: 0 -8px;
  cursor: col-resize; touch-action: none; align-self: stretch;
}
.dcs-tree-handle::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: 4px; height: 48px; border-radius: 999px;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2);
  opacity: 0; transform: translate(-50%, -50%);
}
.dcs-files-split:hover .dcs-tree-handle::after,
.dcs-tree-handle:hover::after,
.dcs-tree-handle[data-dragging]::after { opacity: 1; }
.dcs-tool-stat {
  margin-left: 8px; font-size: 12px; font-variant-numeric: tabular-nums;
  white-space: nowrap; pointer-events: none; font-weight: 500;
}
.dcs-tool-stat .add { color: #16a34a; }
.dcs-tool-stat .del { color: #dc2626; margin-left: 4px; }
.dcs-tree-head {
  height: 36px; display: flex; align-items: center; gap: 0;
  padding: 0 6px 0 14px; flex-shrink: 0;
}
.dcs-tree-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary);
}
.dcs-tree-head .dcs-tool { color: var(--dsw-alias-label-tertiary); }
.dcs-tree-body { flex: 1; overflow: auto; padding: 2px 8px 12px; }
.dcs-tree-row {
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding-right: 8px; border-radius: 6px;
  border: 0; background: transparent; width: 100%; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 400; line-height: 28px;
}
.dcs-tree-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-tree-row[data-on] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dcs-tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-caret {
  width: 16px; height: 16px; flex-shrink: 0; display: grid; place-items: center;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-caret::before {
  content: ''; width: 0; height: 0;
  border-style: solid; border-width: 3.5px 0 3.5px 5.5px;
  border-color: transparent transparent transparent currentColor;
}
.dcs-caret[data-open] { transform: rotate(90deg); }
.dcs-fglyph { width: 16px; height: 16px; flex-shrink: 0; display: block; opacity: 0.72; }
.dcs-term-wrap { flex: 1; min-height: 0; min-width: 0; display: flex; }
.dcs-term-rail {
  width: 168px; flex-shrink: 0; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.dcs-term-rail[data-collapsed] {
  width: 36px; align-items: center; padding-top: 6px;
}
.dcs-term-rail-head {
  height: 36px; flex-shrink: 0; display: flex; align-items: center; gap: 2px;
  padding: 0 6px 0 12px;
}
.dcs-term-rail-count {
  flex: 1; min-width: 0; font-size: 12px; font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dcs-term-rail-icon {
  width: 26px; height: 26px; flex-shrink: 0; padding: 0; border: 0;
  border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary);
  display: grid; place-items: center; cursor: pointer;
}
.dcs-term-rail-icon:hover {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dcs-term-rail-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0 8px; }
.dcs-term-session {
  width: calc(100% - 16px); margin: 1px 8px; padding: 6px 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-primary); display: flex; align-items: center; gap: 8px;
  text-align: left; cursor: pointer; font: inherit; font-size: 13px;
}
.dcs-term-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-term-session[data-on] { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-bg-layer-2)); }
.dcs-term-session-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-term-session-x {
  opacity: 0;
  flex-shrink: 0;
  width: 18px; height: 18px; margin-left: auto;
  display: grid; place-items: center;
  border: 0; border-radius: 4px; background: transparent;
  color: var(--dsw-alias-label-tertiary); cursor: pointer; padding: 0;
}
.dcs-term-session:hover .dcs-term-session-x,
.dcs-term-session:focus-within .dcs-term-session-x { opacity: 1; }
.dcs-term-session-x:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-term {
  flex: 1; min-height: 0; overflow: hidden; padding: 8px 10px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code); font-size: 13px;
  cursor: text;
  --dcs-term-bg: var(--dsw-alias-bg-base);
  --dcs-term-fg: var(--dsw-alias-label-primary);
  --dcs-term-cursor: var(--dsw-alias-label-primary);
  --dcs-term-cursor-accent: var(--dsw-alias-bg-base);
  --dcs-term-selection: var(--dsw-alias-bg-layer-2);
  --dcs-term-black: var(--dsw-alias-label-primary);
  --dcs-term-red: var(--dsw-alias-state-error-primary);
  --dcs-term-green: var(--dsw-alias-state-success-primary);
  --dcs-term-yellow: var(--dsw-alias-state-warn-primary);
  --dcs-term-blue: var(--dsw-alias-state-business-primary);
  --dcs-term-magenta: color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, var(--dsw-alias-state-error-primary));
  --dcs-term-cyan: color-mix(in srgb, var(--dsw-alias-state-business-primary) 50%, var(--dsw-alias-state-success-primary));
  --dcs-term-white: var(--dsw-alias-label-secondary);
  --dcs-term-bright-black: var(--dsw-alias-label-tertiary);
  --dcs-term-bright-red: var(--dsw-alias-state-error-secondary);
  --dcs-term-bright-green: var(--dsw-alias-state-success-secondary);
  --dcs-term-bright-yellow: var(--dsw-alias-state-warn-label);
  --dcs-term-bright-blue: var(--dsw-alias-state-business-primary);
  --dcs-term-bright-magenta: color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, var(--dsw-alias-state-error-secondary));
  --dcs-term-bright-cyan: color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, var(--dsw-alias-state-success-secondary));
  --dcs-term-bright-white: var(--dsw-alias-label-primary);
}
.dcs-term, .dcs-term .xterm, .dcs-term .xterm-char-measure-element {
  line-height: 1;
  letter-spacing: 0;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0;
}
.dcs-term .xterm { width: 100%; height: 100%; }
.dcs-term .xterm-viewport { background-color: var(--dsw-alias-bg-base) !important; }
.xterm {
  cursor: text; position: relative;
  user-select: none; -ms-user-select: none; -webkit-user-select: none;
}
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; top: 0; z-index: 5; }
.xterm .xterm-helper-textarea {
  padding: 0; border: 0; margin: 0; position: absolute; opacity: 0;
  left: -9999em; top: 0; width: 0; height: 0; z-index: -5;
  white-space: nowrap; overflow: hidden; resize: none;
}
.xterm .composition-view {
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  display: none; position: absolute; white-space: nowrap; z-index: 1;
}
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport {
  overflow-y: scroll; cursor: default; position: absolute;
  right: 0; left: 0; top: 0; bottom: 0;
}
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element {
  display: inline-block; visibility: hidden; position: absolute;
  top: 0; left: -9999em; line-height: normal;
}
.xterm.enable-mouse-events { cursor: default; }
.xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
.xterm .xterm-accessibility, .xterm .xterm-message {
  position: absolute; left: 0; top: 0; bottom: 0; right: 0;
  z-index: 10; color: transparent; pointer-events: none;
}
.xterm .live-region {
  position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden;
}
.dcs-note {
  position: absolute;
  z-index: 8;
  overflow: visible;
  width: max-content;
  min-width: min(248px, calc(100% - 16px));
  max-width: min(360px, calc(100% - 16px));
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv2);
  border-radius: 999px;
  padding: 4px 6px 4px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
}
.dcs-note[data-object] {
  padding-left: 10px;
}
.dcs-note-obj {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 42%;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
  line-height: 1;
  font-weight: 500;
}
.dcs-note-obj span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcs-note-obj svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary); }
.dcs-note-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.dcs-note input {
  flex: 1; min-width: 0; width: auto; background: transparent; border: 0; outline: none;
  color: var(--dsw-alias-label-primary); font-size: 13.5px;
}
.dcs-note-add {
  flex-shrink: 0;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.dcs-note-add:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dcs-note-send {
  width: 26px; height: 26px; flex-shrink: 0; border: 0; border-radius: 999px;
  display: grid; place-items: center; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
  padding: 0;
}
.dcs-note-send:hover { filter: brightness(1.08); }
.dcs-note-delete {
  width: 26px; height: 26px; flex: none; padding: 0; border: 0; border-radius: 999px;
  display: grid; place-items: center; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-tertiary);
}
.dcs-note-delete:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-error-primary);
}
.dcs-later {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; padding: 24px;
}
.dcs-root button.dcs-toggle,
button.dcs-toggle {
  width: var(--dcs-toggle-size);
  height: var(--dcs-toggle-size);
  min-width: var(--dcs-toggle-size);
  min-height: var(--dcs-toggle-size);
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  align-self: center;
}
[data-dcs-header] {
  padding-top: var(--dcs-toggle-pad) !important;
  padding-right: var(--dcs-toggle-pad) !important;
}
[data-dcs-pin]:not([data-dcs-open]) [data-dcs-header] {
  padding-right: calc(var(--dcs-toggle-size) + var(--dcs-toggle-pad) * 2) !important;
}
[data-dcs-open] [data-dcs-header] {
  padding-right: var(--dcs-toggle-pad) !important;
}
.dcs-toggle:hover, .dcs-toggle[data-on] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dcs-details] {
  min-width: 0;
}
[data-dcs-pin]:not([data-details-collapsed]) [data-dcs-details] {
  overflow: visible !important;
}
/* Pin only while a 主会话 is open. :has([data-shell-overlay]) is also true
   for the assistant seat, which would crush the host workspace rail to the
   56px fallback on the empty chooser. */
[data-dcs-pin] {
  grid-template-columns: var(--dcs-sidebar-track, 56px) minmax(0, 1fr) var(--dcs-details-track, 0px) !important;
  transition: none !important;
}
[data-side="details"] { display: none !important; }
.dcs-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  padding: 0 4px 8px;
}
/* input.dock is full-column; pin this strip to the composer card so it
   recenters when the 侧栏 opens or closes. Same width axis as InputBar. */
.dcs-chips.dcs-chips-dock {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px));
  max-width: var(--dsh-composer-card-max-width, 780px);
  margin: 0 auto;
  padding: 0 16px 8px;
}
.dcs-root > .dcs-chips {
  padding: 6px 10px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dcs-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 220px;
  font-size: 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 999px;
  padding: 3px 8px 3px 6px;
  color: var(--dsw-alias-label-secondary);
}
.dcs-chip-count { padding-left: 10px; padding-right: 10px; font-weight: 600; }
.dcs-chip-n {
  width: 16px; height: 16px; flex-shrink: 0; border-radius: 50%;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 1;
}
.dcs-chip-open {
  min-width: 0; padding: 0; border: 0; background: transparent; color: inherit;
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
}
.dcs-chip-open:hover .dcs-chip-from { color: var(--dsw-alias-label-primary); }
.dcs-chip-from { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-chip-x {
  width: 14px; height: 14px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--dsw-alias-label-tertiary);
  display: grid; place-items: center; cursor: pointer;
}
.dcs-chip-x:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-chips-send {
  width: 24px; height: 24px; flex: none; padding: 0; border: 0; border-radius: 999px;
  display: grid; place-items: center; cursor: pointer; margin-left: auto;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base);
}
.dcs-b-annotations {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
}
.dcs-b-annotation-outline {
  position: absolute; pointer-events: none; box-sizing: border-box;
  border: 2px solid #38bdf8; border-radius: 4px;
  background: color-mix(in srgb, #38bdf8 10%, transparent);
}
.dcs-b-badge {
  position: absolute; z-index: 4; pointer-events: auto; cursor: pointer;
  min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border: 0;
  border-radius: 999px;
  display: grid; place-items: center;
  background: #38bdf8; color: #0f172a;
  font-size: 11px; font-weight: 700; line-height: 1;
  transform: translate(-50%, -100%);
  margin-top: -2px;
}
.dcs-user-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}
.dcs-user-stack {
  max-width: min(80%, 560px);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}
.dcs-user-bubble {
  box-sizing: border-box;
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dcs-user-text { white-space: pre-wrap; }
.dcs-ref-chip {
  display: inline;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dcs-user-meta { display: flex; align-items: center; gap: 6px; flex: none; }
.dcs-user-time {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
@media (hover: hover) {
  .dcs-user-row .dcs-user-time,
  .dcs-user-row .dcs-user-copy { opacity: 0; transition: opacity 80ms; }
  .dcs-user-row:hover .dcs-user-time,
  .dcs-user-row:hover .dcs-user-copy,
  .dcs-user-row:focus-within .dcs-user-time,
  .dcs-user-row:focus-within .dcs-user-copy { opacity: 1; }
}
.dcs-user-images { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.dcs-user-thumb { max-width: 180px; max-height: 180px; border-radius: 10px; object-fit: cover; }
.dcs-msg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.dcs-msg-chips-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}
button.dcs-msg-chip {
  border: 0;
  cursor: pointer;
  max-width: 240px;
}
.dcs-user-copy {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 28px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.dcs-user-copy:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

`;
		function ensureSidebarStyles() {
			if (typeof document === "undefined") return;
			let style = document.getElementById("dsh-codex-sidebar-css");
			if (style === null) {
				style = document.createElement("style");
				style.id = "dsh-codex-sidebar-css";
				document.head.appendChild(style);
			}
			style.textContent = SIDEBAR_CSS;
		}
		//#endregion
		//#region src/client/locales.ts
		/** Copy for the 侧栏 chrome. */
		const NS = "codex-sidebar";
		const en = {
			toggleShow: "Show sidebar",
			toggleHide: "Hide sidebar",
			resizeDrawer: "Resize sidebar",
			newTab: "New tab",
			closeTab: "Close tab",
			annotate: "Note",
			openTree: "Show file tree",
			closeTree: "Hide file tree",
			filesPreview: "Preview",
			filesDiff: "Diff",
			notePlaceholder: "Add a note for this session",
			noteSend: "Send",
			noteAdd: "Add",
			noteDelete: "Delete note",
			sendAnnotations: "Send annotations",
			later: "This tool arrives in a later ticket.",
			newTerminal: "New terminal",
			collapseTerminals: "Hide terminals",
			expandTerminals: "Show terminals",
			occupantError: "The sidebar hit a display error. It stayed here instead of yielding Details.",
			occupantRetry: "Retry",
			openMark: "Open annotation {n}: {from}",
			copyMessage: "Copy",
			image: "Image",
			imageOpen: "Open original image",
			imageOpenNamed: "Open {label}",
			imageLoading: "Loading image",
			imageLoadFailed: "Could not load image",
			imageDialog: "Original image",
			imageClose: "Close"
		};
		const zh = {
			toggleShow: "显示侧栏",
			toggleHide: "隐藏侧栏",
			resizeDrawer: "调整侧栏宽度",
			newTab: "新 Tab",
			closeTab: "关闭 Tab",
			annotate: "批注",
			openTree: "打开文件树",
			closeTree: "关闭文件树",
			filesPreview: "预览",
			filesDiff: "Diff",
			notePlaceholder: "给当前会话留一条批注",
			noteSend: "发送",
			noteAdd: "新增",
			noteDelete: "删除批注",
			sendAnnotations: "发送批注",
			later: "这个工具会在后续票里接上。",
			newTerminal: "新建终端",
			collapseTerminals: "收起终端列表",
			expandTerminals: "展开终端列表",
			occupantError: "侧栏显示出错，已留在这里，没有退回默认 Details。",
			occupantRetry: "重试",
			openMark: "打开批注 {n}：{from}",
			copyMessage: "复制",
			image: "图片",
			imageOpen: "打开原图",
			imageOpenNamed: "打开 {label}",
			imageLoading: "正在加载图片",
			imageLoadFailed: "无法加载图片",
			imageDialog: "原图",
			imageClose: "关闭"
		};
		//#endregion
		//#region src/tab-events.ts
		function tabAuxIntent(button, tabId) {
			if (button !== 1) return void 0;
			return {
				type: "close-tab",
				id: tabId
			};
		}
		//#endregion
		//#region src/annotation.ts
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
		function visibleAnnotations(snapshot) {
			return [...snapshot.deliveredMarks ?? [], ...snapshot.attachments];
		}
		function annotationMarksFromSource(source) {
			if (typeof source !== "object" || source === null) return void 0;
			const marks = source.annotations;
			if (!Array.isArray(marks) || marks.length === 0) return void 0;
			const out = [];
			for (const item of marks) {
				const mark = decodeMarkView(item);
				if (mark !== void 0) out.push(mark);
			}
			return out.length === 0 ? void 0 : out;
		}
		function decodeMarkView(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
			const rec = value;
			if (typeof rec.id !== "string" || typeof rec.from !== "string") return void 0;
			if (rec.source !== "files" && rec.source !== "browser" && rec.source !== "review") return void 0;
			return {
				id: rec.id,
				from: rec.from,
				source: rec.source,
				...typeof rec.selector === "string" ? { selector: rec.selector } : {},
				...typeof rec.path === "string" ? { path: rec.path } : {},
				...typeof rec.line === "number" && rec.line >= 1 ? { line: rec.line } : {},
				...typeof rec.url === "string" ? { url: rec.url } : {},
				...decodeRect(rec.rect),
				...decodeSelection(rec.selection),
				...typeof rec.evidenceId === "string" ? { evidenceId: rec.evidenceId } : {}
			};
		}
		function decodeRect(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
			const rec = value;
			if (typeof rec.x !== "number" || typeof rec.y !== "number" || typeof rec.w !== "number" || typeof rec.h !== "number") return {};
			return { rect: {
				x: rec.x,
				y: rec.y,
				w: rec.w,
				h: rec.h
			} };
		}
		function decodeSelection(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
			const rec = value;
			if (typeof rec.start !== "number" || typeof rec.end !== "number") return {};
			return { selection: {
				start: rec.start,
				end: rec.end
			} };
		}
		//#endregion
		//#region src/file-tree.ts
		function ancestorsOf(path) {
			const open = /* @__PURE__ */ new Set();
			const parts = path.split("/").filter((part) => part.length > 0);
			const absolute = path.startsWith("/");
			let prefix = "";
			for (let index = 0; index < parts.length - 1; index += 1) {
				prefix = prefix.length === 0 ? absolute ? `/${parts[index]}` : parts[index] ?? "" : `${prefix}/${parts[index]}`;
				if (prefix.length > 0) open.add(prefix);
			}
			return open;
		}
		function visibleTree(nodes, expanded, query) {
			const needle = query.trim().toLowerCase();
			const tree = needle.length === 0 ? buildTree(nodes) : filterTree(buildTree(nodes), needle);
			const open = new Set(expanded);
			if (needle.length > 0) collectDirs(tree, open);
			return flatten(tree, open, 0);
		}
		function filterTree(nodes, needle) {
			const out = [];
			for (const node of nodes) {
				if (node.kind === "file") {
					if (node.name.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) out.push(node);
					continue;
				}
				const children = filterTree(node.children, needle);
				if (children.length > 0 || node.name.toLowerCase().includes(needle)) out.push({
					...node,
					children
				});
			}
			return out;
		}
		function collectDirs(nodes, open) {
			for (const node of nodes) {
				if (node.kind !== "dir") continue;
				open.add(node.path);
				collectDirs(node.children, open);
			}
		}
		function buildTree(nodes) {
			const root = [];
			const dirs = /* @__PURE__ */ new Map();
			function ensureDir(path) {
				if (path.length === 0) return root;
				const held = dirs.get(path);
				if (held !== void 0) return held.children;
				const slash = path.lastIndexOf("/");
				const name = slash === -1 ? path : path.slice(slash + 1);
				const parent = slash === -1 ? "" : path.slice(0, slash);
				const node = {
					path,
					name,
					kind: "dir",
					children: []
				};
				dirs.set(path, node);
				ensureDir(parent).push(node);
				return node.children;
			}
			for (const node of nodes) {
				if (node.kind === "dir") {
					ensureDir(node.path);
					continue;
				}
				const slash = node.path.lastIndexOf("/");
				ensureDir(slash === -1 ? "" : node.path.slice(0, slash)).push({
					path: node.path,
					name: node.name,
					kind: "file",
					children: []
				});
			}
			sortLevel(root);
			return root;
		}
		function sortLevel(list) {
			list.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
				return a.name.localeCompare(b.name, void 0, {
					numeric: true,
					sensitivity: "base"
				});
			});
			for (const child of list) sortLevel(child.children);
		}
		function flatten(nodes, open, depth) {
			const out = [];
			for (const node of nodes) if (node.kind === "dir") {
				const isOpen = open.has(node.path);
				out.push({
					kind: "dir",
					path: node.path,
					name: node.name,
					depth,
					open: isOpen
				});
				if (isOpen) out.push(...flatten(node.children, open, depth + 1));
			} else out.push({
				kind: "file",
				path: node.path,
				name: node.name,
				depth
			});
			return out;
		}
		//#endregion
		//#region src/preview.ts
		const KW = {
			ts: /* @__PURE__ */ new Set([
				"export",
				"import",
				"from",
				"default",
				"function",
				"return",
				"const",
				"let",
				"var",
				"class",
				"extends",
				"implements",
				"interface",
				"type",
				"enum",
				"if",
				"else",
				"for",
				"while",
				"do",
				"switch",
				"case",
				"break",
				"continue",
				"new",
				"this",
				"super",
				"typeof",
				"instanceof",
				"in",
				"of",
				"as",
				"satisfies",
				"async",
				"await",
				"try",
				"catch",
				"finally",
				"throw",
				"void",
				"null",
				"undefined",
				"true",
				"false",
				"yield",
				"delete",
				"debugger",
				"public",
				"private",
				"protected",
				"readonly",
				"static",
				"abstract",
				"declare",
				"module",
				"namespace",
				"keyof",
				"infer",
				"never",
				"unknown",
				"any",
				"boolean",
				"number",
				"string",
				"symbol",
				"bigint",
				"unique",
				"asserts",
				"is",
				"with",
				"package"
			]),
			py: /* @__PURE__ */ new Set([
				"def",
				"class",
				"return",
				"import",
				"from",
				"as",
				"if",
				"elif",
				"else",
				"for",
				"while",
				"try",
				"except",
				"finally",
				"raise",
				"with",
				"yield",
				"lambda",
				"pass",
				"break",
				"continue",
				"and",
				"or",
				"not",
				"in",
				"is",
				"None",
				"True",
				"False",
				"async",
				"await",
				"global",
				"nonlocal",
				"assert",
				"del"
			]),
			go: /* @__PURE__ */ new Set([
				"func",
				"package",
				"import",
				"return",
				"var",
				"const",
				"type",
				"struct",
				"interface",
				"if",
				"else",
				"for",
				"range",
				"switch",
				"case",
				"default",
				"break",
				"continue",
				"go",
				"defer",
				"select",
				"map",
				"chan",
				"nil",
				"true",
				"false"
			]),
			rs: /* @__PURE__ */ new Set([
				"fn",
				"let",
				"mut",
				"const",
				"pub",
				"use",
				"mod",
				"struct",
				"enum",
				"impl",
				"trait",
				"return",
				"if",
				"else",
				"match",
				"for",
				"while",
				"loop",
				"break",
				"continue",
				"async",
				"await",
				"true",
				"false",
				"self",
				"Self",
				"crate",
				"super",
				"where",
				"type"
			]),
			sh: /* @__PURE__ */ new Set([
				"if",
				"then",
				"else",
				"fi",
				"for",
				"while",
				"do",
				"done",
				"case",
				"esac",
				"in",
				"function",
				"return",
				"local",
				"export",
				"source",
				"shift"
			])
		};
		function extOf(path) {
			const base = path.split("/").pop() ?? path;
			const dot = base.lastIndexOf(".");
			return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
		}
		function langOf(path) {
			const ext = extOf(path);
			if (ext === "tsx" || ext === "ts" || ext === "jsx" || ext === "js" || ext === "mjs" || ext === "cjs") return "ts";
			if (ext === "py") return "py";
			if (ext === "go") return "go";
			if (ext === "rs") return "rs";
			if (ext === "json") return "json";
			if (ext === "css" || ext === "scss") return "css";
			if (ext === "html" || ext === "htm" || ext === "svg") return "html";
			if (ext === "sh" || ext === "bash" || ext === "zsh") return "sh";
			if (ext === "yml" || ext === "yaml") return "yaml";
			if (ext === "md" || ext === "mdx" || ext === "markdown") return "md";
			return "text";
		}
		function highlightSource(path, source) {
			const lang = langOf(path);
			const keywords = KW[lang] ?? /* @__PURE__ */ new Set();
			const hash = lang === "py" || lang === "sh" || lang === "yaml";
			const slash = lang === "ts" || lang === "go" || lang === "rs" || lang === "css" || lang === "json" || lang === "md";
			const block = lang === "ts" || lang === "go" || lang === "rs" || lang === "css";
			const html = lang === "html";
			const out = [];
			let inBlock = false;
			let inHtmlCom = false;
			for (const line of source.split("\n")) {
				const row = [];
				let i = 0;
				const push = (kind, text) => {
					if (text.length === 0) return;
					const last = row[row.length - 1];
					if (last && last.kind === kind) last.text += text;
					else row.push({
						kind,
						text
					});
				};
				while (i < line.length) {
					if (inBlock) {
						const end = line.indexOf("*/", i);
						if (end === -1) {
							push("com", line.slice(i));
							i = line.length;
							break;
						}
						push("com", line.slice(i, end + 2));
						i = end + 2;
						inBlock = false;
						continue;
					}
					if (inHtmlCom) {
						const end = line.indexOf("-->", i);
						if (end === -1) {
							push("com", line.slice(i));
							i = line.length;
							break;
						}
						push("com", line.slice(i, end + 3));
						i = end + 3;
						inHtmlCom = false;
						continue;
					}
					const rest = line.slice(i);
					if (block && rest.startsWith("/*")) {
						inBlock = true;
						continue;
					}
					if (html && rest.startsWith("<!--")) {
						inHtmlCom = true;
						continue;
					}
					if (slash && rest.startsWith("//")) {
						push("com", rest);
						break;
					}
					if (hash && rest.startsWith("#")) {
						push("com", rest);
						break;
					}
					const quote = rest[0];
					if (quote === "\"" || quote === "'" || quote === "`" && lang === "ts") {
						const eaten = readString(line, i, quote);
						push("str", line.slice(i, eaten.end));
						i = eaten.end;
						continue;
					}
					if (isDigit(line[i] ?? "")) {
						let j = i + 1;
						while (isDigit(line[j] ?? "") || line[j] === "." || line[j] === "_") j += 1;
						push("num", line.slice(i, j));
						i = j;
						continue;
					}
					if (isIdentStart(line[i] ?? "")) {
						let j = i + 1;
						while (isIdent(line[j] ?? "")) j += 1;
						const word = line.slice(i, j);
						push(keywords.has(word) ? "kw" : "text", word);
						i = j;
						continue;
					}
					const ch = line[i] ?? "";
					if ("(){}[]<>=!+-*%&|^~?:;,.".includes(ch)) {
						push("punc", ch);
						i += 1;
						continue;
					}
					push("text", ch);
					i += 1;
				}
				out.push(row);
			}
			return out;
		}
		function readString(line, start, quote) {
			let i = start + 1;
			while (i < line.length) {
				const ch = line[i];
				if (ch === "\\") {
					i += 2;
					continue;
				}
				if (ch === quote) return { end: i + 1 };
				i += 1;
			}
			return { end: line.length };
		}
		function isDigit(ch) {
			return ch >= "0" && ch <= "9";
		}
		function isIdentStart(ch) {
			return ch >= "A" && ch <= "Z" || ch >= "a" && ch <= "z" || ch === "_" || ch === "$";
		}
		function isIdent(ch) {
			return isIdentStart(ch) || isDigit(ch);
		}
		function parseMarkdown(source) {
			const raw = source.replace(/\r\n?/g, "\n").split("\n");
			const blocks = [];
			let i = 0;
			while (i < raw.length) {
				const line = raw[i] ?? "";
				const lineNo = i + 1;
				if (i === 0 && line.trim() === "---") {
					const end = raw.findIndex((candidate, index) => index > 0 && candidate.trim() === "---");
					if (end > 0) {
						i = end + 1;
						continue;
					}
				}
				if (/^\s*$/.test(line)) {
					i += 1;
					continue;
				}
				if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
					blocks.push({
						type: "hr",
						line: lineNo
					});
					i += 1;
					continue;
				}
				const fence = line.match(/^\s*```(\w*)\s*$/);
				if (fence) {
					const lang = fence[1] ?? "";
					const body = [];
					i += 1;
					while (i < raw.length && !/^\s*```\s*$/.test(raw[i] ?? "")) {
						body.push(raw[i] ?? "");
						i += 1;
					}
					if (i < raw.length) i += 1;
					blocks.push({
						type: "code",
						line: lineNo,
						lang,
						text: body.join("\n")
					});
					continue;
				}
				const table = tableHeader(raw, i);
				if (table !== void 0) {
					const rows = [];
					i += 2;
					while (i < raw.length) {
						const cells = tableCells(raw[i] ?? "");
						if (cells === void 0) break;
						rows.push(table.headers.map((_, index) => parseInlines(cells[index] ?? "")));
						i += 1;
					}
					blocks.push({
						type: "table",
						line: lineNo,
						headers: table.headers.map((cell) => parseInlines(cell)),
						rows
					});
					continue;
				}
				const heading = line.match(/^(#{1,3})\s+(.+)$/);
				if (heading) {
					const marks = heading[1] ?? "#";
					const level = Math.min(marks.length, 3);
					blocks.push({
						type: "h",
						level,
						line: lineNo,
						inlines: parseInlines(heading[2] ?? "")
					});
					i += 1;
					continue;
				}
				const xml = xmlLine(line);
				if (xml !== void 0) {
					if (xml.kind === "open") blocks.push({
						type: "h",
						level: 2,
						line: lineNo,
						inlines: [{
							kind: "text",
							text: displayTag(xml.name)
						}]
					});
					else if (xml.kind === "pair") blocks.push({
						type: "p",
						line: lineNo,
						inlines: [{
							kind: "strong",
							text: displayTag(xml.name)
						}, {
							kind: "text",
							text: ": " + xml.body
						}]
					});
					i += 1;
					continue;
				}
				if (/^\s*<!--/.test(line)) {
					blocks.push({
						type: "quote",
						line: lineNo,
						inlines: parseInlines(line.replace(/^\s*<!--\s?/, "").replace(/\s*-->\s*$/, ""))
					});
					i += 1;
					continue;
				}
				if (looksLikeCode(line)) {
					const body = [line];
					i += 1;
					while (i < raw.length) {
						const next = raw[i] ?? "";
						if (markdownBreak(raw, i) || xmlLine(next) !== void 0) break;
						if (/^\s*$/.test(next) && !looksLikeCode(raw[i + 1] ?? "")) break;
						body.push(next);
						i += 1;
					}
					blocks.push({
						type: "code",
						line: lineNo,
						lang: "",
						text: body.join("\n")
					});
					continue;
				}
				if (/^\s*>\s?/.test(line)) {
					blocks.push({
						type: "quote",
						line: lineNo,
						inlines: parseInlines(line.replace(/^\s*>\s?/, ""))
					});
					i += 1;
					continue;
				}
				if (/^\s*[-*]\s+/.test(line)) {
					const items = [];
					const start = lineNo;
					while (i < raw.length && /^\s*[-*]\s+/.test(raw[i] ?? "")) {
						items.push(parseInlines((raw[i] ?? "").replace(/^\s*[-*]\s+/, "")));
						i += 1;
					}
					blocks.push({
						type: "ul",
						line: start,
						items
					});
					continue;
				}
				if (/^\s*\d+\.\s+/.test(line)) {
					const items = [];
					const start = lineNo;
					while (i < raw.length && /^\s*\d+\.\s+/.test(raw[i] ?? "")) {
						items.push(parseInlines((raw[i] ?? "").replace(/^\s*\d+\.\s+/, "")));
						i += 1;
					}
					blocks.push({
						type: "ol",
						line: start,
						items
					});
					continue;
				}
				const para = [line];
				const start = lineNo;
				i += 1;
				while (i < raw.length) {
					const next = raw[i] ?? "";
					if (markdownBreak(raw, i) || xmlLine(next) !== void 0 || looksLikeCode(next)) break;
					para.push(next);
					i += 1;
				}
				blocks.push({
					type: "p",
					line: start,
					inlines: parseInlines(para.join(" "))
				});
			}
			return blocks;
		}
		function markdownBreak(raw, index) {
			const next = raw[index] ?? "";
			if (/^\s*$/.test(next)) return true;
			if (/^(#{1,3})\s+/.test(next) || /^\s*[-*]\s+/.test(next) || /^\s*\d+\.\s+/.test(next)) return true;
			if (tableHeader(raw, index) !== void 0) return true;
			if (/^\s*>\s?/.test(next) || /^\s*```/.test(next) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(next)) return true;
			if (/^\s*<!--/.test(next)) return true;
			return false;
		}
		function xmlLine(line) {
			const trimmed = line.trim();
			const open = trimmed.match(/^<([a-z][\w-]*)(?:\s+[^>]*)?>$/i);
			if (open) return {
				kind: "open",
				name: open[1] ?? ""
			};
			const close = trimmed.match(/^<\/([a-z][\w-]*)>$/i);
			if (close) return {
				kind: "close",
				name: close[1] ?? ""
			};
			const pair = trimmed.match(/^<([a-z][\w-]*)(?:\s+[^>]*)?>(.*)<\/\1>$/i);
			if (pair) return {
				kind: "pair",
				name: pair[1] ?? "",
				body: (pair[2] ?? "").trim()
			};
		}
		function displayTag(name) {
			return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
		}
		function looksLikeCode(line) {
			const t = line.trim();
			if (t.length === 0) return false;
			if (/^(\/\/|\/\*|\*\s|<!--)/.test(t)) return true;
			if (/^(class |mixin |enum |extension |typedef |void |final |const |var |late |import |export |part |library |GoRoute\(|return |if \(|for \(|while \(|switch \(|case |factory |@override|function |public |private |protected )/.test(t)) return true;
			if (/[{};]$/.test(t)) return true;
			if (t.includes("=>") && /[)(]/.test(t)) return true;
			return false;
		}
		function tableHeader(raw, index) {
			const headers = tableCells(raw[index] ?? "");
			const divider = tableCells(raw[index + 1] ?? "");
			if (headers === void 0 || divider === void 0 || headers.length === 0 || headers.length !== divider.length) return void 0;
			if (!divider.every((cell) => /^:?-{3,}:?$/.test(cell))) return void 0;
			return { headers };
		}
		function tableCells(line) {
			const trimmed = line.trim();
			if (!trimmed.includes("|")) return void 0;
			const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
			return cells.length > 1 ? cells : void 0;
		}
		function parseInlines(input) {
			const out = [];
			const pushText = (text) => {
				if (text.length === 0) return;
				const last = out[out.length - 1];
				if (last && last.kind === "text") last.text += text;
				else out.push({
					kind: "text",
					text
				});
			};
			let i = 0;
			while (i < input.length) {
				const rest = input.slice(i);
				const code = rest.match(/^`([^\`]+)`/);
				if (code) {
					out.push({
						kind: "code",
						text: code[1] ?? ""
					});
					i += code[0].length;
					continue;
				}
				const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
				if (link) {
					out.push({
						kind: "link",
						text: link[1] ?? "",
						href: link[2] ?? ""
					});
					i += link[0].length;
					continue;
				}
				const strong = rest.match(/^\*\*([^*]+)\*\*/);
				if (strong) {
					out.push({
						kind: "strong",
						text: strong[1] ?? ""
					});
					i += strong[0].length;
					continue;
				}
				const em = rest.match(/^\*([^*]+)\*/);
				if (em) {
					out.push({
						kind: "em",
						text: em[1] ?? ""
					});
					i += em[0].length;
					continue;
				}
				pushText(input[i] ?? "");
				i += 1;
			}
			return out;
		}
		//#endregion
		//#region src/client/icons.tsx
		function Ico({ name, size = 16 }) {
			const p = {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.6,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			};
			switch (name) {
				case "review": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "4.5",
						y: "4.5",
						width: "15",
						height: "15",
						rx: "2.5"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 8.5v7M8.5 12h7" })]
				});
				case "terminal": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3.5",
						y: "4.5",
						width: "17",
						height: "15",
						rx: "2.5"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.5 9.5l3 2.5-3 2.5M12.5 14.5h4" })]
				});
				case "globe": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "12",
						cy: "12",
						r: "9"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 12h18M12 3c2.4 3.2 2.4 14.8 0 18M12 3c-2.4 3.2-2.4 14.8 0 18" })]
				});
				case "folder": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.5 8h5.2l1.8 2H20.5v9.5H3.5z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.5 8V6.4A1.4 1.4 0 014.9 5h3.6l1.5 1.6" })]
				});
				case "chat": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20.2 11.2a7.4 7.4 0 01-8.1 7.4L6 21.2l.7-3.3A7.4 7.4 0 1119.6 8" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 9v5M9.5 11.5h5" })]
				});
				case "panel": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "3.5",
						y: "4.5",
						width: "17",
						height: "15",
						rx: "2"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M15.5 4.5v15" })]
				});
				case "device-responsive": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" })
				});
				case "device-phone": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "7.5",
						y: "3.5",
						width: "9",
						height: "17",
						rx: "1.8"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.5 17.5h3" })]
				});
				case "device-tablet": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "5.5",
						y: "3.5",
						width: "13",
						height: "17",
						rx: "1.8"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.5 17.5h3" })]
				});
				case "device-laptop": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "5",
						y: "4.5",
						width: "14",
						height: "11",
						rx: "1.5"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 19h18M7 19l1-3.5h8L17 19" })]
				});
				case "chevron-down": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 9 6 6 6-6" })
				});
				case "plus": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 6v12M6 12h12" })
				});
				case "x": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7 7l10 10M17 7L7 17" })
				});
				case "pencil": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m15 5 4 4" })]
				});
				case "tree": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "3.5",
							y: "4.5",
							width: "17",
							height: "15",
							rx: "2"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.5 4.5v15" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M16.4 8.5h2.2M16.4 12h2.2M16.4 15.5h2.2" })
					]
				});
				case "file": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7 4.5h7l4 4V19.5H7z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 4.5V9h4.5" })]
				});
				case "search": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "11",
						cy: "11",
						r: "6"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M16 16l4 4" })]
				});
				case "chevron": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 6l6 6-6 6" })
				});
				case "back": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.5 6l-6 6 6 6" })
				});
				case "fwd": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.5 6l6 6-6 6" })
				});
				case "refresh": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 11-3.2-6.9" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 3v6h-6" })]
				});
				case "external": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 5h5v5M19 5l-8.5 8.5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M11 6.5H6.8A1.3 1.3 0 005.5 7.8v9.4A1.3 1.3 0 006.8 18.5h9.4a1.3 1.3 0 001.3-1.3V13" })]
				});
				case "file-plus": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 3v5h5" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 18v-6M9 15h6" })
					]
				});
				case "folder-plus": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 19.5h18a1.5 1.5 0 001.5-1.5V8.5A1.5 1.5 0 0021 7h-7.6a1.5 1.5 0 01-1.2-.6L10.8 4.6A1.5 1.5 0 009.6 4H3a1.5 1.5 0 00-1.5 1.5v12A1.5 1.5 0 003 19.5z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 10.5v6M9 13.5h6" })]
				});
				case "more": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "6",
							cy: "12",
							r: "1.2",
							fill: "currentColor",
							stroke: "none"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "12",
							cy: "12",
							r: "1.2",
							fill: "currentColor",
							stroke: "none"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: "18",
							cy: "12",
							r: "1.2",
							fill: "currentColor",
							stroke: "none"
						})
					]
				});
				case "inspect": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: "4.5",
							y: "4.5",
							width: "11",
							height: "11",
							rx: "1.5"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 12l6 6" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M15.5 18.5h3v-3" })
					]
				});
				case "send": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					...p,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 12h14M13 6l6 6-6 6" })
				});
				case "enter": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M20 5v6a3 3 0 0 1-3 3H5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 10l-4 4 4 4" })]
				});
				case "trash": return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					...p,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 7h16M9 3h6l1 4H8l1-4Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6.5 7 1 14h9l1-14M10 11v6M14 11v6" })]
				});
			}
		}
		function tabIcon(kind) {
			if (kind === "Review") return "review";
			if (kind === "Terminal") return "terminal";
			if (kind === "Browser") return "globe";
			if (kind === "Files") return "folder";
			return "file";
		}
		function FileGlyph({ name }) {
			const { stroke, mark } = glyphFor(name);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className: "dcs-fglyph",
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke,
				strokeWidth: "1.15",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4.5 2.75h5.1L12 5.2V13.25H4.5z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.4 2.75V5.4H12" }),
					mark.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: "8",
						y: "11.1",
						textAnchor: "middle",
						fill: "none",
						stroke,
						strokeWidth: "0.55",
						style: {
							fontSize: mark.length > 1 ? 4.4 : 5.2,
							fontWeight: 600,
							letterSpacing: "-0.04em"
						},
						children: mark
					})
				]
			});
		}
		function glyphFor(name) {
			const lower = name.toLowerCase();
			const muted = "var(--dsw-alias-label-tertiary)";
			if (lower === ".gitignore" || lower === ".gitattributes" || lower.endsWith(".gitkeep")) return {
				stroke: "#b56a5c",
				mark: ""
			};
			if (lower === "package.json" || lower === "package-lock.json" || lower === "pnpm-lock.yaml" || lower === ".npmrc" || lower === "yarn.lock" || lower === "npm-shrinkwrap.json") return {
				stroke: "#b06a68",
				mark: "n"
			};
			if (lower.endsWith(".md") || lower.endsWith(".markdown")) return {
				stroke: "#7a8f9c",
				mark: "M"
			};
			if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return {
				stroke: "#9a8d62",
				mark: "Y"
			};
			if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return {
				stroke: "#6d86a3",
				mark: "TS"
			};
			if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return {
				stroke: "#9a9358",
				mark: "JS"
			};
			if (lower.endsWith(".css")) return {
				stroke: "#7d7190",
				mark: "C"
			};
			if (lower.endsWith(".html") || lower.endsWith(".htm")) return {
				stroke: "#b07a68",
				mark: "H"
			};
			if (lower.endsWith(".json")) return {
				stroke: "#9a9358",
				mark: "{}"
			};
			if (lower.endsWith(".svg") || /\.(png|jpe?g|gif|webp)$/i.test(lower)) return {
				stroke: "#8a7a9a",
				mark: ""
			};
			return {
				stroke: muted,
				mark: ""
			};
		}
		const NOTE_ESTIMATE = {
			w: 248,
			h: 38
		};
		function placeNotePopover(anchor, popover, view, pad = 8, gap = 12) {
			const inner = {
				x: view.x + pad,
				y: view.y + pad,
				w: Math.max(0, view.w - pad * 2),
				h: Math.max(0, view.h - pad * 2)
			};
			const pw = Math.min(Math.max(0, popover.w), inner.w);
			const ph = Math.min(Math.max(0, popover.h), inner.h);
			const rightOf = anchor.x + anchor.w + gap;
			const leftOf = anchor.x - gap - pw;
			const x = pickX(anchor.x + anchor.w / 2 - pw / 2, rightOf, leftOf, inner.x, inner.w, pw);
			const below = anchor.y + anchor.h + gap;
			const above = anchor.y - gap - ph;
			let y = below;
			if (below + ph > inner.y + inner.h && above >= inner.y) y = above;
			y = clamp$1(y, inner.y, inner.y + inner.h - ph);
			return {
				x,
				y
			};
		}
		function pickX(centered, rightOf, leftOf, innerX, innerW, pw) {
			if (fitsX(centered, innerX, innerW, pw)) return centered;
			if (centered < innerX && fitsX(rightOf, innerX, innerW, pw)) return rightOf;
			if (centered + pw > innerX + innerW && fitsX(leftOf, innerX, innerW, pw)) return leftOf;
			return clamp$1(centered, innerX, innerX + innerW - pw);
		}
		function fitsX(x, innerX, innerW, pw) {
			return x >= innerX && x + pw <= innerX + innerW;
		}
		function clamp$1(n, min, max) {
			if (max < min) return min;
			return Math.min(Math.max(n, min), max);
		}
		//#endregion
		//#region src/ime-key.ts
		/** IME composition keys must not confirm 批注 Enter. */
		function isImeKey(event) {
			return event.isComposing || event.keyCode === 229;
		}
		//#endregion
		//#region src/client/ime-draft.ts
		/** Keep IME composition off the async 批注/draft RPC. */
		function useImeSafeDraft(value, onCommit) {
			const [text, setText] = (0, react.useState)(value);
			const composing = (0, react.useRef)(false);
			const commit = (0, react.useRef)(onCommit);
			const textRef = (0, react.useRef)(text);
			commit.current = onCommit;
			textRef.current = text;
			(0, react.useEffect)(() => {
				if (!composing.current) setText(value);
			}, [value]);
			function onChange(next) {
				setText(next);
				textRef.current = next;
				if (!composing.current) commit.current(next);
			}
			return {
				value: text,
				onChange,
				onCompositionStart: () => {
					composing.current = true;
				},
				onCompositionEnd: (next) => {
					composing.current = false;
					setText(next);
					textRef.current = next;
					commit.current(next);
				},
				flush: () => {
					composing.current = false;
					const next = textRef.current;
					commit.current(next);
					return next;
				}
			};
		}
		//#endregion
		//#region src/client/NoteComposer.tsx
		/** Floating 批注 chip: flip/shift so it stays fully inside the pane. */
		function NoteComposer({ containerRef, viewportRef, anchor, value, objectText, placeholder, sendLabel, addLabel, deleteLabel, editing, onChange, onAdd, onSend, onDelete, onDismiss }) {
			const noteRef = (0, react.useRef)(null);
			const inputRef = (0, react.useRef)(null);
			const [pos, setPos] = (0, react.useState)({
				x: anchor.x,
				y: anchor.y + 12
			});
			const hasObject = objectText !== void 0 && objectText.length > 0;
			const draft = useImeSafeDraft(value, onChange);
			const add = (0, react.useRef)(onAdd);
			const send = (0, react.useRef)(onSend);
			const dismiss = (0, react.useRef)(onDismiss);
			const flush = (0, react.useRef)(draft.flush);
			add.current = onAdd;
			send.current = onSend;
			dismiss.current = onDismiss;
			flush.current = draft.flush;
			(0, react.useLayoutEffect)(() => {
				function place() {
					const origin = containerRef.current;
					if (origin === null) return;
					const viewEl = viewportRef?.current ?? origin;
					const originBox = origin.getBoundingClientRect();
					const viewBox = viewEl.getBoundingClientRect();
					const view = {
						x: viewBox.left - originBox.left,
						y: viewBox.top - originBox.top,
						w: viewBox.width,
						h: viewBox.height
					};
					const measured = noteRef.current;
					const extra = hasObject ? 8 : 0;
					const popover = measured === null ? {
						w: Math.min(NOTE_ESTIMATE.w, Math.max(0, view.w - 16)),
						h: NOTE_ESTIMATE.h + extra
					} : {
						w: measured.offsetWidth,
						h: measured.offsetHeight
					};
					const next = placeNotePopover({
						x: anchor.x,
						y: anchor.y,
						w: 0,
						h: 0
					}, popover, view);
					setPos((prev) => prev.x === next.x && prev.y === next.y ? prev : next);
				}
				place();
				const viewEl = viewportRef?.current ?? containerRef.current;
				const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
					place();
				});
				if (ro !== null) {
					if (viewEl !== null) ro.observe(viewEl);
					if (containerRef.current !== null) ro.observe(containerRef.current);
					if (noteRef.current !== null) ro.observe(noteRef.current);
				}
				window.addEventListener("resize", place);
				return () => {
					ro?.disconnect();
					window.removeEventListener("resize", place);
				};
			}, [
				anchor.x,
				anchor.y,
				containerRef,
				viewportRef,
				objectText,
				hasObject
			]);
			(0, react.useEffect)(() => {
				function onKey(event) {
					if (isImeKey(event)) return;
					const node = noteRef.current;
					if (node === null) return;
					const target = event.target;
					if (!(target instanceof Node) || !node.contains(target)) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						event.stopImmediatePropagation();
						dismiss.current();
						return;
					}
					if (event.key !== "Enter" && event.code !== "NumpadEnter") return;
					event.preventDefault();
					event.stopPropagation();
					event.stopImmediatePropagation();
					flush.current();
					add.current();
				}
				window.addEventListener("keydown", onKey, true);
				return () => {
					window.removeEventListener("keydown", onKey, true);
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: noteRef,
				className: "dcs-note",
				"data-object": hasObject ? "" : void 0,
				style: {
					left: pos.x,
					top: pos.y
				},
				children: [hasObject && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-note-obj",
					title: objectText,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
						name: "inspect",
						size: 14
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: objectText })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-note-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: inputRef,
							autoFocus: true,
							value: draft.value,
							placeholder,
							onChange: (event) => {
								draft.onChange(event.target.value);
							},
							onCompositionStart: draft.onCompositionStart,
							onCompositionEnd: (event) => {
								draft.onCompositionEnd(event.currentTarget.value);
							}
						}),
						editing && onDelete !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-note-delete",
							title: deleteLabel,
							"aria-label": deleteLabel,
							onClick: onDelete,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "trash",
								size: 13
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-note-add",
							title: addLabel,
							"aria-label": addLabel,
							onClick: () => {
								flush.current();
								add.current();
							},
							children: addLabel
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-note-send",
							title: sendLabel,
							"aria-label": sendLabel,
							onClick: () => {
								flush.current();
								send.current();
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "send",
								size: 13
							})
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/FilesPane.tsx
		/** Files 工具: read-only preview + closable tree + 批注 at the mark. */
		function FilesPane({ snapshot, workspaceName, onIntent, onFilePreview, annotateLabel, openTreeLabel, closeTreeLabel, notePlaceholder, sendLabel, addLabel, deleteLabel, previewLabel, diffLabel }) {
			const files = snapshot.files;
			const slash = files.path.lastIndexOf("/");
			const name = slash === -1 ? files.path : files.path.slice(slash + 1);
			const [fetchedPreview, setFetchedPreview] = (0, react.useState)();
			const [fetchFailed, setFetchFailed] = (0, react.useState)(false);
			const onFilePreviewRef = (0, react.useRef)(onFilePreview);
			onFilePreviewRef.current = onFilePreview;
			(0, react.useEffect)(() => {
				setFetchedPreview(void 0);
				setFetchFailed(false);
				const load = onFilePreviewRef.current;
				if (files.preview !== void 0 || !isImagePath(files.path) || load === void 0) return;
				let cancelled = false;
				load(files.path).then((value) => {
					if (cancelled) return;
					if (value === void 0) setFetchFailed(true);
					else setFetchedPreview(value);
				}, () => {
					if (!cancelled) setFetchFailed(true);
				});
				return () => {
					cancelled = true;
				};
			}, [files.path, files.preview]);
			const preview = files.preview ?? fetchedPreview;
			const image = imageSrc(files.path, preview);
			const markdown = image === void 0 && isMarkdown(files.path);
			const loadingImage = isImagePath(files.path) && preview === void 0 && !fetchFailed && onFilePreview !== void 0;
			const missing = files.path.length > 0 && preview === void 0 && !loadingImage;
			const tooLarge = image === void 0 && isImagePath(files.path) && (preview?.startsWith("[File too large") ?? false);
			const empty = files.path.length === 0;
			const showDiff = files.view === "diff" && files.diff !== null;
			const lines = !empty && image === void 0 && !markdown && !missing && !showDiff ? (files.preview ?? "").split("\n") : [];
			const tokens = lines.length > 0 ? highlightSource(files.path, files.preview ?? "") : [];
			const paneMarks = visibleAnnotations(snapshot);
			const surfaceMarks = fileBadges(paneMarks, files.path);
			const bodyRef = (0, react.useRef)(null);
			const [expanded, setExpanded] = (0, react.useState)(() => ancestorsOf(files.path));
			const [query, setQuery] = (0, react.useState)("");
			(0, react.useLayoutEffect)(() => {
				const surface = bodyRef.current?.querySelector(".dcs-md") ?? null;
				if (surface === null) {
					clearFileSelectionHighlight();
					return;
				}
				const selections = /* @__PURE__ */ new Map();
				for (const mark of surfaceMarks) if (mark.item.selection !== void 0) selections.set(textRangeKey(mark.item.selection), mark.item.selection);
				if (files.pendingSelection !== null) selections.set(textRangeKey(files.pendingSelection), files.pendingSelection);
				showFileSelectionHighlights([...selections.values()].map((selection) => restoreTextRange(surface, selection)).filter((range) => range !== null));
			}, [
				files.path,
				files.pendingSelection,
				markdown,
				snapshot.attachments,
				snapshot.deliveredMarks
			]);
			(0, react.useEffect)(() => () => {
				clearFileSelectionHighlight();
			}, []);
			(0, react.useEffect)(() => {
				const ancestors = ancestorsOf(files.path);
				setExpanded((previous) => {
					const next = new Set(previous);
					let changed = false;
					for (const path of ancestors) {
						if (next.has(path)) continue;
						next.add(path);
						changed = true;
					}
					return changed ? next : previous;
				});
			}, [files.path]);
			const [searching, setSearching] = (0, react.useState)(false);
			const [dragW, setDragW] = (0, react.useState)(null);
			const [localW, setLocalW] = (0, react.useState)(null);
			const crumbs = crumbsOf(empty ? "" : files.path);
			const treeWidth = dragW ?? localW ?? files.treeWidth ?? 240;
			function startResize(event) {
				event.preventDefault();
				const origin = event.clientX;
				const start = treeWidth;
				const handle = event.currentTarget;
				handle.setPointerCapture(event.pointerId);
				handle.dataset.dragging = "true";
				function move(next) {
					setDragW(Math.min(420, Math.max(160, start + (origin - next.clientX))));
				}
				function up(next) {
					handle.releasePointerCapture(next.pointerId);
					delete handle.dataset.dragging;
					handle.removeEventListener("pointermove", move);
					handle.removeEventListener("pointerup", up);
					const width = Math.min(420, Math.max(160, start + (origin - next.clientX)));
					setLocalW(width);
					setDragW(null);
					onIntent({
						type: "set-tree-width",
						width
					});
				}
				handle.addEventListener("pointermove", move);
				handle.addEventListener("pointerup", up);
			}
			function markLine(line, event) {
				if (!files.annotate) return;
				const pane = bodyRef.current;
				if (pane === null) return;
				const box = pane.getBoundingClientRect();
				onIntent({
					type: "click-content",
					mark: `${files.path}:${line}`,
					x: event.clientX - box.left,
					y: event.clientY - box.top
				});
			}
			function markSurface(event) {
				if (!files.annotate) return;
				const target = event.target instanceof Element ? event.target : null;
				if (target !== null && target.closest(".dcs-file-surface-badges") !== null) return;
				const pane = bodyRef.current;
				if (pane === null) return;
				const paneBox = pane.getBoundingClientRect();
				const anchor = surfaceAnchor(event);
				showFileSelectionHighlights(anchor.range === null ? [] : [anchor.range]);
				window.getSelection()?.removeAllRanges();
				onIntent({
					type: "click-content",
					mark: `${files.path}:${anchor.line}`,
					x: event.clientX - paneBox.left,
					y: event.clientY - paneBox.top,
					rect: anchor.rect,
					...anchor.selection === null ? {} : { selection: anchor.selection }
				});
			}
			function editMark(id, event) {
				event.preventDefault();
				event.stopPropagation();
				const pane = bodyRef.current;
				if (pane === null) return;
				const box = pane.getBoundingClientRect();
				if (snapshot.attachments.some((item) => item.id === id)) {
					onIntent({
						type: "edit-attachment",
						id,
						x: event.clientX - box.left,
						y: event.clientY - box.top
					});
					return;
				}
				const delivered = snapshot.deliveredMarks.find((item) => item.id === id);
				if (delivered !== void 0) onIntent({
					type: "reveal-mark",
					mark: delivered
				});
			}
			function toggleDir(path) {
				setExpanded((prev) => {
					const next = new Set(prev);
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
			}
			const grouped = visibleTree(files.tree, expanded, query);
			function openSearch() {
				if (!files.treeOpen) onIntent({ type: "toggle-tree" });
				setSearching((on) => {
					if (on) setQuery("");
					return !on;
				});
			}
			function onCrumb(path, last) {
				if (last) {
					onIntent({
						type: "select-file",
						path
					});
					return;
				}
				if (!files.treeOpen) onIntent({ type: "toggle-tree" });
				setExpanded((prev) => new Set(prev).add(path));
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-files",
				ref: bodyRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-fh",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("nav", {
								className: "dcs-crumbs",
								"aria-label": "path",
								children: empty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dcs-crumb-file",
									children: workspaceName
								}) : crumbs.map((crumb, index) => {
									const last = index === crumbs.length - 1;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "dcs-crumb-wrap",
										children: [index > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dcs-crumb-sep",
											children: "/"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: last ? "dcs-crumb-file" : "dcs-crumb",
											title: crumb.path,
											onClick: () => {
												onCrumb(crumb.path, last);
											},
											children: crumb.name
										})]
									}, crumb.path);
								})
							}),
							searching && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "dcs-fh-search",
								autoFocus: true,
								value: query,
								placeholder: "搜索文件",
								onChange: (event) => {
									setQuery(event.target.value);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-fh-actions",
								children: [
									files.diff !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dcs-fseg",
										role: "tablist",
										"aria-label": previewLabel + " / " + diffLabel,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											role: "tab",
											"aria-selected": files.view === "preview",
											"data-on": files.view === "preview" || void 0,
											onClick: () => {
												onIntent({
													type: "set-files-view",
													view: "preview"
												});
											},
											children: previewLabel
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											role: "tab",
											"aria-selected": files.view === "diff",
											"data-on": files.view === "diff" || void 0,
											onClick: () => {
												onIntent({
													type: "set-files-view",
													view: "diff"
												});
											},
											children: [
												diffLabel,
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dcs-addn",
													children: ["+", files.diff.added]
												}),
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: "dcs-deln",
													children: ["−", files.diff.removed]
												})
											]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: annotateLabel,
										"aria-label": annotateLabel,
										className: "dcs-tool",
										"data-on": files.annotate || void 0,
										onClick: () => {
											onIntent({
												type: "set-annotate",
												on: !files.annotate
											});
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "pencil",
											size: 14
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: "搜索",
										className: "dcs-tool",
										"data-on": searching || void 0,
										onClick: openSearch,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "search",
											size: 14
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: files.treeOpen ? closeTreeLabel : openTreeLabel,
										className: "dcs-tool",
										"data-on": files.treeOpen || void 0,
										onClick: () => {
											onIntent({ type: "toggle-tree" });
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "tree",
											size: 14
										})
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-files-split",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dcs-preview",
							"data-split": files.treeOpen || void 0,
							children: empty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-files-empty",
								children: "Open a file to get started"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-code",
								"data-mark": files.annotate || void 0,
								"data-selected": !markdown && image === void 0 && files.pendingMark !== null || void 0,
								"data-annotated": !markdown && image === void 0 && surfaceMarks.length > 0 || void 0,
								"data-media": image !== void 0 || markdown || void 0,
								children: loadingImage ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dcs-missing",
									children: "正在读取…"
								}) : missing ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dcs-missing",
									children: ["无法读取 ", files.path]
								}) : tooLarge ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dcs-missing",
									children: files.preview
								}) : image !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dcs-media-surface",
									"data-dcs-line": 1,
									onMouseUp: markSurface,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
										alt: name,
										src: image,
										"data-dcs-line": 1,
										style: {
											maxWidth: "100%",
											maxHeight: "100%",
											objectFit: "contain",
											padding: 16
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileSurfaceBadges, {
										marks: surfaceMarks,
										pendingRect: files.pendingRect,
										onEdit: editMark
									})]
								}) : showDiff && files.diff !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileDiffBody, {
									path: files.path,
									hunk: files.diff.hunk,
									lines: files.diff.lines,
									annotate: files.annotate,
									pendingMark: files.pendingMark,
									attachments: paneMarks,
									onMark: markLine,
									onEdit: editMark
								}) : markdown ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dcs-md",
									onMouseUp: markSurface,
									children: [renderMarkdown(preview ?? ""), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileSurfaceBadges, {
										marks: surfaceMarks,
										pendingRect: files.pendingRect,
										onEdit: editMark
									})]
								}) : lines.map((line, index) => {
									const marks = lineBadges(paneMarks, files.path, index + 1);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dcs-line",
										"data-annotated": marks.length > 0 || void 0,
										"data-selected": pendingLine(files.pendingMark, files.path) === index + 1 || void 0,
										onClick: (event) => {
											markLine(index + 1, event);
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dcs-n",
											children: [marks.map((mark) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dcs-line-badge",
												"aria-label": `编辑批注 ${mark.n}`,
												onClick: (event) => {
													editMark(mark.item.id, event);
												},
												children: mark.n
											}, mark.item.id)), index + 1]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeText, {
											tokens: tokens[index],
											fallback: line
										})]
									}, index);
								})
							})
						}), files.treeOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dcs-tree-handle",
							title: "调整目录宽度",
							onPointerDown: startResize
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcs-tree",
							style: { width: treeWidth },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-tree-head",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-tree-title",
										children: workspaceName
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: "新建文件",
										className: "dcs-tool",
										tabIndex: -1,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "file-plus",
											size: 14
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: "新建文件夹",
										className: "dcs-tool",
										tabIndex: -1,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "folder-plus",
											size: 14
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										title: "刷新",
										className: "dcs-tool",
										onClick: () => {
											onIntent({
												type: "select-file",
												path: files.path
											});
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "refresh",
											size: 14
										})
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-tree-body",
								children: grouped.map((entry) => entry.kind === "dir" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dcs-tree-row",
									style: { paddingLeft: 10 + entry.depth * 12 },
									onClick: () => {
										toggleDir(entry.path);
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-caret",
										"data-open": entry.open || void 0
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-tree-name",
										children: entry.name
									})]
								}, `dir:${entry.path}`) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dcs-tree-row",
									"data-on": files.path === entry.path || void 0,
									style: { paddingLeft: 10 + entry.depth * 12 },
									onClick: () => {
										onIntent({
											type: "select-file",
											path: entry.path
										});
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FileGlyph, { name: entry.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-tree-name",
										children: entry.name
									})]
								}, `file:${entry.path}`))
							})]
						})] })]
					}),
					files.pendingMark !== null && files.notePos !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoteComposer, {
						containerRef: bodyRef,
						anchor: files.notePos,
						value: files.noteDraft,
						objectText: fileCaption(files.pendingMark),
						placeholder: notePlaceholder,
						sendLabel,
						addLabel,
						deleteLabel,
						editing: files.editingId !== null,
						onDelete: () => {
							if (files.editingId !== null) onIntent({
								type: "remove-attachment",
								id: files.editingId
							});
						},
						onChange: (text) => {
							onIntent({
								type: "set-note-draft",
								text
							});
						},
						onAdd: () => {
							onIntent({ type: "note-add" });
						},
						onSend: () => {
							onIntent({ type: "note-send" });
						},
						onDismiss: () => {
							onIntent({ type: "dismiss-note" });
						}
					})
				]
			});
		}
		function crumbsOf(path) {
			const parts = path.split("/").filter((part) => part.length > 0);
			const absolute = path.startsWith("/");
			const out = [];
			let prefix = "";
			for (const part of parts) {
				prefix = prefix.length === 0 ? absolute ? `/${part}` : part : `${prefix}/${part}`;
				out.push({
					name: part,
					path: prefix
				});
			}
			return out;
		}
		function pendingLine(mark, path) {
			if (mark === null) return void 0;
			const parsed = parsePathLine(mark);
			return parsed?.path === path ? parsed.line : void 0;
		}
		function fileBadges(attachments, path) {
			return attachments.flatMap((item, index) => item.source === "files" && item.path === path ? [{
				n: index + 1,
				item
			}] : []);
		}
		function lineBadges(attachments, path, line) {
			return fileBadges(attachments, path).filter((mark) => mark.item.line === line);
		}
		function FileSurfaceBadges({ marks, pendingRect, onEdit }) {
			const anchored = marks.filter((mark) => mark.item.rect !== void 0);
			if (anchored.length === 0 && pendingRect === null) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-file-surface-badges",
				children: [pendingRect !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dcs-file-anchor-outline",
					"data-pending": true,
					style: rectStyle(pendingRect)
				}), anchored.map((mark, index) => {
					const duplicate = anchored.slice(0, index).filter((other) => sameAnchor(other.item.rect, mark.item.rect)).length;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcs-file-anchor-outline",
						style: rectStyle(mark.item.rect)
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dcs-line-badge dcs-file-anchor-badge",
						style: {
							left: mark.item.rect.x + duplicate * 20,
							top: mark.item.rect.y
						},
						"aria-label": `编辑批注 ${mark.n}`,
						onClick: (event) => {
							onEdit(mark.item.id, event);
						},
						children: mark.n
					})] }, mark.item.id);
				})]
			});
		}
		function sameAnchor(a, b) {
			return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
		}
		function rectStyle(rect) {
			return {
				left: rect.x,
				top: rect.y,
				width: rect.w,
				height: rect.h
			};
		}
		const FILE_SELECTION_HIGHLIGHT = "dcs-file-selection";
		function fileHighlightApi() {
			const css = globalThis.CSS;
			const HighlightCtor = globalThis.Highlight;
			if (css?.highlights === void 0 || HighlightCtor === void 0) return null;
			return {
				registry: css.highlights,
				create: (ranges) => new HighlightCtor(...ranges)
			};
		}
		function showFileSelectionHighlights(ranges) {
			const api = fileHighlightApi();
			if (api === null) return;
			if (ranges.length === 0) {
				api.registry.delete(FILE_SELECTION_HIGHLIGHT);
				return;
			}
			api.registry.set(FILE_SELECTION_HIGHLIGHT, api.create(ranges));
		}
		function clearFileSelectionHighlight() {
			fileHighlightApi()?.registry.delete(FILE_SELECTION_HIGHLIGHT);
		}
		function textRangeKey(selection) {
			return `${selection.start}:${selection.end}`;
		}
		function captureTextRange(surface, range) {
			if (range.collapsed || !surface.contains(range.commonAncestorContainer)) return null;
			const prefix = document.createRange();
			prefix.selectNodeContents(surface);
			prefix.setEnd(range.startContainer, range.startOffset);
			const start = prefix.toString().length;
			const end = start + range.toString().length;
			return end > start ? {
				start,
				end
			} : null;
		}
		function restoreTextRange(surface, selection) {
			if (selection.start < 0 || selection.end <= selection.start) return null;
			const nodes = [];
			const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT, { acceptNode(node) {
				return node.parentElement?.closest(".dcs-file-surface-badges") === null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
			} });
			while (walker.nextNode()) nodes.push(walker.currentNode);
			let cursor = 0;
			let start = null;
			let end = null;
			for (const node of nodes) {
				const next = cursor + node.data.length;
				if (start === null && selection.start <= next) start = {
					node,
					offset: Math.max(0, selection.start - cursor)
				};
				if (selection.end <= next) {
					end = {
						node,
						offset: Math.max(0, selection.end - cursor)
					};
					break;
				}
				cursor = next;
			}
			if (start === null || end === null) return null;
			const range = document.createRange();
			range.setStart(start.node, Math.min(start.offset, start.node.data.length));
			range.setEnd(end.node, Math.min(end.offset, end.node.data.length));
			return range.collapsed ? null : range;
		}
		function surfaceAnchor(event) {
			const surface = event.currentTarget;
			const target = event.target instanceof Element ? event.target : surface;
			let lineElement = target.closest("[data-dcs-line]");
			let selectedRange = null;
			let targetBox = lineElement?.getBoundingClientRect() ?? target.getBoundingClientRect();
			const selection = window.getSelection();
			if (selection !== null && !selection.isCollapsed && selection.rangeCount > 0) {
				const range = selection.getRangeAt(0);
				const selectedNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
				const selectedBox = range.getBoundingClientRect();
				if (selectedNode !== null && surface.contains(selectedNode) && selectedBox.width > 0 && selectedBox.height > 0) {
					targetBox = selectedBox;
					selectedRange = range.cloneRange();
					lineElement = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest("[data-dcs-line]") ?? lineElement;
				}
			} else if (target.closest("img") !== null) targetBox = new DOMRect(event.clientX, event.clientY, 2, 2);
			const surfaceBox = surface.getBoundingClientRect();
			const toSurfaceRect = (box) => ({
				x: box.left - surfaceBox.left + surface.scrollLeft,
				y: box.top - surfaceBox.top + surface.scrollTop,
				w: Math.max(2, box.width),
				h: Math.max(2, box.height)
			});
			const line = Number(lineElement?.dataset.dcsLine ?? 1);
			return {
				line: Number.isFinite(line) && line > 0 ? line : 1,
				rect: toSurfaceRect(targetBox),
				range: selectedRange,
				selection: selectedRange === null ? null : captureTextRange(surface, selectedRange)
			};
		}
		function CodeText({ tokens, fallback }) {
			const parts = tokens && tokens.length > 0 ? tokens : [{
				kind: "text",
				text: fallback.length === 0 ? " " : fallback
			}];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dcs-t",
				children: parts.map((tok, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: tok.kind === "text" ? void 0 : "dcs-tok-" + tok.kind,
					children: tok.text
				}, index))
			});
		}
		function FileDiffBody({ path, hunk, lines, annotate, pendingMark, attachments, onMark, onEdit }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-fd",
				"data-mark": annotate || void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcs-fd-hunk",
					children: hunk
				}), lines.map((line, index) => {
					const lineNo = line.newNo ?? line.oldNo ?? index + 1;
					const marks = lineBadges(attachments, path, lineNo);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-fd-line",
						"data-kind": line.kind === "ctx" ? void 0 : line.kind,
						"data-annotated": marks.length > 0 || void 0,
						"data-selected": pendingLine(pendingMark, path) === lineNo || void 0,
						onClick: (event) => {
							onMark(lineNo, event);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-fd-ln",
								"data-kind": line.kind === "ctx" ? void 0 : line.kind,
								children: [marks.map((mark) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dcs-line-badge",
									"aria-label": `编辑批注 ${mark.n}`,
									onClick: (event) => {
										onEdit(mark.item.id, event);
									},
									children: mark.n
								}, mark.item.id)), lineNo]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-fd-sign",
								"data-kind": line.kind === "ctx" ? void 0 : line.kind,
								children: line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-fd-code",
								children: line.text.length === 0 ? " " : line.text
							})
						]
					}, index);
				})]
			});
		}
		function isMarkdown(path) {
			return /\.(md|markdown)$/i.test(path);
		}
		function isImagePath(path) {
			return /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
		}
		function imageSrc(path, preview) {
			if (preview === void 0) return void 0;
			if (preview.startsWith("data:image/")) return preview;
			if (/\.(png|jpe?g|gif|webp|svg)$/i.test(path) && preview.startsWith("data:")) return preview;
		}
		function renderMarkdown(source) {
			return parseMarkdown(source).map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownBlock, { block }, `${block.type}-${block.line}-${index}`));
		}
		function MarkdownBlock({ block }) {
			if (block.type === "h") {
				const Tag = `h${block.level}`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
					"data-dcs-line": block.line,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: block.inlines })
				});
			}
			if (block.type === "p") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				"data-dcs-line": block.line,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: block.inlines })
			});
			if (block.type === "quote") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
				"data-dcs-line": block.line,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: block.inlines })
			});
			if (block.type === "hr") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { "data-dcs-line": block.line });
			if (block.type === "code") {
				const rows = highlightSource(block.lang.length > 0 ? `snippet.${block.lang}` : "snippet.txt", block.text);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: "dcs-md-pre",
					"data-dcs-line": block.line,
					children: block.text.split("\n").map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						"data-dcs-line": block.line + index,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CodeText, {
							tokens: rows[index],
							fallback: line
						})
					}, index))
				});
			}
			if (block.type === "table") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcs-md-table-wrap",
				"data-dcs-line": block.line,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", { children: block.headers.map((cell, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: cell }) }, index)) }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: block.rows.map((row, rowIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
					"data-dcs-line": block.line + rowIndex + 2,
					children: row.map((cell, cellIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: cell }) }, cellIndex))
				}, rowIndex)) })] })
			});
			const Tag = block.type === "ol" ? "ol" : "ul";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Tag, {
				"data-dcs-line": block.line,
				children: block.items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					"data-dcs-line": block.line + index,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownInlines, { nodes: item })
				}, index))
			});
		}
		function MarkdownInlines({ nodes }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: nodes.map((node, index) => markdownInline(node, index)) });
		}
		function markdownInline(node, index) {
			if (node.kind === "code") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
				className: "dcs-md-code",
				children: node.text
			}, index);
			if (node.kind === "strong") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: node.text }, index);
			if (node.kind === "em") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: node.text }, index);
			if (node.kind === "link") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				href: node.href,
				target: "_blank",
				rel: "noreferrer",
				children: node.text
			}, index);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: node.text }, index);
		}
		//#endregion
		//#region src/client/Palette.tsx
		const TOOL_ROWS = [
			{
				kind: "Review",
				icon: "review",
				shortcut: "Ctrl+Shift+G"
			},
			{
				kind: "Terminal",
				icon: "terminal",
				shortcut: "Ctrl+`"
			},
			{
				kind: "Browser",
				icon: "globe",
				shortcut: "Ctrl+T"
			},
			{
				kind: "Files",
				icon: "folder",
				shortcut: "Ctrl+P"
			}
		];
		function Palette({ onPick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcs-palette",
				children: TOOL_ROWS.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dcs-pal-row",
					onClick: () => {
						onPick(row.kind);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
							name: row.icon,
							size: 18
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcs-label",
							children: row.kind
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcs-sc",
							children: row.shortcut
						})
					]
				}, row.kind))
			});
		}
		function AddMenu({ onPick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcs-add-menu",
				role: "menu",
				children: TOOL_ROWS.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					role: "menuitem",
					className: "dcs-add-row",
					onClick: () => {
						onPick(row.kind);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
							name: row.icon,
							size: 16
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcs-label",
							children: row.kind
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcs-sc",
							children: row.shortcut
						})
					]
				}, row.kind))
			});
		}
		function decodeBrowserFrame(value) {
			if (value.byteLength < 17) throw new Error("Browser frame header is truncated");
			const view = new DataView(value);
			return {
				version: view.getUint8(0),
				sequence: view.getUint32(1),
				sentAt: view.getFloat64(5),
				width: view.getUint16(13),
				height: view.getUint16(15),
				jpeg: new Uint8Array(value, 17)
			};
		}
		function decodeBrowserOutline(value) {
			try {
				const message = JSON.parse(value);
				if (message.type !== "outline" || typeof message.documentId !== "string" || !Array.isArray(message.nodes)) return void 0;
				const nodes = [];
				for (const value of message.nodes) {
					if (!browserOutlineNode(value)) return void 0;
					nodes.push(value);
				}
				return {
					documentId: message.documentId,
					nodes
				};
			} catch {
				return;
			}
		}
		function decodeBrowserTrackedRect(value) {
			try {
				const message = JSON.parse(value);
				if (message.type !== "tracked-rect" || typeof message.documentId !== "string" || typeof message.selector !== "string") return void 0;
				if (message.rect === null) return {
					documentId: message.documentId,
					selector: message.selector,
					rect: null
				};
				if (!browserAnnotationRect(message.rect)) return void 0;
				return {
					documentId: message.documentId,
					selector: message.selector,
					rect: message.rect
				};
			} catch {
				return;
			}
		}
		function updateBrowserSelectedRect(current, update) {
			return update.type === "tracked" ? update.rect : current;
		}
		function browserAnnotationHighlightRects(selected, hovered) {
			return {
				selected,
				hovered: sameBrowserAnnotationRect(selected, hovered) ? null : hovered
			};
		}
		function sameBrowserAnnotationRect(left, right) {
			return left !== null && right !== null && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
		}
		function browserAnnotationRect(value) {
			if (typeof value !== "object" || value === null) return false;
			const rect = value;
			return [
				rect.x,
				rect.y,
				rect.w,
				rect.h
			].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
		}
		function browserSelectedRectForOutline(selector, nodes) {
			return nodes.find((node) => node.selector === selector)?.rect ?? null;
		}
		function browserAnnotationNodeAt(nodes, point) {
			return nodes.filter((node) => node.rect.w > 0 && node.rect.h > 0 && point.x >= node.rect.x && point.x <= node.rect.x + node.rect.w && point.y >= node.rect.y && point.y <= node.rect.y + node.rect.h).sort((left, right) => left.rect.w * left.rect.h - right.rect.w * right.rect.h)[0];
		}
		function browserOutlineNode(value) {
			if (typeof value !== "object" || value === null) return false;
			const node = value;
			if (typeof node.ref !== "string" || typeof node.role !== "string" || typeof node.name !== "string" || typeof node.selector !== "string") return false;
			if (typeof node.rect !== "object" || node.rect === null) return false;
			const rect = node.rect;
			return [
				rect.x,
				rect.y,
				rect.w,
				rect.h
			].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
		}
		function browserStreamSignalsReady(value) {
			if (value instanceof ArrayBuffer) return true;
			if (typeof value !== "string") return false;
			try {
				const message = JSON.parse(value);
				if (message.type === "ready") return true;
				if (message.type !== "state" || typeof message.projection !== "object" || message.projection === null) return false;
				return message.projection.status === "ready";
			} catch {
				return false;
			}
		}
		function browserWebSocketUrl(path, locationLike = window.location) {
			return (locationLike.protocol === "https:" ? "wss://" : "ws://") + locationLike.host + path;
		}
		function createBrowserInputCoalescer(send, schedule = (flush) => requestAnimationFrame(flush), cancelSchedule = (id) => cancelAnimationFrame(id)) {
			let move;
			let wheel;
			let scheduled;
			const flush = () => {
				scheduled = void 0;
				if (move !== void 0) send(move);
				if (wheel !== void 0) send(wheel);
				move = void 0;
				wheel = void 0;
			};
			const arm = () => {
				scheduled ??= schedule(flush);
			};
			return {
				push(input) {
					if (input.type === "move") {
						move = input;
						arm();
						return;
					}
					if (input.type === "wheel") {
						wheel = wheel === void 0 ? input : {
							...input,
							deltaX: Number(wheel.deltaX ?? 0) + Number(input.deltaX ?? 0),
							deltaY: Number(wheel.deltaY ?? 0) + Number(input.deltaY ?? 0)
						};
						arm();
						return;
					}
					flush();
					send(input);
				},
				flush,
				cancel() {
					if (scheduled !== void 0) cancelSchedule(scheduled);
					scheduled = void 0;
					move = void 0;
					wheel = void 0;
				}
			};
		}
		//#endregion
		//#region src/client/ManagedBrowserCanvas.tsx
		function ManagedBrowserCanvas({ tabId, device, annotate, selectedRect, selectedSelector, requestTicket, onPick, onState, children }) {
			const rootRef = (0, react.useRef)(null);
			const surfaceRef = (0, react.useRef)(null);
			const canvasRef = (0, react.useRef)(null);
			const ticketRef = (0, react.useRef)(requestTicket);
			const stateRef = (0, react.useRef)(onState);
			const deviceRef = (0, react.useRef)(device);
			const viewportRef = (0, react.useRef)({
				width: 720,
				height: 860
			});
			ticketRef.current = requestTicket;
			stateRef.current = onState;
			deviceRef.current = device;
			const inputRef = (0, react.useRef)(null);
			const socketRef = (0, react.useRef)(null);
			const annotateRef = (0, react.useRef)(annotate);
			const selectedSelectorRef = (0, react.useRef)(selectedSelector);
			const documentRef = (0, react.useRef)();
			const outlineTimerRef = (0, react.useRef)();
			annotateRef.current = annotate;
			selectedSelectorRef.current = selectedSelector;
			const dragRef = (0, react.useRef)(null);
			const inputQueueRef = (0, react.useRef)(null);
			if (inputQueueRef.current === null) inputQueueRef.current = createBrowserInputCoalescer((input) => {
				send(socketRef.current, {
					type: "input",
					input
				});
			});
			const [selection, setSelection] = (0, react.useState)(null);
			const [outlineNodes, setOutlineNodes] = (0, react.useState)([]);
			const [hovered, setHovered] = (0, react.useState)(null);
			const [selectedLiveRect, setSelectedLiveRect] = (0, react.useState)(selectedRect);
			const [status, setStatus] = (0, react.useState)("connecting");
			const [surfaceSize, setSurfaceSize] = (0, react.useState)({
				width: 0,
				height: 0
			});
			const [visible, setVisible] = (0, react.useState)(() => typeof document === "undefined" || document.visibilityState === "visible");
			const requestOutline = (delay = 0) => {
				if (outlineTimerRef.current !== void 0) clearTimeout(outlineTimerRef.current);
				outlineTimerRef.current = void 0;
				if (!annotateRef.current) return;
				outlineTimerRef.current = setTimeout(() => {
					outlineTimerRef.current = void 0;
					send(socketRef.current, { type: "outline" });
				}, delay);
			};
			const sendLayout = (socket = socketRef.current) => {
				const root = rootRef.current;
				if (root === null) return;
				const bounds = root.getBoundingClientRect();
				if (bounds.width <= 0 || bounds.height <= 0) return;
				const fixed = browserDeviceViewport(deviceRef.current);
				const viewport = fixed ?? {
					width: clamp(Math.round(bounds.width), 320, 1920),
					height: clamp(Math.round(bounds.height), 240, 1440)
				};
				viewportRef.current = viewport;
				const surface = fixed === null ? {
					width: Math.max(1, Math.round(bounds.width)),
					height: Math.max(1, Math.round(bounds.height))
				} : fitSurface(bounds.width, bounds.height, fixed);
				setSurfaceSize((current) => current.width === surface.width && current.height === surface.height ? current : surface);
				send(socket, {
					type: "resize",
					width: viewport.width,
					height: viewport.height
				});
			};
			(0, react.useEffect)(() => {
				const root = rootRef.current;
				let intersecting = true;
				const update = () => {
					const pageVisible = typeof document === "undefined" || document.visibilityState === "visible";
					setVisible(pageVisible && intersecting);
				};
				const onVisibility = () => {
					update();
				};
				document.addEventListener("visibilitychange", onVisibility);
				let observer;
				if (root !== null && typeof IntersectionObserver !== "undefined") {
					observer = new IntersectionObserver((entries) => {
						intersecting = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0);
						update();
					});
					observer.observe(root);
				}
				update();
				return () => {
					document.removeEventListener("visibilitychange", onVisibility);
					observer?.disconnect();
				};
			}, [tabId]);
			(0, react.useEffect)(() => {
				const root = rootRef.current;
				if (root === null) return;
				const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(() => {
					sendLayout();
				});
				observer?.observe(root);
				sendLayout();
				return () => {
					observer?.disconnect();
				};
			}, [device, tabId]);
			(0, react.useEffect)(() => {
				setOutlineNodes([]);
				setHovered(null);
				if (annotate) requestOutline();
				return () => {
					if (outlineTimerRef.current !== void 0) clearTimeout(outlineTimerRef.current);
					outlineTimerRef.current = void 0;
				};
			}, [annotate, tabId]);
			(0, react.useEffect)(() => {
				setSelectedLiveRect(selectedRect);
				if (selectedSelector !== null) requestOutline();
			}, [
				selectedRect?.x,
				selectedRect?.y,
				selectedRect?.w,
				selectedRect?.h,
				selectedSelector
			]);
			(0, react.useEffect)(() => {
				let stopped = false;
				let reconnect;
				let attempt = 0;
				let decoding = false;
				let latest;
				if (!visible) {
					setStatus("connecting");
					return () => {
						inputQueueRef.current?.cancel();
					};
				}
				const drawLatest = async () => {
					if (decoding) return;
					decoding = true;
					try {
						while (!stopped && latest !== void 0) {
							const value = latest;
							latest = void 0;
							const frame = decodeBrowserFrame(value);
							if (frame.version !== 1) throw new Error("Unsupported Browser stream version");
							const canvas = canvasRef.current;
							if (canvas === null) return;
							const bitmap = await createImageBitmap(new Blob([frame.jpeg], { type: "image/jpeg" }));
							if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
								canvas.width = bitmap.width;
								canvas.height = bitmap.height;
							}
							const context = canvas.getContext("bitmaprenderer");
							if (context !== null) context.transferFromImageBitmap(bitmap);
							else canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
							bitmap.close();
						}
					} finally {
						decoding = false;
					}
				};
				const connect = async () => {
					setStatus("connecting");
					const ticket = await ticketRef.current(tabId);
					if (stopped) return;
					if (ticket === void 0) {
						reconnect = setTimeout(() => {
							connect();
						}, Math.min(2e3, 250 * 2 ** attempt++));
						return;
					}
					const socket = new WebSocket(browserWebSocketUrl(ticket.path));
					socket.binaryType = "arraybuffer";
					socketRef.current = socket;
					socket.onopen = () => {
						attempt = 0;
						sendLayout(socket);
						if (annotateRef.current) requestOutline();
					};
					socket.onmessage = (event) => {
						if (browserStreamSignalsReady(event.data)) setStatus("ready");
						if (typeof event.data === "string") {
							const tracked = decodeBrowserTrackedRect(event.data);
							if (tracked !== void 0) {
								if ((documentRef.current === void 0 || documentRef.current === tracked.documentId) && selectedSelectorRef.current === tracked.selector) setSelectedLiveRect((current) => updateBrowserSelectedRect(current, {
									type: "tracked",
									rect: tracked.rect
								}));
								return;
							}
							const outline = decodeBrowserOutline(event.data);
							if (outline !== void 0) {
								if (documentRef.current === void 0 || documentRef.current === outline.documentId) {
									documentRef.current = outline.documentId;
									setOutlineNodes(outline.nodes);
									const selector = selectedSelectorRef.current;
									if (selector !== null) setSelectedLiveRect(browserSelectedRectForOutline(selector, outline.nodes));
								}
								return;
							}
							try {
								const message = JSON.parse(event.data);
								if (message.type === "ready") setStatus("ready");
								if (message.type === "state" && managedProjection(message.projection)) {
									if (documentRef.current !== void 0 && documentRef.current !== message.projection.documentId) {
										setOutlineNodes([]);
										setHovered(null);
										setSelectedLiveRect(null);
									}
									documentRef.current = message.projection.documentId;
									stateRef.current(message.projection);
									if (annotateRef.current && message.projection.status === "ready") requestOutline();
								}
							} catch {
								setStatus("error");
							}
							return;
						}
						if (event.data instanceof ArrayBuffer) {
							latest = event.data;
							drawLatest().catch(() => {
								setStatus("error");
							});
						}
					};
					socket.onerror = () => {
						setStatus("error");
					};
					socket.onclose = () => {
						if (socketRef.current === socket) socketRef.current = null;
						if (!stopped) reconnect = setTimeout(() => {
							connect();
						}, Math.min(2e3, 250 * 2 ** attempt++));
					};
				};
				connect();
				return () => {
					stopped = true;
					if (reconnect !== void 0) clearTimeout(reconnect);
					socketRef.current?.close(1e3, "Browser surface hidden");
					socketRef.current = null;
					inputQueueRef.current?.cancel();
				};
			}, [tabId, visible]);
			const point = (event) => {
				const canvas = canvasRef.current;
				if (canvas === null) return {
					x: 0,
					y: 0
				};
				const bounds = canvas.getBoundingClientRect();
				const viewport = viewportRef.current;
				return {
					x: (event.clientX - bounds.left) * viewport.width / Math.max(1, bounds.width),
					y: (event.clientY - bounds.top) * viewport.height / Math.max(1, bounds.height)
				};
			};
			const input = (value) => {
				inputQueueRef.current?.push(value);
			};
			const onPointerDown = (event) => {
				event.currentTarget.setPointerCapture(event.pointerId);
				inputRef.current?.focus({ preventScroll: true });
				const at = point(event);
				if (annotate) {
					dragRef.current = {
						point: at,
						pointerId: event.pointerId
					};
					setHovered(null);
					setSelection({
						x: at.x,
						y: at.y,
						w: 0,
						h: 0
					});
					return;
				}
				input({
					type: "down",
					...at,
					pressed: true
				});
			};
			const onPointerMove = (event) => {
				const at = point(event);
				const drag = dragRef.current;
				if (annotate) {
					if (drag?.pointerId === event.pointerId) setSelection(rectFrom(drag.point, at));
					else setHovered(browserAnnotationNodeAt(outlineNodes, at)?.rect ?? null);
					return;
				}
				input({
					type: "move",
					...at,
					pressed: event.buttons === 1
				});
			};
			const onPointerUp = (event) => {
				const at = point(event);
				const drag = dragRef.current;
				if (annotate && drag?.pointerId === event.pointerId) {
					const rect = rectFrom(drag.point, at);
					dragRef.current = null;
					setSelection(null);
					setHovered(browserAnnotationNodeAt(outlineNodes, at)?.rect ?? null);
					const canvasBounds = event.currentTarget.getBoundingClientRect();
					const rootBounds = rootRef.current?.getBoundingClientRect() ?? canvasBounds;
					onPick(rect.w < 4 && rect.h < 4 ? {
						x: at.x - 8,
						y: at.y - 8,
						w: 16,
						h: 16
					} : rect, {
						x: event.clientX - rootBounds.left,
						y: event.clientY - rootBounds.top
					});
					return;
				}
				input({
					type: "up",
					...at,
					pressed: false
				});
			};
			const onWheel = (event) => {
				event.preventDefault();
				const at = point(event);
				if (annotate) {
					setOutlineNodes([]);
					setHovered(null);
					setSelectedLiveRect((current) => updateBrowserSelectedRect(current, { type: "wheel" }));
					requestOutline(180);
				}
				const selector = selectedSelectorRef.current;
				input({
					type: "wheel",
					...at,
					deltaX: event.deltaX,
					deltaY: event.deltaY,
					...selector === null ? {} : { selector }
				});
			};
			const onKey = (event, type) => {
				input({
					type,
					key: event.key,
					code: event.code,
					modifiers: modifiers(event)
				});
				if (event.key === "Tab" || event.key === "Backspace" || event.key === "Enter" || event.metaKey || event.ctrlKey || event.altKey) event.preventDefault();
			};
			const highlights = browserAnnotationHighlightRects(selectedLiveRect, hovered);
			const surfaceStyle = surfaceSize.width <= 0 || surfaceSize.height <= 0 ? {
				width: "100%",
				height: "100%"
			} : {
				width: surfaceSize.width + "px",
				height: surfaceSize.height + "px"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-managed-browser",
				ref: rootRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-managed-browser-surface",
						ref: surfaceRef,
						style: surfaceStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
								ref: canvasRef,
								className: "dcs-managed-browser-canvas",
								tabIndex: -1,
								onPointerDown,
								onPointerMove,
								onPointerUp,
								onPointerCancel: () => {
									dragRef.current = null;
									setSelection(null);
									setHovered(null);
								},
								onPointerLeave: () => {
									if (dragRef.current === null) setHovered(null);
								},
								onWheel
							}),
							annotate && selection === null && highlights.selected !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-managed-selected",
								style: selectionStyle(highlights.selected, viewportRef.current)
							}),
							annotate && selection === null && highlights.hovered !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-managed-hover",
								style: selectionStyle(highlights.hovered, viewportRef.current)
							}),
							annotate && selection !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-managed-selection",
								style: selectionStyle(selection, viewportRef.current)
							}),
							children
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						ref: inputRef,
						className: "dcs-managed-ime",
						"aria-label": "Browser keyboard input",
						onKeyDown: (event) => {
							onKey(event, "keyDown");
						},
						onKeyUp: (event) => {
							onKey(event, "keyUp");
						},
						onInput: (event) => {
							const text = event.currentTarget.value;
							if (text.length > 0) input({
								type: "text",
								text
							});
							event.currentTarget.value = "";
						}
					}),
					status !== "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcs-managed-browser-status",
						children: status === "error" ? "Browser stream unavailable" : "Connecting…"
					})
				]
			});
		}
		function managedProjection(value) {
			if (typeof value !== "object" || value === null) return false;
			const record = value;
			return typeof record.url === "string" && typeof record.title === "string" && typeof record.documentId === "string" && (record.status === "idle" || record.status === "loading" || record.status === "ready" || record.status === "error" || record.status === "crashed") && (record.error === void 0 || typeof record.error === "string");
		}
		function send(socket, value) {
			if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
		}
		function rectFrom(start, end) {
			return {
				x: Math.min(start.x, end.x),
				y: Math.min(start.y, end.y),
				w: Math.abs(end.x - start.x),
				h: Math.abs(end.y - start.y)
			};
		}
		function modifiers(event) {
			return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
		}
		function selectionStyle(rect, viewport) {
			return {
				left: rect.x / Math.max(1, viewport.width) * 100 + "%",
				top: rect.y / Math.max(1, viewport.height) * 100 + "%",
				width: rect.w / Math.max(1, viewport.width) * 100 + "%",
				height: rect.h / Math.max(1, viewport.height) * 100 + "%"
			};
		}
		function fitSurface(containerWidth, containerHeight, viewport) {
			const scale = Math.min(containerWidth / Math.max(1, viewport.width), containerHeight / Math.max(1, viewport.height));
			return {
				width: Math.max(1, Math.round(viewport.width * scale)),
				height: Math.max(1, Math.round(viewport.height * scale))
			};
		}
		function clamp(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}
		//#endregion
		//#region src/client/BrowserPane.tsx
		/** Managed Chromium Browser chrome, Canvas stream, and screenshot-backed 批注. */
		const BROWSER_CSS = `
.dcs-browser { display:flex; flex-direction:column; flex:1; min-height:0; width:100%; position:relative; }
.dcs-b-chrome { display:flex; align-items:center; gap:2px; padding:8px 10px; border-bottom:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); flex-shrink:0; }
.dcs-b-nav { width:28px; height:28px; border:0; border-radius:6px; background:transparent; display:grid; place-items:center; color:var(--dsw-alias-label-tertiary); }
.dcs-b-nav[data-on] { color:var(--dsw-alias-label-primary); cursor:pointer; }
.dcs-b-nav[data-on]:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dcs-b-url { flex:1; display:flex; align-items:center; background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:8px; height:32px; padding:0 6px 0 10px; }
.dcs-b-url input { flex:1; background:transparent; border:0; color:var(--dsw-alias-label-primary); outline:none; font-size:12.5px; padding:0; min-width:0; }
.dcs-b-device { position:relative; flex-shrink:0; }
.dcs-b-device-trigger { width:38px; height:32px; display:flex; align-items:center; justify-content:center; gap:1px; border:0; border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); cursor:pointer; }
.dcs-b-device-trigger:hover, .dcs-b-device-trigger[data-open] { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.dcs-b-device-chevron { display:grid; place-items:center; opacity:.72; }
.dcs-b-device-menu { position:absolute; top:calc(100% + 4px); right:0; z-index:30; box-sizing:border-box; min-width:230px; width:max-content; max-width:min(280px, 70vw); max-height:calc(100vh - 84px); overflow:auto; padding:6px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-base); box-shadow:var(--dsw-shadow-lv2); font-family:var(--dsw-font-family); font-size:12.5px; font-weight:500; line-height:18px; color:var(--dsw-alias-label-primary); }
.dcs-b-device-option { display:grid; grid-template-columns:16px 18px minmax(0, 1fr); align-items:center; gap:8px; width:100%; border:0; border-radius:7px; padding:7px 8px; background:transparent; color:var(--dsw-alias-label-primary); text-align:left; font:inherit; line-height:18px; cursor:pointer; }
.dcs-b-device-option:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dcs-b-device-option[data-selected] { background:var(--dsw-alias-bg-layer-2); }
.dcs-b-device-check { color:var(--dsw-alias-label-secondary); font-size:12px; text-align:center; }
.dcs-b-device-icon { width:18px; height:18px; display:grid; place-items:center; color:var(--dsw-alias-label-tertiary); }
.dcs-b-device-option[data-selected] .dcs-b-device-icon { color:var(--dsw-alias-label-primary); }
.dcs-b-empty { flex:1; min-height:0; width:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-bg-base); }
.dcs-b-empty h2 { margin:10px 0 0; font-size:17px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.dcs-b-empty p { margin:0; font-size:13px; color:var(--dsw-alias-label-tertiary); max-width:320px; text-align:center; }
.dcs-b-page { flex:1; min-height:0; width:100%; position:relative; overflow:hidden; background:#fff; }
.dcs-managed-browser { position:absolute; inset:0; overflow:hidden; display:grid; place-items:center; background:#f3f4f6; }
.dcs-managed-browser-surface { position:relative; flex:none; overflow:hidden; background:#fff; box-shadow:0 1px 8px rgba(15,23,42,.16); }
.dcs-managed-browser-canvas { width:100%; height:100%; display:block; touch-action:none; user-select:none; outline:none; }
.dcs-managed-ime { position:absolute; left:-10000px; top:0; width:1px; height:1px; opacity:0; }
.dcs-managed-browser-status { position:absolute; inset:0; z-index:6; display:grid; place-items:center; pointer-events:none; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-base); font-size:13px; }
.dcs-managed-selected, .dcs-managed-hover, .dcs-managed-selection { position:absolute; pointer-events:none; box-sizing:border-box; z-index:2; }
.dcs-managed-selected { border:2px solid #0ea5e9; background:rgba(14,165,233,.2); box-shadow:0 0 0 1px rgba(255,255,255,.7) inset; }
.dcs-managed-hover { border:1.5px solid #38bdf8; background:rgba(56,189,248,.1); }
.dcs-managed-selection { border:1.5px solid #38bdf8; background:rgba(56,189,248,.18); }
.dcs-b-chrome > .dcs-tool[data-on] { background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-base); }
.dcs-b-capturing { position:absolute; left:50%; bottom:10px; transform:translateX(-50%); z-index:5; pointer-events:none; padding:5px 10px; border-radius:999px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); font-size:12px; }
.dcs-b-badge { position:absolute; z-index:4; border:0; border-radius:999px; min-width:18px; height:18px; padding:0 5px; transform:translate(-50%,-100%); background:#38bdf8; color:#0f172a; font-size:11px; font-weight:700; cursor:pointer; }
.dcs-b-hl { position:absolute; pointer-events:none; z-index:3; box-sizing:border-box; border:1.5px solid #7dd3fc; background:rgba(125,211,252,.16); }
`;
		function ensureBrowserStyles() {
			if (typeof document === "undefined") return;
			let style = document.getElementById("dsh-codex-sidebar-browser-css");
			if (style === null) {
				style = document.createElement("style");
				style.id = "dsh-codex-sidebar-browser-css";
				document.head.appendChild(style);
			}
			style.textContent = BROWSER_CSS;
		}
		function BrowserPane({ snapshot, onIntent, requestTicket, requestCapture, sendLabel, addLabel, deleteLabel }) {
			ensureBrowserStyles();
			const browser = snapshot.browser;
			const bodyRef = (0, react.useRef)(null);
			const pageRef = (0, react.useRef)(null);
			const [draft, setDraft] = (0, react.useState)(browser.draft);
			const [capturing, setCapturing] = (0, react.useState)(false);
			const [deviceOverride, setDeviceOverride] = (0, react.useState)(null);
			const device = deviceOverride ?? browser.device;
			const href = liveHref(browser.url);
			const hasPage = href !== void 0;
			const tabId = snapshot.tabs.find((tab) => tab.id === snapshot.active && tab.kind === "Browser")?.id;
			(0, react.useEffect)(() => {
				setDraft(browser.draft);
			}, [browser.draft]);
			(0, react.useEffect)(() => {
				setDeviceOverride(null);
			}, [browser.device]);
			(0, react.useEffect)(() => {
				if (!browser.annotate) return;
				const onKey = (event) => {
					if (event.key !== "Escape" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
					event.preventDefault();
					onIntent({
						type: "browser-set-annotate",
						on: false
					});
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [browser.annotate, onIntent]);
			const submitUrl = (event) => {
				event.preventDefault();
				onIntent({
					type: "open-url",
					url: draft
				});
			};
			const openLive = () => {
				if (href === void 0) return;
				onIntent({ type: "browser-open-external" });
				window.open(href, "_blank", "noopener");
			};
			const pick = async (rect, anchor) => {
				if (tabId === void 0 || capturing) return;
				setCapturing(true);
				try {
					const capture = await requestCapture(tabId);
					if (capture === void 0) return;
					const hit = targetFor(rect, capture);
					const page = pageRef.current;
					const body = bodyRef.current;
					const x = anchor.x + (page?.offsetLeft ?? 0);
					const y = anchor.y + (page?.offsetTop ?? 0);
					onIntent({
						type: "browser-click-content",
						mark: hit === void 0 ? areaCaption(rect) : nodeCaption(hit),
						x: body === null ? x : Math.min(body.clientWidth - 12, Math.max(12, x)),
						y: body === null ? y : Math.min(body.clientHeight - 12, Math.max(12, y)),
						captureId: capture.captureId,
						documentId: capture.documentId,
						...hit === void 0 ? { rect } : {
							selector: hit.selector,
							rect: hit.rect ?? rect
						}
					});
				} finally {
					setCapturing(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-browser",
				ref: bodyRef,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-b-chrome",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavButton, {
								title: "后退",
								enabled: browser.canBack,
								icon: "back",
								onClick: () => {
									onIntent({ type: "browser-back" });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavButton, {
								title: "前进",
								enabled: browser.canForward,
								icon: "fwd",
								onClick: () => {
									onIntent({ type: "browser-forward" });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavButton, {
								title: "刷新",
								enabled: hasPage,
								icon: "refresh",
								onClick: () => {
									onIntent({ type: "browser-refresh" });
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								className: "dcs-b-url",
								onSubmit: submitUrl,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: draft,
									placeholder: "Enter a URL",
									onChange: (event) => {
										setDraft(event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NavButton, {
									title: "外部打开",
									enabled: hasPage,
									icon: "external",
									onClick: openLive
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DevicePicker, {
								value: device,
								onChange: (next) => {
									setDeviceOverride(next);
									onIntent({
										type: "browser-set-device",
										device: next
									});
								}
							}),
							browser.canAnnotate && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								title: "批注",
								className: "dcs-tool",
								"data-on": browser.annotate || void 0,
								onClick: () => {
									onIntent({
										type: "browser-set-annotate",
										on: !browser.annotate
									});
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
									name: "pencil",
									size: 14
								})
							})
						]
					}),
					browser.status === "empty" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Empty, {
						title: "打开网页",
						detail: "输入 URL，在侧栏里查看页面"
					}),
					browser.status !== "empty" && href === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Empty, {
						title: "无法打开",
						detail: "需要 http 或 https 地址"
					}),
					browser.status !== "empty" && href !== void 0 && tabId !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-b-page",
						ref: pageRef,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ManagedBrowserCanvas, {
							tabId,
							device,
							annotate: browser.annotate,
							selectedRect: browser.pendingRect,
							selectedSelector: browser.pendingSelector,
							requestTicket,
							onPick: pick,
							onState: (projection) => {
								onIntent({
									type: "browser-runtime-sync",
									tabId,
									url: projection.url,
									title: projection.title,
									documentId: projection.documentId,
									status: projection.status,
									...projection.error === void 0 ? {} : { error: projection.error }
								});
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StackedBadges, {
								attachments: visibleAnnotations(snapshot),
								url: browser.url,
								onEdit: (id, event) => {
									const box = bodyRef.current?.getBoundingClientRect();
									if (snapshot.attachments.some((item) => item.id === id)) {
										onIntent({
											type: "edit-attachment",
											id,
											x: box === void 0 ? 180 : event.clientX - box.left,
											y: box === void 0 ? 72 : event.clientY - box.top
										});
										return;
									}
									const delivered = snapshot.deliveredMarks.find((item) => item.id === id);
									if (delivered !== void 0) onIntent({
										type: "reveal-mark",
										mark: delivered
									});
								}
							})
						}), capturing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dcs-b-capturing",
							children: "Capturing screenshot…"
						})]
					}),
					browser.pendingMark !== null && browser.notePos !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoteComposer, {
						containerRef: bodyRef,
						viewportRef: pageRef,
						anchor: browser.notePos,
						value: browser.noteDraft,
						objectText: shortCaption(browser.pendingMark),
						placeholder: "批注",
						sendLabel,
						addLabel,
						deleteLabel,
						editing: browser.editingId !== null,
						onDelete: () => {
							if (browser.editingId !== null) onIntent({
								type: "remove-attachment",
								id: browser.editingId
							});
						},
						onChange: (text) => {
							onIntent({
								type: "browser-set-note-draft",
								text
							});
						},
						onAdd: () => {
							onIntent({ type: "browser-note-add" });
						},
						onSend: () => {
							onIntent({ type: "browser-note-send" });
						},
						onDismiss: () => {
							onIntent({ type: "browser-dismiss-note" });
						}
					})
				]
			});
		}
		function NavButton({ title, enabled, icon, onClick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				title,
				className: "dcs-b-nav",
				"data-on": enabled || void 0,
				disabled: !enabled,
				onClick,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
					name: icon,
					size: 15
				})
			});
		}
		function DevicePicker({ value, onChange }) {
			const [open, setOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const selected = BROWSER_DEVICE_PRESETS.find((preset) => preset.id === value) ?? BROWSER_DEVICE_PRESETS[0];
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (!rootRef.current?.contains(event.target)) setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						setOpen(false);
					}
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-b-device",
				ref: rootRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dcs-b-device-trigger",
					"data-open": open || void 0,
					"aria-label": selected?.label ?? "页面尺寸",
					title: selected?.label ?? "页面尺寸",
					"aria-haspopup": "menu",
					"aria-expanded": open,
					onClick: () => {
						setOpen((current) => !current);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
						name: deviceIcon(value),
						size: 20
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcs-b-device-chevron",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
							name: "chevron-down",
							size: 10
						})
					})]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcs-b-device-menu",
					role: "menu",
					"aria-label": "页面尺寸",
					children: BROWSER_DEVICE_PRESETS.map((preset) => {
						const current = preset.id === value;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "menuitemradio",
							"aria-checked": current,
							className: "dcs-b-device-option",
							"data-selected": current || void 0,
							onClick: () => {
								onChange(preset.id);
								setOpen(false);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dcs-b-device-check",
									children: current ? "✓" : ""
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dcs-b-device-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
										name: deviceIcon(preset.id),
										size: 16
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: preset.label })
							]
						}, preset.id);
					})
				})]
			});
		}
		function deviceIcon(device) {
			if (device === "phone") return "device-phone";
			if (device === "tablet") return "device-tablet";
			if (device === "laptop") return "device-laptop";
			return "device-responsive";
		}
		function Empty({ title, detail }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-b-empty",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
						name: "globe",
						size: 48
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: title }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: detail })
				]
			});
		}
		function targetFor(rect, capture) {
			const center = {
				x: rect.x + rect.w / 2,
				y: rect.y + rect.h / 2
			};
			return capture.nodes.filter((node) => node.rect !== void 0 && contains(node.rect, center)).sort((left, right) => area(left.rect) - area(right.rect))[0];
		}
		function contains(rect, point) {
			return rect !== void 0 && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
		}
		function area(rect) {
			return rect === void 0 ? Number.POSITIVE_INFINITY : rect.w * rect.h;
		}
		function nodeCaption(node) {
			return (node.name.trim() || node.selector || node.role).slice(0, 120);
		}
		function areaCaption(rect) {
			return "area " + Math.round(rect.x) + "," + Math.round(rect.y) + " " + Math.round(rect.w) + "×" + Math.round(rect.h);
		}
		function shortCaption(value) {
			return value.length <= 44 ? value : value.slice(0, 41) + "…";
		}
		function StackedBadges({ attachments, url, onEdit }) {
			const marks = attachments.flatMap((item, index) => {
				if (item.source !== "browser" || item.evidence === void 0 || item.url !== void 0 && item.url !== url) return [];
				const rect = item.rect ?? {
					x: 18 + index * 22,
					y: 18,
					w: 0,
					h: 0
				};
				return [{
					item,
					n: index + 1,
					rect
				}];
			});
			if (marks.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: marks.map(({ item, n, rect }) => {
				const width = item.evidence?.width ?? 1;
				const height = item.evidence?.height ?? 1;
				const style = {
					left: rect.x / width * 100 + "%",
					top: rect.y / height * 100 + "%",
					width: rect.w / width * 100 + "%",
					height: rect.h / height * 100 + "%"
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [rect.w > 1 && rect.h > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcs-b-hl",
					style
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dcs-b-badge",
					style: {
						left: style.left,
						top: style.top
					},
					onClick: (event) => {
						onEdit(item.id, event);
					},
					children: n
				})] }, item.id);
			}) });
		}
		//#endregion
		//#region src/client/ReviewPane.tsx
		/** Review 工具 pane: read-only unified diff + 批注 at the gutter. */
		const REVIEW_CSS = `
.dcs-rev {
  display: flex; flex-direction: column; min-height: 0; flex: 1;
  padding: 12px 14px 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
}
.dcs-rev-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; position: relative; z-index: 5; overflow: visible; }
.dcs-rev-seg {
  margin-left: auto; display: flex; background: var(--dsw-alias-bg-layer-2);
  border-radius: 8px; padding: 2px;
}
.dcs-rev-seg button {
  border: 0; background: transparent; padding: 4px 10px; border-radius: 6px;
  font-size: 11.5px; cursor: pointer; color: var(--dsw-alias-label-secondary);
}
.dcs-rev-seg button[data-on] {
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2);
}
.dcs-rev-k {
  font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px;
  display: flex; justify-content: space-between; padding: 0 4px; font-weight: 500; letter-spacing: .04em;
}
.dcs-rev-list { flex: 1; overflow: auto; min-height: 0; }
.dcs-rev-row {
  display: flex; align-items: baseline; gap: 8px; padding: 9px 8px; cursor: pointer;
  border-radius: 8px; width: 100%; border: 0; background: transparent; text-align: left;
  appearance: none; -webkit-appearance: none;
  font-family: inherit; color: var(--dsw-alias-label-primary);
}
.dcs-rev-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-name { font-size: 13.5px; font-weight: 500; }
.dcs-rev-dir { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-stat { margin-left: auto; font-family: var(--ds-font-family-code); font-size: 12px; white-space: nowrap; }
.dcs-rev-addn { color: #3dd68c; } .dcs-rev-deln { color: #e85d5d; }
.dcs-rev-diff {
  font-family: var(--ds-font-family-code); font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden;
  margin: 0 4px 10px; background: var(--dsw-alias-bg-base);
}
.dcs-rev-hunk {
  padding: 5px 12px; color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2); font-size: 11px;
}
.dcs-rev-line { display: grid; grid-template-columns: 22px 34px 34px 14px 1fr; align-items: stretch; }
.dcs-rev-line[data-kind="add"] { background: color-mix(in srgb, #3dd68c 14%, transparent); }
.dcs-rev-line[data-kind="del"] { background: color-mix(in srgb, #e85d5d 14%, transparent); }
.dcs-rev-line[data-annotated] { box-shadow: inset 3px 0 #38bdf8; }
.dcs-rev-gutter { display: flex; align-items: center; justify-content: center; }
.dcs-rev-badge {
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: #38bdf8; color: #0f172a;
  font-size: 10px; font-weight: 700; line-height: 16px;
}
.dcs-rev-plus {
  width: 16px; height: 16px; border: 0; border-radius: 3px;
  background: #3dd68c; color: var(--dsw-alias-bg-base); cursor: pointer;
  font-size: 13px; line-height: 16px; padding: 0;
}
.dcs-rev-ln { text-align: right; padding: 3px 7px 3px 0; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-ln[data-kind="del"] { color: #e85d5d; }
.dcs-rev-ln[data-kind="add"] { color: #3dd68c; }
.dcs-rev-sign { padding-top: 3px; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-sign[data-kind="add"] { color: #3dd68c; }
.dcs-rev-sign[data-kind="del"] { color: #e85d5d; }
.dcs-rev-code { padding: 3px 8px 3px 0; white-space: pre; color: var(--dsw-alias-label-primary); }
.dcs-rev-note {
  background: var(--dsw-alias-bg-layer-1); padding: 10px 12px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dcs-rev-note input {
  flex: 1; min-width: 0; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; color: var(--dsw-alias-label-primary); padding: 8px 10px; font-size: 13px; outline: none;
}
.dcs-rev-note-row { display: flex; align-items: center; gap: 8px; }
.dcs-rev-add {
  flex-shrink: 0; height: 32px; padding: 0 10px; border: 0; border-radius: 6px; cursor: pointer;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500;
}
.dcs-rev-add:hover { color: var(--dsw-alias-label-primary); }
.dcs-rev-delete, .dcs-rev-send {
  flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
}
.dcs-rev-delete { background: transparent; color: var(--dsw-alias-label-tertiary); }
.dcs-rev-delete:hover { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-send { background: var(--dsw-alias-interactive-primary); color: var(--dsw-alias-label-primary-on-color); }
.dcs-rev-dd { position: relative; min-width: 0; flex: 0 1 auto; max-width: min(280px, 52%); overflow: visible; }
.dcs-rev-dd-btn {
  border: 0; background: var(--dsw-alias-bg-layer-2); padding: 5px 8px; border-radius: 8px;
  cursor: pointer; color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family); font-size: 12.5px; font-weight: 500; line-height: 18px;
  display: inline-grid; grid-template-columns: auto auto 10px; align-items: center; gap: 8px;
  width: max-content; max-width: 100%; text-align: left;
  appearance: none; -webkit-appearance: none;
}
.dcs-rev-dd-btn:hover, .dcs-rev-dd-btn[data-open] { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-rev-dd-btn > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcs-rev-dd-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; box-sizing: border-box;
  min-width: 100%; width: max-content; max-width: min(280px, 70vw); padding: 6px;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px; box-shadow: var(--dsw-shadow-lv2);
  font-family: var(--dsw-font-family); font-size: 12.5px; font-weight: 500; line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
button.dcs-rev-dd-item, button.dcs-rev-dd-sub {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 100%; border: 0; background: transparent;
  padding: 7px 8px; border-radius: 7px; cursor: pointer; text-align: left;
  appearance: none; -webkit-appearance: none;
  font-family: inherit; font-size: 12.5px; font-weight: 500; line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.dcs-rev-dd-sub .dcs-rev-dd-label { padding-left: 12px; color: var(--dsw-alias-label-secondary); }
button.dcs-rev-dd-item:hover, button.dcs-rev-dd-sub:hover { background: var(--dsw-alias-interactive-bg-hover); }
button.dcs-rev-dd-item[data-on], button.dcs-rev-dd-sub[data-on] { background: var(--dsw-alias-bg-layer-2); }
.dcs-rev-dd-check { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dcs-rev-dd-stat { margin: 0; font-family: var(--ds-font-family-code); font-size: 12px; white-space: nowrap; justify-self: end; }
.dcs-rev-empty { padding: 18px 8px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
`;
		function ensureReviewCss() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dcs-rev-css")) return;
			const style = document.createElement("style");
			style.id = "dcs-rev-css";
			style.textContent = REVIEW_CSS;
			document.head.appendChild(style);
		}
		function ReviewPane({ snapshot, onIntent }) {
			ensureReviewCss();
			const review = snapshot.review;
			const [hover, setHover] = (0, react.useState)(null);
			const [menu, setMenu] = (0, react.useState)(null);
			const headRef = (0, react.useRef)(null);
			const branches = review.branches ?? {
				current: "",
				names: []
			};
			const branch = review.branch || branches.current;
			const scopes = review.scopes ?? ZERO_SCOPES;
			const mode = review.mode === "staged" || review.mode === "unstaged" || review.mode === "uncommitted" ? review.mode : review.mode === "tree" ? "uncommitted" : "turn";
			const scopeKey = mode === "turn" ? "turn" : mode;
			function pick(next) {
				setMenu(null);
				onIntent({
					type: "review-switch",
					mode: next
				});
			}
			function pickBranch(name) {
				setMenu(null);
				onIntent({
					type: "review-set-branch",
					branch: name
				});
			}
			(0, react.useEffect)(() => {
				if (menu === null) return;
				const onPointer = (event) => {
					if (headRef.current?.contains(event.target)) return;
					setMenu(null);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setMenu(null);
				};
				document.addEventListener("pointerdown", onPointer);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer);
					document.removeEventListener("keydown", onKey);
				};
			}, [menu]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-rev",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-rev-head",
					ref: headRef,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcs-rev-dd",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dcs-rev-dd-btn",
								"data-open": menu === "scope" || void 0,
								"aria-haspopup": "menu",
								"aria-expanded": menu === "scope",
								onClick: () => {
									setMenu((on) => on === "scope" ? null : "scope");
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: modeLabel(mode) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeStat, { stat: scopes[scopeKey] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "▾"
									})
								]
							}), menu === "scope" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-rev-dd-menu",
								role: "menu",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeItem, {
										on: mode === "turn",
										indent: false,
										label: "本轮变更",
										stat: scopes.turn,
										onClick: () => {
											pick("turn");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeItem, {
										on: mode === "uncommitted",
										indent: false,
										label: "未提交",
										stat: scopes.uncommitted,
										onClick: () => {
											pick("uncommitted");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeItem, {
										on: mode === "staged",
										indent: true,
										label: "已暂存",
										stat: scopes.staged,
										onClick: () => {
											pick("staged");
										}
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeItem, {
										on: mode === "unstaged",
										indent: true,
										label: "未暂存",
										stat: scopes.unstaged,
										onClick: () => {
											pick("unstaged");
										}
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcs-rev-dd",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dcs-rev-dd-btn",
								"data-open": menu === "branch" || void 0,
								"aria-haspopup": "menu",
								"aria-expanded": menu === "branch",
								onClick: () => {
									setMenu((on) => on === "branch" ? null : "branch");
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: branch.length > 0 ? branch : "无分支" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "▾"
									})
								]
							}), menu === "branch" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-rev-dd-menu",
								role: "menu",
								children: [branches.names.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dcs-rev-empty",
									children: "不是 git 仓库，没有分支可筛。"
								}), branches.names.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dcs-rev-dd-item",
									"data-on": name === branch || void 0,
									onClick: () => {
										pickBranch(name);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dcs-rev-dd-check",
											children: name === branch ? "✓" : ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dcs-rev-dd-label",
											children: [name, name === branches.current ? " · 当前" : ""]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
									]
								}, name))]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dcs-rev-k",
							style: {
								margin: 0,
								marginLeft: "auto"
							},
							children: "只读"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-rev-list",
					children: [review.files.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dcs-rev-empty",
						children: emptyHint(mode)
					}), review.files.map((file) => {
						const open = review.openDiff?.path === file.path;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dcs-rev-row",
							onClick: () => {
								onIntent({
									type: "review-toggle-file",
									path: file.path
								});
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dcs-rev-name",
									children: file.name
								}),
								file.dir.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dcs-rev-dir",
									children: file.dir
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: "dcs-rev-stat",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dcs-rev-addn",
											children: ["+", file.added]
										}),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "dcs-rev-deln",
											children: ["−", file.removed]
										})
									]
								})
							]
						}), open && review.openDiff !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcs-rev-diff",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dcs-rev-hunk",
								children: review.openDiff.hunk
							}), review.openDiff.lines.map((line, index) => {
								const lineNo = line.newNo ?? line.oldNo;
								const mark = `${file.path}:${lineNo ?? index}`;
								const showPlus = hover === mark;
								const pending = review.pendingMark === mark;
								const stacked = reviewBadge(visibleAnnotations(snapshot), mark);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dcs-rev-line",
									"data-kind": line.kind === "ctx" ? void 0 : line.kind,
									"data-annotated": stacked !== void 0 || void 0,
									onMouseEnter: () => {
										setHover(mark);
									},
									onMouseLeave: () => {
										setHover((cur) => cur === mark ? null : cur);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dcs-rev-gutter",
											children: stacked !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dcs-rev-badge",
												"aria-label": `编辑批注 ${stacked.n}`,
												onClick: (event) => {
													event.stopPropagation();
													if (snapshot.attachments.some((item) => item.id === stacked.id)) {
														onIntent({
															type: "edit-attachment",
															id: stacked.id
														});
														return;
													}
													const delivered = snapshot.deliveredMarks.find((item) => item.id === stacked.id);
													if (delivered !== void 0) onIntent({
														type: "reveal-mark",
														mark: delivered
													});
												},
												children: stacked.n
											}) : showPlus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: "dcs-rev-plus",
												title: "批注此行",
												onClick: (event) => {
													event.stopPropagation();
													onIntent({
														type: "review-gutter",
														mark
													});
												},
												children: "+"
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dcs-rev-ln",
											"data-kind": line.kind === "del" ? "del" : void 0,
											children: line.oldNo ?? ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dcs-rev-ln",
											"data-kind": line.kind === "add" ? "add" : void 0,
											children: line.newNo ?? ""
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dcs-rev-sign",
											"data-kind": line.kind === "ctx" ? void 0 : line.kind,
											children: line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dcs-rev-code",
											children: line.text.length === 0 ? " " : line.text
										})
									]
								}), pending && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReviewNote, {
									value: review.noteDraft,
									editingId: review.editingId,
									onIntent
								})] }, index);
							})]
						})] }, file.path);
					})]
				})]
			});
		}
		const ZERO_SCOPES = {
			turn: {
				added: 0,
				removed: 0
			},
			uncommitted: {
				added: 0,
				removed: 0
			},
			staged: {
				added: 0,
				removed: 0
			},
			unstaged: {
				added: 0,
				removed: 0
			}
		};
		function modeLabel(mode) {
			if (mode === "uncommitted" || mode === "tree") return "未提交";
			if (mode === "staged") return "已暂存";
			if (mode === "unstaged") return "未暂存";
			return "本轮变更";
		}
		function emptyHint(mode) {
			if (mode === "turn") return "本轮没有文件写入。";
			if (mode === "staged") return "没有已暂存的变更。";
			if (mode === "unstaged") return "没有未暂存的变更。";
			return "没有未提交的变更。不是 git 仓库时这里会是空的，本轮写入请切到「本轮变更」。";
		}
		function ScopeItem({ on, indent, label, stat, onClick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: indent ? "dcs-rev-dd-sub" : "dcs-rev-dd-item",
				"data-on": on || void 0,
				onClick,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcs-rev-dd-check",
						children: on ? "✓" : ""
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dcs-rev-dd-label",
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ScopeStat, { stat })
				]
			});
		}
		function ScopeStat({ stat }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dcs-rev-dd-stat",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcs-rev-addn",
						children: ["+", stat.added]
					}),
					" ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcs-rev-deln",
						children: ["−", stat.removed]
					})
				]
			});
		}
		function ReviewNote({ value, editingId, onIntent }) {
			const draft = useImeSafeDraft(value, (text) => {
				onIntent({
					type: "review-set-note-draft",
					text
				});
			});
			function onNoteKey(event) {
				if (isImeKey(event.nativeEvent)) return;
				event.stopPropagation();
				if (event.key === "Escape") {
					event.preventDefault();
					onIntent({ type: "review-dismiss-note" });
					return;
				}
				if (event.key === "Enter") {
					event.preventDefault();
					draft.flush();
					onIntent({ type: "review-note-add" });
				}
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcs-rev-note",
				onClick: (event) => {
					event.stopPropagation();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-rev-note-row",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							autoFocus: true,
							value: draft.value,
							placeholder: "给当前会话留一条批注",
							onChange: (event) => {
								draft.onChange(event.target.value);
							},
							onCompositionStart: draft.onCompositionStart,
							onCompositionEnd: (event) => {
								draft.onCompositionEnd(event.currentTarget.value);
							},
							onKeyDown: onNoteKey
						}),
						editingId !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-rev-delete",
							title: "删除批注",
							"aria-label": "删除批注",
							onClick: () => {
								onIntent({
									type: "remove-attachment",
									id: editingId
								});
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "trash",
								size: 13
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-rev-add",
							onClick: () => {
								draft.flush();
								onIntent({ type: "review-note-add" });
							},
							children: "新增"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-rev-send",
							title: "发送",
							"aria-label": "发送",
							onClick: () => {
								draft.flush();
								onIntent({ type: "review-note-send" });
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "send",
								size: 13
							})
						})
					]
				})
			});
		}
		function reviewBadge(attachments, mark) {
			const index = attachments.findIndex((item) => item.source === "review" && item.selector === mark);
			const item = index < 0 ? void 0 : attachments[index];
			return item === void 0 ? void 0 : {
				n: index + 1,
				id: item.id
			};
		}
		//#endregion
		//#region node_modules/.pnpm/@xterm+xterm@5.5.0/node_modules/@xterm/xterm/lib/xterm.js
		var require_xterm = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			(function(e, t) {
				if ("object" == typeof exports && "object" == typeof module) module.exports = t();
				else if ("function" == typeof define && define.amd) define([], t);
				else {
					var i = t();
					for (var s in i) ("object" == typeof exports ? exports : e)[s] = i[s];
				}
			})(globalThis, (() => (() => {
				"use strict";
				var e = {
					4567: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.AccessibilityManager = void 0;
						const n = i(9042), o = i(9924), a = i(844), h = i(4725), c = i(2585), l = i(3656);
						let d = t.AccessibilityManager = class extends a.Disposable {
							constructor(e, t, i, s) {
								super(), this._terminal = e, this._coreBrowserService = i, this._renderService = s, this._rowColumns = /* @__PURE__ */ new WeakMap(), this._liveRegionLineCount = 0, this._charsToConsume = [], this._charsToAnnounce = "", this._accessibilityContainer = this._coreBrowserService.mainDocument.createElement("div"), this._accessibilityContainer.classList.add("xterm-accessibility"), this._rowContainer = this._coreBrowserService.mainDocument.createElement("div"), this._rowContainer.setAttribute("role", "list"), this._rowContainer.classList.add("xterm-accessibility-tree"), this._rowElements = [];
								for (let e = 0; e < this._terminal.rows; e++) this._rowElements[e] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e]);
								if (this._topBoundaryFocusListener = (e) => this._handleBoundaryFocus(e, 0), this._bottomBoundaryFocusListener = (e) => this._handleBoundaryFocus(e, 1), this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions(), this._accessibilityContainer.appendChild(this._rowContainer), this._liveRegion = this._coreBrowserService.mainDocument.createElement("div"), this._liveRegion.classList.add("live-region"), this._liveRegion.setAttribute("aria-live", "assertive"), this._accessibilityContainer.appendChild(this._liveRegion), this._liveRegionDebouncer = this.register(new o.TimeBasedDebouncer(this._renderRows.bind(this))), !this._terminal.element) throw new Error("Cannot enable accessibility before Terminal.open");
								this._terminal.element.insertAdjacentElement("afterbegin", this._accessibilityContainer), this.register(this._terminal.onResize(((e) => this._handleResize(e.rows)))), this.register(this._terminal.onRender(((e) => this._refreshRows(e.start, e.end)))), this.register(this._terminal.onScroll((() => this._refreshRows()))), this.register(this._terminal.onA11yChar(((e) => this._handleChar(e)))), this.register(this._terminal.onLineFeed((() => this._handleChar("\n")))), this.register(this._terminal.onA11yTab(((e) => this._handleTab(e)))), this.register(this._terminal.onKey(((e) => this._handleKey(e.key)))), this.register(this._terminal.onBlur((() => this._clearLiveRegion()))), this.register(this._renderService.onDimensionsChange((() => this._refreshRowsDimensions()))), this.register((0, l.addDisposableDomListener)(document, "selectionchange", (() => this._handleSelectionChange()))), this.register(this._coreBrowserService.onDprChange((() => this._refreshRowsDimensions()))), this._refreshRows(), this.register((0, a.toDisposable)((() => {
									this._accessibilityContainer.remove(), this._rowElements.length = 0;
								})));
							}
							_handleTab(e) {
								for (let t = 0; t < e; t++) this._handleChar(" ");
							}
							_handleChar(e) {
								this._liveRegionLineCount < 21 && (this._charsToConsume.length > 0 ? this._charsToConsume.shift() !== e && (this._charsToAnnounce += e) : this._charsToAnnounce += e, "\n" === e && (this._liveRegionLineCount++, 21 === this._liveRegionLineCount && (this._liveRegion.textContent += n.tooMuchOutput)));
							}
							_clearLiveRegion() {
								this._liveRegion.textContent = "", this._liveRegionLineCount = 0;
							}
							_handleKey(e) {
								this._clearLiveRegion(), /\p{Control}/u.test(e) || this._charsToConsume.push(e);
							}
							_refreshRows(e, t) {
								this._liveRegionDebouncer.refresh(e, t, this._terminal.rows);
							}
							_renderRows(e, t) {
								const i = this._terminal.buffer, s = i.lines.length.toString();
								for (let r = e; r <= t; r++) {
									const e = i.lines.get(i.ydisp + r), t = [], n = e?.translateToString(!0, void 0, void 0, t) || "", o = (i.ydisp + r + 1).toString(), a = this._rowElements[r];
									a && (0 === n.length ? (a.innerText = "\xA0", this._rowColumns.set(a, [0, 1])) : (a.textContent = n, this._rowColumns.set(a, t)), a.setAttribute("aria-posinset", o), a.setAttribute("aria-setsize", s));
								}
								this._announceCharacters();
							}
							_announceCharacters() {
								0 !== this._charsToAnnounce.length && (this._liveRegion.textContent += this._charsToAnnounce, this._charsToAnnounce = "");
							}
							_handleBoundaryFocus(e, t) {
								const i = e.target, s = this._rowElements[0 === t ? 1 : this._rowElements.length - 2];
								if (i.getAttribute("aria-posinset") === (0 === t ? "1" : `${this._terminal.buffer.lines.length}`)) return;
								if (e.relatedTarget !== s) return;
								let r, n;
								if (0 === t ? (r = i, n = this._rowElements.pop(), this._rowContainer.removeChild(n)) : (r = this._rowElements.shift(), n = i, this._rowContainer.removeChild(r)), r.removeEventListener("focus", this._topBoundaryFocusListener), n.removeEventListener("focus", this._bottomBoundaryFocusListener), 0 === t) {
									const e = this._createAccessibilityTreeNode();
									this._rowElements.unshift(e), this._rowContainer.insertAdjacentElement("afterbegin", e);
								} else {
									const e = this._createAccessibilityTreeNode();
									this._rowElements.push(e), this._rowContainer.appendChild(e);
								}
								this._rowElements[0].addEventListener("focus", this._topBoundaryFocusListener), this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._terminal.scrollLines(0 === t ? -1 : 1), this._rowElements[0 === t ? 1 : this._rowElements.length - 2].focus(), e.preventDefault(), e.stopImmediatePropagation();
							}
							_handleSelectionChange() {
								if (0 === this._rowElements.length) return;
								const e = document.getSelection();
								if (!e) return;
								if (e.isCollapsed) return void (this._rowContainer.contains(e.anchorNode) && this._terminal.clearSelection());
								if (!e.anchorNode || !e.focusNode) return void console.error("anchorNode and/or focusNode are null");
								let t = {
									node: e.anchorNode,
									offset: e.anchorOffset
								}, i = {
									node: e.focusNode,
									offset: e.focusOffset
								};
								if ((t.node.compareDocumentPosition(i.node) & Node.DOCUMENT_POSITION_PRECEDING || t.node === i.node && t.offset > i.offset) && ([t, i] = [i, t]), t.node.compareDocumentPosition(this._rowElements[0]) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_FOLLOWING) && (t = {
									node: this._rowElements[0].childNodes[0],
									offset: 0
								}), !this._rowContainer.contains(t.node)) return;
								const s = this._rowElements.slice(-1)[0];
								if (i.node.compareDocumentPosition(s) & (Node.DOCUMENT_POSITION_CONTAINED_BY | Node.DOCUMENT_POSITION_PRECEDING) && (i = {
									node: s,
									offset: s.textContent?.length ?? 0
								}), !this._rowContainer.contains(i.node)) return;
								const r = ({ node: e, offset: t }) => {
									const i = e instanceof Text ? e.parentNode : e;
									let s = parseInt(i?.getAttribute("aria-posinset"), 10) - 1;
									if (isNaN(s)) return console.warn("row is invalid. Race condition?"), null;
									const r = this._rowColumns.get(i);
									if (!r) return console.warn("columns is null. Race condition?"), null;
									let n = t < r.length ? r[t] : r.slice(-1)[0] + 1;
									return n >= this._terminal.cols && (++s, n = 0), {
										row: s,
										column: n
									};
								}, n = r(t), o = r(i);
								if (n && o) {
									if (n.row > o.row || n.row === o.row && n.column >= o.column) throw new Error("invalid range");
									this._terminal.select(n.column, n.row, (o.row - n.row) * this._terminal.cols - n.column + o.column);
								}
							}
							_handleResize(e) {
								this._rowElements[this._rowElements.length - 1].removeEventListener("focus", this._bottomBoundaryFocusListener);
								for (let e = this._rowContainer.children.length; e < this._terminal.rows; e++) this._rowElements[e] = this._createAccessibilityTreeNode(), this._rowContainer.appendChild(this._rowElements[e]);
								for (; this._rowElements.length > e;) this._rowContainer.removeChild(this._rowElements.pop());
								this._rowElements[this._rowElements.length - 1].addEventListener("focus", this._bottomBoundaryFocusListener), this._refreshRowsDimensions();
							}
							_createAccessibilityTreeNode() {
								const e = this._coreBrowserService.mainDocument.createElement("div");
								return e.setAttribute("role", "listitem"), e.tabIndex = -1, this._refreshRowDimensions(e), e;
							}
							_refreshRowsDimensions() {
								if (this._renderService.dimensions.css.cell.height) {
									this._accessibilityContainer.style.width = `${this._renderService.dimensions.css.canvas.width}px`, this._rowElements.length !== this._terminal.rows && this._handleResize(this._terminal.rows);
									for (let e = 0; e < this._terminal.rows; e++) this._refreshRowDimensions(this._rowElements[e]);
								}
							}
							_refreshRowDimensions(e) {
								e.style.height = `${this._renderService.dimensions.css.cell.height}px`;
							}
						};
						t.AccessibilityManager = d = s([
							r(1, c.IInstantiationService),
							r(2, h.ICoreBrowserService),
							r(3, h.IRenderService)
						], d);
					},
					3614: (e, t) => {
						function i(e) {
							return e.replace(/\r?\n/g, "\r");
						}
						function s(e, t) {
							return t ? "\x1B[200~" + e + "\x1B[201~" : e;
						}
						function r(e, t, r, n) {
							e = s(e = i(e), r.decPrivateModes.bracketedPasteMode && !0 !== n.rawOptions.ignoreBracketedPasteMode), r.triggerDataEvent(e, !0), t.value = "";
						}
						function n(e, t, i) {
							const s = i.getBoundingClientRect(), r = e.clientX - s.left - 10, n = e.clientY - s.top - 10;
							t.style.width = "20px", t.style.height = "20px", t.style.left = `${r}px`, t.style.top = `${n}px`, t.style.zIndex = "1000", t.focus();
						}
						Object.defineProperty(t, "__esModule", { value: !0 }), t.rightClickHandler = t.moveTextAreaUnderMouseCursor = t.paste = t.handlePasteEvent = t.copyHandler = t.bracketTextForPaste = t.prepareTextForTerminal = void 0, t.prepareTextForTerminal = i, t.bracketTextForPaste = s, t.copyHandler = function(e, t) {
							e.clipboardData && e.clipboardData.setData("text/plain", t.selectionText), e.preventDefault();
						}, t.handlePasteEvent = function(e, t, i, s) {
							e.stopPropagation(), e.clipboardData && r(e.clipboardData.getData("text/plain"), t, i, s);
						}, t.paste = r, t.moveTextAreaUnderMouseCursor = n, t.rightClickHandler = function(e, t, i, s, r) {
							n(e, t, i), r && s.rightClickSelect(e), t.value = s.selectionText, t.select();
						};
					},
					7239: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ColorContrastCache = void 0;
						const s = i(1505);
						t.ColorContrastCache = class {
							constructor() {
								this._color = new s.TwoKeyMap(), this._css = new s.TwoKeyMap();
							}
							setCss(e, t, i) {
								this._css.set(e, t, i);
							}
							getCss(e, t) {
								return this._css.get(e, t);
							}
							setColor(e, t, i) {
								this._color.set(e, t, i);
							}
							getColor(e, t) {
								return this._color.get(e, t);
							}
							clear() {
								this._color.clear(), this._css.clear();
							}
						};
					},
					3656: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.addDisposableDomListener = void 0, t.addDisposableDomListener = function(e, t, i, s) {
							e.addEventListener(t, i, s);
							let r = !1;
							return { dispose: () => {
								r || (r = !0, e.removeEventListener(t, i, s));
							} };
						};
					},
					3551: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Linkifier = void 0;
						const n = i(3656), o = i(8460), a = i(844), h = i(2585), c = i(4725);
						let l = t.Linkifier = class extends a.Disposable {
							get currentLink() {
								return this._currentLink;
							}
							constructor(e, t, i, s, r) {
								super(), this._element = e, this._mouseService = t, this._renderService = i, this._bufferService = s, this._linkProviderService = r, this._linkCacheDisposables = [], this._isMouseOut = !0, this._wasResized = !1, this._activeLine = -1, this._onShowLinkUnderline = this.register(new o.EventEmitter()), this.onShowLinkUnderline = this._onShowLinkUnderline.event, this._onHideLinkUnderline = this.register(new o.EventEmitter()), this.onHideLinkUnderline = this._onHideLinkUnderline.event, this.register((0, a.getDisposeArrayDisposable)(this._linkCacheDisposables)), this.register((0, a.toDisposable)((() => {
									this._lastMouseEvent = void 0, this._activeProviderReplies?.clear();
								}))), this.register(this._bufferService.onResize((() => {
									this._clearCurrentLink(), this._wasResized = !0;
								}))), this.register((0, n.addDisposableDomListener)(this._element, "mouseleave", (() => {
									this._isMouseOut = !0, this._clearCurrentLink();
								}))), this.register((0, n.addDisposableDomListener)(this._element, "mousemove", this._handleMouseMove.bind(this))), this.register((0, n.addDisposableDomListener)(this._element, "mousedown", this._handleMouseDown.bind(this))), this.register((0, n.addDisposableDomListener)(this._element, "mouseup", this._handleMouseUp.bind(this)));
							}
							_handleMouseMove(e) {
								this._lastMouseEvent = e;
								const t = this._positionFromMouseEvent(e, this._element, this._mouseService);
								if (!t) return;
								this._isMouseOut = !1;
								const i = e.composedPath();
								for (let e = 0; e < i.length; e++) {
									const t = i[e];
									if (t.classList.contains("xterm")) break;
									if (t.classList.contains("xterm-hover")) return;
								}
								this._lastBufferCell && t.x === this._lastBufferCell.x && t.y === this._lastBufferCell.y || (this._handleHover(t), this._lastBufferCell = t);
							}
							_handleHover(e) {
								if (this._activeLine !== e.y || this._wasResized) return this._clearCurrentLink(), this._askForLink(e, !1), void (this._wasResized = !1);
								this._currentLink && this._linkAtPosition(this._currentLink.link, e) || (this._clearCurrentLink(), this._askForLink(e, !0));
							}
							_askForLink(e, t) {
								this._activeProviderReplies && t || (this._activeProviderReplies?.forEach(((e) => {
									e?.forEach(((e) => {
										e.link.dispose && e.link.dispose();
									}));
								})), this._activeProviderReplies = /* @__PURE__ */ new Map(), this._activeLine = e.y);
								let i = !1;
								for (const [s, r] of this._linkProviderService.linkProviders.entries()) if (t) this._activeProviderReplies?.get(s) && (i = this._checkLinkProviderResult(s, e, i));
								else r.provideLinks(e.y, ((t) => {
									if (this._isMouseOut) return;
									const r = t?.map(((e) => ({ link: e })));
									this._activeProviderReplies?.set(s, r), i = this._checkLinkProviderResult(s, e, i), this._activeProviderReplies?.size === this._linkProviderService.linkProviders.length && this._removeIntersectingLinks(e.y, this._activeProviderReplies);
								}));
							}
							_removeIntersectingLinks(e, t) {
								const i = /* @__PURE__ */ new Set();
								for (let s = 0; s < t.size; s++) {
									const r = t.get(s);
									if (r) for (let t = 0; t < r.length; t++) {
										const s = r[t], n = s.link.range.start.y < e ? 0 : s.link.range.start.x, o = s.link.range.end.y > e ? this._bufferService.cols : s.link.range.end.x;
										for (let e = n; e <= o; e++) {
											if (i.has(e)) {
												r.splice(t--, 1);
												break;
											}
											i.add(e);
										}
									}
								}
							}
							_checkLinkProviderResult(e, t, i) {
								if (!this._activeProviderReplies) return i;
								const s = this._activeProviderReplies.get(e);
								let r = !1;
								for (let t = 0; t < e; t++) this._activeProviderReplies.has(t) && !this._activeProviderReplies.get(t) || (r = !0);
								if (!r && s) {
									const e = s.find(((e) => this._linkAtPosition(e.link, t)));
									e && (i = !0, this._handleNewLink(e));
								}
								if (this._activeProviderReplies.size === this._linkProviderService.linkProviders.length && !i) for (let e = 0; e < this._activeProviderReplies.size; e++) {
									const s = this._activeProviderReplies.get(e)?.find(((e) => this._linkAtPosition(e.link, t)));
									if (s) {
										i = !0, this._handleNewLink(s);
										break;
									}
								}
								return i;
							}
							_handleMouseDown() {
								this._mouseDownLink = this._currentLink;
							}
							_handleMouseUp(e) {
								if (!this._currentLink) return;
								const t = this._positionFromMouseEvent(e, this._element, this._mouseService);
								t && this._mouseDownLink === this._currentLink && this._linkAtPosition(this._currentLink.link, t) && this._currentLink.link.activate(e, this._currentLink.link.text);
							}
							_clearCurrentLink(e, t) {
								this._currentLink && this._lastMouseEvent && (!e || !t || this._currentLink.link.range.start.y >= e && this._currentLink.link.range.end.y <= t) && (this._linkLeave(this._element, this._currentLink.link, this._lastMouseEvent), this._currentLink = void 0, (0, a.disposeArray)(this._linkCacheDisposables));
							}
							_handleNewLink(e) {
								if (!this._lastMouseEvent) return;
								const t = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
								t && this._linkAtPosition(e.link, t) && (this._currentLink = e, this._currentLink.state = {
									decorations: {
										underline: void 0 === e.link.decorations || e.link.decorations.underline,
										pointerCursor: void 0 === e.link.decorations || e.link.decorations.pointerCursor
									},
									isHovered: !0
								}, this._linkHover(this._element, e.link, this._lastMouseEvent), e.link.decorations = {}, Object.defineProperties(e.link.decorations, {
									pointerCursor: {
										get: () => this._currentLink?.state?.decorations.pointerCursor,
										set: (e) => {
											this._currentLink?.state && this._currentLink.state.decorations.pointerCursor !== e && (this._currentLink.state.decorations.pointerCursor = e, this._currentLink.state.isHovered && this._element.classList.toggle("xterm-cursor-pointer", e));
										}
									},
									underline: {
										get: () => this._currentLink?.state?.decorations.underline,
										set: (t) => {
											this._currentLink?.state && this._currentLink?.state?.decorations.underline !== t && (this._currentLink.state.decorations.underline = t, this._currentLink.state.isHovered && this._fireUnderlineEvent(e.link, t));
										}
									}
								}), this._linkCacheDisposables.push(this._renderService.onRenderedViewportChange(((e) => {
									if (!this._currentLink) return;
									const t = 0 === e.start ? 0 : e.start + 1 + this._bufferService.buffer.ydisp, i = this._bufferService.buffer.ydisp + 1 + e.end;
									if (this._currentLink.link.range.start.y >= t && this._currentLink.link.range.end.y <= i && (this._clearCurrentLink(t, i), this._lastMouseEvent)) {
										const e = this._positionFromMouseEvent(this._lastMouseEvent, this._element, this._mouseService);
										e && this._askForLink(e, !1);
									}
								}))));
							}
							_linkHover(e, t, i) {
								this._currentLink?.state && (this._currentLink.state.isHovered = !0, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t, !0), this._currentLink.state.decorations.pointerCursor && e.classList.add("xterm-cursor-pointer")), t.hover && t.hover(i, t.text);
							}
							_fireUnderlineEvent(e, t) {
								const i = e.range, s = this._bufferService.buffer.ydisp, r = this._createLinkUnderlineEvent(i.start.x - 1, i.start.y - s - 1, i.end.x, i.end.y - s - 1, void 0);
								(t ? this._onShowLinkUnderline : this._onHideLinkUnderline).fire(r);
							}
							_linkLeave(e, t, i) {
								this._currentLink?.state && (this._currentLink.state.isHovered = !1, this._currentLink.state.decorations.underline && this._fireUnderlineEvent(t, !1), this._currentLink.state.decorations.pointerCursor && e.classList.remove("xterm-cursor-pointer")), t.leave && t.leave(i, t.text);
							}
							_linkAtPosition(e, t) {
								const i = e.range.start.y * this._bufferService.cols + e.range.start.x, s = e.range.end.y * this._bufferService.cols + e.range.end.x, r = t.y * this._bufferService.cols + t.x;
								return i <= r && r <= s;
							}
							_positionFromMouseEvent(e, t, i) {
								const s = i.getCoords(e, t, this._bufferService.cols, this._bufferService.rows);
								if (s) return {
									x: s[0],
									y: s[1] + this._bufferService.buffer.ydisp
								};
							}
							_createLinkUnderlineEvent(e, t, i, s, r) {
								return {
									x1: e,
									y1: t,
									x2: i,
									y2: s,
									cols: this._bufferService.cols,
									fg: r
								};
							}
						};
						t.Linkifier = l = s([
							r(1, c.IMouseService),
							r(2, c.IRenderService),
							r(3, h.IBufferService),
							r(4, c.ILinkProviderService)
						], l);
					},
					9042: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.tooMuchOutput = t.promptLabel = void 0, t.promptLabel = "Terminal input", t.tooMuchOutput = "Too much output to announce, navigate to rows manually to read";
					},
					3730: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.OscLinkProvider = void 0;
						const n = i(511), o = i(2585);
						let a = t.OscLinkProvider = class {
							constructor(e, t, i) {
								this._bufferService = e, this._optionsService = t, this._oscLinkService = i;
							}
							provideLinks(e, t) {
								const i = this._bufferService.buffer.lines.get(e - 1);
								if (!i) return void t(void 0);
								const s = [], r = this._optionsService.rawOptions.linkHandler, o = new n.CellData(), a = i.getTrimmedLength();
								let c = -1, l = -1, d = !1;
								for (let t = 0; t < a; t++) if (-1 !== l || i.hasContent(t)) {
									if (i.loadCell(t, o), o.hasExtendedAttrs() && o.extended.urlId) {
										if (-1 === l) {
											l = t, c = o.extended.urlId;
											continue;
										}
										d = o.extended.urlId !== c;
									} else -1 !== l && (d = !0);
									if (d || -1 !== l && t === a - 1) {
										const i = this._oscLinkService.getLinkData(c)?.uri;
										if (i) {
											const n = {
												start: {
													x: l + 1,
													y: e
												},
												end: {
													x: t + (d || t !== a - 1 ? 0 : 1),
													y: e
												}
											};
											let o = !1;
											if (!r?.allowNonHttpProtocols) try {
												const e = new URL(i);
												["http:", "https:"].includes(e.protocol) || (o = !0);
											} catch (e) {
												o = !0;
											}
											o || s.push({
												text: i,
												range: n,
												activate: (e, t) => r ? r.activate(e, t, n) : h(0, t),
												hover: (e, t) => r?.hover?.(e, t, n),
												leave: (e, t) => r?.leave?.(e, t, n)
											});
										}
										d = !1, o.hasExtendedAttrs() && o.extended.urlId ? (l = t, c = o.extended.urlId) : (l = -1, c = -1);
									}
								}
								t(s);
							}
						};
						function h(e, t) {
							if (confirm(`Do you want to navigate to ${t}?\n\nWARNING: This link could potentially be dangerous`)) {
								const e = window.open();
								if (e) {
									try {
										e.opener = null;
									} catch {}
									e.location.href = t;
								} else console.warn("Opening link blocked as opener could not be cleared");
							}
						}
						t.OscLinkProvider = a = s([
							r(0, o.IBufferService),
							r(1, o.IOptionsService),
							r(2, o.IOscLinkService)
						], a);
					},
					6193: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.RenderDebouncer = void 0, t.RenderDebouncer = class {
							constructor(e, t) {
								this._renderCallback = e, this._coreBrowserService = t, this._refreshCallbacks = [];
							}
							dispose() {
								this._animationFrame && (this._coreBrowserService.window.cancelAnimationFrame(this._animationFrame), this._animationFrame = void 0);
							}
							addRefreshCallback(e) {
								return this._refreshCallbacks.push(e), this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._innerRefresh()))), this._animationFrame;
							}
							refresh(e, t, i) {
								this._rowCount = i, e = void 0 !== e ? e : 0, t = void 0 !== t ? t : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e) : e, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t) : t, this._animationFrame || (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._innerRefresh())));
							}
							_innerRefresh() {
								if (this._animationFrame = void 0, void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return void this._runRefreshCallbacks();
								const e = Math.max(this._rowStart, 0), t = Math.min(this._rowEnd, this._rowCount - 1);
								this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e, t), this._runRefreshCallbacks();
							}
							_runRefreshCallbacks() {
								for (const e of this._refreshCallbacks) e(0);
								this._refreshCallbacks = [];
							}
						};
					},
					3236: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Terminal = void 0;
						const s = i(3614), r = i(3656), n = i(3551), o = i(9042), a = i(3730), h = i(1680), c = i(3107), l = i(5744), d = i(2950), _ = i(1296), u = i(428), f = i(4269), v = i(5114), p = i(8934), g = i(3230), m = i(9312), S = i(4725), C = i(6731), b = i(8055), w = i(8969), y = i(8460), E = i(844), k = i(6114), L = i(8437), D = i(2584), R = i(7399), x = i(5941), A = i(9074), B = i(2585), T = i(5435), M = i(4567), O = i(779);
						class P extends w.CoreTerminal {
							get onFocus() {
								return this._onFocus.event;
							}
							get onBlur() {
								return this._onBlur.event;
							}
							get onA11yChar() {
								return this._onA11yCharEmitter.event;
							}
							get onA11yTab() {
								return this._onA11yTabEmitter.event;
							}
							get onWillOpen() {
								return this._onWillOpen.event;
							}
							constructor(e = {}) {
								super(e), this.browser = k, this._keyDownHandled = !1, this._keyDownSeen = !1, this._keyPressHandled = !1, this._unprocessedDeadKey = !1, this._accessibilityManager = this.register(new E.MutableDisposable()), this._onCursorMove = this.register(new y.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onKey = this.register(new y.EventEmitter()), this.onKey = this._onKey.event, this._onRender = this.register(new y.EventEmitter()), this.onRender = this._onRender.event, this._onSelectionChange = this.register(new y.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onTitleChange = this.register(new y.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onBell = this.register(new y.EventEmitter()), this.onBell = this._onBell.event, this._onFocus = this.register(new y.EventEmitter()), this._onBlur = this.register(new y.EventEmitter()), this._onA11yCharEmitter = this.register(new y.EventEmitter()), this._onA11yTabEmitter = this.register(new y.EventEmitter()), this._onWillOpen = this.register(new y.EventEmitter()), this._setup(), this._decorationService = this._instantiationService.createInstance(A.DecorationService), this._instantiationService.setService(B.IDecorationService, this._decorationService), this._linkProviderService = this._instantiationService.createInstance(O.LinkProviderService), this._instantiationService.setService(S.ILinkProviderService, this._linkProviderService), this._linkProviderService.registerLinkProvider(this._instantiationService.createInstance(a.OscLinkProvider)), this.register(this._inputHandler.onRequestBell((() => this._onBell.fire()))), this.register(this._inputHandler.onRequestRefreshRows(((e, t) => this.refresh(e, t)))), this.register(this._inputHandler.onRequestSendFocus((() => this._reportFocus()))), this.register(this._inputHandler.onRequestReset((() => this.reset()))), this.register(this._inputHandler.onRequestWindowsOptionsReport(((e) => this._reportWindowsOptions(e)))), this.register(this._inputHandler.onColor(((e) => this._handleColorEvent(e)))), this.register((0, y.forwardEvent)(this._inputHandler.onCursorMove, this._onCursorMove)), this.register((0, y.forwardEvent)(this._inputHandler.onTitleChange, this._onTitleChange)), this.register((0, y.forwardEvent)(this._inputHandler.onA11yChar, this._onA11yCharEmitter)), this.register((0, y.forwardEvent)(this._inputHandler.onA11yTab, this._onA11yTabEmitter)), this.register(this._bufferService.onResize(((e) => this._afterResize(e.cols, e.rows)))), this.register((0, E.toDisposable)((() => {
									this._customKeyEventHandler = void 0, this.element?.parentNode?.removeChild(this.element);
								})));
							}
							_handleColorEvent(e) {
								if (this._themeService) for (const t of e) {
									let e, i = "";
									switch (t.index) {
										case 256:
											e = "foreground", i = "10";
											break;
										case 257:
											e = "background", i = "11";
											break;
										case 258:
											e = "cursor", i = "12";
											break;
										default: e = "ansi", i = "4;" + t.index;
									}
									switch (t.type) {
										case 0:
											const s = b.color.toColorRGB("ansi" === e ? this._themeService.colors.ansi[t.index] : this._themeService.colors[e]);
											this.coreService.triggerDataEvent(`${D.C0.ESC}]${i};${(0, x.toRgbString)(s)}${D.C1_ESCAPED.ST}`);
											break;
										case 1:
											if ("ansi" === e) this._themeService.modifyColors(((e) => e.ansi[t.index] = b.channels.toColor(...t.color)));
											else {
												const i = e;
												this._themeService.modifyColors(((e) => e[i] = b.channels.toColor(...t.color)));
											}
											break;
										case 2: this._themeService.restoreColor(t.index);
									}
								}
							}
							_setup() {
								super._setup(), this._customKeyEventHandler = void 0;
							}
							get buffer() {
								return this.buffers.active;
							}
							focus() {
								this.textarea && this.textarea.focus({ preventScroll: !0 });
							}
							_handleScreenReaderModeOptionChange(e) {
								e ? !this._accessibilityManager.value && this._renderService && (this._accessibilityManager.value = this._instantiationService.createInstance(M.AccessibilityManager, this)) : this._accessibilityManager.clear();
							}
							_handleTextAreaFocus(e) {
								this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D.C0.ESC + "[I"), this.element.classList.add("focus"), this._showCursor(), this._onFocus.fire();
							}
							blur() {
								return this.textarea?.blur();
							}
							_handleTextAreaBlur() {
								this.textarea.value = "", this.refresh(this.buffer.y, this.buffer.y), this.coreService.decPrivateModes.sendFocus && this.coreService.triggerDataEvent(D.C0.ESC + "[O"), this.element.classList.remove("focus"), this._onBlur.fire();
							}
							_syncTextArea() {
								if (!this.textarea || !this.buffer.isCursorInViewport || this._compositionHelper.isComposing || !this._renderService) return;
								const e = this.buffer.ybase + this.buffer.y, t = this.buffer.lines.get(e);
								if (!t) return;
								const i = Math.min(this.buffer.x, this.cols - 1), s = this._renderService.dimensions.css.cell.height, r = t.getWidth(i), n = this._renderService.dimensions.css.cell.width * r, o = this.buffer.y * this._renderService.dimensions.css.cell.height, a = i * this._renderService.dimensions.css.cell.width;
								this.textarea.style.left = a + "px", this.textarea.style.top = o + "px", this.textarea.style.width = n + "px", this.textarea.style.height = s + "px", this.textarea.style.lineHeight = s + "px", this.textarea.style.zIndex = "-5";
							}
							_initGlobal() {
								this._bindKeys(), this.register((0, r.addDisposableDomListener)(this.element, "copy", ((e) => {
									this.hasSelection() && (0, s.copyHandler)(e, this._selectionService);
								})));
								const e = (e) => (0, s.handlePasteEvent)(e, this.textarea, this.coreService, this.optionsService);
								this.register((0, r.addDisposableDomListener)(this.textarea, "paste", e)), this.register((0, r.addDisposableDomListener)(this.element, "paste", e)), k.isFirefox ? this.register((0, r.addDisposableDomListener)(this.element, "mousedown", ((e) => {
									2 === e.button && (0, s.rightClickHandler)(e, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
								}))) : this.register((0, r.addDisposableDomListener)(this.element, "contextmenu", ((e) => {
									(0, s.rightClickHandler)(e, this.textarea, this.screenElement, this._selectionService, this.options.rightClickSelectsWord);
								}))), k.isLinux && this.register((0, r.addDisposableDomListener)(this.element, "auxclick", ((e) => {
									1 === e.button && (0, s.moveTextAreaUnderMouseCursor)(e, this.textarea, this.screenElement);
								})));
							}
							_bindKeys() {
								this.register((0, r.addDisposableDomListener)(this.textarea, "keyup", ((e) => this._keyUp(e)), !0)), this.register((0, r.addDisposableDomListener)(this.textarea, "keydown", ((e) => this._keyDown(e)), !0)), this.register((0, r.addDisposableDomListener)(this.textarea, "keypress", ((e) => this._keyPress(e)), !0)), this.register((0, r.addDisposableDomListener)(this.textarea, "compositionstart", (() => this._compositionHelper.compositionstart()))), this.register((0, r.addDisposableDomListener)(this.textarea, "compositionupdate", ((e) => this._compositionHelper.compositionupdate(e)))), this.register((0, r.addDisposableDomListener)(this.textarea, "compositionend", (() => this._compositionHelper.compositionend()))), this.register((0, r.addDisposableDomListener)(this.textarea, "input", ((e) => this._inputEvent(e)), !0)), this.register(this.onRender((() => this._compositionHelper.updateCompositionElements())));
							}
							open(e) {
								if (!e) throw new Error("Terminal requires a parent element.");
								if (e.isConnected || this._logService.debug("Terminal.open was called on an element that was not attached to the DOM"), this.element?.ownerDocument.defaultView && this._coreBrowserService) return void (this.element.ownerDocument.defaultView !== this._coreBrowserService.window && (this._coreBrowserService.window = this.element.ownerDocument.defaultView));
								this._document = e.ownerDocument, this.options.documentOverride && this.options.documentOverride instanceof Document && (this._document = this.optionsService.rawOptions.documentOverride), this.element = this._document.createElement("div"), this.element.dir = "ltr", this.element.classList.add("terminal"), this.element.classList.add("xterm"), e.appendChild(this.element);
								const t = this._document.createDocumentFragment();
								this._viewportElement = this._document.createElement("div"), this._viewportElement.classList.add("xterm-viewport"), t.appendChild(this._viewportElement), this._viewportScrollArea = this._document.createElement("div"), this._viewportScrollArea.classList.add("xterm-scroll-area"), this._viewportElement.appendChild(this._viewportScrollArea), this.screenElement = this._document.createElement("div"), this.screenElement.classList.add("xterm-screen"), this.register((0, r.addDisposableDomListener)(this.screenElement, "mousemove", ((e) => this.updateCursorStyle(e)))), this._helperContainer = this._document.createElement("div"), this._helperContainer.classList.add("xterm-helpers"), this.screenElement.appendChild(this._helperContainer), t.appendChild(this.screenElement), this.textarea = this._document.createElement("textarea"), this.textarea.classList.add("xterm-helper-textarea"), this.textarea.setAttribute("aria-label", o.promptLabel), k.isChromeOS || this.textarea.setAttribute("aria-multiline", "false"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.tabIndex = 0, this._coreBrowserService = this.register(this._instantiationService.createInstance(v.CoreBrowserService, this.textarea, e.ownerDocument.defaultView ?? window, this._document ?? "undefined" != typeof window ? window.document : null)), this._instantiationService.setService(S.ICoreBrowserService, this._coreBrowserService), this.register((0, r.addDisposableDomListener)(this.textarea, "focus", ((e) => this._handleTextAreaFocus(e)))), this.register((0, r.addDisposableDomListener)(this.textarea, "blur", (() => this._handleTextAreaBlur()))), this._helperContainer.appendChild(this.textarea), this._charSizeService = this._instantiationService.createInstance(u.CharSizeService, this._document, this._helperContainer), this._instantiationService.setService(S.ICharSizeService, this._charSizeService), this._themeService = this._instantiationService.createInstance(C.ThemeService), this._instantiationService.setService(S.IThemeService, this._themeService), this._characterJoinerService = this._instantiationService.createInstance(f.CharacterJoinerService), this._instantiationService.setService(S.ICharacterJoinerService, this._characterJoinerService), this._renderService = this.register(this._instantiationService.createInstance(g.RenderService, this.rows, this.screenElement)), this._instantiationService.setService(S.IRenderService, this._renderService), this.register(this._renderService.onRenderedViewportChange(((e) => this._onRender.fire(e)))), this.onResize(((e) => this._renderService.resize(e.cols, e.rows))), this._compositionView = this._document.createElement("div"), this._compositionView.classList.add("composition-view"), this._compositionHelper = this._instantiationService.createInstance(d.CompositionHelper, this.textarea, this._compositionView), this._helperContainer.appendChild(this._compositionView), this._mouseService = this._instantiationService.createInstance(p.MouseService), this._instantiationService.setService(S.IMouseService, this._mouseService), this.linkifier = this.register(this._instantiationService.createInstance(n.Linkifier, this.screenElement)), this.element.appendChild(t);
								try {
									this._onWillOpen.fire(this.element);
								} catch {}
								this._renderService.hasRenderer() || this._renderService.setRenderer(this._createRenderer()), this.viewport = this._instantiationService.createInstance(h.Viewport, this._viewportElement, this._viewportScrollArea), this.viewport.onRequestScrollLines(((e) => this.scrollLines(e.amount, e.suppressScrollEvent, 1))), this.register(this._inputHandler.onRequestSyncScrollBar((() => this.viewport.syncScrollArea()))), this.register(this.viewport), this.register(this.onCursorMove((() => {
									this._renderService.handleCursorMove(), this._syncTextArea();
								}))), this.register(this.onResize((() => this._renderService.handleResize(this.cols, this.rows)))), this.register(this.onBlur((() => this._renderService.handleBlur()))), this.register(this.onFocus((() => this._renderService.handleFocus()))), this.register(this._renderService.onDimensionsChange((() => this.viewport.syncScrollArea()))), this._selectionService = this.register(this._instantiationService.createInstance(m.SelectionService, this.element, this.screenElement, this.linkifier)), this._instantiationService.setService(S.ISelectionService, this._selectionService), this.register(this._selectionService.onRequestScrollLines(((e) => this.scrollLines(e.amount, e.suppressScrollEvent)))), this.register(this._selectionService.onSelectionChange((() => this._onSelectionChange.fire()))), this.register(this._selectionService.onRequestRedraw(((e) => this._renderService.handleSelectionChanged(e.start, e.end, e.columnSelectMode)))), this.register(this._selectionService.onLinuxMouseSelection(((e) => {
									this.textarea.value = e, this.textarea.focus(), this.textarea.select();
								}))), this.register(this._onScroll.event(((e) => {
									this.viewport.syncScrollArea(), this._selectionService.refresh();
								}))), this.register((0, r.addDisposableDomListener)(this._viewportElement, "scroll", (() => this._selectionService.refresh()))), this.register(this._instantiationService.createInstance(c.BufferDecorationRenderer, this.screenElement)), this.register((0, r.addDisposableDomListener)(this.element, "mousedown", ((e) => this._selectionService.handleMouseDown(e)))), this.coreMouseService.areMouseEventsActive ? (this._selectionService.disable(), this.element.classList.add("enable-mouse-events")) : this._selectionService.enable(), this.options.screenReaderMode && (this._accessibilityManager.value = this._instantiationService.createInstance(M.AccessibilityManager, this)), this.register(this.optionsService.onSpecificOptionChange("screenReaderMode", ((e) => this._handleScreenReaderModeOptionChange(e)))), this.options.overviewRulerWidth && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l.OverviewRulerRenderer, this._viewportElement, this.screenElement))), this.optionsService.onSpecificOptionChange("overviewRulerWidth", ((e) => {
									!this._overviewRulerRenderer && e && this._viewportElement && this.screenElement && (this._overviewRulerRenderer = this.register(this._instantiationService.createInstance(l.OverviewRulerRenderer, this._viewportElement, this.screenElement)));
								})), this._charSizeService.measure(), this.refresh(0, this.rows - 1), this._initGlobal(), this.bindMouse();
							}
							_createRenderer() {
								return this._instantiationService.createInstance(_.DomRenderer, this, this._document, this.element, this.screenElement, this._viewportElement, this._helperContainer, this.linkifier);
							}
							bindMouse() {
								const e = this, t = this.element;
								function i(t) {
									const i = e._mouseService.getMouseReportCoords(t, e.screenElement);
									if (!i) return !1;
									let s, r;
									switch (t.overrideType || t.type) {
										case "mousemove":
											r = 32, void 0 === t.buttons ? (s = 3, void 0 !== t.button && (s = t.button < 3 ? t.button : 3)) : s = 1 & t.buttons ? 0 : 4 & t.buttons ? 1 : 2 & t.buttons ? 2 : 3;
											break;
										case "mouseup":
											r = 0, s = t.button < 3 ? t.button : 3;
											break;
										case "mousedown":
											r = 1, s = t.button < 3 ? t.button : 3;
											break;
										case "wheel":
											if (e._customWheelEventHandler && !1 === e._customWheelEventHandler(t)) return !1;
											if (0 === e.viewport.getLinesScrolled(t)) return !1;
											r = t.deltaY < 0 ? 0 : 1, s = 4;
											break;
										default: return !1;
									}
									return !(void 0 === r || void 0 === s || s > 4) && e.coreMouseService.triggerMouseEvent({
										col: i.col,
										row: i.row,
										x: i.x,
										y: i.y,
										button: s,
										action: r,
										ctrl: t.ctrlKey,
										alt: t.altKey,
										shift: t.shiftKey
									});
								}
								const s = {
									mouseup: null,
									wheel: null,
									mousedrag: null,
									mousemove: null
								}, n = {
									mouseup: (e) => (i(e), e.buttons || (this._document.removeEventListener("mouseup", s.mouseup), s.mousedrag && this._document.removeEventListener("mousemove", s.mousedrag)), this.cancel(e)),
									wheel: (e) => (i(e), this.cancel(e, !0)),
									mousedrag: (e) => {
										e.buttons && i(e);
									},
									mousemove: (e) => {
										e.buttons || i(e);
									}
								};
								this.register(this.coreMouseService.onProtocolChange(((e) => {
									e ? ("debug" === this.optionsService.rawOptions.logLevel && this._logService.debug("Binding to mouse events:", this.coreMouseService.explainEvents(e)), this.element.classList.add("enable-mouse-events"), this._selectionService.disable()) : (this._logService.debug("Unbinding from mouse events."), this.element.classList.remove("enable-mouse-events"), this._selectionService.enable()), 8 & e ? s.mousemove || (t.addEventListener("mousemove", n.mousemove), s.mousemove = n.mousemove) : (t.removeEventListener("mousemove", s.mousemove), s.mousemove = null), 16 & e ? s.wheel || (t.addEventListener("wheel", n.wheel, { passive: !1 }), s.wheel = n.wheel) : (t.removeEventListener("wheel", s.wheel), s.wheel = null), 2 & e ? s.mouseup || (s.mouseup = n.mouseup) : (this._document.removeEventListener("mouseup", s.mouseup), s.mouseup = null), 4 & e ? s.mousedrag || (s.mousedrag = n.mousedrag) : (this._document.removeEventListener("mousemove", s.mousedrag), s.mousedrag = null);
								}))), this.coreMouseService.activeProtocol = this.coreMouseService.activeProtocol, this.register((0, r.addDisposableDomListener)(t, "mousedown", ((e) => {
									if (e.preventDefault(), this.focus(), this.coreMouseService.areMouseEventsActive && !this._selectionService.shouldForceSelection(e)) return i(e), s.mouseup && this._document.addEventListener("mouseup", s.mouseup), s.mousedrag && this._document.addEventListener("mousemove", s.mousedrag), this.cancel(e);
								}))), this.register((0, r.addDisposableDomListener)(t, "wheel", ((e) => {
									if (!s.wheel) {
										if (this._customWheelEventHandler && !1 === this._customWheelEventHandler(e)) return !1;
										if (!this.buffer.hasScrollback) {
											const t = this.viewport.getLinesScrolled(e);
											if (0 === t) return;
											const i = D.C0.ESC + (this.coreService.decPrivateModes.applicationCursorKeys ? "O" : "[") + (e.deltaY < 0 ? "A" : "B");
											let s = "";
											for (let e = 0; e < Math.abs(t); e++) s += i;
											return this.coreService.triggerDataEvent(s, !0), this.cancel(e, !0);
										}
										return this.viewport.handleWheel(e) ? this.cancel(e) : void 0;
									}
								}), { passive: !1 })), this.register((0, r.addDisposableDomListener)(t, "touchstart", ((e) => {
									if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchStart(e), this.cancel(e);
								}), { passive: !0 })), this.register((0, r.addDisposableDomListener)(t, "touchmove", ((e) => {
									if (!this.coreMouseService.areMouseEventsActive) return this.viewport.handleTouchMove(e) ? void 0 : this.cancel(e);
								}), { passive: !1 }));
							}
							refresh(e, t) {
								this._renderService?.refreshRows(e, t);
							}
							updateCursorStyle(e) {
								this._selectionService?.shouldColumnSelect(e) ? this.element.classList.add("column-select") : this.element.classList.remove("column-select");
							}
							_showCursor() {
								this.coreService.isCursorInitialized || (this.coreService.isCursorInitialized = !0, this.refresh(this.buffer.y, this.buffer.y));
							}
							scrollLines(e, t, i = 0) {
								1 === i ? (super.scrollLines(e, t, i), this.refresh(0, this.rows - 1)) : this.viewport?.scrollLines(e);
							}
							paste(e) {
								(0, s.paste)(e, this.textarea, this.coreService, this.optionsService);
							}
							attachCustomKeyEventHandler(e) {
								this._customKeyEventHandler = e;
							}
							attachCustomWheelEventHandler(e) {
								this._customWheelEventHandler = e;
							}
							registerLinkProvider(e) {
								return this._linkProviderService.registerLinkProvider(e);
							}
							registerCharacterJoiner(e) {
								if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
								const t = this._characterJoinerService.register(e);
								return this.refresh(0, this.rows - 1), t;
							}
							deregisterCharacterJoiner(e) {
								if (!this._characterJoinerService) throw new Error("Terminal must be opened first");
								this._characterJoinerService.deregister(e) && this.refresh(0, this.rows - 1);
							}
							get markers() {
								return this.buffer.markers;
							}
							registerMarker(e) {
								return this.buffer.addMarker(this.buffer.ybase + this.buffer.y + e);
							}
							registerDecoration(e) {
								return this._decorationService.registerDecoration(e);
							}
							hasSelection() {
								return !!this._selectionService && this._selectionService.hasSelection;
							}
							select(e, t, i) {
								this._selectionService.setSelection(e, t, i);
							}
							getSelection() {
								return this._selectionService ? this._selectionService.selectionText : "";
							}
							getSelectionPosition() {
								if (this._selectionService && this._selectionService.hasSelection) return {
									start: {
										x: this._selectionService.selectionStart[0],
										y: this._selectionService.selectionStart[1]
									},
									end: {
										x: this._selectionService.selectionEnd[0],
										y: this._selectionService.selectionEnd[1]
									}
								};
							}
							clearSelection() {
								this._selectionService?.clearSelection();
							}
							selectAll() {
								this._selectionService?.selectAll();
							}
							selectLines(e, t) {
								this._selectionService?.selectLines(e, t);
							}
							_keyDown(e) {
								if (this._keyDownHandled = !1, this._keyDownSeen = !0, this._customKeyEventHandler && !1 === this._customKeyEventHandler(e)) return !1;
								const t = this.browser.isMac && this.options.macOptionIsMeta && e.altKey;
								if (!t && !this._compositionHelper.keydown(e)) return this.options.scrollOnUserInput && this.buffer.ybase !== this.buffer.ydisp && this.scrollToBottom(), !1;
								t || "Dead" !== e.key && "AltGraph" !== e.key || (this._unprocessedDeadKey = !0);
								const i = (0, R.evaluateKeyboardEvent)(e, this.coreService.decPrivateModes.applicationCursorKeys, this.browser.isMac, this.options.macOptionIsMeta);
								if (this.updateCursorStyle(e), 3 === i.type || 2 === i.type) {
									const t = this.rows - 1;
									return this.scrollLines(2 === i.type ? -t : t), this.cancel(e, !0);
								}
								return 1 === i.type && this.selectAll(), !!this._isThirdLevelShift(this.browser, e) || (i.cancel && this.cancel(e, !0), !i.key || !!(e.key && !e.ctrlKey && !e.altKey && !e.metaKey && 1 === e.key.length && e.key.charCodeAt(0) >= 65 && e.key.charCodeAt(0) <= 90) || (this._unprocessedDeadKey ? (this._unprocessedDeadKey = !1, !0) : (i.key !== D.C0.ETX && i.key !== D.C0.CR || (this.textarea.value = ""), this._onKey.fire({
									key: i.key,
									domEvent: e
								}), this._showCursor(), this.coreService.triggerDataEvent(i.key, !0), !this.optionsService.rawOptions.screenReaderMode || e.altKey || e.ctrlKey ? this.cancel(e, !0) : void (this._keyDownHandled = !0))));
							}
							_isThirdLevelShift(e, t) {
								const i = e.isMac && !this.options.macOptionIsMeta && t.altKey && !t.ctrlKey && !t.metaKey || e.isWindows && t.altKey && t.ctrlKey && !t.metaKey || e.isWindows && t.getModifierState("AltGraph");
								return "keypress" === t.type ? i : i && (!t.keyCode || t.keyCode > 47);
							}
							_keyUp(e) {
								this._keyDownSeen = !1, this._customKeyEventHandler && !1 === this._customKeyEventHandler(e) || (function(e) {
									return 16 === e.keyCode || 17 === e.keyCode || 18 === e.keyCode;
								}(e) || this.focus(), this.updateCursorStyle(e), this._keyPressHandled = !1);
							}
							_keyPress(e) {
								let t;
								if (this._keyPressHandled = !1, this._keyDownHandled) return !1;
								if (this._customKeyEventHandler && !1 === this._customKeyEventHandler(e)) return !1;
								if (this.cancel(e), e.charCode) t = e.charCode;
								else if (null === e.which || void 0 === e.which) t = e.keyCode;
								else {
									if (0 === e.which || 0 === e.charCode) return !1;
									t = e.which;
								}
								return !(!t || (e.altKey || e.ctrlKey || e.metaKey) && !this._isThirdLevelShift(this.browser, e) || (t = String.fromCharCode(t), this._onKey.fire({
									key: t,
									domEvent: e
								}), this._showCursor(), this.coreService.triggerDataEvent(t, !0), this._keyPressHandled = !0, this._unprocessedDeadKey = !1, 0));
							}
							_inputEvent(e) {
								if (e.data && "insertText" === e.inputType && (!e.composed || !this._keyDownSeen) && !this.optionsService.rawOptions.screenReaderMode) {
									if (this._keyPressHandled) return !1;
									this._unprocessedDeadKey = !1;
									const t = e.data;
									return this.coreService.triggerDataEvent(t, !0), this.cancel(e), !0;
								}
								return !1;
							}
							resize(e, t) {
								e !== this.cols || t !== this.rows ? super.resize(e, t) : this._charSizeService && !this._charSizeService.hasValidSize && this._charSizeService.measure();
							}
							_afterResize(e, t) {
								this._charSizeService?.measure(), this.viewport?.syncScrollArea(!0);
							}
							clear() {
								if (0 !== this.buffer.ybase || 0 !== this.buffer.y) {
									this.buffer.clearAllMarkers(), this.buffer.lines.set(0, this.buffer.lines.get(this.buffer.ybase + this.buffer.y)), this.buffer.lines.length = 1, this.buffer.ydisp = 0, this.buffer.ybase = 0, this.buffer.y = 0;
									for (let e = 1; e < this.rows; e++) this.buffer.lines.push(this.buffer.getBlankLine(L.DEFAULT_ATTR_DATA));
									this._onScroll.fire({
										position: this.buffer.ydisp,
										source: 0
									}), this.viewport?.reset(), this.refresh(0, this.rows - 1);
								}
							}
							reset() {
								this.options.rows = this.rows, this.options.cols = this.cols;
								const e = this._customKeyEventHandler;
								this._setup(), super.reset(), this._selectionService?.reset(), this._decorationService.reset(), this.viewport?.reset(), this._customKeyEventHandler = e, this.refresh(0, this.rows - 1);
							}
							clearTextureAtlas() {
								this._renderService?.clearTextureAtlas();
							}
							_reportFocus() {
								this.element?.classList.contains("focus") ? this.coreService.triggerDataEvent(D.C0.ESC + "[I") : this.coreService.triggerDataEvent(D.C0.ESC + "[O");
							}
							_reportWindowsOptions(e) {
								if (this._renderService) switch (e) {
									case T.WindowsOptionsReportType.GET_WIN_SIZE_PIXELS:
										const e = this._renderService.dimensions.css.canvas.width.toFixed(0), t = this._renderService.dimensions.css.canvas.height.toFixed(0);
										this.coreService.triggerDataEvent(`${D.C0.ESC}[4;${t};${e}t`);
										break;
									case T.WindowsOptionsReportType.GET_CELL_SIZE_PIXELS:
										const i = this._renderService.dimensions.css.cell.width.toFixed(0), s = this._renderService.dimensions.css.cell.height.toFixed(0);
										this.coreService.triggerDataEvent(`${D.C0.ESC}[6;${s};${i}t`);
								}
							}
							cancel(e, t) {
								if (this.options.cancelEvents || t) return e.preventDefault(), e.stopPropagation(), !1;
							}
						}
						t.Terminal = P;
					},
					9924: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.TimeBasedDebouncer = void 0, t.TimeBasedDebouncer = class {
							constructor(e, t = 1e3) {
								this._renderCallback = e, this._debounceThresholdMS = t, this._lastRefreshMs = 0, this._additionalRefreshRequested = !1;
							}
							dispose() {
								this._refreshTimeoutID && clearTimeout(this._refreshTimeoutID);
							}
							refresh(e, t, i) {
								this._rowCount = i, e = void 0 !== e ? e : 0, t = void 0 !== t ? t : this._rowCount - 1, this._rowStart = void 0 !== this._rowStart ? Math.min(this._rowStart, e) : e, this._rowEnd = void 0 !== this._rowEnd ? Math.max(this._rowEnd, t) : t;
								const s = Date.now();
								if (s - this._lastRefreshMs >= this._debounceThresholdMS) this._lastRefreshMs = s, this._innerRefresh();
								else if (!this._additionalRefreshRequested) {
									const e = s - this._lastRefreshMs, t = this._debounceThresholdMS - e;
									this._additionalRefreshRequested = !0, this._refreshTimeoutID = window.setTimeout((() => {
										this._lastRefreshMs = Date.now(), this._innerRefresh(), this._additionalRefreshRequested = !1, this._refreshTimeoutID = void 0;
									}), t);
								}
							}
							_innerRefresh() {
								if (void 0 === this._rowStart || void 0 === this._rowEnd || void 0 === this._rowCount) return;
								const e = Math.max(this._rowStart, 0), t = Math.min(this._rowEnd, this._rowCount - 1);
								this._rowStart = void 0, this._rowEnd = void 0, this._renderCallback(e, t);
							}
						};
					},
					1680: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Viewport = void 0;
						const n = i(3656), o = i(4725), a = i(8460), h = i(844), c = i(2585);
						let l = t.Viewport = class extends h.Disposable {
							constructor(e, t, i, s, r, o, h, c) {
								super(), this._viewportElement = e, this._scrollArea = t, this._bufferService = i, this._optionsService = s, this._charSizeService = r, this._renderService = o, this._coreBrowserService = h, this.scrollBarWidth = 0, this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._wheelPartialScroll = 0, this._refreshAnimationFrame = null, this._ignoreNextScrollEvent = !1, this._smoothScrollState = {
									startTime: 0,
									origin: -1,
									target: -1
								}, this._onRequestScrollLines = this.register(new a.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this.scrollBarWidth = this._viewportElement.offsetWidth - this._scrollArea.offsetWidth || 15, this.register((0, n.addDisposableDomListener)(this._viewportElement, "scroll", this._handleScroll.bind(this))), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate(((e) => this._activeBuffer = e.activeBuffer))), this._renderDimensions = this._renderService.dimensions, this.register(this._renderService.onDimensionsChange(((e) => this._renderDimensions = e))), this._handleThemeChange(c.colors), this.register(c.onChangeColors(((e) => this._handleThemeChange(e)))), this.register(this._optionsService.onSpecificOptionChange("scrollback", (() => this.syncScrollArea()))), setTimeout((() => this.syncScrollArea()));
							}
							_handleThemeChange(e) {
								this._viewportElement.style.backgroundColor = e.background.css;
							}
							reset() {
								this._currentRowHeight = 0, this._currentDeviceCellHeight = 0, this._lastRecordedBufferLength = 0, this._lastRecordedViewportHeight = 0, this._lastRecordedBufferHeight = 0, this._lastTouchY = 0, this._lastScrollTop = 0, this._coreBrowserService.window.requestAnimationFrame((() => this.syncScrollArea()));
							}
							_refresh(e) {
								if (e) return this._innerRefresh(), void (null !== this._refreshAnimationFrame && this._coreBrowserService.window.cancelAnimationFrame(this._refreshAnimationFrame));
								null === this._refreshAnimationFrame && (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._innerRefresh())));
							}
							_innerRefresh() {
								if (this._charSizeService.height > 0) {
									this._currentRowHeight = this._renderDimensions.device.cell.height / this._coreBrowserService.dpr, this._currentDeviceCellHeight = this._renderDimensions.device.cell.height, this._lastRecordedViewportHeight = this._viewportElement.offsetHeight;
									const e = Math.round(this._currentRowHeight * this._lastRecordedBufferLength) + (this._lastRecordedViewportHeight - this._renderDimensions.css.canvas.height);
									this._lastRecordedBufferHeight !== e && (this._lastRecordedBufferHeight = e, this._scrollArea.style.height = this._lastRecordedBufferHeight + "px");
								}
								const e = this._bufferService.buffer.ydisp * this._currentRowHeight;
								this._viewportElement.scrollTop !== e && (this._ignoreNextScrollEvent = !0, this._viewportElement.scrollTop = e), this._refreshAnimationFrame = null;
							}
							syncScrollArea(e = !1) {
								if (this._lastRecordedBufferLength !== this._bufferService.buffer.lines.length) return this._lastRecordedBufferLength = this._bufferService.buffer.lines.length, void this._refresh(e);
								this._lastRecordedViewportHeight === this._renderService.dimensions.css.canvas.height && this._lastScrollTop === this._activeBuffer.ydisp * this._currentRowHeight && this._renderDimensions.device.cell.height === this._currentDeviceCellHeight || this._refresh(e);
							}
							_handleScroll(e) {
								if (this._lastScrollTop = this._viewportElement.scrollTop, !this._viewportElement.offsetParent) return;
								if (this._ignoreNextScrollEvent) return this._ignoreNextScrollEvent = !1, void this._onRequestScrollLines.fire({
									amount: 0,
									suppressScrollEvent: !0
								});
								const t = Math.round(this._lastScrollTop / this._currentRowHeight) - this._bufferService.buffer.ydisp;
								this._onRequestScrollLines.fire({
									amount: t,
									suppressScrollEvent: !0
								});
							}
							_smoothScroll() {
								if (this._isDisposed || -1 === this._smoothScrollState.origin || -1 === this._smoothScrollState.target) return;
								const e = this._smoothScrollPercent();
								this._viewportElement.scrollTop = this._smoothScrollState.origin + Math.round(e * (this._smoothScrollState.target - this._smoothScrollState.origin)), e < 1 ? this._coreBrowserService.window.requestAnimationFrame((() => this._smoothScroll())) : this._clearSmoothScrollState();
							}
							_smoothScrollPercent() {
								return this._optionsService.rawOptions.smoothScrollDuration && this._smoothScrollState.startTime ? Math.max(Math.min((Date.now() - this._smoothScrollState.startTime) / this._optionsService.rawOptions.smoothScrollDuration, 1), 0) : 1;
							}
							_clearSmoothScrollState() {
								this._smoothScrollState.startTime = 0, this._smoothScrollState.origin = -1, this._smoothScrollState.target = -1;
							}
							_bubbleScroll(e, t) {
								const i = this._viewportElement.scrollTop + this._lastRecordedViewportHeight;
								return !(t < 0 && 0 !== this._viewportElement.scrollTop || t > 0 && i < this._lastRecordedBufferHeight) || (e.cancelable && e.preventDefault(), !1);
							}
							handleWheel(e) {
								const t = this._getPixelsScrolled(e);
								return 0 !== t && (this._optionsService.rawOptions.smoothScrollDuration ? (this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, -1 === this._smoothScrollState.target ? this._smoothScrollState.target = this._viewportElement.scrollTop + t : this._smoothScrollState.target += t, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState()) : this._viewportElement.scrollTop += t, this._bubbleScroll(e, t));
							}
							scrollLines(e) {
								if (0 !== e) if (this._optionsService.rawOptions.smoothScrollDuration) {
									const t = e * this._currentRowHeight;
									this._smoothScrollState.startTime = Date.now(), this._smoothScrollPercent() < 1 ? (this._smoothScrollState.origin = this._viewportElement.scrollTop, this._smoothScrollState.target = this._smoothScrollState.origin + t, this._smoothScrollState.target = Math.max(Math.min(this._smoothScrollState.target, this._viewportElement.scrollHeight), 0), this._smoothScroll()) : this._clearSmoothScrollState();
								} else this._onRequestScrollLines.fire({
									amount: e,
									suppressScrollEvent: !1
								});
							}
							_getPixelsScrolled(e) {
								if (0 === e.deltaY || e.shiftKey) return 0;
								let t = this._applyScrollModifier(e.deltaY, e);
								return e.deltaMode === WheelEvent.DOM_DELTA_LINE ? t *= this._currentRowHeight : e.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t *= this._currentRowHeight * this._bufferService.rows), t;
							}
							getBufferElements(e, t) {
								let i, s = "";
								const r = [], n = t ?? this._bufferService.buffer.lines.length, o = this._bufferService.buffer.lines;
								for (let t = e; t < n; t++) {
									const e = o.get(t);
									if (!e) continue;
									const n = o.get(t + 1)?.isWrapped;
									if (s += e.translateToString(!n), !n || t === o.length - 1) {
										const e = document.createElement("div");
										e.textContent = s, r.push(e), s.length > 0 && (i = e), s = "";
									}
								}
								return {
									bufferElements: r,
									cursorElement: i
								};
							}
							getLinesScrolled(e) {
								if (0 === e.deltaY || e.shiftKey) return 0;
								let t = this._applyScrollModifier(e.deltaY, e);
								return e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? (t /= this._currentRowHeight + 0, this._wheelPartialScroll += t, t = Math.floor(Math.abs(this._wheelPartialScroll)) * (this._wheelPartialScroll > 0 ? 1 : -1), this._wheelPartialScroll %= 1) : e.deltaMode === WheelEvent.DOM_DELTA_PAGE && (t *= this._bufferService.rows), t;
							}
							_applyScrollModifier(e, t) {
								const i = this._optionsService.rawOptions.fastScrollModifier;
								return "alt" === i && t.altKey || "ctrl" === i && t.ctrlKey || "shift" === i && t.shiftKey ? e * this._optionsService.rawOptions.fastScrollSensitivity * this._optionsService.rawOptions.scrollSensitivity : e * this._optionsService.rawOptions.scrollSensitivity;
							}
							handleTouchStart(e) {
								this._lastTouchY = e.touches[0].pageY;
							}
							handleTouchMove(e) {
								const t = this._lastTouchY - e.touches[0].pageY;
								return this._lastTouchY = e.touches[0].pageY, 0 !== t && (this._viewportElement.scrollTop += t, this._bubbleScroll(e, t));
							}
						};
						t.Viewport = l = s([
							r(2, c.IBufferService),
							r(3, c.IOptionsService),
							r(4, o.ICharSizeService),
							r(5, o.IRenderService),
							r(6, o.ICoreBrowserService),
							r(7, o.IThemeService)
						], l);
					},
					3107: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferDecorationRenderer = void 0;
						const n = i(4725), o = i(844), a = i(2585);
						let h = t.BufferDecorationRenderer = class extends o.Disposable {
							constructor(e, t, i, s, r) {
								super(), this._screenElement = e, this._bufferService = t, this._coreBrowserService = i, this._decorationService = s, this._renderService = r, this._decorationElements = /* @__PURE__ */ new Map(), this._altBufferIsActive = !1, this._dimensionsChanged = !1, this._container = document.createElement("div"), this._container.classList.add("xterm-decoration-container"), this._screenElement.appendChild(this._container), this.register(this._renderService.onRenderedViewportChange((() => this._doRefreshDecorations()))), this.register(this._renderService.onDimensionsChange((() => {
									this._dimensionsChanged = !0, this._queueRefresh();
								}))), this.register(this._coreBrowserService.onDprChange((() => this._queueRefresh()))), this.register(this._bufferService.buffers.onBufferActivate((() => {
									this._altBufferIsActive = this._bufferService.buffer === this._bufferService.buffers.alt;
								}))), this.register(this._decorationService.onDecorationRegistered((() => this._queueRefresh()))), this.register(this._decorationService.onDecorationRemoved(((e) => this._removeDecoration(e)))), this.register((0, o.toDisposable)((() => {
									this._container.remove(), this._decorationElements.clear();
								})));
							}
							_queueRefresh() {
								void 0 === this._animationFrame && (this._animationFrame = this._renderService.addRefreshCallback((() => {
									this._doRefreshDecorations(), this._animationFrame = void 0;
								})));
							}
							_doRefreshDecorations() {
								for (const e of this._decorationService.decorations) this._renderDecoration(e);
								this._dimensionsChanged = !1;
							}
							_renderDecoration(e) {
								this._refreshStyle(e), this._dimensionsChanged && this._refreshXPosition(e);
							}
							_createElement(e) {
								const t = this._coreBrowserService.mainDocument.createElement("div");
								t.classList.add("xterm-decoration"), t.classList.toggle("xterm-decoration-top-layer", "top" === e?.options?.layer), t.style.width = `${Math.round((e.options.width || 1) * this._renderService.dimensions.css.cell.width)}px`, t.style.height = (e.options.height || 1) * this._renderService.dimensions.css.cell.height + "px", t.style.top = (e.marker.line - this._bufferService.buffers.active.ydisp) * this._renderService.dimensions.css.cell.height + "px", t.style.lineHeight = `${this._renderService.dimensions.css.cell.height}px`;
								const i = e.options.x ?? 0;
								return i && i > this._bufferService.cols && (t.style.display = "none"), this._refreshXPosition(e, t), t;
							}
							_refreshStyle(e) {
								const t = e.marker.line - this._bufferService.buffers.active.ydisp;
								if (t < 0 || t >= this._bufferService.rows) e.element && (e.element.style.display = "none", e.onRenderEmitter.fire(e.element));
								else {
									let i = this._decorationElements.get(e);
									i || (i = this._createElement(e), e.element = i, this._decorationElements.set(e, i), this._container.appendChild(i), e.onDispose((() => {
										this._decorationElements.delete(e), i.remove();
									}))), i.style.top = t * this._renderService.dimensions.css.cell.height + "px", i.style.display = this._altBufferIsActive ? "none" : "block", e.onRenderEmitter.fire(i);
								}
							}
							_refreshXPosition(e, t = e.element) {
								if (!t) return;
								const i = e.options.x ?? 0;
								"right" === (e.options.anchor || "left") ? t.style.right = i ? i * this._renderService.dimensions.css.cell.width + "px" : "" : t.style.left = i ? i * this._renderService.dimensions.css.cell.width + "px" : "";
							}
							_removeDecoration(e) {
								this._decorationElements.get(e)?.remove(), this._decorationElements.delete(e), e.dispose();
							}
						};
						t.BufferDecorationRenderer = h = s([
							r(1, a.IBufferService),
							r(2, n.ICoreBrowserService),
							r(3, a.IDecorationService),
							r(4, n.IRenderService)
						], h);
					},
					5871: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ColorZoneStore = void 0, t.ColorZoneStore = class {
							constructor() {
								this._zones = [], this._zonePool = [], this._zonePoolIndex = 0, this._linePadding = {
									full: 0,
									left: 0,
									center: 0,
									right: 0
								};
							}
							get zones() {
								return this._zonePool.length = Math.min(this._zonePool.length, this._zones.length), this._zones;
							}
							clear() {
								this._zones.length = 0, this._zonePoolIndex = 0;
							}
							addDecoration(e) {
								if (e.options.overviewRulerOptions) {
									for (const t of this._zones) if (t.color === e.options.overviewRulerOptions.color && t.position === e.options.overviewRulerOptions.position) {
										if (this._lineIntersectsZone(t, e.marker.line)) return;
										if (this._lineAdjacentToZone(t, e.marker.line, e.options.overviewRulerOptions.position)) return void this._addLineToZone(t, e.marker.line);
									}
									if (this._zonePoolIndex < this._zonePool.length) return this._zonePool[this._zonePoolIndex].color = e.options.overviewRulerOptions.color, this._zonePool[this._zonePoolIndex].position = e.options.overviewRulerOptions.position, this._zonePool[this._zonePoolIndex].startBufferLine = e.marker.line, this._zonePool[this._zonePoolIndex].endBufferLine = e.marker.line, void this._zones.push(this._zonePool[this._zonePoolIndex++]);
									this._zones.push({
										color: e.options.overviewRulerOptions.color,
										position: e.options.overviewRulerOptions.position,
										startBufferLine: e.marker.line,
										endBufferLine: e.marker.line
									}), this._zonePool.push(this._zones[this._zones.length - 1]), this._zonePoolIndex++;
								}
							}
							setPadding(e) {
								this._linePadding = e;
							}
							_lineIntersectsZone(e, t) {
								return t >= e.startBufferLine && t <= e.endBufferLine;
							}
							_lineAdjacentToZone(e, t, i) {
								return t >= e.startBufferLine - this._linePadding[i || "full"] && t <= e.endBufferLine + this._linePadding[i || "full"];
							}
							_addLineToZone(e, t) {
								e.startBufferLine = Math.min(e.startBufferLine, t), e.endBufferLine = Math.max(e.endBufferLine, t);
							}
						};
					},
					5744: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.OverviewRulerRenderer = void 0;
						const n = i(5871), o = i(4725), a = i(844), h = i(2585), c = {
							full: 0,
							left: 0,
							center: 0,
							right: 0
						}, l = {
							full: 0,
							left: 0,
							center: 0,
							right: 0
						}, d = {
							full: 0,
							left: 0,
							center: 0,
							right: 0
						};
						let _ = t.OverviewRulerRenderer = class extends a.Disposable {
							get _width() {
								return this._optionsService.options.overviewRulerWidth || 0;
							}
							constructor(e, t, i, s, r, o, h) {
								super(), this._viewportElement = e, this._screenElement = t, this._bufferService = i, this._decorationService = s, this._renderService = r, this._optionsService = o, this._coreBrowserService = h, this._colorZoneStore = new n.ColorZoneStore(), this._shouldUpdateDimensions = !0, this._shouldUpdateAnchor = !0, this._lastKnownBufferLength = 0, this._canvas = this._coreBrowserService.mainDocument.createElement("canvas"), this._canvas.classList.add("xterm-decoration-overview-ruler"), this._refreshCanvasDimensions(), this._viewportElement.parentElement?.insertBefore(this._canvas, this._viewportElement);
								const c = this._canvas.getContext("2d");
								if (!c) throw new Error("Ctx cannot be null");
								this._ctx = c, this._registerDecorationListeners(), this._registerBufferChangeListeners(), this._registerDimensionChangeListeners(), this.register((0, a.toDisposable)((() => {
									this._canvas?.remove();
								})));
							}
							_registerDecorationListeners() {
								this.register(this._decorationService.onDecorationRegistered((() => this._queueRefresh(void 0, !0)))), this.register(this._decorationService.onDecorationRemoved((() => this._queueRefresh(void 0, !0))));
							}
							_registerBufferChangeListeners() {
								this.register(this._renderService.onRenderedViewportChange((() => this._queueRefresh()))), this.register(this._bufferService.buffers.onBufferActivate((() => {
									this._canvas.style.display = this._bufferService.buffer === this._bufferService.buffers.alt ? "none" : "block";
								}))), this.register(this._bufferService.onScroll((() => {
									this._lastKnownBufferLength !== this._bufferService.buffers.normal.lines.length && (this._refreshDrawHeightConstants(), this._refreshColorZonePadding());
								})));
							}
							_registerDimensionChangeListeners() {
								this.register(this._renderService.onRender((() => {
									this._containerHeight && this._containerHeight === this._screenElement.clientHeight || (this._queueRefresh(!0), this._containerHeight = this._screenElement.clientHeight);
								}))), this.register(this._optionsService.onSpecificOptionChange("overviewRulerWidth", (() => this._queueRefresh(!0)))), this.register(this._coreBrowserService.onDprChange((() => this._queueRefresh(!0)))), this._queueRefresh(!0);
							}
							_refreshDrawConstants() {
								const e = Math.floor(this._canvas.width / 3), t = Math.ceil(this._canvas.width / 3);
								l.full = this._canvas.width, l.left = e, l.center = t, l.right = e, this._refreshDrawHeightConstants(), d.full = 0, d.left = 0, d.center = l.left, d.right = l.left + l.center;
							}
							_refreshDrawHeightConstants() {
								c.full = Math.round(2 * this._coreBrowserService.dpr);
								const e = this._canvas.height / this._bufferService.buffer.lines.length, t = Math.round(Math.max(Math.min(e, 12), 6) * this._coreBrowserService.dpr);
								c.left = t, c.center = t, c.right = t;
							}
							_refreshColorZonePadding() {
								this._colorZoneStore.setPadding({
									full: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c.full),
									left: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c.left),
									center: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c.center),
									right: Math.floor(this._bufferService.buffers.active.lines.length / (this._canvas.height - 1) * c.right)
								}), this._lastKnownBufferLength = this._bufferService.buffers.normal.lines.length;
							}
							_refreshCanvasDimensions() {
								this._canvas.style.width = `${this._width}px`, this._canvas.width = Math.round(this._width * this._coreBrowserService.dpr), this._canvas.style.height = `${this._screenElement.clientHeight}px`, this._canvas.height = Math.round(this._screenElement.clientHeight * this._coreBrowserService.dpr), this._refreshDrawConstants(), this._refreshColorZonePadding();
							}
							_refreshDecorations() {
								this._shouldUpdateDimensions && this._refreshCanvasDimensions(), this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height), this._colorZoneStore.clear();
								for (const e of this._decorationService.decorations) this._colorZoneStore.addDecoration(e);
								this._ctx.lineWidth = 1;
								const e = this._colorZoneStore.zones;
								for (const t of e) "full" !== t.position && this._renderColorZone(t);
								for (const t of e) "full" === t.position && this._renderColorZone(t);
								this._shouldUpdateDimensions = !1, this._shouldUpdateAnchor = !1;
							}
							_renderColorZone(e) {
								this._ctx.fillStyle = e.color, this._ctx.fillRect(d[e.position || "full"], Math.round((this._canvas.height - 1) * (e.startBufferLine / this._bufferService.buffers.active.lines.length) - c[e.position || "full"] / 2), l[e.position || "full"], Math.round((this._canvas.height - 1) * ((e.endBufferLine - e.startBufferLine) / this._bufferService.buffers.active.lines.length) + c[e.position || "full"]));
							}
							_queueRefresh(e, t) {
								this._shouldUpdateDimensions = e || this._shouldUpdateDimensions, this._shouldUpdateAnchor = t || this._shouldUpdateAnchor, void 0 === this._animationFrame && (this._animationFrame = this._coreBrowserService.window.requestAnimationFrame((() => {
									this._refreshDecorations(), this._animationFrame = void 0;
								})));
							}
						};
						t.OverviewRulerRenderer = _ = s([
							r(2, h.IBufferService),
							r(3, h.IDecorationService),
							r(4, o.IRenderService),
							r(5, h.IOptionsService),
							r(6, o.ICoreBrowserService)
						], _);
					},
					2950: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CompositionHelper = void 0;
						const n = i(4725), o = i(2585), a = i(2584);
						let h = t.CompositionHelper = class {
							get isComposing() {
								return this._isComposing;
							}
							constructor(e, t, i, s, r, n) {
								this._textarea = e, this._compositionView = t, this._bufferService = i, this._optionsService = s, this._coreService = r, this._renderService = n, this._isComposing = !1, this._isSendingComposition = !1, this._compositionPosition = {
									start: 0,
									end: 0
								}, this._dataAlreadySent = "";
							}
							compositionstart() {
								this._isComposing = !0, this._compositionPosition.start = this._textarea.value.length, this._compositionView.textContent = "", this._dataAlreadySent = "", this._compositionView.classList.add("active");
							}
							compositionupdate(e) {
								this._compositionView.textContent = e.data, this.updateCompositionElements(), setTimeout((() => {
									this._compositionPosition.end = this._textarea.value.length;
								}), 0);
							}
							compositionend() {
								this._finalizeComposition(!0);
							}
							keydown(e) {
								if (this._isComposing || this._isSendingComposition) {
									if (229 === e.keyCode) return !1;
									if (16 === e.keyCode || 17 === e.keyCode || 18 === e.keyCode) return !1;
									this._finalizeComposition(!1);
								}
								return 229 !== e.keyCode || (this._handleAnyTextareaChanges(), !1);
							}
							_finalizeComposition(e) {
								if (this._compositionView.classList.remove("active"), this._isComposing = !1, e) {
									const e = {
										start: this._compositionPosition.start,
										end: this._compositionPosition.end
									};
									this._isSendingComposition = !0, setTimeout((() => {
										if (this._isSendingComposition) {
											let t;
											this._isSendingComposition = !1, e.start += this._dataAlreadySent.length, t = this._isComposing ? this._textarea.value.substring(e.start, e.end) : this._textarea.value.substring(e.start), t.length > 0 && this._coreService.triggerDataEvent(t, !0);
										}
									}), 0);
								} else {
									this._isSendingComposition = !1;
									const e = this._textarea.value.substring(this._compositionPosition.start, this._compositionPosition.end);
									this._coreService.triggerDataEvent(e, !0);
								}
							}
							_handleAnyTextareaChanges() {
								const e = this._textarea.value;
								setTimeout((() => {
									if (!this._isComposing) {
										const t = this._textarea.value, i = t.replace(e, "");
										this._dataAlreadySent = i, t.length > e.length ? this._coreService.triggerDataEvent(i, !0) : t.length < e.length ? this._coreService.triggerDataEvent(`${a.C0.DEL}`, !0) : t.length === e.length && t !== e && this._coreService.triggerDataEvent(t, !0);
									}
								}), 0);
							}
							updateCompositionElements(e) {
								if (this._isComposing) {
									if (this._bufferService.buffer.isCursorInViewport) {
										const e = Math.min(this._bufferService.buffer.x, this._bufferService.cols - 1), t = this._renderService.dimensions.css.cell.height, i = this._bufferService.buffer.y * this._renderService.dimensions.css.cell.height, s = e * this._renderService.dimensions.css.cell.width;
										this._compositionView.style.left = s + "px", this._compositionView.style.top = i + "px", this._compositionView.style.height = t + "px", this._compositionView.style.lineHeight = t + "px", this._compositionView.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._compositionView.style.fontSize = this._optionsService.rawOptions.fontSize + "px";
										const r = this._compositionView.getBoundingClientRect();
										this._textarea.style.left = s + "px", this._textarea.style.top = i + "px", this._textarea.style.width = Math.max(r.width, 1) + "px", this._textarea.style.height = Math.max(r.height, 1) + "px", this._textarea.style.lineHeight = r.height + "px";
									}
									e || setTimeout((() => this.updateCompositionElements(!0)), 0);
								}
							}
						};
						t.CompositionHelper = h = s([
							r(2, o.IBufferService),
							r(3, o.IOptionsService),
							r(4, o.ICoreService),
							r(5, n.IRenderService)
						], h);
					},
					9806: (e, t) => {
						function i(e, t, i) {
							const s = i.getBoundingClientRect(), r = e.getComputedStyle(i), n = parseInt(r.getPropertyValue("padding-left")), o = parseInt(r.getPropertyValue("padding-top"));
							return [t.clientX - s.left - n, t.clientY - s.top - o];
						}
						Object.defineProperty(t, "__esModule", { value: !0 }), t.getCoords = t.getCoordsRelativeToElement = void 0, t.getCoordsRelativeToElement = i, t.getCoords = function(e, t, s, r, n, o, a, h, c) {
							if (!o) return;
							const l = i(e, t, s);
							return l ? (l[0] = Math.ceil((l[0] + (c ? a / 2 : 0)) / a), l[1] = Math.ceil(l[1] / h), l[0] = Math.min(Math.max(l[0], 1), r + (c ? 1 : 0)), l[1] = Math.min(Math.max(l[1], 1), n), l) : void 0;
						};
					},
					9504: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.moveToCellSequence = void 0;
						const s = i(2584);
						function r(e, t, i, s) {
							const r = e - n(e, i), a = t - n(t, i);
							return c(Math.abs(r - a) - function(e, t, i) {
								let s = 0;
								const r = e - n(e, i), a = t - n(t, i);
								for (let n = 0; n < Math.abs(r - a); n++) {
									const a = "A" === o(e, t) ? -1 : 1;
									i.buffer.lines.get(r + a * n)?.isWrapped && s++;
								}
								return s;
							}(e, t, i), h(o(e, t), s));
						}
						function n(e, t) {
							let i = 0, s = t.buffer.lines.get(e), r = s?.isWrapped;
							for (; r && e >= 0 && e < t.rows;) i++, s = t.buffer.lines.get(--e), r = s?.isWrapped;
							return i;
						}
						function o(e, t) {
							return e > t ? "A" : "B";
						}
						function a(e, t, i, s, r, n) {
							let o = e, a = t, h = "";
							for (; o !== i || a !== s;) o += r ? 1 : -1, r && o > n.cols - 1 ? (h += n.buffer.translateBufferLineToString(a, !1, e, o), o = 0, e = 0, a++) : !r && o < 0 && (h += n.buffer.translateBufferLineToString(a, !1, 0, e + 1), o = n.cols - 1, e = o, a--);
							return h + n.buffer.translateBufferLineToString(a, !1, e, o);
						}
						function h(e, t) {
							const i = t ? "O" : "[";
							return s.C0.ESC + i + e;
						}
						function c(e, t) {
							e = Math.floor(e);
							let i = "";
							for (let s = 0; s < e; s++) i += t;
							return i;
						}
						t.moveToCellSequence = function(e, t, i, s) {
							const o = i.buffer.x, l = i.buffer.y;
							if (!i.buffer.hasScrollback) return function(e, t, i, s, o, l) {
								return 0 === r(t, s, o, l).length ? "" : c(a(e, t, e, t - n(t, o), !1, o).length, h("D", l));
							}(o, l, 0, t, i, s) + r(l, t, i, s) + function(e, t, i, s, o, l) {
								let d;
								d = r(t, s, o, l).length > 0 ? s - n(s, o) : t;
								const _ = s, u = function(e, t, i, s, o, a) {
									let h;
									return h = r(i, s, o, a).length > 0 ? s - n(s, o) : t, e < i && h <= s || e >= i && h < s ? "C" : "D";
								}(e, t, i, s, o, l);
								return c(a(e, d, i, _, "C" === u, o).length, h(u, l));
							}(o, l, e, t, i, s);
							let d;
							if (l === t) return d = o > e ? "D" : "C", c(Math.abs(o - e), h(d, s));
							d = l > t ? "D" : "C";
							const _ = Math.abs(l - t);
							return c(function(e, t) {
								return t.cols - e;
							}(l > t ? e : o, i) + (_ - 1) * i.cols + 1 + ((l > t ? o : e) - 1), h(d, s));
						};
					},
					1296: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DomRenderer = void 0;
						const n = i(3787), o = i(2550), a = i(2223), h = i(6171), c = i(6052), l = i(4725), d = i(8055), _ = i(8460), u = i(844), f = i(2585), v = "xterm-dom-renderer-owner-", p = "xterm-rows", g = "xterm-fg-", m = "xterm-bg-", S = "xterm-focus", C = "xterm-selection";
						let b = 1, w = t.DomRenderer = class extends u.Disposable {
							constructor(e, t, i, s, r, a, l, d, f, g, m, S, w) {
								super(), this._terminal = e, this._document = t, this._element = i, this._screenElement = s, this._viewportElement = r, this._helperContainer = a, this._linkifier2 = l, this._charSizeService = f, this._optionsService = g, this._bufferService = m, this._coreBrowserService = S, this._themeService = w, this._terminalClass = b++, this._rowElements = [], this._selectionRenderModel = (0, c.createSelectionRenderModel)(), this.onRequestRedraw = this.register(new _.EventEmitter()).event, this._rowContainer = this._document.createElement("div"), this._rowContainer.classList.add(p), this._rowContainer.style.lineHeight = "normal", this._rowContainer.setAttribute("aria-hidden", "true"), this._refreshRowElements(this._bufferService.cols, this._bufferService.rows), this._selectionContainer = this._document.createElement("div"), this._selectionContainer.classList.add(C), this._selectionContainer.setAttribute("aria-hidden", "true"), this.dimensions = (0, h.createRenderDimensions)(), this._updateDimensions(), this.register(this._optionsService.onOptionChange((() => this._handleOptionsChanged()))), this.register(this._themeService.onChangeColors(((e) => this._injectCss(e)))), this._injectCss(this._themeService.colors), this._rowFactory = d.createInstance(n.DomRendererRowFactory, document), this._element.classList.add(v + this._terminalClass), this._screenElement.appendChild(this._rowContainer), this._screenElement.appendChild(this._selectionContainer), this.register(this._linkifier2.onShowLinkUnderline(((e) => this._handleLinkHover(e)))), this.register(this._linkifier2.onHideLinkUnderline(((e) => this._handleLinkLeave(e)))), this.register((0, u.toDisposable)((() => {
									this._element.classList.remove(v + this._terminalClass), this._rowContainer.remove(), this._selectionContainer.remove(), this._widthCache.dispose(), this._themeStyleElement.remove(), this._dimensionsStyleElement.remove();
								}))), this._widthCache = new o.WidthCache(this._document, this._helperContainer), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
							}
							_updateDimensions() {
								const e = this._coreBrowserService.dpr;
								this.dimensions.device.char.width = this._charSizeService.width * e, this.dimensions.device.char.height = Math.ceil(this._charSizeService.height * e), this.dimensions.device.cell.width = this.dimensions.device.char.width + Math.round(this._optionsService.rawOptions.letterSpacing), this.dimensions.device.cell.height = Math.floor(this.dimensions.device.char.height * this._optionsService.rawOptions.lineHeight), this.dimensions.device.char.left = 0, this.dimensions.device.char.top = 0, this.dimensions.device.canvas.width = this.dimensions.device.cell.width * this._bufferService.cols, this.dimensions.device.canvas.height = this.dimensions.device.cell.height * this._bufferService.rows, this.dimensions.css.canvas.width = Math.round(this.dimensions.device.canvas.width / e), this.dimensions.css.canvas.height = Math.round(this.dimensions.device.canvas.height / e), this.dimensions.css.cell.width = this.dimensions.css.canvas.width / this._bufferService.cols, this.dimensions.css.cell.height = this.dimensions.css.canvas.height / this._bufferService.rows;
								for (const e of this._rowElements) e.style.width = `${this.dimensions.css.canvas.width}px`, e.style.height = `${this.dimensions.css.cell.height}px`, e.style.lineHeight = `${this.dimensions.css.cell.height}px`, e.style.overflow = "hidden";
								this._dimensionsStyleElement || (this._dimensionsStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._dimensionsStyleElement));
								const t = `${this._terminalSelector} .${p} span { display: inline-block; height: 100%; vertical-align: top;}`;
								this._dimensionsStyleElement.textContent = t, this._selectionContainer.style.height = this._viewportElement.style.height, this._screenElement.style.width = `${this.dimensions.css.canvas.width}px`, this._screenElement.style.height = `${this.dimensions.css.canvas.height}px`;
							}
							_injectCss(e) {
								this._themeStyleElement || (this._themeStyleElement = this._document.createElement("style"), this._screenElement.appendChild(this._themeStyleElement));
								let t = `${this._terminalSelector} .${p} { color: ${e.foreground.css}; font-family: ${this._optionsService.rawOptions.fontFamily}; font-size: ${this._optionsService.rawOptions.fontSize}px; font-kerning: none; white-space: pre}`;
								t += `${this._terminalSelector} .${p} .xterm-dim { color: ${d.color.multiplyOpacity(e.foreground, .5).css};}`, t += `${this._terminalSelector} span:not(.xterm-bold) { font-weight: ${this._optionsService.rawOptions.fontWeight};}${this._terminalSelector} span.xterm-bold { font-weight: ${this._optionsService.rawOptions.fontWeightBold};}${this._terminalSelector} span.xterm-italic { font-style: italic;}`;
								const i = `blink_underline_${this._terminalClass}`, s = `blink_bar_${this._terminalClass}`, r = `blink_block_${this._terminalClass}`;
								t += `@keyframes ${i} { 50% {  border-bottom-style: hidden; }}`, t += `@keyframes ${s} { 50% {  box-shadow: none; }}`, t += `@keyframes ${r} { 0% {  background-color: ${e.cursor.css};  color: ${e.cursorAccent.css}; } 50% {  background-color: inherit;  color: ${e.cursor.css}; }}`, t += `${this._terminalSelector} .${p}.${S} .xterm-cursor.xterm-cursor-blink.xterm-cursor-underline { animation: ${i} 1s step-end infinite;}${this._terminalSelector} .${p}.${S} .xterm-cursor.xterm-cursor-blink.xterm-cursor-bar { animation: ${s} 1s step-end infinite;}${this._terminalSelector} .${p}.${S} .xterm-cursor.xterm-cursor-blink.xterm-cursor-block { animation: ${r} 1s step-end infinite;}${this._terminalSelector} .${p} .xterm-cursor.xterm-cursor-block { background-color: ${e.cursor.css}; color: ${e.cursorAccent.css};}${this._terminalSelector} .${p} .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: ${e.cursor.css} !important; color: ${e.cursorAccent.css} !important;}${this._terminalSelector} .${p} .xterm-cursor.xterm-cursor-outline { outline: 1px solid ${e.cursor.css}; outline-offset: -1px;}${this._terminalSelector} .${p} .xterm-cursor.xterm-cursor-bar { box-shadow: ${this._optionsService.rawOptions.cursorWidth}px 0 0 ${e.cursor.css} inset;}${this._terminalSelector} .${p} .xterm-cursor.xterm-cursor-underline { border-bottom: 1px ${e.cursor.css}; border-bottom-style: solid; height: calc(100% - 1px);}`, t += `${this._terminalSelector} .${C} { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none;}${this._terminalSelector}.focus .${C} div { position: absolute; background-color: ${e.selectionBackgroundOpaque.css};}${this._terminalSelector} .${C} div { position: absolute; background-color: ${e.selectionInactiveBackgroundOpaque.css};}`;
								for (const [i, s] of e.ansi.entries()) t += `${this._terminalSelector} .${g}${i} { color: ${s.css}; }${this._terminalSelector} .${g}${i}.xterm-dim { color: ${d.color.multiplyOpacity(s, .5).css}; }${this._terminalSelector} .${m}${i} { background-color: ${s.css}; }`;
								t += `${this._terminalSelector} .${g}${a.INVERTED_DEFAULT_COLOR} { color: ${d.color.opaque(e.background).css}; }${this._terminalSelector} .${g}${a.INVERTED_DEFAULT_COLOR}.xterm-dim { color: ${d.color.multiplyOpacity(d.color.opaque(e.background), .5).css}; }${this._terminalSelector} .${m}${a.INVERTED_DEFAULT_COLOR} { background-color: ${e.foreground.css}; }`, this._themeStyleElement.textContent = t;
							}
							_setDefaultSpacing() {
								const e = this.dimensions.css.cell.width - this._widthCache.get("W", !1, !1);
								this._rowContainer.style.letterSpacing = `${e}px`, this._rowFactory.defaultSpacing = e;
							}
							handleDevicePixelRatioChange() {
								this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
							}
							_refreshRowElements(e, t) {
								for (let e = this._rowElements.length; e <= t; e++) {
									const e = this._document.createElement("div");
									this._rowContainer.appendChild(e), this._rowElements.push(e);
								}
								for (; this._rowElements.length > t;) this._rowContainer.removeChild(this._rowElements.pop());
							}
							handleResize(e, t) {
								this._refreshRowElements(e, t), this._updateDimensions(), this.handleSelectionChanged(this._selectionRenderModel.selectionStart, this._selectionRenderModel.selectionEnd, this._selectionRenderModel.columnSelectMode);
							}
							handleCharSizeChanged() {
								this._updateDimensions(), this._widthCache.clear(), this._setDefaultSpacing();
							}
							handleBlur() {
								this._rowContainer.classList.remove(S), this.renderRows(0, this._bufferService.rows - 1);
							}
							handleFocus() {
								this._rowContainer.classList.add(S), this.renderRows(this._bufferService.buffer.y, this._bufferService.buffer.y);
							}
							handleSelectionChanged(e, t, i) {
								if (this._selectionContainer.replaceChildren(), this._rowFactory.handleSelectionChanged(e, t, i), this.renderRows(0, this._bufferService.rows - 1), !e || !t) return;
								this._selectionRenderModel.update(this._terminal, e, t, i);
								const s = this._selectionRenderModel.viewportStartRow, r = this._selectionRenderModel.viewportEndRow, n = this._selectionRenderModel.viewportCappedStartRow, o = this._selectionRenderModel.viewportCappedEndRow;
								if (n >= this._bufferService.rows || o < 0) return;
								const a = this._document.createDocumentFragment();
								if (i) {
									const i = e[0] > t[0];
									a.appendChild(this._createSelectionElement(n, i ? t[0] : e[0], i ? e[0] : t[0], o - n + 1));
								} else {
									const i = s === n ? e[0] : 0, h = n === r ? t[0] : this._bufferService.cols;
									a.appendChild(this._createSelectionElement(n, i, h));
									const c = o - n - 1;
									if (a.appendChild(this._createSelectionElement(n + 1, 0, this._bufferService.cols, c)), n !== o) {
										const e = r === o ? t[0] : this._bufferService.cols;
										a.appendChild(this._createSelectionElement(o, 0, e));
									}
								}
								this._selectionContainer.appendChild(a);
							}
							_createSelectionElement(e, t, i, s = 1) {
								const r = this._document.createElement("div"), n = t * this.dimensions.css.cell.width;
								let o = this.dimensions.css.cell.width * (i - t);
								return n + o > this.dimensions.css.canvas.width && (o = this.dimensions.css.canvas.width - n), r.style.height = s * this.dimensions.css.cell.height + "px", r.style.top = e * this.dimensions.css.cell.height + "px", r.style.left = `${n}px`, r.style.width = `${o}px`, r;
							}
							handleCursorMove() {}
							_handleOptionsChanged() {
								this._updateDimensions(), this._injectCss(this._themeService.colors), this._widthCache.setFont(this._optionsService.rawOptions.fontFamily, this._optionsService.rawOptions.fontSize, this._optionsService.rawOptions.fontWeight, this._optionsService.rawOptions.fontWeightBold), this._setDefaultSpacing();
							}
							clear() {
								for (const e of this._rowElements) e.replaceChildren();
							}
							renderRows(e, t) {
								const i = this._bufferService.buffer, s = i.ybase + i.y, r = Math.min(i.x, this._bufferService.cols - 1), n = this._optionsService.rawOptions.cursorBlink, o = this._optionsService.rawOptions.cursorStyle, a = this._optionsService.rawOptions.cursorInactiveStyle;
								for (let h = e; h <= t; h++) {
									const e = h + i.ydisp, t = this._rowElements[h], c = i.lines.get(e);
									if (!t || !c) break;
									t.replaceChildren(...this._rowFactory.createRow(c, e, e === s, o, a, r, n, this.dimensions.css.cell.width, this._widthCache, -1, -1));
								}
							}
							get _terminalSelector() {
								return `.${v}${this._terminalClass}`;
							}
							_handleLinkHover(e) {
								this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, !0);
							}
							_handleLinkLeave(e) {
								this._setCellUnderline(e.x1, e.x2, e.y1, e.y2, e.cols, !1);
							}
							_setCellUnderline(e, t, i, s, r, n) {
								i < 0 && (e = 0), s < 0 && (t = 0);
								const o = this._bufferService.rows - 1;
								i = Math.max(Math.min(i, o), 0), s = Math.max(Math.min(s, o), 0), r = Math.min(r, this._bufferService.cols);
								const a = this._bufferService.buffer, h = a.ybase + a.y, c = Math.min(a.x, r - 1), l = this._optionsService.rawOptions.cursorBlink, d = this._optionsService.rawOptions.cursorStyle, _ = this._optionsService.rawOptions.cursorInactiveStyle;
								for (let o = i; o <= s; ++o) {
									const u = o + a.ydisp, f = this._rowElements[o], v = a.lines.get(u);
									if (!f || !v) break;
									f.replaceChildren(...this._rowFactory.createRow(v, u, u === h, d, _, c, l, this.dimensions.css.cell.width, this._widthCache, n ? o === i ? e : 0 : -1, n ? (o === s ? t : r) - 1 : -1));
								}
							}
						};
						t.DomRenderer = w = s([
							r(7, f.IInstantiationService),
							r(8, l.ICharSizeService),
							r(9, f.IOptionsService),
							r(10, f.IBufferService),
							r(11, l.ICoreBrowserService),
							r(12, l.IThemeService)
						], w);
					},
					3787: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DomRendererRowFactory = void 0;
						const n = i(2223), o = i(643), a = i(511), h = i(2585), c = i(8055), l = i(4725), d = i(4269), _ = i(6171), u = i(3734);
						let f = t.DomRendererRowFactory = class {
							constructor(e, t, i, s, r, n, o) {
								this._document = e, this._characterJoinerService = t, this._optionsService = i, this._coreBrowserService = s, this._coreService = r, this._decorationService = n, this._themeService = o, this._workCell = new a.CellData(), this._columnSelectMode = !1, this.defaultSpacing = 0;
							}
							handleSelectionChanged(e, t, i) {
								this._selectionStart = e, this._selectionEnd = t, this._columnSelectMode = i;
							}
							createRow(e, t, i, s, r, a, h, l, _, f, p) {
								const g = [], m = this._characterJoinerService.getJoinedCharacters(t), S = this._themeService.colors;
								let C, b = e.getNoBgTrimmedLength();
								i && b < a + 1 && (b = a + 1);
								let w = 0, y = "", E = 0, k = 0, L = 0, D = !1, R = 0, x = !1, A = 0;
								const B = [], T = -1 !== f && -1 !== p;
								for (let M = 0; M < b; M++) {
									e.loadCell(M, this._workCell);
									let b = this._workCell.getWidth();
									if (0 === b) continue;
									let O = !1, P = M, I = this._workCell;
									if (m.length > 0 && M === m[0][0]) {
										O = !0;
										const t = m.shift();
										I = new d.JoinedCellData(this._workCell, e.translateToString(!0, t[0], t[1]), t[1] - t[0]), P = t[1] - 1, b = I.getWidth();
									}
									const H = this._isCellInSelection(M, t), F = i && M === a, W = T && M >= f && M <= p;
									let U = !1;
									this._decorationService.forEachDecorationAtCell(M, t, void 0, ((e) => {
										U = !0;
									}));
									let N = I.getChars() || o.WHITESPACE_CELL_CHAR;
									if (" " === N && (I.isUnderline() || I.isOverline()) && (N = "\xA0"), A = b * l - _.get(N, I.isBold(), I.isItalic()), C) {
										if (w && (H && x || !H && !x && I.bg === E) && (H && x && S.selectionForeground || I.fg === k) && I.extended.ext === L && W === D && A === R && !F && !O && !U) {
											I.isInvisible() ? y += o.WHITESPACE_CELL_CHAR : y += N, w++;
											continue;
										}
										w && (C.textContent = y), C = this._document.createElement("span"), w = 0, y = "";
									} else C = this._document.createElement("span");
									if (E = I.bg, k = I.fg, L = I.extended.ext, D = W, R = A, x = H, O && a >= M && a <= P && (a = M), !this._coreService.isCursorHidden && F && this._coreService.isCursorInitialized) {
										if (B.push("xterm-cursor"), this._coreBrowserService.isFocused) h && B.push("xterm-cursor-blink"), B.push("bar" === s ? "xterm-cursor-bar" : "underline" === s ? "xterm-cursor-underline" : "xterm-cursor-block");
										else if (r) switch (r) {
											case "outline":
												B.push("xterm-cursor-outline");
												break;
											case "block":
												B.push("xterm-cursor-block");
												break;
											case "bar":
												B.push("xterm-cursor-bar");
												break;
											case "underline": B.push("xterm-cursor-underline");
										}
									}
									if (I.isBold() && B.push("xterm-bold"), I.isItalic() && B.push("xterm-italic"), I.isDim() && B.push("xterm-dim"), y = I.isInvisible() ? o.WHITESPACE_CELL_CHAR : I.getChars() || o.WHITESPACE_CELL_CHAR, I.isUnderline() && (B.push(`xterm-underline-${I.extended.underlineStyle}`), " " === y && (y = "\xA0"), !I.isUnderlineColorDefault())) if (I.isUnderlineColorRGB()) C.style.textDecorationColor = `rgb(${u.AttributeData.toColorRGB(I.getUnderlineColor()).join(",")})`;
									else {
										let e = I.getUnderlineColor();
										this._optionsService.rawOptions.drawBoldTextInBrightColors && I.isBold() && e < 8 && (e += 8), C.style.textDecorationColor = S.ansi[e].css;
									}
									I.isOverline() && (B.push("xterm-overline"), " " === y && (y = "\xA0")), I.isStrikethrough() && B.push("xterm-strikethrough"), W && (C.style.textDecoration = "underline");
									let $ = I.getFgColor(), j = I.getFgColorMode(), z = I.getBgColor(), K = I.getBgColorMode();
									const q = !!I.isInverse();
									if (q) {
										const e = $;
										$ = z, z = e;
										const t = j;
										j = K, K = t;
									}
									let V, G, X, J = !1;
									switch (this._decorationService.forEachDecorationAtCell(M, t, void 0, ((e) => {
										"top" !== e.options.layer && J || (e.backgroundColorRGB && (K = 50331648, z = e.backgroundColorRGB.rgba >> 8 & 16777215, V = e.backgroundColorRGB), e.foregroundColorRGB && (j = 50331648, $ = e.foregroundColorRGB.rgba >> 8 & 16777215, G = e.foregroundColorRGB), J = "top" === e.options.layer);
									})), !J && H && (V = this._coreBrowserService.isFocused ? S.selectionBackgroundOpaque : S.selectionInactiveBackgroundOpaque, z = V.rgba >> 8 & 16777215, K = 50331648, J = !0, S.selectionForeground && (j = 50331648, $ = S.selectionForeground.rgba >> 8 & 16777215, G = S.selectionForeground)), J && B.push("xterm-decoration-top"), K) {
										case 16777216:
										case 33554432:
											X = S.ansi[z], B.push(`xterm-bg-${z}`);
											break;
										case 50331648:
											X = c.channels.toColor(z >> 16, z >> 8 & 255, 255 & z), this._addStyle(C, `background-color:#${v((z >>> 0).toString(16), "0", 6)}`);
											break;
										default: q ? (X = S.foreground, B.push(`xterm-bg-${n.INVERTED_DEFAULT_COLOR}`)) : X = S.background;
									}
									switch (V || I.isDim() && (V = c.color.multiplyOpacity(X, .5)), j) {
										case 16777216:
										case 33554432:
											I.isBold() && $ < 8 && this._optionsService.rawOptions.drawBoldTextInBrightColors && ($ += 8), this._applyMinimumContrast(C, X, S.ansi[$], I, V, void 0) || B.push(`xterm-fg-${$}`);
											break;
										case 50331648:
											const e = c.channels.toColor($ >> 16 & 255, $ >> 8 & 255, 255 & $);
											this._applyMinimumContrast(C, X, e, I, V, G) || this._addStyle(C, `color:#${v($.toString(16), "0", 6)}`);
											break;
										default: this._applyMinimumContrast(C, X, S.foreground, I, V, G) || q && B.push(`xterm-fg-${n.INVERTED_DEFAULT_COLOR}`);
									}
									B.length && (C.className = B.join(" "), B.length = 0), F || O || U ? C.textContent = y : w++, A !== this.defaultSpacing && (C.style.letterSpacing = `${A}px`), g.push(C), M = P;
								}
								return C && w && (C.textContent = y), g;
							}
							_applyMinimumContrast(e, t, i, s, r, n) {
								if (1 === this._optionsService.rawOptions.minimumContrastRatio || (0, _.treatGlyphAsBackgroundColor)(s.getCode())) return !1;
								const o = this._getContrastCache(s);
								let a;
								if (r || n || (a = o.getColor(t.rgba, i.rgba)), void 0 === a) {
									const e = this._optionsService.rawOptions.minimumContrastRatio / (s.isDim() ? 2 : 1);
									a = c.color.ensureContrastRatio(r || t, n || i, e), o.setColor((r || t).rgba, (n || i).rgba, a ?? null);
								}
								return !!a && (this._addStyle(e, `color:${a.css}`), !0);
							}
							_getContrastCache(e) {
								return e.isDim() ? this._themeService.colors.halfContrastCache : this._themeService.colors.contrastCache;
							}
							_addStyle(e, t) {
								e.setAttribute("style", `${e.getAttribute("style") || ""}${t};`);
							}
							_isCellInSelection(e, t) {
								const i = this._selectionStart, s = this._selectionEnd;
								return !(!i || !s) && (this._columnSelectMode ? i[0] <= s[0] ? e >= i[0] && t >= i[1] && e < s[0] && t <= s[1] : e < i[0] && t >= i[1] && e >= s[0] && t <= s[1] : t > i[1] && t < s[1] || i[1] === s[1] && t === i[1] && e >= i[0] && e < s[0] || i[1] < s[1] && t === s[1] && e < s[0] || i[1] < s[1] && t === i[1] && e >= i[0]);
							}
						};
						function v(e, t, i) {
							for (; e.length < i;) e = t + e;
							return e;
						}
						t.DomRendererRowFactory = f = s([
							r(1, l.ICharacterJoinerService),
							r(2, h.IOptionsService),
							r(3, l.ICoreBrowserService),
							r(4, h.ICoreService),
							r(5, h.IDecorationService),
							r(6, l.IThemeService)
						], f);
					},
					2550: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.WidthCache = void 0, t.WidthCache = class {
							constructor(e, t) {
								this._flat = /* @__PURE__ */ new Float32Array(256), this._font = "", this._fontSize = 0, this._weight = "normal", this._weightBold = "bold", this._measureElements = [], this._container = e.createElement("div"), this._container.classList.add("xterm-width-cache-measure-container"), this._container.setAttribute("aria-hidden", "true"), this._container.style.whiteSpace = "pre", this._container.style.fontKerning = "none";
								const i = e.createElement("span");
								i.classList.add("xterm-char-measure-element");
								const s = e.createElement("span");
								s.classList.add("xterm-char-measure-element"), s.style.fontWeight = "bold";
								const r = e.createElement("span");
								r.classList.add("xterm-char-measure-element"), r.style.fontStyle = "italic";
								const n = e.createElement("span");
								n.classList.add("xterm-char-measure-element"), n.style.fontWeight = "bold", n.style.fontStyle = "italic", this._measureElements = [
									i,
									s,
									r,
									n
								], this._container.appendChild(i), this._container.appendChild(s), this._container.appendChild(r), this._container.appendChild(n), t.appendChild(this._container), this.clear();
							}
							dispose() {
								this._container.remove(), this._measureElements.length = 0, this._holey = void 0;
							}
							clear() {
								this._flat.fill(-9999), this._holey = /* @__PURE__ */ new Map();
							}
							setFont(e, t, i, s) {
								e === this._font && t === this._fontSize && i === this._weight && s === this._weightBold || (this._font = e, this._fontSize = t, this._weight = i, this._weightBold = s, this._container.style.fontFamily = this._font, this._container.style.fontSize = `${this._fontSize}px`, this._measureElements[0].style.fontWeight = `${i}`, this._measureElements[1].style.fontWeight = `${s}`, this._measureElements[2].style.fontWeight = `${i}`, this._measureElements[3].style.fontWeight = `${s}`, this.clear());
							}
							get(e, t, i) {
								let s = 0;
								if (!t && !i && 1 === e.length && (s = e.charCodeAt(0)) < 256) {
									if (-9999 !== this._flat[s]) return this._flat[s];
									const t = this._measure(e, 0);
									return t > 0 && (this._flat[s] = t), t;
								}
								let r = e;
								t && (r += "B"), i && (r += "I");
								let n = this._holey.get(r);
								if (void 0 === n) {
									let s = 0;
									t && (s |= 1), i && (s |= 2), n = this._measure(e, s), n > 0 && this._holey.set(r, n);
								}
								return n;
							}
							_measure(e, t) {
								const i = this._measureElements[t];
								return i.textContent = e.repeat(32), i.offsetWidth / 32;
							}
						};
					},
					2223: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.TEXT_BASELINE = t.DIM_OPACITY = t.INVERTED_DEFAULT_COLOR = void 0;
						const s = i(6114);
						t.INVERTED_DEFAULT_COLOR = 257, t.DIM_OPACITY = .5, t.TEXT_BASELINE = s.isFirefox || s.isLegacyEdge ? "bottom" : "ideographic";
					},
					6171: (e, t) => {
						function i(e) {
							return 57508 <= e && e <= 57558;
						}
						function s(e) {
							return e >= 128512 && e <= 128591 || e >= 127744 && e <= 128511 || e >= 128640 && e <= 128767 || e >= 9728 && e <= 9983 || e >= 9984 && e <= 10175 || e >= 65024 && e <= 65039 || e >= 129280 && e <= 129535 || e >= 127462 && e <= 127487;
						}
						Object.defineProperty(t, "__esModule", { value: !0 }), t.computeNextVariantOffset = t.createRenderDimensions = t.treatGlyphAsBackgroundColor = t.allowRescaling = t.isEmoji = t.isRestrictedPowerlineGlyph = t.isPowerlineGlyph = t.throwIfFalsy = void 0, t.throwIfFalsy = function(e) {
							if (!e) throw new Error("value must not be falsy");
							return e;
						}, t.isPowerlineGlyph = i, t.isRestrictedPowerlineGlyph = function(e) {
							return 57520 <= e && e <= 57527;
						}, t.isEmoji = s, t.allowRescaling = function(e, t, r, n) {
							return 1 === t && r > Math.ceil(1.5 * n) && void 0 !== e && e > 255 && !s(e) && !i(e) && !function(e) {
								return 57344 <= e && e <= 63743;
							}(e);
						}, t.treatGlyphAsBackgroundColor = function(e) {
							return i(e) || function(e) {
								return 9472 <= e && e <= 9631;
							}(e);
						}, t.createRenderDimensions = function() {
							return {
								css: {
									canvas: {
										width: 0,
										height: 0
									},
									cell: {
										width: 0,
										height: 0
									}
								},
								device: {
									canvas: {
										width: 0,
										height: 0
									},
									cell: {
										width: 0,
										height: 0
									},
									char: {
										width: 0,
										height: 0,
										left: 0,
										top: 0
									}
								}
							};
						}, t.computeNextVariantOffset = function(e, t, i = 0) {
							return (e - (2 * Math.round(t) - i)) % (2 * Math.round(t));
						};
					},
					6052: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.createSelectionRenderModel = void 0;
						class i {
							constructor() {
								this.clear();
							}
							clear() {
								this.hasSelection = !1, this.columnSelectMode = !1, this.viewportStartRow = 0, this.viewportEndRow = 0, this.viewportCappedStartRow = 0, this.viewportCappedEndRow = 0, this.startCol = 0, this.endCol = 0, this.selectionStart = void 0, this.selectionEnd = void 0;
							}
							update(e, t, i, s = !1) {
								if (this.selectionStart = t, this.selectionEnd = i, !t || !i || t[0] === i[0] && t[1] === i[1]) return void this.clear();
								const r = e.buffers.active.ydisp, n = t[1] - r, o = i[1] - r, a = Math.max(n, 0), h = Math.min(o, e.rows - 1);
								a >= e.rows || h < 0 ? this.clear() : (this.hasSelection = !0, this.columnSelectMode = s, this.viewportStartRow = n, this.viewportEndRow = o, this.viewportCappedStartRow = a, this.viewportCappedEndRow = h, this.startCol = t[0], this.endCol = i[0]);
							}
							isCellSelected(e, t, i) {
								return !!this.hasSelection && (i -= e.buffer.active.viewportY, this.columnSelectMode ? this.startCol <= this.endCol ? t >= this.startCol && i >= this.viewportCappedStartRow && t < this.endCol && i <= this.viewportCappedEndRow : t < this.startCol && i >= this.viewportCappedStartRow && t >= this.endCol && i <= this.viewportCappedEndRow : i > this.viewportStartRow && i < this.viewportEndRow || this.viewportStartRow === this.viewportEndRow && i === this.viewportStartRow && t >= this.startCol && t < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportEndRow && t < this.endCol || this.viewportStartRow < this.viewportEndRow && i === this.viewportStartRow && t >= this.startCol);
							}
						}
						t.createSelectionRenderModel = function() {
							return new i();
						};
					},
					456: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.SelectionModel = void 0, t.SelectionModel = class {
							constructor(e) {
								this._bufferService = e, this.isSelectAllActive = !1, this.selectionStartLength = 0;
							}
							clearSelection() {
								this.selectionStart = void 0, this.selectionEnd = void 0, this.isSelectAllActive = !1, this.selectionStartLength = 0;
							}
							get finalSelectionStart() {
								return this.isSelectAllActive ? [0, 0] : this.selectionEnd && this.selectionStart && this.areSelectionValuesReversed() ? this.selectionEnd : this.selectionStart;
							}
							get finalSelectionEnd() {
								if (this.isSelectAllActive) return [this._bufferService.cols, this._bufferService.buffer.ybase + this._bufferService.rows - 1];
								if (this.selectionStart) {
									if (!this.selectionEnd || this.areSelectionValuesReversed()) {
										const e = this.selectionStart[0] + this.selectionStartLength;
										return e > this._bufferService.cols ? e % this._bufferService.cols == 0 ? [this._bufferService.cols, this.selectionStart[1] + Math.floor(e / this._bufferService.cols) - 1] : [e % this._bufferService.cols, this.selectionStart[1] + Math.floor(e / this._bufferService.cols)] : [e, this.selectionStart[1]];
									}
									if (this.selectionStartLength && this.selectionEnd[1] === this.selectionStart[1]) {
										const e = this.selectionStart[0] + this.selectionStartLength;
										return e > this._bufferService.cols ? [e % this._bufferService.cols, this.selectionStart[1] + Math.floor(e / this._bufferService.cols)] : [Math.max(e, this.selectionEnd[0]), this.selectionEnd[1]];
									}
									return this.selectionEnd;
								}
							}
							areSelectionValuesReversed() {
								const e = this.selectionStart, t = this.selectionEnd;
								return !(!e || !t) && (e[1] > t[1] || e[1] === t[1] && e[0] > t[0]);
							}
							handleTrim(e) {
								return this.selectionStart && (this.selectionStart[1] -= e), this.selectionEnd && (this.selectionEnd[1] -= e), this.selectionEnd && this.selectionEnd[1] < 0 ? (this.clearSelection(), !0) : (this.selectionStart && this.selectionStart[1] < 0 && (this.selectionStart[1] = 0), !1);
							}
						};
					},
					428: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CharSizeService = void 0;
						const n = i(2585), o = i(8460), a = i(844);
						let h = t.CharSizeService = class extends a.Disposable {
							get hasValidSize() {
								return this.width > 0 && this.height > 0;
							}
							constructor(e, t, i) {
								super(), this._optionsService = i, this.width = 0, this.height = 0, this._onCharSizeChange = this.register(new o.EventEmitter()), this.onCharSizeChange = this._onCharSizeChange.event;
								try {
									this._measureStrategy = this.register(new d(this._optionsService));
								} catch {
									this._measureStrategy = this.register(new l(e, t, this._optionsService));
								}
								this.register(this._optionsService.onMultipleOptionChange(["fontFamily", "fontSize"], (() => this.measure())));
							}
							measure() {
								const e = this._measureStrategy.measure();
								e.width === this.width && e.height === this.height || (this.width = e.width, this.height = e.height, this._onCharSizeChange.fire());
							}
						};
						t.CharSizeService = h = s([r(2, n.IOptionsService)], h);
						class c extends a.Disposable {
							constructor() {
								super(...arguments), this._result = {
									width: 0,
									height: 0
								};
							}
							_validateAndSet(e, t) {
								void 0 !== e && e > 0 && void 0 !== t && t > 0 && (this._result.width = e, this._result.height = t);
							}
						}
						class l extends c {
							constructor(e, t, i) {
								super(), this._document = e, this._parentElement = t, this._optionsService = i, this._measureElement = this._document.createElement("span"), this._measureElement.classList.add("xterm-char-measure-element"), this._measureElement.textContent = "W".repeat(32), this._measureElement.setAttribute("aria-hidden", "true"), this._measureElement.style.whiteSpace = "pre", this._measureElement.style.fontKerning = "none", this._parentElement.appendChild(this._measureElement);
							}
							measure() {
								return this._measureElement.style.fontFamily = this._optionsService.rawOptions.fontFamily, this._measureElement.style.fontSize = `${this._optionsService.rawOptions.fontSize}px`, this._validateAndSet(Number(this._measureElement.offsetWidth) / 32, Number(this._measureElement.offsetHeight)), this._result;
							}
						}
						class d extends c {
							constructor(e) {
								super(), this._optionsService = e, this._canvas = new OffscreenCanvas(100, 100), this._ctx = this._canvas.getContext("2d");
								const t = this._ctx.measureText("W");
								if (!("width" in t && "fontBoundingBoxAscent" in t && "fontBoundingBoxDescent" in t)) throw new Error("Required font metrics not supported");
							}
							measure() {
								this._ctx.font = `${this._optionsService.rawOptions.fontSize}px ${this._optionsService.rawOptions.fontFamily}`;
								const e = this._ctx.measureText("W");
								return this._validateAndSet(e.width, e.fontBoundingBoxAscent + e.fontBoundingBoxDescent), this._result;
							}
						}
					},
					4269: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CharacterJoinerService = t.JoinedCellData = void 0;
						const n = i(3734), o = i(643), a = i(511), h = i(2585);
						class c extends n.AttributeData {
							constructor(e, t, i) {
								super(), this.content = 0, this.combinedData = "", this.fg = e.fg, this.bg = e.bg, this.combinedData = t, this._width = i;
							}
							isCombined() {
								return 2097152;
							}
							getWidth() {
								return this._width;
							}
							getChars() {
								return this.combinedData;
							}
							getCode() {
								return 2097151;
							}
							setFromCharData(e) {
								throw new Error("not implemented");
							}
							getAsCharData() {
								return [
									this.fg,
									this.getChars(),
									this.getWidth(),
									this.getCode()
								];
							}
						}
						t.JoinedCellData = c;
						let l = t.CharacterJoinerService = class e {
							constructor(e) {
								this._bufferService = e, this._characterJoiners = [], this._nextCharacterJoinerId = 0, this._workCell = new a.CellData();
							}
							register(e) {
								const t = {
									id: this._nextCharacterJoinerId++,
									handler: e
								};
								return this._characterJoiners.push(t), t.id;
							}
							deregister(e) {
								for (let t = 0; t < this._characterJoiners.length; t++) if (this._characterJoiners[t].id === e) return this._characterJoiners.splice(t, 1), !0;
								return !1;
							}
							getJoinedCharacters(e) {
								if (0 === this._characterJoiners.length) return [];
								const t = this._bufferService.buffer.lines.get(e);
								if (!t || 0 === t.length) return [];
								const i = [], s = t.translateToString(!0);
								let r = 0, n = 0, a = 0, h = t.getFg(0), c = t.getBg(0);
								for (let e = 0; e < t.getTrimmedLength(); e++) if (t.loadCell(e, this._workCell), 0 !== this._workCell.getWidth()) {
									if (this._workCell.fg !== h || this._workCell.bg !== c) {
										if (e - r > 1) {
											const e = this._getJoinedRanges(s, a, n, t, r);
											for (let t = 0; t < e.length; t++) i.push(e[t]);
										}
										r = e, a = n, h = this._workCell.fg, c = this._workCell.bg;
									}
									n += this._workCell.getChars().length || o.WHITESPACE_CELL_CHAR.length;
								}
								if (this._bufferService.cols - r > 1) {
									const e = this._getJoinedRanges(s, a, n, t, r);
									for (let t = 0; t < e.length; t++) i.push(e[t]);
								}
								return i;
							}
							_getJoinedRanges(t, i, s, r, n) {
								const o = t.substring(i, s);
								let a = [];
								try {
									a = this._characterJoiners[0].handler(o);
								} catch (e) {
									console.error(e);
								}
								for (let t = 1; t < this._characterJoiners.length; t++) try {
									const i = this._characterJoiners[t].handler(o);
									for (let t = 0; t < i.length; t++) e._mergeRanges(a, i[t]);
								} catch (e) {
									console.error(e);
								}
								return this._stringRangesToCellRanges(a, r, n), a;
							}
							_stringRangesToCellRanges(e, t, i) {
								let s = 0, r = !1, n = 0, a = e[s];
								if (a) {
									for (let h = i; h < this._bufferService.cols; h++) {
										const i = t.getWidth(h), c = t.getString(h).length || o.WHITESPACE_CELL_CHAR.length;
										if (0 !== i) {
											if (!r && a[0] <= n && (a[0] = h, r = !0), a[1] <= n) {
												if (a[1] = h, a = e[++s], !a) break;
												a[0] <= n ? (a[0] = h, r = !0) : r = !1;
											}
											n += c;
										}
									}
									a && (a[1] = this._bufferService.cols);
								}
							}
							static _mergeRanges(e, t) {
								let i = !1;
								for (let s = 0; s < e.length; s++) {
									const r = e[s];
									if (i) {
										if (t[1] <= r[0]) return e[s - 1][1] = t[1], e;
										if (t[1] <= r[1]) return e[s - 1][1] = Math.max(t[1], r[1]), e.splice(s, 1), e;
										e.splice(s, 1), s--;
									} else {
										if (t[1] <= r[0]) return e.splice(s, 0, t), e;
										if (t[1] <= r[1]) return r[0] = Math.min(t[0], r[0]), e;
										t[0] < r[1] && (r[0] = Math.min(t[0], r[0]), i = !0);
									}
								}
								return i ? e[e.length - 1][1] = t[1] : e.push(t), e;
							}
						};
						t.CharacterJoinerService = l = s([r(0, h.IBufferService)], l);
					},
					5114: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CoreBrowserService = void 0;
						const s = i(844), r = i(8460), n = i(3656);
						class o extends s.Disposable {
							constructor(e, t, i) {
								super(), this._textarea = e, this._window = t, this.mainDocument = i, this._isFocused = !1, this._cachedIsFocused = void 0, this._screenDprMonitor = new a(this._window), this._onDprChange = this.register(new r.EventEmitter()), this.onDprChange = this._onDprChange.event, this._onWindowChange = this.register(new r.EventEmitter()), this.onWindowChange = this._onWindowChange.event, this.register(this.onWindowChange(((e) => this._screenDprMonitor.setWindow(e)))), this.register((0, r.forwardEvent)(this._screenDprMonitor.onDprChange, this._onDprChange)), this._textarea.addEventListener("focus", (() => this._isFocused = !0)), this._textarea.addEventListener("blur", (() => this._isFocused = !1));
							}
							get window() {
								return this._window;
							}
							set window(e) {
								this._window !== e && (this._window = e, this._onWindowChange.fire(this._window));
							}
							get dpr() {
								return this.window.devicePixelRatio;
							}
							get isFocused() {
								return void 0 === this._cachedIsFocused && (this._cachedIsFocused = this._isFocused && this._textarea.ownerDocument.hasFocus(), queueMicrotask((() => this._cachedIsFocused = void 0))), this._cachedIsFocused;
							}
						}
						t.CoreBrowserService = o;
						class a extends s.Disposable {
							constructor(e) {
								super(), this._parentWindow = e, this._windowResizeListener = this.register(new s.MutableDisposable()), this._onDprChange = this.register(new r.EventEmitter()), this.onDprChange = this._onDprChange.event, this._outerListener = () => this._setDprAndFireIfDiffers(), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._updateDpr(), this._setWindowResizeListener(), this.register((0, s.toDisposable)((() => this.clearListener())));
							}
							setWindow(e) {
								this._parentWindow = e, this._setWindowResizeListener(), this._setDprAndFireIfDiffers();
							}
							_setWindowResizeListener() {
								this._windowResizeListener.value = (0, n.addDisposableDomListener)(this._parentWindow, "resize", (() => this._setDprAndFireIfDiffers()));
							}
							_setDprAndFireIfDiffers() {
								this._parentWindow.devicePixelRatio !== this._currentDevicePixelRatio && this._onDprChange.fire(this._parentWindow.devicePixelRatio), this._updateDpr();
							}
							_updateDpr() {
								this._outerListener && (this._resolutionMediaMatchList?.removeListener(this._outerListener), this._currentDevicePixelRatio = this._parentWindow.devicePixelRatio, this._resolutionMediaMatchList = this._parentWindow.matchMedia(`screen and (resolution: ${this._parentWindow.devicePixelRatio}dppx)`), this._resolutionMediaMatchList.addListener(this._outerListener));
							}
							clearListener() {
								this._resolutionMediaMatchList && this._outerListener && (this._resolutionMediaMatchList.removeListener(this._outerListener), this._resolutionMediaMatchList = void 0, this._outerListener = void 0);
							}
						}
					},
					779: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.LinkProviderService = void 0;
						const s = i(844);
						class r extends s.Disposable {
							constructor() {
								super(), this.linkProviders = [], this.register((0, s.toDisposable)((() => this.linkProviders.length = 0)));
							}
							registerLinkProvider(e) {
								return this.linkProviders.push(e), { dispose: () => {
									const t = this.linkProviders.indexOf(e);
									-1 !== t && this.linkProviders.splice(t, 1);
								} };
							}
						}
						t.LinkProviderService = r;
					},
					8934: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.MouseService = void 0;
						const n = i(4725), o = i(9806);
						let a = t.MouseService = class {
							constructor(e, t) {
								this._renderService = e, this._charSizeService = t;
							}
							getCoords(e, t, i, s, r) {
								return (0, o.getCoords)(window, e, t, i, s, this._charSizeService.hasValidSize, this._renderService.dimensions.css.cell.width, this._renderService.dimensions.css.cell.height, r);
							}
							getMouseReportCoords(e, t) {
								const i = (0, o.getCoordsRelativeToElement)(window, e, t);
								if (this._charSizeService.hasValidSize) return i[0] = Math.min(Math.max(i[0], 0), this._renderService.dimensions.css.canvas.width - 1), i[1] = Math.min(Math.max(i[1], 0), this._renderService.dimensions.css.canvas.height - 1), {
									col: Math.floor(i[0] / this._renderService.dimensions.css.cell.width),
									row: Math.floor(i[1] / this._renderService.dimensions.css.cell.height),
									x: Math.floor(i[0]),
									y: Math.floor(i[1])
								};
							}
						};
						t.MouseService = a = s([r(0, n.IRenderService), r(1, n.ICharSizeService)], a);
					},
					3230: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.RenderService = void 0;
						const n = i(6193), o = i(4725), a = i(8460), h = i(844), c = i(7226), l = i(2585);
						let d = t.RenderService = class extends h.Disposable {
							get dimensions() {
								return this._renderer.value.dimensions;
							}
							constructor(e, t, i, s, r, o, l, d) {
								super(), this._rowCount = e, this._charSizeService = s, this._renderer = this.register(new h.MutableDisposable()), this._pausedResizeTask = new c.DebouncedIdleTask(), this._observerDisposable = this.register(new h.MutableDisposable()), this._isPaused = !1, this._needsFullRefresh = !1, this._isNextRenderRedrawOnly = !0, this._needsSelectionRefresh = !1, this._canvasWidth = 0, this._canvasHeight = 0, this._selectionState = {
									start: void 0,
									end: void 0,
									columnSelectMode: !1
								}, this._onDimensionsChange = this.register(new a.EventEmitter()), this.onDimensionsChange = this._onDimensionsChange.event, this._onRenderedViewportChange = this.register(new a.EventEmitter()), this.onRenderedViewportChange = this._onRenderedViewportChange.event, this._onRender = this.register(new a.EventEmitter()), this.onRender = this._onRender.event, this._onRefreshRequest = this.register(new a.EventEmitter()), this.onRefreshRequest = this._onRefreshRequest.event, this._renderDebouncer = new n.RenderDebouncer(((e, t) => this._renderRows(e, t)), l), this.register(this._renderDebouncer), this.register(l.onDprChange((() => this.handleDevicePixelRatioChange()))), this.register(o.onResize((() => this._fullRefresh()))), this.register(o.buffers.onBufferActivate((() => this._renderer.value?.clear()))), this.register(i.onOptionChange((() => this._handleOptionsChanged()))), this.register(this._charSizeService.onCharSizeChange((() => this.handleCharSizeChanged()))), this.register(r.onDecorationRegistered((() => this._fullRefresh()))), this.register(r.onDecorationRemoved((() => this._fullRefresh()))), this.register(i.onMultipleOptionChange([
									"customGlyphs",
									"drawBoldTextInBrightColors",
									"letterSpacing",
									"lineHeight",
									"fontFamily",
									"fontSize",
									"fontWeight",
									"fontWeightBold",
									"minimumContrastRatio",
									"rescaleOverlappingGlyphs"
								], (() => {
									this.clear(), this.handleResize(o.cols, o.rows), this._fullRefresh();
								}))), this.register(i.onMultipleOptionChange(["cursorBlink", "cursorStyle"], (() => this.refreshRows(o.buffer.y, o.buffer.y, !0)))), this.register(d.onChangeColors((() => this._fullRefresh()))), this._registerIntersectionObserver(l.window, t), this.register(l.onWindowChange(((e) => this._registerIntersectionObserver(e, t))));
							}
							_registerIntersectionObserver(e, t) {
								if ("IntersectionObserver" in e) {
									const i = new e.IntersectionObserver(((e) => this._handleIntersectionChange(e[e.length - 1])), { threshold: 0 });
									i.observe(t), this._observerDisposable.value = (0, h.toDisposable)((() => i.disconnect()));
								}
							}
							_handleIntersectionChange(e) {
								this._isPaused = void 0 === e.isIntersecting ? 0 === e.intersectionRatio : !e.isIntersecting, this._isPaused || this._charSizeService.hasValidSize || this._charSizeService.measure(), !this._isPaused && this._needsFullRefresh && (this._pausedResizeTask.flush(), this.refreshRows(0, this._rowCount - 1), this._needsFullRefresh = !1);
							}
							refreshRows(e, t, i = !1) {
								this._isPaused ? this._needsFullRefresh = !0 : (i || (this._isNextRenderRedrawOnly = !1), this._renderDebouncer.refresh(e, t, this._rowCount));
							}
							_renderRows(e, t) {
								this._renderer.value && (e = Math.min(e, this._rowCount - 1), t = Math.min(t, this._rowCount - 1), this._renderer.value.renderRows(e, t), this._needsSelectionRefresh && (this._renderer.value.handleSelectionChanged(this._selectionState.start, this._selectionState.end, this._selectionState.columnSelectMode), this._needsSelectionRefresh = !1), this._isNextRenderRedrawOnly || this._onRenderedViewportChange.fire({
									start: e,
									end: t
								}), this._onRender.fire({
									start: e,
									end: t
								}), this._isNextRenderRedrawOnly = !0);
							}
							resize(e, t) {
								this._rowCount = t, this._fireOnCanvasResize();
							}
							_handleOptionsChanged() {
								this._renderer.value && (this.refreshRows(0, this._rowCount - 1), this._fireOnCanvasResize());
							}
							_fireOnCanvasResize() {
								this._renderer.value && (this._renderer.value.dimensions.css.canvas.width === this._canvasWidth && this._renderer.value.dimensions.css.canvas.height === this._canvasHeight || this._onDimensionsChange.fire(this._renderer.value.dimensions));
							}
							hasRenderer() {
								return !!this._renderer.value;
							}
							setRenderer(e) {
								this._renderer.value = e, this._renderer.value && (this._renderer.value.onRequestRedraw(((e) => this.refreshRows(e.start, e.end, !0))), this._needsSelectionRefresh = !0, this._fullRefresh());
							}
							addRefreshCallback(e) {
								return this._renderDebouncer.addRefreshCallback(e);
							}
							_fullRefresh() {
								this._isPaused ? this._needsFullRefresh = !0 : this.refreshRows(0, this._rowCount - 1);
							}
							clearTextureAtlas() {
								this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh());
							}
							handleDevicePixelRatioChange() {
								this._charSizeService.measure(), this._renderer.value && (this._renderer.value.handleDevicePixelRatioChange(), this.refreshRows(0, this._rowCount - 1));
							}
							handleResize(e, t) {
								this._renderer.value && (this._isPaused ? this._pausedResizeTask.set((() => this._renderer.value?.handleResize(e, t))) : this._renderer.value.handleResize(e, t), this._fullRefresh());
							}
							handleCharSizeChanged() {
								this._renderer.value?.handleCharSizeChanged();
							}
							handleBlur() {
								this._renderer.value?.handleBlur();
							}
							handleFocus() {
								this._renderer.value?.handleFocus();
							}
							handleSelectionChanged(e, t, i) {
								this._selectionState.start = e, this._selectionState.end = t, this._selectionState.columnSelectMode = i, this._renderer.value?.handleSelectionChanged(e, t, i);
							}
							handleCursorMove() {
								this._renderer.value?.handleCursorMove();
							}
							clear() {
								this._renderer.value?.clear();
							}
						};
						t.RenderService = d = s([
							r(2, l.IOptionsService),
							r(3, o.ICharSizeService),
							r(4, l.IDecorationService),
							r(5, l.IBufferService),
							r(6, o.ICoreBrowserService),
							r(7, o.IThemeService)
						], d);
					},
					9312: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.SelectionService = void 0;
						const n = i(9806), o = i(9504), a = i(456), h = i(4725), c = i(8460), l = i(844), d = i(6114), _ = i(4841), u = i(511), f = i(2585), p = new RegExp(String.fromCharCode(160), "g");
						let g = t.SelectionService = class extends l.Disposable {
							constructor(e, t, i, s, r, n, o, h, d) {
								super(), this._element = e, this._screenElement = t, this._linkifier = i, this._bufferService = s, this._coreService = r, this._mouseService = n, this._optionsService = o, this._renderService = h, this._coreBrowserService = d, this._dragScrollAmount = 0, this._enabled = !0, this._workCell = new u.CellData(), this._mouseDownTimeStamp = 0, this._oldHasSelection = !1, this._oldSelectionStart = void 0, this._oldSelectionEnd = void 0, this._onLinuxMouseSelection = this.register(new c.EventEmitter()), this.onLinuxMouseSelection = this._onLinuxMouseSelection.event, this._onRedrawRequest = this.register(new c.EventEmitter()), this.onRequestRedraw = this._onRedrawRequest.event, this._onSelectionChange = this.register(new c.EventEmitter()), this.onSelectionChange = this._onSelectionChange.event, this._onRequestScrollLines = this.register(new c.EventEmitter()), this.onRequestScrollLines = this._onRequestScrollLines.event, this._mouseMoveListener = (e) => this._handleMouseMove(e), this._mouseUpListener = (e) => this._handleMouseUp(e), this._coreService.onUserInput((() => {
									this.hasSelection && this.clearSelection();
								})), this._trimListener = this._bufferService.buffer.lines.onTrim(((e) => this._handleTrim(e))), this.register(this._bufferService.buffers.onBufferActivate(((e) => this._handleBufferActivate(e)))), this.enable(), this._model = new a.SelectionModel(this._bufferService), this._activeSelectionMode = 0, this.register((0, l.toDisposable)((() => {
									this._removeMouseDownListeners();
								})));
							}
							reset() {
								this.clearSelection();
							}
							disable() {
								this.clearSelection(), this._enabled = !1;
							}
							enable() {
								this._enabled = !0;
							}
							get selectionStart() {
								return this._model.finalSelectionStart;
							}
							get selectionEnd() {
								return this._model.finalSelectionEnd;
							}
							get hasSelection() {
								const e = this._model.finalSelectionStart, t = this._model.finalSelectionEnd;
								return !(!e || !t || e[0] === t[0] && e[1] === t[1]);
							}
							get selectionText() {
								const e = this._model.finalSelectionStart, t = this._model.finalSelectionEnd;
								if (!e || !t) return "";
								const i = this._bufferService.buffer, s = [];
								if (3 === this._activeSelectionMode) {
									if (e[0] === t[0]) return "";
									const r = e[0] < t[0] ? e[0] : t[0], n = e[0] < t[0] ? t[0] : e[0];
									for (let o = e[1]; o <= t[1]; o++) {
										const e = i.translateBufferLineToString(o, !0, r, n);
										s.push(e);
									}
								} else {
									const r = e[1] === t[1] ? t[0] : void 0;
									s.push(i.translateBufferLineToString(e[1], !0, e[0], r));
									for (let r = e[1] + 1; r <= t[1] - 1; r++) {
										const e = i.lines.get(r), t = i.translateBufferLineToString(r, !0);
										e?.isWrapped ? s[s.length - 1] += t : s.push(t);
									}
									if (e[1] !== t[1]) {
										const e = i.lines.get(t[1]), r = i.translateBufferLineToString(t[1], !0, 0, t[0]);
										e && e.isWrapped ? s[s.length - 1] += r : s.push(r);
									}
								}
								return s.map(((e) => e.replace(p, " "))).join(d.isWindows ? "\r\n" : "\n");
							}
							clearSelection() {
								this._model.clearSelection(), this._removeMouseDownListeners(), this.refresh(), this._onSelectionChange.fire();
							}
							refresh(e) {
								this._refreshAnimationFrame || (this._refreshAnimationFrame = this._coreBrowserService.window.requestAnimationFrame((() => this._refresh()))), d.isLinux && e && this.selectionText.length && this._onLinuxMouseSelection.fire(this.selectionText);
							}
							_refresh() {
								this._refreshAnimationFrame = void 0, this._onRedrawRequest.fire({
									start: this._model.finalSelectionStart,
									end: this._model.finalSelectionEnd,
									columnSelectMode: 3 === this._activeSelectionMode
								});
							}
							_isClickInSelection(e) {
								const t = this._getMouseBufferCoords(e), i = this._model.finalSelectionStart, s = this._model.finalSelectionEnd;
								return !!(i && s && t) && this._areCoordsInSelection(t, i, s);
							}
							isCellInSelection(e, t) {
								const i = this._model.finalSelectionStart, s = this._model.finalSelectionEnd;
								return !(!i || !s) && this._areCoordsInSelection([e, t], i, s);
							}
							_areCoordsInSelection(e, t, i) {
								return e[1] > t[1] && e[1] < i[1] || t[1] === i[1] && e[1] === t[1] && e[0] >= t[0] && e[0] < i[0] || t[1] < i[1] && e[1] === i[1] && e[0] < i[0] || t[1] < i[1] && e[1] === t[1] && e[0] >= t[0];
							}
							_selectWordAtCursor(e, t) {
								const i = this._linkifier.currentLink?.link?.range;
								if (i) return this._model.selectionStart = [i.start.x - 1, i.start.y - 1], this._model.selectionStartLength = (0, _.getRangeLength)(i, this._bufferService.cols), this._model.selectionEnd = void 0, !0;
								const s = this._getMouseBufferCoords(e);
								return !!s && (this._selectWordAt(s, t), this._model.selectionEnd = void 0, !0);
							}
							selectAll() {
								this._model.isSelectAllActive = !0, this.refresh(), this._onSelectionChange.fire();
							}
							selectLines(e, t) {
								this._model.clearSelection(), e = Math.max(e, 0), t = Math.min(t, this._bufferService.buffer.lines.length - 1), this._model.selectionStart = [0, e], this._model.selectionEnd = [this._bufferService.cols, t], this.refresh(), this._onSelectionChange.fire();
							}
							_handleTrim(e) {
								this._model.handleTrim(e) && this.refresh();
							}
							_getMouseBufferCoords(e) {
								const t = this._mouseService.getCoords(e, this._screenElement, this._bufferService.cols, this._bufferService.rows, !0);
								if (t) return t[0]--, t[1]--, t[1] += this._bufferService.buffer.ydisp, t;
							}
							_getMouseEventScrollAmount(e) {
								let t = (0, n.getCoordsRelativeToElement)(this._coreBrowserService.window, e, this._screenElement)[1];
								const i = this._renderService.dimensions.css.canvas.height;
								return t >= 0 && t <= i ? 0 : (t > i && (t -= i), t = Math.min(Math.max(t, -50), 50), t /= 50, t / Math.abs(t) + Math.round(14 * t));
							}
							shouldForceSelection(e) {
								return d.isMac ? e.altKey && this._optionsService.rawOptions.macOptionClickForcesSelection : e.shiftKey;
							}
							handleMouseDown(e) {
								if (this._mouseDownTimeStamp = e.timeStamp, (2 !== e.button || !this.hasSelection) && 0 === e.button) {
									if (!this._enabled) {
										if (!this.shouldForceSelection(e)) return;
										e.stopPropagation();
									}
									e.preventDefault(), this._dragScrollAmount = 0, this._enabled && e.shiftKey ? this._handleIncrementalClick(e) : 1 === e.detail ? this._handleSingleClick(e) : 2 === e.detail ? this._handleDoubleClick(e) : 3 === e.detail && this._handleTripleClick(e), this._addMouseDownListeners(), this.refresh(!0);
								}
							}
							_addMouseDownListeners() {
								this._screenElement.ownerDocument && (this._screenElement.ownerDocument.addEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.addEventListener("mouseup", this._mouseUpListener)), this._dragScrollIntervalTimer = this._coreBrowserService.window.setInterval((() => this._dragScroll()), 50);
							}
							_removeMouseDownListeners() {
								this._screenElement.ownerDocument && (this._screenElement.ownerDocument.removeEventListener("mousemove", this._mouseMoveListener), this._screenElement.ownerDocument.removeEventListener("mouseup", this._mouseUpListener)), this._coreBrowserService.window.clearInterval(this._dragScrollIntervalTimer), this._dragScrollIntervalTimer = void 0;
							}
							_handleIncrementalClick(e) {
								this._model.selectionStart && (this._model.selectionEnd = this._getMouseBufferCoords(e));
							}
							_handleSingleClick(e) {
								if (this._model.selectionStartLength = 0, this._model.isSelectAllActive = !1, this._activeSelectionMode = this.shouldColumnSelect(e) ? 3 : 0, this._model.selectionStart = this._getMouseBufferCoords(e), !this._model.selectionStart) return;
								this._model.selectionEnd = void 0;
								const t = this._bufferService.buffer.lines.get(this._model.selectionStart[1]);
								t && t.length !== this._model.selectionStart[0] && 0 === t.hasWidth(this._model.selectionStart[0]) && this._model.selectionStart[0]++;
							}
							_handleDoubleClick(e) {
								this._selectWordAtCursor(e, !0) && (this._activeSelectionMode = 1);
							}
							_handleTripleClick(e) {
								const t = this._getMouseBufferCoords(e);
								t && (this._activeSelectionMode = 2, this._selectLineAt(t[1]));
							}
							shouldColumnSelect(e) {
								return e.altKey && !(d.isMac && this._optionsService.rawOptions.macOptionClickForcesSelection);
							}
							_handleMouseMove(e) {
								if (e.stopImmediatePropagation(), !this._model.selectionStart) return;
								const t = this._model.selectionEnd ? [this._model.selectionEnd[0], this._model.selectionEnd[1]] : null;
								if (this._model.selectionEnd = this._getMouseBufferCoords(e), !this._model.selectionEnd) return void this.refresh(!0);
								2 === this._activeSelectionMode ? this._model.selectionEnd[1] < this._model.selectionStart[1] ? this._model.selectionEnd[0] = 0 : this._model.selectionEnd[0] = this._bufferService.cols : 1 === this._activeSelectionMode && this._selectToWordAt(this._model.selectionEnd), this._dragScrollAmount = this._getMouseEventScrollAmount(e), 3 !== this._activeSelectionMode && (this._dragScrollAmount > 0 ? this._model.selectionEnd[0] = this._bufferService.cols : this._dragScrollAmount < 0 && (this._model.selectionEnd[0] = 0));
								const i = this._bufferService.buffer;
								if (this._model.selectionEnd[1] < i.lines.length) {
									const e = i.lines.get(this._model.selectionEnd[1]);
									e && 0 === e.hasWidth(this._model.selectionEnd[0]) && this._model.selectionEnd[0] < this._bufferService.cols && this._model.selectionEnd[0]++;
								}
								t && t[0] === this._model.selectionEnd[0] && t[1] === this._model.selectionEnd[1] || this.refresh(!0);
							}
							_dragScroll() {
								if (this._model.selectionEnd && this._model.selectionStart && this._dragScrollAmount) {
									this._onRequestScrollLines.fire({
										amount: this._dragScrollAmount,
										suppressScrollEvent: !1
									});
									const e = this._bufferService.buffer;
									this._dragScrollAmount > 0 ? (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = this._bufferService.cols), this._model.selectionEnd[1] = Math.min(e.ydisp + this._bufferService.rows, e.lines.length - 1)) : (3 !== this._activeSelectionMode && (this._model.selectionEnd[0] = 0), this._model.selectionEnd[1] = e.ydisp), this.refresh();
								}
							}
							_handleMouseUp(e) {
								const t = e.timeStamp - this._mouseDownTimeStamp;
								if (this._removeMouseDownListeners(), this.selectionText.length <= 1 && t < 500 && e.altKey && this._optionsService.rawOptions.altClickMovesCursor) {
									if (this._bufferService.buffer.ybase === this._bufferService.buffer.ydisp) {
										const t = this._mouseService.getCoords(e, this._element, this._bufferService.cols, this._bufferService.rows, !1);
										if (t && void 0 !== t[0] && void 0 !== t[1]) {
											const e = (0, o.moveToCellSequence)(t[0] - 1, t[1] - 1, this._bufferService, this._coreService.decPrivateModes.applicationCursorKeys);
											this._coreService.triggerDataEvent(e, !0);
										}
									}
								} else this._fireEventIfSelectionChanged();
							}
							_fireEventIfSelectionChanged() {
								const e = this._model.finalSelectionStart, t = this._model.finalSelectionEnd, i = !(!e || !t || e[0] === t[0] && e[1] === t[1]);
								i ? e && t && (this._oldSelectionStart && this._oldSelectionEnd && e[0] === this._oldSelectionStart[0] && e[1] === this._oldSelectionStart[1] && t[0] === this._oldSelectionEnd[0] && t[1] === this._oldSelectionEnd[1] || this._fireOnSelectionChange(e, t, i)) : this._oldHasSelection && this._fireOnSelectionChange(e, t, i);
							}
							_fireOnSelectionChange(e, t, i) {
								this._oldSelectionStart = e, this._oldSelectionEnd = t, this._oldHasSelection = i, this._onSelectionChange.fire();
							}
							_handleBufferActivate(e) {
								this.clearSelection(), this._trimListener.dispose(), this._trimListener = e.activeBuffer.lines.onTrim(((e) => this._handleTrim(e)));
							}
							_convertViewportColToCharacterIndex(e, t) {
								let i = t;
								for (let s = 0; t >= s; s++) {
									const r = e.loadCell(s, this._workCell).getChars().length;
									0 === this._workCell.getWidth() ? i-- : r > 1 && t !== s && (i += r - 1);
								}
								return i;
							}
							setSelection(e, t, i) {
								this._model.clearSelection(), this._removeMouseDownListeners(), this._model.selectionStart = [e, t], this._model.selectionStartLength = i, this.refresh(), this._fireEventIfSelectionChanged();
							}
							rightClickSelect(e) {
								this._isClickInSelection(e) || (this._selectWordAtCursor(e, !1) && this.refresh(!0), this._fireEventIfSelectionChanged());
							}
							_getWordAt(e, t, i = !0, s = !0) {
								if (e[0] >= this._bufferService.cols) return;
								const r = this._bufferService.buffer, n = r.lines.get(e[1]);
								if (!n) return;
								const o = r.translateBufferLineToString(e[1], !1);
								let a = this._convertViewportColToCharacterIndex(n, e[0]), h = a;
								const c = e[0] - a;
								let l = 0, d = 0, _ = 0, u = 0;
								if (" " === o.charAt(a)) {
									for (; a > 0 && " " === o.charAt(a - 1);) a--;
									for (; h < o.length && " " === o.charAt(h + 1);) h++;
								} else {
									let t = e[0], i = e[0];
									0 === n.getWidth(t) && (l++, t--), 2 === n.getWidth(i) && (d++, i++);
									const s = n.getString(i).length;
									for (s > 1 && (u += s - 1, h += s - 1); t > 0 && a > 0 && !this._isCharWordSeparator(n.loadCell(t - 1, this._workCell));) {
										n.loadCell(t - 1, this._workCell);
										const e = this._workCell.getChars().length;
										0 === this._workCell.getWidth() ? (l++, t--) : e > 1 && (_ += e - 1, a -= e - 1), a--, t--;
									}
									for (; i < n.length && h + 1 < o.length && !this._isCharWordSeparator(n.loadCell(i + 1, this._workCell));) {
										n.loadCell(i + 1, this._workCell);
										const e = this._workCell.getChars().length;
										2 === this._workCell.getWidth() ? (d++, i++) : e > 1 && (u += e - 1, h += e - 1), h++, i++;
									}
								}
								h++;
								let f = a + c - l + _, v = Math.min(this._bufferService.cols, h - a + l + d - _ - u);
								if (t || "" !== o.slice(a, h).trim()) {
									if (i && 0 === f && 32 !== n.getCodePoint(0)) {
										const t = r.lines.get(e[1] - 1);
										if (t && n.isWrapped && 32 !== t.getCodePoint(this._bufferService.cols - 1)) {
											const t = this._getWordAt([this._bufferService.cols - 1, e[1] - 1], !1, !0, !1);
											if (t) {
												const e = this._bufferService.cols - t.start;
												f -= e, v += e;
											}
										}
									}
									if (s && f + v === this._bufferService.cols && 32 !== n.getCodePoint(this._bufferService.cols - 1)) {
										const t = r.lines.get(e[1] + 1);
										if (t?.isWrapped && 32 !== t.getCodePoint(0)) {
											const t = this._getWordAt([0, e[1] + 1], !1, !1, !0);
											t && (v += t.length);
										}
									}
									return {
										start: f,
										length: v
									};
								}
							}
							_selectWordAt(e, t) {
								const i = this._getWordAt(e, t);
								if (i) {
									for (; i.start < 0;) i.start += this._bufferService.cols, e[1]--;
									this._model.selectionStart = [i.start, e[1]], this._model.selectionStartLength = i.length;
								}
							}
							_selectToWordAt(e) {
								const t = this._getWordAt(e, !0);
								if (t) {
									let i = e[1];
									for (; t.start < 0;) t.start += this._bufferService.cols, i--;
									if (!this._model.areSelectionValuesReversed()) for (; t.start + t.length > this._bufferService.cols;) t.length -= this._bufferService.cols, i++;
									this._model.selectionEnd = [this._model.areSelectionValuesReversed() ? t.start : t.start + t.length, i];
								}
							}
							_isCharWordSeparator(e) {
								return 0 !== e.getWidth() && this._optionsService.rawOptions.wordSeparator.indexOf(e.getChars()) >= 0;
							}
							_selectLineAt(e) {
								const t = this._bufferService.buffer.getWrappedRangeForLine(e), i = {
									start: {
										x: 0,
										y: t.first
									},
									end: {
										x: this._bufferService.cols - 1,
										y: t.last
									}
								};
								this._model.selectionStart = [0, t.first], this._model.selectionEnd = void 0, this._model.selectionStartLength = (0, _.getRangeLength)(i, this._bufferService.cols);
							}
						};
						t.SelectionService = g = s([
							r(3, f.IBufferService),
							r(4, f.ICoreService),
							r(5, h.IMouseService),
							r(6, f.IOptionsService),
							r(7, h.IRenderService),
							r(8, h.ICoreBrowserService)
						], g);
					},
					4725: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ILinkProviderService = t.IThemeService = t.ICharacterJoinerService = t.ISelectionService = t.IRenderService = t.IMouseService = t.ICoreBrowserService = t.ICharSizeService = void 0;
						const s = i(8343);
						t.ICharSizeService = (0, s.createDecorator)("CharSizeService"), t.ICoreBrowserService = (0, s.createDecorator)("CoreBrowserService"), t.IMouseService = (0, s.createDecorator)("MouseService"), t.IRenderService = (0, s.createDecorator)("RenderService"), t.ISelectionService = (0, s.createDecorator)("SelectionService"), t.ICharacterJoinerService = (0, s.createDecorator)("CharacterJoinerService"), t.IThemeService = (0, s.createDecorator)("ThemeService"), t.ILinkProviderService = (0, s.createDecorator)("LinkProviderService");
					},
					6731: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ThemeService = t.DEFAULT_ANSI_COLORS = void 0;
						const n = i(7239), o = i(8055), a = i(8460), h = i(844), c = i(2585), l = o.css.toColor("#ffffff"), d = o.css.toColor("#000000"), _ = o.css.toColor("#ffffff"), u = o.css.toColor("#000000"), f = {
							css: "rgba(255, 255, 255, 0.3)",
							rgba: 4294967117
						};
						t.DEFAULT_ANSI_COLORS = Object.freeze((() => {
							const e = [
								o.css.toColor("#2e3436"),
								o.css.toColor("#cc0000"),
								o.css.toColor("#4e9a06"),
								o.css.toColor("#c4a000"),
								o.css.toColor("#3465a4"),
								o.css.toColor("#75507b"),
								o.css.toColor("#06989a"),
								o.css.toColor("#d3d7cf"),
								o.css.toColor("#555753"),
								o.css.toColor("#ef2929"),
								o.css.toColor("#8ae234"),
								o.css.toColor("#fce94f"),
								o.css.toColor("#729fcf"),
								o.css.toColor("#ad7fa8"),
								o.css.toColor("#34e2e2"),
								o.css.toColor("#eeeeec")
							], t = [
								0,
								95,
								135,
								175,
								215,
								255
							];
							for (let i = 0; i < 216; i++) {
								const s = t[i / 36 % 6 | 0], r = t[i / 6 % 6 | 0], n = t[i % 6];
								e.push({
									css: o.channels.toCss(s, r, n),
									rgba: o.channels.toRgba(s, r, n)
								});
							}
							for (let t = 0; t < 24; t++) {
								const i = 8 + 10 * t;
								e.push({
									css: o.channels.toCss(i, i, i),
									rgba: o.channels.toRgba(i, i, i)
								});
							}
							return e;
						})());
						let v = t.ThemeService = class extends h.Disposable {
							get colors() {
								return this._colors;
							}
							constructor(e) {
								super(), this._optionsService = e, this._contrastCache = new n.ColorContrastCache(), this._halfContrastCache = new n.ColorContrastCache(), this._onChangeColors = this.register(new a.EventEmitter()), this.onChangeColors = this._onChangeColors.event, this._colors = {
									foreground: l,
									background: d,
									cursor: _,
									cursorAccent: u,
									selectionForeground: void 0,
									selectionBackgroundTransparent: f,
									selectionBackgroundOpaque: o.color.blend(d, f),
									selectionInactiveBackgroundTransparent: f,
									selectionInactiveBackgroundOpaque: o.color.blend(d, f),
									ansi: t.DEFAULT_ANSI_COLORS.slice(),
									contrastCache: this._contrastCache,
									halfContrastCache: this._halfContrastCache
								}, this._updateRestoreColors(), this._setTheme(this._optionsService.rawOptions.theme), this.register(this._optionsService.onSpecificOptionChange("minimumContrastRatio", (() => this._contrastCache.clear()))), this.register(this._optionsService.onSpecificOptionChange("theme", (() => this._setTheme(this._optionsService.rawOptions.theme))));
							}
							_setTheme(e = {}) {
								const i = this._colors;
								if (i.foreground = p(e.foreground, l), i.background = p(e.background, d), i.cursor = p(e.cursor, _), i.cursorAccent = p(e.cursorAccent, u), i.selectionBackgroundTransparent = p(e.selectionBackground, f), i.selectionBackgroundOpaque = o.color.blend(i.background, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundTransparent = p(e.selectionInactiveBackground, i.selectionBackgroundTransparent), i.selectionInactiveBackgroundOpaque = o.color.blend(i.background, i.selectionInactiveBackgroundTransparent), i.selectionForeground = e.selectionForeground ? p(e.selectionForeground, o.NULL_COLOR) : void 0, i.selectionForeground === o.NULL_COLOR && (i.selectionForeground = void 0), o.color.isOpaque(i.selectionBackgroundTransparent)) i.selectionBackgroundTransparent = o.color.opacity(i.selectionBackgroundTransparent, .3);
								if (o.color.isOpaque(i.selectionInactiveBackgroundTransparent)) i.selectionInactiveBackgroundTransparent = o.color.opacity(i.selectionInactiveBackgroundTransparent, .3);
								if (i.ansi = t.DEFAULT_ANSI_COLORS.slice(), i.ansi[0] = p(e.black, t.DEFAULT_ANSI_COLORS[0]), i.ansi[1] = p(e.red, t.DEFAULT_ANSI_COLORS[1]), i.ansi[2] = p(e.green, t.DEFAULT_ANSI_COLORS[2]), i.ansi[3] = p(e.yellow, t.DEFAULT_ANSI_COLORS[3]), i.ansi[4] = p(e.blue, t.DEFAULT_ANSI_COLORS[4]), i.ansi[5] = p(e.magenta, t.DEFAULT_ANSI_COLORS[5]), i.ansi[6] = p(e.cyan, t.DEFAULT_ANSI_COLORS[6]), i.ansi[7] = p(e.white, t.DEFAULT_ANSI_COLORS[7]), i.ansi[8] = p(e.brightBlack, t.DEFAULT_ANSI_COLORS[8]), i.ansi[9] = p(e.brightRed, t.DEFAULT_ANSI_COLORS[9]), i.ansi[10] = p(e.brightGreen, t.DEFAULT_ANSI_COLORS[10]), i.ansi[11] = p(e.brightYellow, t.DEFAULT_ANSI_COLORS[11]), i.ansi[12] = p(e.brightBlue, t.DEFAULT_ANSI_COLORS[12]), i.ansi[13] = p(e.brightMagenta, t.DEFAULT_ANSI_COLORS[13]), i.ansi[14] = p(e.brightCyan, t.DEFAULT_ANSI_COLORS[14]), i.ansi[15] = p(e.brightWhite, t.DEFAULT_ANSI_COLORS[15]), e.extendedAnsi) {
									const s = Math.min(i.ansi.length - 16, e.extendedAnsi.length);
									for (let r = 0; r < s; r++) i.ansi[r + 16] = p(e.extendedAnsi[r], t.DEFAULT_ANSI_COLORS[r + 16]);
								}
								this._contrastCache.clear(), this._halfContrastCache.clear(), this._updateRestoreColors(), this._onChangeColors.fire(this.colors);
							}
							restoreColor(e) {
								this._restoreColor(e), this._onChangeColors.fire(this.colors);
							}
							_restoreColor(e) {
								if (void 0 !== e) switch (e) {
									case 256:
										this._colors.foreground = this._restoreColors.foreground;
										break;
									case 257:
										this._colors.background = this._restoreColors.background;
										break;
									case 258:
										this._colors.cursor = this._restoreColors.cursor;
										break;
									default: this._colors.ansi[e] = this._restoreColors.ansi[e];
								}
								else for (let e = 0; e < this._restoreColors.ansi.length; ++e) this._colors.ansi[e] = this._restoreColors.ansi[e];
							}
							modifyColors(e) {
								e(this._colors), this._onChangeColors.fire(this.colors);
							}
							_updateRestoreColors() {
								this._restoreColors = {
									foreground: this._colors.foreground,
									background: this._colors.background,
									cursor: this._colors.cursor,
									ansi: this._colors.ansi.slice()
								};
							}
						};
						function p(e, t) {
							if (void 0 !== e) try {
								return o.css.toColor(e);
							} catch {}
							return t;
						}
						t.ThemeService = v = s([r(0, c.IOptionsService)], v);
					},
					6349: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CircularList = void 0;
						const s = i(8460), r = i(844);
						class n extends r.Disposable {
							constructor(e) {
								super(), this._maxLength = e, this.onDeleteEmitter = this.register(new s.EventEmitter()), this.onDelete = this.onDeleteEmitter.event, this.onInsertEmitter = this.register(new s.EventEmitter()), this.onInsert = this.onInsertEmitter.event, this.onTrimEmitter = this.register(new s.EventEmitter()), this.onTrim = this.onTrimEmitter.event, this._array = new Array(this._maxLength), this._startIndex = 0, this._length = 0;
							}
							get maxLength() {
								return this._maxLength;
							}
							set maxLength(e) {
								if (this._maxLength === e) return;
								const t = new Array(e);
								for (let i = 0; i < Math.min(e, this.length); i++) t[i] = this._array[this._getCyclicIndex(i)];
								this._array = t, this._maxLength = e, this._startIndex = 0;
							}
							get length() {
								return this._length;
							}
							set length(e) {
								if (e > this._length) for (let t = this._length; t < e; t++) this._array[t] = void 0;
								this._length = e;
							}
							get(e) {
								return this._array[this._getCyclicIndex(e)];
							}
							set(e, t) {
								this._array[this._getCyclicIndex(e)] = t;
							}
							push(e) {
								this._array[this._getCyclicIndex(this._length)] = e, this._length === this._maxLength ? (this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1)) : this._length++;
							}
							recycle() {
								if (this._length !== this._maxLength) throw new Error("Can only recycle when the buffer is full");
								return this._startIndex = ++this._startIndex % this._maxLength, this.onTrimEmitter.fire(1), this._array[this._getCyclicIndex(this._length - 1)];
							}
							get isFull() {
								return this._length === this._maxLength;
							}
							pop() {
								return this._array[this._getCyclicIndex(this._length-- - 1)];
							}
							splice(e, t, ...i) {
								if (t) {
									for (let i = e; i < this._length - t; i++) this._array[this._getCyclicIndex(i)] = this._array[this._getCyclicIndex(i + t)];
									this._length -= t, this.onDeleteEmitter.fire({
										index: e,
										amount: t
									});
								}
								for (let t = this._length - 1; t >= e; t--) this._array[this._getCyclicIndex(t + i.length)] = this._array[this._getCyclicIndex(t)];
								for (let t = 0; t < i.length; t++) this._array[this._getCyclicIndex(e + t)] = i[t];
								if (i.length && this.onInsertEmitter.fire({
									index: e,
									amount: i.length
								}), this._length + i.length > this._maxLength) {
									const e = this._length + i.length - this._maxLength;
									this._startIndex += e, this._length = this._maxLength, this.onTrimEmitter.fire(e);
								} else this._length += i.length;
							}
							trimStart(e) {
								e > this._length && (e = this._length), this._startIndex += e, this._length -= e, this.onTrimEmitter.fire(e);
							}
							shiftElements(e, t, i) {
								if (!(t <= 0)) {
									if (e < 0 || e >= this._length) throw new Error("start argument out of range");
									if (e + i < 0) throw new Error("Cannot shift elements in list beyond index 0");
									if (i > 0) {
										for (let s = t - 1; s >= 0; s--) this.set(e + s + i, this.get(e + s));
										const s = e + t + i - this._length;
										if (s > 0) for (this._length += s; this._length > this._maxLength;) this._length--, this._startIndex++, this.onTrimEmitter.fire(1);
									} else for (let s = 0; s < t; s++) this.set(e + s + i, this.get(e + s));
								}
							}
							_getCyclicIndex(e) {
								return (this._startIndex + e) % this._maxLength;
							}
						}
						t.CircularList = n;
					},
					1439: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.clone = void 0, t.clone = function e(t, i = 5) {
							if ("object" != typeof t) return t;
							const s = Array.isArray(t) ? [] : {};
							for (const r in t) s[r] = i <= 1 ? t[r] : t[r] && e(t[r], i - 1);
							return s;
						};
					},
					8055: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.contrastRatio = t.toPaddedHex = t.rgba = t.rgb = t.css = t.color = t.channels = t.NULL_COLOR = void 0;
						let i = 0, s = 0, r = 0, n = 0;
						var o, a, h, c, l;
						function d(e) {
							const t = e.toString(16);
							return t.length < 2 ? "0" + t : t;
						}
						function _(e, t) {
							return e < t ? (t + .05) / (e + .05) : (e + .05) / (t + .05);
						}
						t.NULL_COLOR = {
							css: "#00000000",
							rgba: 0
						}, function(e) {
							e.toCss = function(e, t, i, s) {
								return void 0 !== s ? `#${d(e)}${d(t)}${d(i)}${d(s)}` : `#${d(e)}${d(t)}${d(i)}`;
							}, e.toRgba = function(e, t, i, s = 255) {
								return (e << 24 | t << 16 | i << 8 | s) >>> 0;
							}, e.toColor = function(t, i, s, r) {
								return {
									css: e.toCss(t, i, s, r),
									rgba: e.toRgba(t, i, s, r)
								};
							};
						}(o || (t.channels = o = {})), function(e) {
							function t(e, t) {
								return n = Math.round(255 * t), [i, s, r] = l.toChannels(e.rgba), {
									css: o.toCss(i, s, r, n),
									rgba: o.toRgba(i, s, r, n)
								};
							}
							e.blend = function(e, t) {
								if (n = (255 & t.rgba) / 255, 1 === n) return {
									css: t.css,
									rgba: t.rgba
								};
								const a = t.rgba >> 24 & 255, h = t.rgba >> 16 & 255, c = t.rgba >> 8 & 255, l = e.rgba >> 24 & 255, d = e.rgba >> 16 & 255, _ = e.rgba >> 8 & 255;
								return i = l + Math.round((a - l) * n), s = d + Math.round((h - d) * n), r = _ + Math.round((c - _) * n), {
									css: o.toCss(i, s, r),
									rgba: o.toRgba(i, s, r)
								};
							}, e.isOpaque = function(e) {
								return 255 == (255 & e.rgba);
							}, e.ensureContrastRatio = function(e, t, i) {
								const s = l.ensureContrastRatio(e.rgba, t.rgba, i);
								if (s) return o.toColor(s >> 24 & 255, s >> 16 & 255, s >> 8 & 255);
							}, e.opaque = function(e) {
								const t = (255 | e.rgba) >>> 0;
								return [i, s, r] = l.toChannels(t), {
									css: o.toCss(i, s, r),
									rgba: t
								};
							}, e.opacity = t, e.multiplyOpacity = function(e, i) {
								return n = 255 & e.rgba, t(e, n * i / 255);
							}, e.toColorRGB = function(e) {
								return [
									e.rgba >> 24 & 255,
									e.rgba >> 16 & 255,
									e.rgba >> 8 & 255
								];
							};
						}(a || (t.color = a = {})), function(e) {
							let t, a;
							try {
								const e = document.createElement("canvas");
								e.width = 1, e.height = 1;
								const i = e.getContext("2d", { willReadFrequently: !0 });
								i && (t = i, t.globalCompositeOperation = "copy", a = t.createLinearGradient(0, 0, 1, 1));
							} catch {}
							e.toColor = function(e) {
								if (e.match(/#[\da-f]{3,8}/i)) switch (e.length) {
									case 4: return i = parseInt(e.slice(1, 2).repeat(2), 16), s = parseInt(e.slice(2, 3).repeat(2), 16), r = parseInt(e.slice(3, 4).repeat(2), 16), o.toColor(i, s, r);
									case 5: return i = parseInt(e.slice(1, 2).repeat(2), 16), s = parseInt(e.slice(2, 3).repeat(2), 16), r = parseInt(e.slice(3, 4).repeat(2), 16), n = parseInt(e.slice(4, 5).repeat(2), 16), o.toColor(i, s, r, n);
									case 7: return {
										css: e,
										rgba: (parseInt(e.slice(1), 16) << 8 | 255) >>> 0
									};
									case 9: return {
										css: e,
										rgba: parseInt(e.slice(1), 16) >>> 0
									};
								}
								const h = e.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/);
								if (h) return i = parseInt(h[1]), s = parseInt(h[2]), r = parseInt(h[3]), n = Math.round(255 * (void 0 === h[5] ? 1 : parseFloat(h[5]))), o.toColor(i, s, r, n);
								if (!t || !a) throw new Error("css.toColor: Unsupported css format");
								if (t.fillStyle = a, t.fillStyle = e, "string" != typeof t.fillStyle) throw new Error("css.toColor: Unsupported css format");
								if (t.fillRect(0, 0, 1, 1), [i, s, r, n] = t.getImageData(0, 0, 1, 1).data, 255 !== n) throw new Error("css.toColor: Unsupported css format");
								return {
									rgba: o.toRgba(i, s, r, n),
									css: e
								};
							};
						}(h || (t.css = h = {})), function(e) {
							function t(e, t, i) {
								const s = e / 255, r = t / 255, n = i / 255;
								return .2126 * (s <= .03928 ? s / 12.92 : Math.pow((s + .055) / 1.055, 2.4)) + .7152 * (r <= .03928 ? r / 12.92 : Math.pow((r + .055) / 1.055, 2.4)) + .0722 * (n <= .03928 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4));
							}
							e.relativeLuminance = function(e) {
								return t(e >> 16 & 255, e >> 8 & 255, 255 & e);
							}, e.relativeLuminance2 = t;
						}(c || (t.rgb = c = {})), function(e) {
							function t(e, t, i) {
								const s = e >> 24 & 255, r = e >> 16 & 255, n = e >> 8 & 255;
								let o = t >> 24 & 255, a = t >> 16 & 255, h = t >> 8 & 255, l = _(c.relativeLuminance2(o, a, h), c.relativeLuminance2(s, r, n));
								for (; l < i && (o > 0 || a > 0 || h > 0);) o -= Math.max(0, Math.ceil(.1 * o)), a -= Math.max(0, Math.ceil(.1 * a)), h -= Math.max(0, Math.ceil(.1 * h)), l = _(c.relativeLuminance2(o, a, h), c.relativeLuminance2(s, r, n));
								return (o << 24 | a << 16 | h << 8 | 255) >>> 0;
							}
							function a(e, t, i) {
								const s = e >> 24 & 255, r = e >> 16 & 255, n = e >> 8 & 255;
								let o = t >> 24 & 255, a = t >> 16 & 255, h = t >> 8 & 255, l = _(c.relativeLuminance2(o, a, h), c.relativeLuminance2(s, r, n));
								for (; l < i && (o < 255 || a < 255 || h < 255);) o = Math.min(255, o + Math.ceil(.1 * (255 - o))), a = Math.min(255, a + Math.ceil(.1 * (255 - a))), h = Math.min(255, h + Math.ceil(.1 * (255 - h))), l = _(c.relativeLuminance2(o, a, h), c.relativeLuminance2(s, r, n));
								return (o << 24 | a << 16 | h << 8 | 255) >>> 0;
							}
							e.blend = function(e, t) {
								if (n = (255 & t) / 255, 1 === n) return t;
								const a = t >> 24 & 255, h = t >> 16 & 255, c = t >> 8 & 255, l = e >> 24 & 255, d = e >> 16 & 255, _ = e >> 8 & 255;
								return i = l + Math.round((a - l) * n), s = d + Math.round((h - d) * n), r = _ + Math.round((c - _) * n), o.toRgba(i, s, r);
							}, e.ensureContrastRatio = function(e, i, s) {
								const r = c.relativeLuminance(e >> 8), n = c.relativeLuminance(i >> 8);
								if (_(r, n) < s) {
									if (n < r) {
										const n = t(e, i, s), o = _(r, c.relativeLuminance(n >> 8));
										if (o < s) {
											const t = a(e, i, s);
											return o > _(r, c.relativeLuminance(t >> 8)) ? n : t;
										}
										return n;
									}
									const o = a(e, i, s), h = _(r, c.relativeLuminance(o >> 8));
									if (h < s) {
										const n = t(e, i, s);
										return h > _(r, c.relativeLuminance(n >> 8)) ? o : n;
									}
									return o;
								}
							}, e.reduceLuminance = t, e.increaseLuminance = a, e.toChannels = function(e) {
								return [
									e >> 24 & 255,
									e >> 16 & 255,
									e >> 8 & 255,
									255 & e
								];
							};
						}(l || (t.rgba = l = {})), t.toPaddedHex = d, t.contrastRatio = _;
					},
					8969: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CoreTerminal = void 0;
						const s = i(844), r = i(2585), n = i(4348), o = i(7866), a = i(744), h = i(7302), c = i(6975), l = i(8460), d = i(1753), _ = i(1480), u = i(7994), f = i(9282), v = i(5435), p = i(5981), g = i(2660);
						let m = !1;
						class S extends s.Disposable {
							get onScroll() {
								return this._onScrollApi || (this._onScrollApi = this.register(new l.EventEmitter()), this._onScroll.event(((e) => {
									this._onScrollApi?.fire(e.position);
								}))), this._onScrollApi.event;
							}
							get cols() {
								return this._bufferService.cols;
							}
							get rows() {
								return this._bufferService.rows;
							}
							get buffers() {
								return this._bufferService.buffers;
							}
							get options() {
								return this.optionsService.options;
							}
							set options(e) {
								for (const t in e) this.optionsService.options[t] = e[t];
							}
							constructor(e) {
								super(), this._windowsWrappingHeuristics = this.register(new s.MutableDisposable()), this._onBinary = this.register(new l.EventEmitter()), this.onBinary = this._onBinary.event, this._onData = this.register(new l.EventEmitter()), this.onData = this._onData.event, this._onLineFeed = this.register(new l.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onResize = this.register(new l.EventEmitter()), this.onResize = this._onResize.event, this._onWriteParsed = this.register(new l.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event, this._onScroll = this.register(new l.EventEmitter()), this._instantiationService = new n.InstantiationService(), this.optionsService = this.register(new h.OptionsService(e)), this._instantiationService.setService(r.IOptionsService, this.optionsService), this._bufferService = this.register(this._instantiationService.createInstance(a.BufferService)), this._instantiationService.setService(r.IBufferService, this._bufferService), this._logService = this.register(this._instantiationService.createInstance(o.LogService)), this._instantiationService.setService(r.ILogService, this._logService), this.coreService = this.register(this._instantiationService.createInstance(c.CoreService)), this._instantiationService.setService(r.ICoreService, this.coreService), this.coreMouseService = this.register(this._instantiationService.createInstance(d.CoreMouseService)), this._instantiationService.setService(r.ICoreMouseService, this.coreMouseService), this.unicodeService = this.register(this._instantiationService.createInstance(_.UnicodeService)), this._instantiationService.setService(r.IUnicodeService, this.unicodeService), this._charsetService = this._instantiationService.createInstance(u.CharsetService), this._instantiationService.setService(r.ICharsetService, this._charsetService), this._oscLinkService = this._instantiationService.createInstance(g.OscLinkService), this._instantiationService.setService(r.IOscLinkService, this._oscLinkService), this._inputHandler = this.register(new v.InputHandler(this._bufferService, this._charsetService, this.coreService, this._logService, this.optionsService, this._oscLinkService, this.coreMouseService, this.unicodeService)), this.register((0, l.forwardEvent)(this._inputHandler.onLineFeed, this._onLineFeed)), this.register(this._inputHandler), this.register((0, l.forwardEvent)(this._bufferService.onResize, this._onResize)), this.register((0, l.forwardEvent)(this.coreService.onData, this._onData)), this.register((0, l.forwardEvent)(this.coreService.onBinary, this._onBinary)), this.register(this.coreService.onRequestScrollToBottom((() => this.scrollToBottom()))), this.register(this.coreService.onUserInput((() => this._writeBuffer.handleUserInput()))), this.register(this.optionsService.onMultipleOptionChange(["windowsMode", "windowsPty"], (() => this._handleWindowsPtyOptionChange()))), this.register(this._bufferService.onScroll(((e) => {
									this._onScroll.fire({
										position: this._bufferService.buffer.ydisp,
										source: 0
									}), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
								}))), this.register(this._inputHandler.onScroll(((e) => {
									this._onScroll.fire({
										position: this._bufferService.buffer.ydisp,
										source: 0
									}), this._inputHandler.markRangeDirty(this._bufferService.buffer.scrollTop, this._bufferService.buffer.scrollBottom);
								}))), this._writeBuffer = this.register(new p.WriteBuffer(((e, t) => this._inputHandler.parse(e, t)))), this.register((0, l.forwardEvent)(this._writeBuffer.onWriteParsed, this._onWriteParsed));
							}
							write(e, t) {
								this._writeBuffer.write(e, t);
							}
							writeSync(e, t) {
								this._logService.logLevel <= r.LogLevelEnum.WARN && !m && (this._logService.warn("writeSync is unreliable and will be removed soon."), m = !0), this._writeBuffer.writeSync(e, t);
							}
							input(e, t = !0) {
								this.coreService.triggerDataEvent(e, t);
							}
							resize(e, t) {
								isNaN(e) || isNaN(t) || (e = Math.max(e, a.MINIMUM_COLS), t = Math.max(t, a.MINIMUM_ROWS), this._bufferService.resize(e, t));
							}
							scroll(e, t = !1) {
								this._bufferService.scroll(e, t);
							}
							scrollLines(e, t, i) {
								this._bufferService.scrollLines(e, t, i);
							}
							scrollPages(e) {
								this.scrollLines(e * (this.rows - 1));
							}
							scrollToTop() {
								this.scrollLines(-this._bufferService.buffer.ydisp);
							}
							scrollToBottom() {
								this.scrollLines(this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
							}
							scrollToLine(e) {
								const t = e - this._bufferService.buffer.ydisp;
								0 !== t && this.scrollLines(t);
							}
							registerEscHandler(e, t) {
								return this._inputHandler.registerEscHandler(e, t);
							}
							registerDcsHandler(e, t) {
								return this._inputHandler.registerDcsHandler(e, t);
							}
							registerCsiHandler(e, t) {
								return this._inputHandler.registerCsiHandler(e, t);
							}
							registerOscHandler(e, t) {
								return this._inputHandler.registerOscHandler(e, t);
							}
							_setup() {
								this._handleWindowsPtyOptionChange();
							}
							reset() {
								this._inputHandler.reset(), this._bufferService.reset(), this._charsetService.reset(), this.coreService.reset(), this.coreMouseService.reset();
							}
							_handleWindowsPtyOptionChange() {
								let e = !1;
								const t = this.optionsService.rawOptions.windowsPty;
								t && void 0 !== t.buildNumber && void 0 !== t.buildNumber ? e = !!("conpty" === t.backend && t.buildNumber < 21376) : this.optionsService.rawOptions.windowsMode && (e = !0), e ? this._enableWindowsWrappingHeuristics() : this._windowsWrappingHeuristics.clear();
							}
							_enableWindowsWrappingHeuristics() {
								if (!this._windowsWrappingHeuristics.value) {
									const e = [];
									e.push(this.onLineFeed(f.updateWindowsModeWrappedState.bind(null, this._bufferService))), e.push(this.registerCsiHandler({ final: "H" }, (() => ((0, f.updateWindowsModeWrappedState)(this._bufferService), !1)))), this._windowsWrappingHeuristics.value = (0, s.toDisposable)((() => {
										for (const t of e) t.dispose();
									}));
								}
							}
						}
						t.CoreTerminal = S;
					},
					8460: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.runAndSubscribe = t.forwardEvent = t.EventEmitter = void 0, t.EventEmitter = class {
							constructor() {
								this._listeners = [], this._disposed = !1;
							}
							get event() {
								return this._event || (this._event = (e) => (this._listeners.push(e), { dispose: () => {
									if (!this._disposed) {
										for (let t = 0; t < this._listeners.length; t++) if (this._listeners[t] === e) return void this._listeners.splice(t, 1);
									}
								} })), this._event;
							}
							fire(e, t) {
								const i = [];
								for (let e = 0; e < this._listeners.length; e++) i.push(this._listeners[e]);
								for (let s = 0; s < i.length; s++) i[s].call(void 0, e, t);
							}
							dispose() {
								this.clearListeners(), this._disposed = !0;
							}
							clearListeners() {
								this._listeners && (this._listeners.length = 0);
							}
						}, t.forwardEvent = function(e, t) {
							return e(((e) => t.fire(e)));
						}, t.runAndSubscribe = function(e, t) {
							return t(void 0), e(((e) => t(e)));
						};
					},
					5435: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.InputHandler = t.WindowsOptionsReportType = void 0;
						const n = i(2584), o = i(7116), a = i(2015), h = i(844), c = i(482), l = i(8437), d = i(8460), _ = i(643), u = i(511), f = i(3734), v = i(2585), p = i(1480), g = i(6242), m = i(6351), S = i(5941), C = {
							"(": 0,
							")": 1,
							"*": 2,
							"+": 3,
							"-": 1,
							".": 2
						}, b = 131072;
						function w(e, t) {
							if (e > 24) return t.setWinLines || !1;
							switch (e) {
								case 1: return !!t.restoreWin;
								case 2: return !!t.minimizeWin;
								case 3: return !!t.setWinPosition;
								case 4: return !!t.setWinSizePixels;
								case 5: return !!t.raiseWin;
								case 6: return !!t.lowerWin;
								case 7: return !!t.refreshWin;
								case 8: return !!t.setWinSizeChars;
								case 9: return !!t.maximizeWin;
								case 10: return !!t.fullscreenWin;
								case 11: return !!t.getWinState;
								case 13: return !!t.getWinPosition;
								case 14: return !!t.getWinSizePixels;
								case 15: return !!t.getScreenSizePixels;
								case 16: return !!t.getCellSizePixels;
								case 18: return !!t.getWinSizeChars;
								case 19: return !!t.getScreenSizeChars;
								case 20: return !!t.getIconTitle;
								case 21: return !!t.getWinTitle;
								case 22: return !!t.pushTitle;
								case 23: return !!t.popTitle;
								case 24: return !!t.setWinLines;
							}
							return !1;
						}
						var y;
						(function(e) {
							e[e.GET_WIN_SIZE_PIXELS = 0] = "GET_WIN_SIZE_PIXELS", e[e.GET_CELL_SIZE_PIXELS = 1] = "GET_CELL_SIZE_PIXELS";
						})(y || (t.WindowsOptionsReportType = y = {}));
						let E = 0;
						class k extends h.Disposable {
							getAttrData() {
								return this._curAttrData;
							}
							constructor(e, t, i, s, r, h, _, f, v = new a.EscapeSequenceParser()) {
								super(), this._bufferService = e, this._charsetService = t, this._coreService = i, this._logService = s, this._optionsService = r, this._oscLinkService = h, this._coreMouseService = _, this._unicodeService = f, this._parser = v, this._parseBuffer = /* @__PURE__ */ new Uint32Array(4096), this._stringDecoder = new c.StringToUtf32(), this._utf8Decoder = new c.Utf8ToUtf32(), this._workCell = new u.CellData(), this._windowTitle = "", this._iconName = "", this._windowTitleStack = [], this._iconNameStack = [], this._curAttrData = l.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l.DEFAULT_ATTR_DATA.clone(), this._onRequestBell = this.register(new d.EventEmitter()), this.onRequestBell = this._onRequestBell.event, this._onRequestRefreshRows = this.register(new d.EventEmitter()), this.onRequestRefreshRows = this._onRequestRefreshRows.event, this._onRequestReset = this.register(new d.EventEmitter()), this.onRequestReset = this._onRequestReset.event, this._onRequestSendFocus = this.register(new d.EventEmitter()), this.onRequestSendFocus = this._onRequestSendFocus.event, this._onRequestSyncScrollBar = this.register(new d.EventEmitter()), this.onRequestSyncScrollBar = this._onRequestSyncScrollBar.event, this._onRequestWindowsOptionsReport = this.register(new d.EventEmitter()), this.onRequestWindowsOptionsReport = this._onRequestWindowsOptionsReport.event, this._onA11yChar = this.register(new d.EventEmitter()), this.onA11yChar = this._onA11yChar.event, this._onA11yTab = this.register(new d.EventEmitter()), this.onA11yTab = this._onA11yTab.event, this._onCursorMove = this.register(new d.EventEmitter()), this.onCursorMove = this._onCursorMove.event, this._onLineFeed = this.register(new d.EventEmitter()), this.onLineFeed = this._onLineFeed.event, this._onScroll = this.register(new d.EventEmitter()), this.onScroll = this._onScroll.event, this._onTitleChange = this.register(new d.EventEmitter()), this.onTitleChange = this._onTitleChange.event, this._onColor = this.register(new d.EventEmitter()), this.onColor = this._onColor.event, this._parseStack = {
									paused: !1,
									cursorStartX: 0,
									cursorStartY: 0,
									decodedLength: 0,
									position: 0
								}, this._specialColors = [
									256,
									257,
									258
								], this.register(this._parser), this._dirtyRowTracker = new L(this._bufferService), this._activeBuffer = this._bufferService.buffer, this.register(this._bufferService.buffers.onBufferActivate(((e) => this._activeBuffer = e.activeBuffer))), this._parser.setCsiHandlerFallback(((e, t) => {
									this._logService.debug("Unknown CSI code: ", {
										identifier: this._parser.identToString(e),
										params: t.toArray()
									});
								})), this._parser.setEscHandlerFallback(((e) => {
									this._logService.debug("Unknown ESC code: ", { identifier: this._parser.identToString(e) });
								})), this._parser.setExecuteHandlerFallback(((e) => {
									this._logService.debug("Unknown EXECUTE code: ", { code: e });
								})), this._parser.setOscHandlerFallback(((e, t, i) => {
									this._logService.debug("Unknown OSC code: ", {
										identifier: e,
										action: t,
										data: i
									});
								})), this._parser.setDcsHandlerFallback(((e, t, i) => {
									"HOOK" === t && (i = i.toArray()), this._logService.debug("Unknown DCS code: ", {
										identifier: this._parser.identToString(e),
										action: t,
										payload: i
									});
								})), this._parser.setPrintHandler(((e, t, i) => this.print(e, t, i))), this._parser.registerCsiHandler({ final: "@" }, ((e) => this.insertChars(e))), this._parser.registerCsiHandler({
									intermediates: " ",
									final: "@"
								}, ((e) => this.scrollLeft(e))), this._parser.registerCsiHandler({ final: "A" }, ((e) => this.cursorUp(e))), this._parser.registerCsiHandler({
									intermediates: " ",
									final: "A"
								}, ((e) => this.scrollRight(e))), this._parser.registerCsiHandler({ final: "B" }, ((e) => this.cursorDown(e))), this._parser.registerCsiHandler({ final: "C" }, ((e) => this.cursorForward(e))), this._parser.registerCsiHandler({ final: "D" }, ((e) => this.cursorBackward(e))), this._parser.registerCsiHandler({ final: "E" }, ((e) => this.cursorNextLine(e))), this._parser.registerCsiHandler({ final: "F" }, ((e) => this.cursorPrecedingLine(e))), this._parser.registerCsiHandler({ final: "G" }, ((e) => this.cursorCharAbsolute(e))), this._parser.registerCsiHandler({ final: "H" }, ((e) => this.cursorPosition(e))), this._parser.registerCsiHandler({ final: "I" }, ((e) => this.cursorForwardTab(e))), this._parser.registerCsiHandler({ final: "J" }, ((e) => this.eraseInDisplay(e, !1))), this._parser.registerCsiHandler({
									prefix: "?",
									final: "J"
								}, ((e) => this.eraseInDisplay(e, !0))), this._parser.registerCsiHandler({ final: "K" }, ((e) => this.eraseInLine(e, !1))), this._parser.registerCsiHandler({
									prefix: "?",
									final: "K"
								}, ((e) => this.eraseInLine(e, !0))), this._parser.registerCsiHandler({ final: "L" }, ((e) => this.insertLines(e))), this._parser.registerCsiHandler({ final: "M" }, ((e) => this.deleteLines(e))), this._parser.registerCsiHandler({ final: "P" }, ((e) => this.deleteChars(e))), this._parser.registerCsiHandler({ final: "S" }, ((e) => this.scrollUp(e))), this._parser.registerCsiHandler({ final: "T" }, ((e) => this.scrollDown(e))), this._parser.registerCsiHandler({ final: "X" }, ((e) => this.eraseChars(e))), this._parser.registerCsiHandler({ final: "Z" }, ((e) => this.cursorBackwardTab(e))), this._parser.registerCsiHandler({ final: "`" }, ((e) => this.charPosAbsolute(e))), this._parser.registerCsiHandler({ final: "a" }, ((e) => this.hPositionRelative(e))), this._parser.registerCsiHandler({ final: "b" }, ((e) => this.repeatPrecedingCharacter(e))), this._parser.registerCsiHandler({ final: "c" }, ((e) => this.sendDeviceAttributesPrimary(e))), this._parser.registerCsiHandler({
									prefix: ">",
									final: "c"
								}, ((e) => this.sendDeviceAttributesSecondary(e))), this._parser.registerCsiHandler({ final: "d" }, ((e) => this.linePosAbsolute(e))), this._parser.registerCsiHandler({ final: "e" }, ((e) => this.vPositionRelative(e))), this._parser.registerCsiHandler({ final: "f" }, ((e) => this.hVPosition(e))), this._parser.registerCsiHandler({ final: "g" }, ((e) => this.tabClear(e))), this._parser.registerCsiHandler({ final: "h" }, ((e) => this.setMode(e))), this._parser.registerCsiHandler({
									prefix: "?",
									final: "h"
								}, ((e) => this.setModePrivate(e))), this._parser.registerCsiHandler({ final: "l" }, ((e) => this.resetMode(e))), this._parser.registerCsiHandler({
									prefix: "?",
									final: "l"
								}, ((e) => this.resetModePrivate(e))), this._parser.registerCsiHandler({ final: "m" }, ((e) => this.charAttributes(e))), this._parser.registerCsiHandler({ final: "n" }, ((e) => this.deviceStatus(e))), this._parser.registerCsiHandler({
									prefix: "?",
									final: "n"
								}, ((e) => this.deviceStatusPrivate(e))), this._parser.registerCsiHandler({
									intermediates: "!",
									final: "p"
								}, ((e) => this.softReset(e))), this._parser.registerCsiHandler({
									intermediates: " ",
									final: "q"
								}, ((e) => this.setCursorStyle(e))), this._parser.registerCsiHandler({ final: "r" }, ((e) => this.setScrollRegion(e))), this._parser.registerCsiHandler({ final: "s" }, ((e) => this.saveCursor(e))), this._parser.registerCsiHandler({ final: "t" }, ((e) => this.windowOptions(e))), this._parser.registerCsiHandler({ final: "u" }, ((e) => this.restoreCursor(e))), this._parser.registerCsiHandler({
									intermediates: "'",
									final: "}"
								}, ((e) => this.insertColumns(e))), this._parser.registerCsiHandler({
									intermediates: "'",
									final: "~"
								}, ((e) => this.deleteColumns(e))), this._parser.registerCsiHandler({
									intermediates: "\"",
									final: "q"
								}, ((e) => this.selectProtected(e))), this._parser.registerCsiHandler({
									intermediates: "$",
									final: "p"
								}, ((e) => this.requestMode(e, !0))), this._parser.registerCsiHandler({
									prefix: "?",
									intermediates: "$",
									final: "p"
								}, ((e) => this.requestMode(e, !1))), this._parser.setExecuteHandler(n.C0.BEL, (() => this.bell())), this._parser.setExecuteHandler(n.C0.LF, (() => this.lineFeed())), this._parser.setExecuteHandler(n.C0.VT, (() => this.lineFeed())), this._parser.setExecuteHandler(n.C0.FF, (() => this.lineFeed())), this._parser.setExecuteHandler(n.C0.CR, (() => this.carriageReturn())), this._parser.setExecuteHandler(n.C0.BS, (() => this.backspace())), this._parser.setExecuteHandler(n.C0.HT, (() => this.tab())), this._parser.setExecuteHandler(n.C0.SO, (() => this.shiftOut())), this._parser.setExecuteHandler(n.C0.SI, (() => this.shiftIn())), this._parser.setExecuteHandler(n.C1.IND, (() => this.index())), this._parser.setExecuteHandler(n.C1.NEL, (() => this.nextLine())), this._parser.setExecuteHandler(n.C1.HTS, (() => this.tabSet())), this._parser.registerOscHandler(0, new g.OscHandler(((e) => (this.setTitle(e), this.setIconName(e), !0)))), this._parser.registerOscHandler(1, new g.OscHandler(((e) => this.setIconName(e)))), this._parser.registerOscHandler(2, new g.OscHandler(((e) => this.setTitle(e)))), this._parser.registerOscHandler(4, new g.OscHandler(((e) => this.setOrReportIndexedColor(e)))), this._parser.registerOscHandler(8, new g.OscHandler(((e) => this.setHyperlink(e)))), this._parser.registerOscHandler(10, new g.OscHandler(((e) => this.setOrReportFgColor(e)))), this._parser.registerOscHandler(11, new g.OscHandler(((e) => this.setOrReportBgColor(e)))), this._parser.registerOscHandler(12, new g.OscHandler(((e) => this.setOrReportCursorColor(e)))), this._parser.registerOscHandler(104, new g.OscHandler(((e) => this.restoreIndexedColor(e)))), this._parser.registerOscHandler(110, new g.OscHandler(((e) => this.restoreFgColor(e)))), this._parser.registerOscHandler(111, new g.OscHandler(((e) => this.restoreBgColor(e)))), this._parser.registerOscHandler(112, new g.OscHandler(((e) => this.restoreCursorColor(e)))), this._parser.registerEscHandler({ final: "7" }, (() => this.saveCursor())), this._parser.registerEscHandler({ final: "8" }, (() => this.restoreCursor())), this._parser.registerEscHandler({ final: "D" }, (() => this.index())), this._parser.registerEscHandler({ final: "E" }, (() => this.nextLine())), this._parser.registerEscHandler({ final: "H" }, (() => this.tabSet())), this._parser.registerEscHandler({ final: "M" }, (() => this.reverseIndex())), this._parser.registerEscHandler({ final: "=" }, (() => this.keypadApplicationMode())), this._parser.registerEscHandler({ final: ">" }, (() => this.keypadNumericMode())), this._parser.registerEscHandler({ final: "c" }, (() => this.fullReset())), this._parser.registerEscHandler({ final: "n" }, (() => this.setgLevel(2))), this._parser.registerEscHandler({ final: "o" }, (() => this.setgLevel(3))), this._parser.registerEscHandler({ final: "|" }, (() => this.setgLevel(3))), this._parser.registerEscHandler({ final: "}" }, (() => this.setgLevel(2))), this._parser.registerEscHandler({ final: "~" }, (() => this.setgLevel(1))), this._parser.registerEscHandler({
									intermediates: "%",
									final: "@"
								}, (() => this.selectDefaultCharset())), this._parser.registerEscHandler({
									intermediates: "%",
									final: "G"
								}, (() => this.selectDefaultCharset()));
								for (const e in o.CHARSETS) this._parser.registerEscHandler({
									intermediates: "(",
									final: e
								}, (() => this.selectCharset("(" + e))), this._parser.registerEscHandler({
									intermediates: ")",
									final: e
								}, (() => this.selectCharset(")" + e))), this._parser.registerEscHandler({
									intermediates: "*",
									final: e
								}, (() => this.selectCharset("*" + e))), this._parser.registerEscHandler({
									intermediates: "+",
									final: e
								}, (() => this.selectCharset("+" + e))), this._parser.registerEscHandler({
									intermediates: "-",
									final: e
								}, (() => this.selectCharset("-" + e))), this._parser.registerEscHandler({
									intermediates: ".",
									final: e
								}, (() => this.selectCharset("." + e))), this._parser.registerEscHandler({
									intermediates: "/",
									final: e
								}, (() => this.selectCharset("/" + e)));
								this._parser.registerEscHandler({
									intermediates: "#",
									final: "8"
								}, (() => this.screenAlignmentPattern())), this._parser.setErrorHandler(((e) => (this._logService.error("Parsing error: ", e), e))), this._parser.registerDcsHandler({
									intermediates: "$",
									final: "q"
								}, new m.DcsHandler(((e, t) => this.requestStatusString(e, t))));
							}
							_preserveStack(e, t, i, s) {
								this._parseStack.paused = !0, this._parseStack.cursorStartX = e, this._parseStack.cursorStartY = t, this._parseStack.decodedLength = i, this._parseStack.position = s;
							}
							_logSlowResolvingAsync(e) {
								this._logService.logLevel <= v.LogLevelEnum.WARN && Promise.race([e, new Promise(((e, t) => setTimeout((() => t("#SLOW_TIMEOUT")), 5e3)))]).catch(((e) => {
									if ("#SLOW_TIMEOUT" !== e) throw e;
									console.warn("async parser handler taking longer than 5000 ms");
								}));
							}
							_getCurrentLinkId() {
								return this._curAttrData.extended.urlId;
							}
							parse(e, t) {
								let i, s = this._activeBuffer.x, r = this._activeBuffer.y, n = 0;
								const o = this._parseStack.paused;
								if (o) {
									if (i = this._parser.parse(this._parseBuffer, this._parseStack.decodedLength, t)) return this._logSlowResolvingAsync(i), i;
									s = this._parseStack.cursorStartX, r = this._parseStack.cursorStartY, this._parseStack.paused = !1, e.length > b && (n = this._parseStack.position + b);
								}
								if (this._logService.logLevel <= v.LogLevelEnum.DEBUG && this._logService.debug("parsing data" + ("string" == typeof e ? ` "${e}"` : ` "${Array.prototype.map.call(e, ((e) => String.fromCharCode(e))).join("")}"`), "string" == typeof e ? e.split("").map(((e) => e.charCodeAt(0))) : e), this._parseBuffer.length < e.length && this._parseBuffer.length < b && (this._parseBuffer = new Uint32Array(Math.min(e.length, b))), o || this._dirtyRowTracker.clearRange(), e.length > b) for (let t = n; t < e.length; t += b) {
									const n = t + b < e.length ? t + b : e.length, o = "string" == typeof e ? this._stringDecoder.decode(e.substring(t, n), this._parseBuffer) : this._utf8Decoder.decode(e.subarray(t, n), this._parseBuffer);
									if (i = this._parser.parse(this._parseBuffer, o)) return this._preserveStack(s, r, o, t), this._logSlowResolvingAsync(i), i;
								}
								else if (!o) {
									const t = "string" == typeof e ? this._stringDecoder.decode(e, this._parseBuffer) : this._utf8Decoder.decode(e, this._parseBuffer);
									if (i = this._parser.parse(this._parseBuffer, t)) return this._preserveStack(s, r, t, 0), this._logSlowResolvingAsync(i), i;
								}
								this._activeBuffer.x === s && this._activeBuffer.y === r || this._onCursorMove.fire();
								const a = this._dirtyRowTracker.end + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp), h = this._dirtyRowTracker.start + (this._bufferService.buffer.ybase - this._bufferService.buffer.ydisp);
								h < this._bufferService.rows && this._onRequestRefreshRows.fire(Math.min(h, this._bufferService.rows - 1), Math.min(a, this._bufferService.rows - 1));
							}
							print(e, t, i) {
								let s, r;
								const n = this._charsetService.charset, o = this._optionsService.rawOptions.screenReaderMode, a = this._bufferService.cols, h = this._coreService.decPrivateModes.wraparound, d = this._coreService.modes.insertMode, u = this._curAttrData;
								let f = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
								this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._activeBuffer.x && i - t > 0 && 2 === f.getWidth(this._activeBuffer.x - 1) && f.setCellFromCodepoint(this._activeBuffer.x - 1, 0, 1, u);
								let v = this._parser.precedingJoinState;
								for (let g = t; g < i; ++g) {
									if (s = e[g], s < 127 && n) {
										const e = n[String.fromCharCode(s)];
										e && (s = e.charCodeAt(0));
									}
									const t = this._unicodeService.charProperties(s, v);
									r = p.UnicodeService.extractWidth(t);
									const i = p.UnicodeService.extractShouldJoin(t), m = i ? p.UnicodeService.extractWidth(v) : 0;
									if (v = t, o && this._onA11yChar.fire((0, c.stringFromCodePoint)(s)), this._getCurrentLinkId() && this._oscLinkService.addLineToLink(this._getCurrentLinkId(), this._activeBuffer.ybase + this._activeBuffer.y), this._activeBuffer.x + r - m > a) {
										if (h) {
											const e = f;
											let t = this._activeBuffer.x - m;
											for (this._activeBuffer.x = m, this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData(), !0)) : (this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = !0), f = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y), m > 0 && f instanceof l.BufferLine && f.copyCellsFrom(e, t, 0, m, !1); t < a;) e.setCellFromCodepoint(t++, 0, 1, u);
										} else if (this._activeBuffer.x = a - 1, 2 === r) continue;
									}
									if (i && this._activeBuffer.x) {
										const e = f.getWidth(this._activeBuffer.x - 1) ? 1 : 2;
										f.addCodepointToCell(this._activeBuffer.x - e, s, r);
										for (let e = r - m; --e >= 0;) f.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, u);
									} else if (d && (f.insertCells(this._activeBuffer.x, r - m, this._activeBuffer.getNullCell(u)), 2 === f.getWidth(a - 1) && f.setCellFromCodepoint(a - 1, _.NULL_CELL_CODE, _.NULL_CELL_WIDTH, u)), f.setCellFromCodepoint(this._activeBuffer.x++, s, r, u), r > 0) for (; --r;) f.setCellFromCodepoint(this._activeBuffer.x++, 0, 0, u);
								}
								this._parser.precedingJoinState = v, this._activeBuffer.x < a && i - t > 0 && 0 === f.getWidth(this._activeBuffer.x) && !f.hasContent(this._activeBuffer.x) && f.setCellFromCodepoint(this._activeBuffer.x, 0, 1, u), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
							}
							registerCsiHandler(e, t) {
								return "t" !== e.final || e.prefix || e.intermediates ? this._parser.registerCsiHandler(e, t) : this._parser.registerCsiHandler(e, ((e) => !w(e.params[0], this._optionsService.rawOptions.windowOptions) || t(e)));
							}
							registerDcsHandler(e, t) {
								return this._parser.registerDcsHandler(e, new m.DcsHandler(t));
							}
							registerEscHandler(e, t) {
								return this._parser.registerEscHandler(e, t);
							}
							registerOscHandler(e, t) {
								return this._parser.registerOscHandler(e, new g.OscHandler(t));
							}
							bell() {
								return this._onRequestBell.fire(), !0;
							}
							lineFeed() {
								return this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._optionsService.rawOptions.convertEol && (this._activeBuffer.x = 0), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows ? this._activeBuffer.y = this._bufferService.rows - 1 : this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = !1, this._activeBuffer.x >= this._bufferService.cols && this._activeBuffer.x--, this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._onLineFeed.fire(), !0;
							}
							carriageReturn() {
								return this._activeBuffer.x = 0, !0;
							}
							backspace() {
								if (!this._coreService.decPrivateModes.reverseWraparound) return this._restrictCursor(), this._activeBuffer.x > 0 && this._activeBuffer.x--, !0;
								if (this._restrictCursor(this._bufferService.cols), this._activeBuffer.x > 0) this._activeBuffer.x--;
								else if (0 === this._activeBuffer.x && this._activeBuffer.y > this._activeBuffer.scrollTop && this._activeBuffer.y <= this._activeBuffer.scrollBottom && this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y)?.isWrapped) {
									this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).isWrapped = !1, this._activeBuffer.y--, this._activeBuffer.x = this._bufferService.cols - 1;
									const e = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
									e.hasWidth(this._activeBuffer.x) && !e.hasContent(this._activeBuffer.x) && this._activeBuffer.x--;
								}
								return this._restrictCursor(), !0;
							}
							tab() {
								if (this._activeBuffer.x >= this._bufferService.cols) return !0;
								const e = this._activeBuffer.x;
								return this._activeBuffer.x = this._activeBuffer.nextStop(), this._optionsService.rawOptions.screenReaderMode && this._onA11yTab.fire(this._activeBuffer.x - e), !0;
							}
							shiftOut() {
								return this._charsetService.setgLevel(1), !0;
							}
							shiftIn() {
								return this._charsetService.setgLevel(0), !0;
							}
							_restrictCursor(e = this._bufferService.cols - 1) {
								this._activeBuffer.x = Math.min(e, Math.max(0, this._activeBuffer.x)), this._activeBuffer.y = this._coreService.decPrivateModes.origin ? Math.min(this._activeBuffer.scrollBottom, Math.max(this._activeBuffer.scrollTop, this._activeBuffer.y)) : Math.min(this._bufferService.rows - 1, Math.max(0, this._activeBuffer.y)), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
							}
							_setCursor(e, t) {
								this._dirtyRowTracker.markDirty(this._activeBuffer.y), this._coreService.decPrivateModes.origin ? (this._activeBuffer.x = e, this._activeBuffer.y = this._activeBuffer.scrollTop + t) : (this._activeBuffer.x = e, this._activeBuffer.y = t), this._restrictCursor(), this._dirtyRowTracker.markDirty(this._activeBuffer.y);
							}
							_moveCursor(e, t) {
								this._restrictCursor(), this._setCursor(this._activeBuffer.x + e, this._activeBuffer.y + t);
							}
							cursorUp(e) {
								const t = this._activeBuffer.y - this._activeBuffer.scrollTop;
								return t >= 0 ? this._moveCursor(0, -Math.min(t, e.params[0] || 1)) : this._moveCursor(0, -(e.params[0] || 1)), !0;
							}
							cursorDown(e) {
								const t = this._activeBuffer.scrollBottom - this._activeBuffer.y;
								return t >= 0 ? this._moveCursor(0, Math.min(t, e.params[0] || 1)) : this._moveCursor(0, e.params[0] || 1), !0;
							}
							cursorForward(e) {
								return this._moveCursor(e.params[0] || 1, 0), !0;
							}
							cursorBackward(e) {
								return this._moveCursor(-(e.params[0] || 1), 0), !0;
							}
							cursorNextLine(e) {
								return this.cursorDown(e), this._activeBuffer.x = 0, !0;
							}
							cursorPrecedingLine(e) {
								return this.cursorUp(e), this._activeBuffer.x = 0, !0;
							}
							cursorCharAbsolute(e) {
								return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), !0;
							}
							cursorPosition(e) {
								return this._setCursor(e.length >= 2 ? (e.params[1] || 1) - 1 : 0, (e.params[0] || 1) - 1), !0;
							}
							charPosAbsolute(e) {
								return this._setCursor((e.params[0] || 1) - 1, this._activeBuffer.y), !0;
							}
							hPositionRelative(e) {
								return this._moveCursor(e.params[0] || 1, 0), !0;
							}
							linePosAbsolute(e) {
								return this._setCursor(this._activeBuffer.x, (e.params[0] || 1) - 1), !0;
							}
							vPositionRelative(e) {
								return this._moveCursor(0, e.params[0] || 1), !0;
							}
							hVPosition(e) {
								return this.cursorPosition(e), !0;
							}
							tabClear(e) {
								const t = e.params[0];
								return 0 === t ? delete this._activeBuffer.tabs[this._activeBuffer.x] : 3 === t && (this._activeBuffer.tabs = {}), !0;
							}
							cursorForwardTab(e) {
								if (this._activeBuffer.x >= this._bufferService.cols) return !0;
								let t = e.params[0] || 1;
								for (; t--;) this._activeBuffer.x = this._activeBuffer.nextStop();
								return !0;
							}
							cursorBackwardTab(e) {
								if (this._activeBuffer.x >= this._bufferService.cols) return !0;
								let t = e.params[0] || 1;
								for (; t--;) this._activeBuffer.x = this._activeBuffer.prevStop();
								return !0;
							}
							selectProtected(e) {
								const t = e.params[0];
								return 1 === t && (this._curAttrData.bg |= 536870912), 2 !== t && 0 !== t || (this._curAttrData.bg &= -536870913), !0;
							}
							_eraseInBufferLine(e, t, i, s = !1, r = !1) {
								const n = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
								n.replaceCells(t, i, this._activeBuffer.getNullCell(this._eraseAttrData()), r), s && (n.isWrapped = !1);
							}
							_resetBufferLine(e, t = !1) {
								const i = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
								i && (i.fill(this._activeBuffer.getNullCell(this._eraseAttrData()), t), this._bufferService.buffer.clearMarkers(this._activeBuffer.ybase + e), i.isWrapped = !1);
							}
							eraseInDisplay(e, t = !1) {
								let i;
								switch (this._restrictCursor(this._bufferService.cols), e.params[0]) {
									case 0:
										for (i = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i), this._eraseInBufferLine(i++, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t); i < this._bufferService.rows; i++) this._resetBufferLine(i, t);
										this._dirtyRowTracker.markDirty(i);
										break;
									case 1:
										for (i = this._activeBuffer.y, this._dirtyRowTracker.markDirty(i), this._eraseInBufferLine(i, 0, this._activeBuffer.x + 1, !0, t), this._activeBuffer.x + 1 >= this._bufferService.cols && (this._activeBuffer.lines.get(i + 1).isWrapped = !1); i--;) this._resetBufferLine(i, t);
										this._dirtyRowTracker.markDirty(0);
										break;
									case 2:
										for (i = this._bufferService.rows, this._dirtyRowTracker.markDirty(i - 1); i--;) this._resetBufferLine(i, t);
										this._dirtyRowTracker.markDirty(0);
										break;
									case 3:
										const e = this._activeBuffer.lines.length - this._bufferService.rows;
										e > 0 && (this._activeBuffer.lines.trimStart(e), this._activeBuffer.ybase = Math.max(this._activeBuffer.ybase - e, 0), this._activeBuffer.ydisp = Math.max(this._activeBuffer.ydisp - e, 0), this._onScroll.fire(0));
								}
								return !0;
							}
							eraseInLine(e, t = !1) {
								switch (this._restrictCursor(this._bufferService.cols), e.params[0]) {
									case 0:
										this._eraseInBufferLine(this._activeBuffer.y, this._activeBuffer.x, this._bufferService.cols, 0 === this._activeBuffer.x, t);
										break;
									case 1:
										this._eraseInBufferLine(this._activeBuffer.y, 0, this._activeBuffer.x + 1, !1, t);
										break;
									case 2: this._eraseInBufferLine(this._activeBuffer.y, 0, this._bufferService.cols, !0, t);
								}
								return this._dirtyRowTracker.markDirty(this._activeBuffer.y), !0;
							}
							insertLines(e) {
								this._restrictCursor();
								let t = e.params[0] || 1;
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const i = this._activeBuffer.ybase + this._activeBuffer.y, s = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, r = this._bufferService.rows - 1 + this._activeBuffer.ybase - s + 1;
								for (; t--;) this._activeBuffer.lines.splice(r - 1, 1), this._activeBuffer.lines.splice(i, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, !0;
							}
							deleteLines(e) {
								this._restrictCursor();
								let t = e.params[0] || 1;
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const i = this._activeBuffer.ybase + this._activeBuffer.y;
								let s;
								for (s = this._bufferService.rows - 1 - this._activeBuffer.scrollBottom, s = this._bufferService.rows - 1 + this._activeBuffer.ybase - s; t--;) this._activeBuffer.lines.splice(i, 1), this._activeBuffer.lines.splice(s, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.y, this._activeBuffer.scrollBottom), this._activeBuffer.x = 0, !0;
							}
							insertChars(e) {
								this._restrictCursor();
								const t = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
								return t && (t.insertCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), !0;
							}
							deleteChars(e) {
								this._restrictCursor();
								const t = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
								return t && (t.deleteCells(this._activeBuffer.x, e.params[0] || 1, this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), !0;
							}
							scrollUp(e) {
								let t = e.params[0] || 1;
								for (; t--;) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 0, this._activeBuffer.getBlankLine(this._eraseAttrData()));
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							scrollDown(e) {
								let t = e.params[0] || 1;
								for (; t--;) this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollBottom, 1), this._activeBuffer.lines.splice(this._activeBuffer.ybase + this._activeBuffer.scrollTop, 0, this._activeBuffer.getBlankLine(l.DEFAULT_ATTR_DATA));
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							scrollLeft(e) {
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const t = e.params[0] || 1;
								for (let e = this._activeBuffer.scrollTop; e <= this._activeBuffer.scrollBottom; ++e) {
									const i = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
									i.deleteCells(0, t, this._activeBuffer.getNullCell(this._eraseAttrData())), i.isWrapped = !1;
								}
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							scrollRight(e) {
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const t = e.params[0] || 1;
								for (let e = this._activeBuffer.scrollTop; e <= this._activeBuffer.scrollBottom; ++e) {
									const i = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
									i.insertCells(0, t, this._activeBuffer.getNullCell(this._eraseAttrData())), i.isWrapped = !1;
								}
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							insertColumns(e) {
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const t = e.params[0] || 1;
								for (let e = this._activeBuffer.scrollTop; e <= this._activeBuffer.scrollBottom; ++e) {
									const i = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
									i.insertCells(this._activeBuffer.x, t, this._activeBuffer.getNullCell(this._eraseAttrData())), i.isWrapped = !1;
								}
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							deleteColumns(e) {
								if (this._activeBuffer.y > this._activeBuffer.scrollBottom || this._activeBuffer.y < this._activeBuffer.scrollTop) return !0;
								const t = e.params[0] || 1;
								for (let e = this._activeBuffer.scrollTop; e <= this._activeBuffer.scrollBottom; ++e) {
									const i = this._activeBuffer.lines.get(this._activeBuffer.ybase + e);
									i.deleteCells(this._activeBuffer.x, t, this._activeBuffer.getNullCell(this._eraseAttrData())), i.isWrapped = !1;
								}
								return this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom), !0;
							}
							eraseChars(e) {
								this._restrictCursor();
								const t = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y);
								return t && (t.replaceCells(this._activeBuffer.x, this._activeBuffer.x + (e.params[0] || 1), this._activeBuffer.getNullCell(this._eraseAttrData())), this._dirtyRowTracker.markDirty(this._activeBuffer.y)), !0;
							}
							repeatPrecedingCharacter(e) {
								const t = this._parser.precedingJoinState;
								if (!t) return !0;
								const i = e.params[0] || 1, s = p.UnicodeService.extractWidth(t), r = this._activeBuffer.x - s, n = this._activeBuffer.lines.get(this._activeBuffer.ybase + this._activeBuffer.y).getString(r), o = new Uint32Array(n.length * i);
								let a = 0;
								for (let e = 0; e < n.length;) {
									const t = n.codePointAt(e) || 0;
									o[a++] = t, e += t > 65535 ? 2 : 1;
								}
								let h = a;
								for (let e = 1; e < i; ++e) o.copyWithin(h, 0, a), h += a;
								return this.print(o, 0, h), !0;
							}
							sendDeviceAttributesPrimary(e) {
								return e.params[0] > 0 || (this._is("xterm") || this._is("rxvt-unicode") || this._is("screen") ? this._coreService.triggerDataEvent(n.C0.ESC + "[?1;2c") : this._is("linux") && this._coreService.triggerDataEvent(n.C0.ESC + "[?6c")), !0;
							}
							sendDeviceAttributesSecondary(e) {
								return e.params[0] > 0 || (this._is("xterm") ? this._coreService.triggerDataEvent(n.C0.ESC + "[>0;276;0c") : this._is("rxvt-unicode") ? this._coreService.triggerDataEvent(n.C0.ESC + "[>85;95;0c") : this._is("linux") ? this._coreService.triggerDataEvent(e.params[0] + "c") : this._is("screen") && this._coreService.triggerDataEvent(n.C0.ESC + "[>83;40003;0c")), !0;
							}
							_is(e) {
								return 0 === (this._optionsService.rawOptions.termName + "").indexOf(e);
							}
							setMode(e) {
								for (let t = 0; t < e.length; t++) switch (e.params[t]) {
									case 4:
										this._coreService.modes.insertMode = !0;
										break;
									case 20: this._optionsService.options.convertEol = !0;
								}
								return !0;
							}
							setModePrivate(e) {
								for (let t = 0; t < e.length; t++) switch (e.params[t]) {
									case 1:
										this._coreService.decPrivateModes.applicationCursorKeys = !0;
										break;
									case 2:
										this._charsetService.setgCharset(0, o.DEFAULT_CHARSET), this._charsetService.setgCharset(1, o.DEFAULT_CHARSET), this._charsetService.setgCharset(2, o.DEFAULT_CHARSET), this._charsetService.setgCharset(3, o.DEFAULT_CHARSET);
										break;
									case 3:
										this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(132, this._bufferService.rows), this._onRequestReset.fire());
										break;
									case 6:
										this._coreService.decPrivateModes.origin = !0, this._setCursor(0, 0);
										break;
									case 7:
										this._coreService.decPrivateModes.wraparound = !0;
										break;
									case 12:
										this._optionsService.options.cursorBlink = !0;
										break;
									case 45:
										this._coreService.decPrivateModes.reverseWraparound = !0;
										break;
									case 66:
										this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = !0, this._onRequestSyncScrollBar.fire();
										break;
									case 9:
										this._coreMouseService.activeProtocol = "X10";
										break;
									case 1e3:
										this._coreMouseService.activeProtocol = "VT200";
										break;
									case 1002:
										this._coreMouseService.activeProtocol = "DRAG";
										break;
									case 1003:
										this._coreMouseService.activeProtocol = "ANY";
										break;
									case 1004:
										this._coreService.decPrivateModes.sendFocus = !0, this._onRequestSendFocus.fire();
										break;
									case 1005:
										this._logService.debug("DECSET 1005 not supported (see #2507)");
										break;
									case 1006:
										this._coreMouseService.activeEncoding = "SGR";
										break;
									case 1015:
										this._logService.debug("DECSET 1015 not supported (see #2507)");
										break;
									case 1016:
										this._coreMouseService.activeEncoding = "SGR_PIXELS";
										break;
									case 25:
										this._coreService.isCursorHidden = !1;
										break;
									case 1048:
										this.saveCursor();
										break;
									case 1049: this.saveCursor();
									case 47:
									case 1047:
										this._bufferService.buffers.activateAltBuffer(this._eraseAttrData()), this._coreService.isCursorInitialized = !0, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
										break;
									case 2004: this._coreService.decPrivateModes.bracketedPasteMode = !0;
								}
								return !0;
							}
							resetMode(e) {
								for (let t = 0; t < e.length; t++) switch (e.params[t]) {
									case 4:
										this._coreService.modes.insertMode = !1;
										break;
									case 20: this._optionsService.options.convertEol = !1;
								}
								return !0;
							}
							resetModePrivate(e) {
								for (let t = 0; t < e.length; t++) switch (e.params[t]) {
									case 1:
										this._coreService.decPrivateModes.applicationCursorKeys = !1;
										break;
									case 3:
										this._optionsService.rawOptions.windowOptions.setWinLines && (this._bufferService.resize(80, this._bufferService.rows), this._onRequestReset.fire());
										break;
									case 6:
										this._coreService.decPrivateModes.origin = !1, this._setCursor(0, 0);
										break;
									case 7:
										this._coreService.decPrivateModes.wraparound = !1;
										break;
									case 12:
										this._optionsService.options.cursorBlink = !1;
										break;
									case 45:
										this._coreService.decPrivateModes.reverseWraparound = !1;
										break;
									case 66:
										this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = !1, this._onRequestSyncScrollBar.fire();
										break;
									case 9:
									case 1e3:
									case 1002:
									case 1003:
										this._coreMouseService.activeProtocol = "NONE";
										break;
									case 1004:
										this._coreService.decPrivateModes.sendFocus = !1;
										break;
									case 1005:
										this._logService.debug("DECRST 1005 not supported (see #2507)");
										break;
									case 1006:
									case 1016:
										this._coreMouseService.activeEncoding = "DEFAULT";
										break;
									case 1015:
										this._logService.debug("DECRST 1015 not supported (see #2507)");
										break;
									case 25:
										this._coreService.isCursorHidden = !0;
										break;
									case 1048:
										this.restoreCursor();
										break;
									case 1049:
									case 47:
									case 1047:
										this._bufferService.buffers.activateNormalBuffer(), 1049 === e.params[t] && this.restoreCursor(), this._coreService.isCursorInitialized = !0, this._onRequestRefreshRows.fire(0, this._bufferService.rows - 1), this._onRequestSyncScrollBar.fire();
										break;
									case 2004: this._coreService.decPrivateModes.bracketedPasteMode = !1;
								}
								return !0;
							}
							requestMode(e, t) {
								const i = this._coreService.decPrivateModes, { activeProtocol: s, activeEncoding: r } = this._coreMouseService, o = this._coreService, { buffers: a, cols: h } = this._bufferService, { active: c, alt: l } = a, d = this._optionsService.rawOptions, _ = (e) => e ? 1 : 2, u = e.params[0];
								return f = u, v = t ? 2 === u ? 4 : 4 === u ? _(o.modes.insertMode) : 12 === u ? 3 : 20 === u ? _(d.convertEol) : 0 : 1 === u ? _(i.applicationCursorKeys) : 3 === u ? d.windowOptions.setWinLines ? 80 === h ? 2 : 132 === h ? 1 : 0 : 0 : 6 === u ? _(i.origin) : 7 === u ? _(i.wraparound) : 8 === u ? 3 : 9 === u ? _("X10" === s) : 12 === u ? _(d.cursorBlink) : 25 === u ? _(!o.isCursorHidden) : 45 === u ? _(i.reverseWraparound) : 66 === u ? _(i.applicationKeypad) : 67 === u ? 4 : 1e3 === u ? _("VT200" === s) : 1002 === u ? _("DRAG" === s) : 1003 === u ? _("ANY" === s) : 1004 === u ? _(i.sendFocus) : 1005 === u ? 4 : 1006 === u ? _("SGR" === r) : 1015 === u ? 4 : 1016 === u ? _("SGR_PIXELS" === r) : 1048 === u ? 1 : 47 === u || 1047 === u || 1049 === u ? _(c === l) : 2004 === u ? _(i.bracketedPasteMode) : 0, o.triggerDataEvent(`${n.C0.ESC}[${t ? "" : "?"}${f};${v}$y`), !0;
								var f, v;
							}
							_updateAttrColor(e, t, i, s, r) {
								return 2 === t ? (e |= 50331648, e &= -16777216, e |= f.AttributeData.fromColorRGB([
									i,
									s,
									r
								])) : 5 === t && (e &= -50331904, e |= 33554432 | 255 & i), e;
							}
							_extractColor(e, t, i) {
								const s = [
									0,
									0,
									-1,
									0,
									0,
									0
								];
								let r = 0, n = 0;
								do {
									if (s[n + r] = e.params[t + n], e.hasSubParams(t + n)) {
										const i = e.getSubParams(t + n);
										let o = 0;
										do
											5 === s[1] && (r = 1), s[n + o + 1 + r] = i[o];
										while (++o < i.length && o + n + 1 + r < s.length);
										break;
									}
									if (5 === s[1] && n + r >= 2 || 2 === s[1] && n + r >= 5) break;
									s[1] && (r = 1);
								} while (++n + t < e.length && n + r < s.length);
								for (let e = 2; e < s.length; ++e) -1 === s[e] && (s[e] = 0);
								switch (s[0]) {
									case 38:
										i.fg = this._updateAttrColor(i.fg, s[1], s[3], s[4], s[5]);
										break;
									case 48:
										i.bg = this._updateAttrColor(i.bg, s[1], s[3], s[4], s[5]);
										break;
									case 58: i.extended = i.extended.clone(), i.extended.underlineColor = this._updateAttrColor(i.extended.underlineColor, s[1], s[3], s[4], s[5]);
								}
								return n;
							}
							_processUnderline(e, t) {
								t.extended = t.extended.clone(), (!~e || e > 5) && (e = 1), t.extended.underlineStyle = e, t.fg |= 268435456, 0 === e && (t.fg &= -268435457), t.updateExtended();
							}
							_processSGR0(e) {
								e.fg = l.DEFAULT_ATTR_DATA.fg, e.bg = l.DEFAULT_ATTR_DATA.bg, e.extended = e.extended.clone(), e.extended.underlineStyle = 0, e.extended.underlineColor &= -67108864, e.updateExtended();
							}
							charAttributes(e) {
								if (1 === e.length && 0 === e.params[0]) return this._processSGR0(this._curAttrData), !0;
								const t = e.length;
								let i;
								const s = this._curAttrData;
								for (let r = 0; r < t; r++) i = e.params[r], i >= 30 && i <= 37 ? (s.fg &= -50331904, s.fg |= 16777216 | i - 30) : i >= 40 && i <= 47 ? (s.bg &= -50331904, s.bg |= 16777216 | i - 40) : i >= 90 && i <= 97 ? (s.fg &= -50331904, s.fg |= 16777224 | i - 90) : i >= 100 && i <= 107 ? (s.bg &= -50331904, s.bg |= 16777224 | i - 100) : 0 === i ? this._processSGR0(s) : 1 === i ? s.fg |= 134217728 : 3 === i ? s.bg |= 67108864 : 4 === i ? (s.fg |= 268435456, this._processUnderline(e.hasSubParams(r) ? e.getSubParams(r)[0] : 1, s)) : 5 === i ? s.fg |= 536870912 : 7 === i ? s.fg |= 67108864 : 8 === i ? s.fg |= 1073741824 : 9 === i ? s.fg |= 2147483648 : 2 === i ? s.bg |= 134217728 : 21 === i ? this._processUnderline(2, s) : 22 === i ? (s.fg &= -134217729, s.bg &= -134217729) : 23 === i ? s.bg &= -67108865 : 24 === i ? (s.fg &= -268435457, this._processUnderline(0, s)) : 25 === i ? s.fg &= -536870913 : 27 === i ? s.fg &= -67108865 : 28 === i ? s.fg &= -1073741825 : 29 === i ? s.fg &= 2147483647 : 39 === i ? (s.fg &= -67108864, s.fg |= 16777215 & l.DEFAULT_ATTR_DATA.fg) : 49 === i ? (s.bg &= -67108864, s.bg |= 16777215 & l.DEFAULT_ATTR_DATA.bg) : 38 === i || 48 === i || 58 === i ? r += this._extractColor(e, r, s) : 53 === i ? s.bg |= 1073741824 : 55 === i ? s.bg &= -1073741825 : 59 === i ? (s.extended = s.extended.clone(), s.extended.underlineColor = -1, s.updateExtended()) : 100 === i ? (s.fg &= -67108864, s.fg |= 16777215 & l.DEFAULT_ATTR_DATA.fg, s.bg &= -67108864, s.bg |= 16777215 & l.DEFAULT_ATTR_DATA.bg) : this._logService.debug("Unknown SGR attribute: %d.", i);
								return !0;
							}
							deviceStatus(e) {
								switch (e.params[0]) {
									case 5:
										this._coreService.triggerDataEvent(`${n.C0.ESC}[0n`);
										break;
									case 6:
										const e = this._activeBuffer.y + 1, t = this._activeBuffer.x + 1;
										this._coreService.triggerDataEvent(`${n.C0.ESC}[${e};${t}R`);
								}
								return !0;
							}
							deviceStatusPrivate(e) {
								if (6 === e.params[0]) {
									const e = this._activeBuffer.y + 1, t = this._activeBuffer.x + 1;
									this._coreService.triggerDataEvent(`${n.C0.ESC}[?${e};${t}R`);
								}
								return !0;
							}
							softReset(e) {
								return this._coreService.isCursorHidden = !1, this._onRequestSyncScrollBar.fire(), this._activeBuffer.scrollTop = 0, this._activeBuffer.scrollBottom = this._bufferService.rows - 1, this._curAttrData = l.DEFAULT_ATTR_DATA.clone(), this._coreService.reset(), this._charsetService.reset(), this._activeBuffer.savedX = 0, this._activeBuffer.savedY = this._activeBuffer.ybase, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, this._coreService.decPrivateModes.origin = !1, !0;
							}
							setCursorStyle(e) {
								const t = e.params[0] || 1;
								switch (t) {
									case 1:
									case 2:
										this._optionsService.options.cursorStyle = "block";
										break;
									case 3:
									case 4:
										this._optionsService.options.cursorStyle = "underline";
										break;
									case 5:
									case 6: this._optionsService.options.cursorStyle = "bar";
								}
								const i = t % 2 == 1;
								return this._optionsService.options.cursorBlink = i, !0;
							}
							setScrollRegion(e) {
								const t = e.params[0] || 1;
								let i;
								return (e.length < 2 || (i = e.params[1]) > this._bufferService.rows || 0 === i) && (i = this._bufferService.rows), i > t && (this._activeBuffer.scrollTop = t - 1, this._activeBuffer.scrollBottom = i - 1, this._setCursor(0, 0)), !0;
							}
							windowOptions(e) {
								if (!w(e.params[0], this._optionsService.rawOptions.windowOptions)) return !0;
								const t = e.length > 1 ? e.params[1] : 0;
								switch (e.params[0]) {
									case 14:
										2 !== t && this._onRequestWindowsOptionsReport.fire(y.GET_WIN_SIZE_PIXELS);
										break;
									case 16:
										this._onRequestWindowsOptionsReport.fire(y.GET_CELL_SIZE_PIXELS);
										break;
									case 18:
										this._bufferService && this._coreService.triggerDataEvent(`${n.C0.ESC}[8;${this._bufferService.rows};${this._bufferService.cols}t`);
										break;
									case 22:
										0 !== t && 2 !== t || (this._windowTitleStack.push(this._windowTitle), this._windowTitleStack.length > 10 && this._windowTitleStack.shift()), 0 !== t && 1 !== t || (this._iconNameStack.push(this._iconName), this._iconNameStack.length > 10 && this._iconNameStack.shift());
										break;
									case 23: 0 !== t && 2 !== t || this._windowTitleStack.length && this.setTitle(this._windowTitleStack.pop()), 0 !== t && 1 !== t || this._iconNameStack.length && this.setIconName(this._iconNameStack.pop());
								}
								return !0;
							}
							saveCursor(e) {
								return this._activeBuffer.savedX = this._activeBuffer.x, this._activeBuffer.savedY = this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.savedCurAttrData.fg = this._curAttrData.fg, this._activeBuffer.savedCurAttrData.bg = this._curAttrData.bg, this._activeBuffer.savedCharset = this._charsetService.charset, !0;
							}
							restoreCursor(e) {
								return this._activeBuffer.x = this._activeBuffer.savedX || 0, this._activeBuffer.y = Math.max(this._activeBuffer.savedY - this._activeBuffer.ybase, 0), this._curAttrData.fg = this._activeBuffer.savedCurAttrData.fg, this._curAttrData.bg = this._activeBuffer.savedCurAttrData.bg, this._charsetService.charset = this._savedCharset, this._activeBuffer.savedCharset && (this._charsetService.charset = this._activeBuffer.savedCharset), this._restrictCursor(), !0;
							}
							setTitle(e) {
								return this._windowTitle = e, this._onTitleChange.fire(e), !0;
							}
							setIconName(e) {
								return this._iconName = e, !0;
							}
							setOrReportIndexedColor(e) {
								const t = [], i = e.split(";");
								for (; i.length > 1;) {
									const e = i.shift(), s = i.shift();
									if (/^\d+$/.exec(e)) {
										const i = parseInt(e);
										if (D(i)) if ("?" === s) t.push({
											type: 0,
											index: i
										});
										else {
											const e = (0, S.parseColor)(s);
											e && t.push({
												type: 1,
												index: i,
												color: e
											});
										}
									}
								}
								return t.length && this._onColor.fire(t), !0;
							}
							setHyperlink(e) {
								const t = e.split(";");
								return !(t.length < 2) && (t[1] ? this._createHyperlink(t[0], t[1]) : !t[0] && this._finishHyperlink());
							}
							_createHyperlink(e, t) {
								this._getCurrentLinkId() && this._finishHyperlink();
								const i = e.split(":");
								let s;
								const r = i.findIndex(((e) => e.startsWith("id=")));
								return -1 !== r && (s = i[r].slice(3) || void 0), this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = this._oscLinkService.registerLink({
									id: s,
									uri: t
								}), this._curAttrData.updateExtended(), !0;
							}
							_finishHyperlink() {
								return this._curAttrData.extended = this._curAttrData.extended.clone(), this._curAttrData.extended.urlId = 0, this._curAttrData.updateExtended(), !0;
							}
							_setOrReportSpecialColor(e, t) {
								const i = e.split(";");
								for (let e = 0; e < i.length && !(t >= this._specialColors.length); ++e, ++t) if ("?" === i[e]) this._onColor.fire([{
									type: 0,
									index: this._specialColors[t]
								}]);
								else {
									const s = (0, S.parseColor)(i[e]);
									s && this._onColor.fire([{
										type: 1,
										index: this._specialColors[t],
										color: s
									}]);
								}
								return !0;
							}
							setOrReportFgColor(e) {
								return this._setOrReportSpecialColor(e, 0);
							}
							setOrReportBgColor(e) {
								return this._setOrReportSpecialColor(e, 1);
							}
							setOrReportCursorColor(e) {
								return this._setOrReportSpecialColor(e, 2);
							}
							restoreIndexedColor(e) {
								if (!e) return this._onColor.fire([{ type: 2 }]), !0;
								const t = [], i = e.split(";");
								for (let e = 0; e < i.length; ++e) if (/^\d+$/.exec(i[e])) {
									const s = parseInt(i[e]);
									D(s) && t.push({
										type: 2,
										index: s
									});
								}
								return t.length && this._onColor.fire(t), !0;
							}
							restoreFgColor(e) {
								return this._onColor.fire([{
									type: 2,
									index: 256
								}]), !0;
							}
							restoreBgColor(e) {
								return this._onColor.fire([{
									type: 2,
									index: 257
								}]), !0;
							}
							restoreCursorColor(e) {
								return this._onColor.fire([{
									type: 2,
									index: 258
								}]), !0;
							}
							nextLine() {
								return this._activeBuffer.x = 0, this.index(), !0;
							}
							keypadApplicationMode() {
								return this._logService.debug("Serial port requested application keypad."), this._coreService.decPrivateModes.applicationKeypad = !0, this._onRequestSyncScrollBar.fire(), !0;
							}
							keypadNumericMode() {
								return this._logService.debug("Switching back to normal keypad."), this._coreService.decPrivateModes.applicationKeypad = !1, this._onRequestSyncScrollBar.fire(), !0;
							}
							selectDefaultCharset() {
								return this._charsetService.setgLevel(0), this._charsetService.setgCharset(0, o.DEFAULT_CHARSET), !0;
							}
							selectCharset(e) {
								return 2 !== e.length ? (this.selectDefaultCharset(), !0) : ("/" === e[0] || this._charsetService.setgCharset(C[e[0]], o.CHARSETS[e[1]] || o.DEFAULT_CHARSET), !0);
							}
							index() {
								return this._restrictCursor(), this._activeBuffer.y++, this._activeBuffer.y === this._activeBuffer.scrollBottom + 1 ? (this._activeBuffer.y--, this._bufferService.scroll(this._eraseAttrData())) : this._activeBuffer.y >= this._bufferService.rows && (this._activeBuffer.y = this._bufferService.rows - 1), this._restrictCursor(), !0;
							}
							tabSet() {
								return this._activeBuffer.tabs[this._activeBuffer.x] = !0, !0;
							}
							reverseIndex() {
								if (this._restrictCursor(), this._activeBuffer.y === this._activeBuffer.scrollTop) {
									const e = this._activeBuffer.scrollBottom - this._activeBuffer.scrollTop;
									this._activeBuffer.lines.shiftElements(this._activeBuffer.ybase + this._activeBuffer.y, e, 1), this._activeBuffer.lines.set(this._activeBuffer.ybase + this._activeBuffer.y, this._activeBuffer.getBlankLine(this._eraseAttrData())), this._dirtyRowTracker.markRangeDirty(this._activeBuffer.scrollTop, this._activeBuffer.scrollBottom);
								} else this._activeBuffer.y--, this._restrictCursor();
								return !0;
							}
							fullReset() {
								return this._parser.reset(), this._onRequestReset.fire(), !0;
							}
							reset() {
								this._curAttrData = l.DEFAULT_ATTR_DATA.clone(), this._eraseAttrDataInternal = l.DEFAULT_ATTR_DATA.clone();
							}
							_eraseAttrData() {
								return this._eraseAttrDataInternal.bg &= -67108864, this._eraseAttrDataInternal.bg |= 67108863 & this._curAttrData.bg, this._eraseAttrDataInternal;
							}
							setgLevel(e) {
								return this._charsetService.setgLevel(e), !0;
							}
							screenAlignmentPattern() {
								const e = new u.CellData();
								e.content = 1 << 22 | "E".charCodeAt(0), e.fg = this._curAttrData.fg, e.bg = this._curAttrData.bg, this._setCursor(0, 0);
								for (let t = 0; t < this._bufferService.rows; ++t) {
									const i = this._activeBuffer.ybase + this._activeBuffer.y + t, s = this._activeBuffer.lines.get(i);
									s && (s.fill(e), s.isWrapped = !1);
								}
								return this._dirtyRowTracker.markAllDirty(), this._setCursor(0, 0), !0;
							}
							requestStatusString(e, t) {
								const i = this._bufferService.buffer, s = this._optionsService.rawOptions;
								return ((e) => (this._coreService.triggerDataEvent(`${n.C0.ESC}${e}${n.C0.ESC}\\`), !0))("\"q" === e ? `P1$r${this._curAttrData.isProtected() ? 1 : 0}"q` : "\"p" === e ? "P1$r61;1\"p" : "r" === e ? `P1$r${i.scrollTop + 1};${i.scrollBottom + 1}r` : "m" === e ? "P1$r0m" : " q" === e ? `P1$r${{
									block: 2,
									underline: 4,
									bar: 6
								}[s.cursorStyle] - (s.cursorBlink ? 1 : 0)} q` : "P0$r");
							}
							markRangeDirty(e, t) {
								this._dirtyRowTracker.markRangeDirty(e, t);
							}
						}
						t.InputHandler = k;
						let L = class {
							constructor(e) {
								this._bufferService = e, this.clearRange();
							}
							clearRange() {
								this.start = this._bufferService.buffer.y, this.end = this._bufferService.buffer.y;
							}
							markDirty(e) {
								e < this.start ? this.start = e : e > this.end && (this.end = e);
							}
							markRangeDirty(e, t) {
								e > t && (E = e, e = t, t = E), e < this.start && (this.start = e), t > this.end && (this.end = t);
							}
							markAllDirty() {
								this.markRangeDirty(0, this._bufferService.rows - 1);
							}
						};
						function D(e) {
							return 0 <= e && e < 256;
						}
						L = s([r(0, v.IBufferService)], L);
					},
					844: (e, t) => {
						function i(e) {
							for (const t of e) t.dispose();
							e.length = 0;
						}
						Object.defineProperty(t, "__esModule", { value: !0 }), t.getDisposeArrayDisposable = t.disposeArray = t.toDisposable = t.MutableDisposable = t.Disposable = void 0, t.Disposable = class {
							constructor() {
								this._disposables = [], this._isDisposed = !1;
							}
							dispose() {
								this._isDisposed = !0;
								for (const e of this._disposables) e.dispose();
								this._disposables.length = 0;
							}
							register(e) {
								return this._disposables.push(e), e;
							}
							unregister(e) {
								const t = this._disposables.indexOf(e);
								-1 !== t && this._disposables.splice(t, 1);
							}
						}, t.MutableDisposable = class {
							constructor() {
								this._isDisposed = !1;
							}
							get value() {
								return this._isDisposed ? void 0 : this._value;
							}
							set value(e) {
								this._isDisposed || e === this._value || (this._value?.dispose(), this._value = e);
							}
							clear() {
								this.value = void 0;
							}
							dispose() {
								this._isDisposed = !0, this._value?.dispose(), this._value = void 0;
							}
						}, t.toDisposable = function(e) {
							return { dispose: e };
						}, t.disposeArray = i, t.getDisposeArrayDisposable = function(e) {
							return { dispose: () => i(e) };
						};
					},
					1505: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.FourKeyMap = t.TwoKeyMap = void 0;
						class i {
							constructor() {
								this._data = {};
							}
							set(e, t, i) {
								this._data[e] || (this._data[e] = {}), this._data[e][t] = i;
							}
							get(e, t) {
								return this._data[e] ? this._data[e][t] : void 0;
							}
							clear() {
								this._data = {};
							}
						}
						t.TwoKeyMap = i, t.FourKeyMap = class {
							constructor() {
								this._data = new i();
							}
							set(e, t, s, r, n) {
								this._data.get(e, t) || this._data.set(e, t, new i()), this._data.get(e, t).set(s, r, n);
							}
							get(e, t, i, s) {
								return this._data.get(e, t)?.get(i, s);
							}
							clear() {
								this._data.clear();
							}
						};
					},
					6114: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.isChromeOS = t.isLinux = t.isWindows = t.isIphone = t.isIpad = t.isMac = t.getSafariVersion = t.isSafari = t.isLegacyEdge = t.isFirefox = t.isNode = void 0, t.isNode = "undefined" != typeof process && "title" in process;
						const i = t.isNode ? "node" : navigator.userAgent, s = t.isNode ? "node" : navigator.platform;
						t.isFirefox = i.includes("Firefox"), t.isLegacyEdge = i.includes("Edge"), t.isSafari = /^((?!chrome|android).)*safari/i.test(i), t.getSafariVersion = function() {
							if (!t.isSafari) return 0;
							const e = i.match(/Version\/(\d+)/);
							return null === e || e.length < 2 ? 0 : parseInt(e[1]);
						}, t.isMac = [
							"Macintosh",
							"MacIntel",
							"MacPPC",
							"Mac68K"
						].includes(s), t.isIpad = "iPad" === s, t.isIphone = "iPhone" === s, t.isWindows = [
							"Windows",
							"Win16",
							"Win32",
							"WinCE"
						].includes(s), t.isLinux = s.indexOf("Linux") >= 0, t.isChromeOS = /\bCrOS\b/.test(i);
					},
					6106: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.SortedList = void 0;
						let i = 0;
						t.SortedList = class {
							constructor(e) {
								this._getKey = e, this._array = [];
							}
							clear() {
								this._array.length = 0;
							}
							insert(e) {
								0 !== this._array.length ? (i = this._search(this._getKey(e)), this._array.splice(i, 0, e)) : this._array.push(e);
							}
							delete(e) {
								if (0 === this._array.length) return !1;
								const t = this._getKey(e);
								if (void 0 === t) return !1;
								if (i = this._search(t), -1 === i) return !1;
								if (this._getKey(this._array[i]) !== t) return !1;
								do
									if (this._array[i] === e) return this._array.splice(i, 1), !0;
								while (++i < this._array.length && this._getKey(this._array[i]) === t);
								return !1;
							}
							*getKeyIterator(e) {
								if (0 !== this._array.length && (i = this._search(e), !(i < 0 || i >= this._array.length) && this._getKey(this._array[i]) === e)) do
									yield this._array[i];
								while (++i < this._array.length && this._getKey(this._array[i]) === e);
							}
							forEachByKey(e, t) {
								if (0 !== this._array.length && (i = this._search(e), !(i < 0 || i >= this._array.length) && this._getKey(this._array[i]) === e)) do
									t(this._array[i]);
								while (++i < this._array.length && this._getKey(this._array[i]) === e);
							}
							values() {
								return [...this._array].values();
							}
							_search(e) {
								let t = 0, i = this._array.length - 1;
								for (; i >= t;) {
									let s = t + i >> 1;
									const r = this._getKey(this._array[s]);
									if (r > e) i = s - 1;
									else {
										if (!(r < e)) {
											for (; s > 0 && this._getKey(this._array[s - 1]) === e;) s--;
											return s;
										}
										t = s + 1;
									}
								}
								return t;
							}
						};
					},
					7226: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DebouncedIdleTask = t.IdleTaskQueue = t.PriorityTaskQueue = void 0;
						const s = i(6114);
						class r {
							constructor() {
								this._tasks = [], this._i = 0;
							}
							enqueue(e) {
								this._tasks.push(e), this._start();
							}
							flush() {
								for (; this._i < this._tasks.length;) this._tasks[this._i]() || this._i++;
								this.clear();
							}
							clear() {
								this._idleCallback && (this._cancelCallback(this._idleCallback), this._idleCallback = void 0), this._i = 0, this._tasks.length = 0;
							}
							_start() {
								this._idleCallback || (this._idleCallback = this._requestCallback(this._process.bind(this)));
							}
							_process(e) {
								this._idleCallback = void 0;
								let t = 0, i = 0, s = e.timeRemaining(), r = 0;
								for (; this._i < this._tasks.length;) {
									if (t = Date.now(), this._tasks[this._i]() || this._i++, t = Math.max(1, Date.now() - t), i = Math.max(t, i), r = e.timeRemaining(), 1.5 * i > r) return s - t < -20 && console.warn(`task queue exceeded allotted deadline by ${Math.abs(Math.round(s - t))}ms`), void this._start();
									s = r;
								}
								this.clear();
							}
						}
						class n extends r {
							_requestCallback(e) {
								return setTimeout((() => e(this._createDeadline(16))));
							}
							_cancelCallback(e) {
								clearTimeout(e);
							}
							_createDeadline(e) {
								const t = Date.now() + e;
								return { timeRemaining: () => Math.max(0, t - Date.now()) };
							}
						}
						t.PriorityTaskQueue = n, t.IdleTaskQueue = !s.isNode && "requestIdleCallback" in window ? class extends r {
							_requestCallback(e) {
								return requestIdleCallback(e);
							}
							_cancelCallback(e) {
								cancelIdleCallback(e);
							}
						} : n, t.DebouncedIdleTask = class {
							constructor() {
								this._queue = new t.IdleTaskQueue();
							}
							set(e) {
								this._queue.clear(), this._queue.enqueue(e);
							}
							flush() {
								this._queue.flush();
							}
						};
					},
					9282: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.updateWindowsModeWrappedState = void 0;
						const s = i(643);
						t.updateWindowsModeWrappedState = function(e) {
							const i = e.buffer.lines.get(e.buffer.ybase + e.buffer.y - 1)?.get(e.cols - 1), r = e.buffer.lines.get(e.buffer.ybase + e.buffer.y);
							r && i && (r.isWrapped = i[s.CHAR_DATA_CODE_INDEX] !== s.NULL_CELL_CODE && i[s.CHAR_DATA_CODE_INDEX] !== s.WHITESPACE_CELL_CODE);
						};
					},
					3734: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ExtendedAttrs = t.AttributeData = void 0;
						class i {
							constructor() {
								this.fg = 0, this.bg = 0, this.extended = new s();
							}
							static toColorRGB(e) {
								return [
									e >>> 16 & 255,
									e >>> 8 & 255,
									255 & e
								];
							}
							static fromColorRGB(e) {
								return (255 & e[0]) << 16 | (255 & e[1]) << 8 | 255 & e[2];
							}
							clone() {
								const e = new i();
								return e.fg = this.fg, e.bg = this.bg, e.extended = this.extended.clone(), e;
							}
							isInverse() {
								return 67108864 & this.fg;
							}
							isBold() {
								return 134217728 & this.fg;
							}
							isUnderline() {
								return this.hasExtendedAttrs() && 0 !== this.extended.underlineStyle ? 1 : 268435456 & this.fg;
							}
							isBlink() {
								return 536870912 & this.fg;
							}
							isInvisible() {
								return 1073741824 & this.fg;
							}
							isItalic() {
								return 67108864 & this.bg;
							}
							isDim() {
								return 134217728 & this.bg;
							}
							isStrikethrough() {
								return 2147483648 & this.fg;
							}
							isProtected() {
								return 536870912 & this.bg;
							}
							isOverline() {
								return 1073741824 & this.bg;
							}
							getFgColorMode() {
								return 50331648 & this.fg;
							}
							getBgColorMode() {
								return 50331648 & this.bg;
							}
							isFgRGB() {
								return 50331648 == (50331648 & this.fg);
							}
							isBgRGB() {
								return 50331648 == (50331648 & this.bg);
							}
							isFgPalette() {
								return 16777216 == (50331648 & this.fg) || 33554432 == (50331648 & this.fg);
							}
							isBgPalette() {
								return 16777216 == (50331648 & this.bg) || 33554432 == (50331648 & this.bg);
							}
							isFgDefault() {
								return 0 == (50331648 & this.fg);
							}
							isBgDefault() {
								return 0 == (50331648 & this.bg);
							}
							isAttributeDefault() {
								return 0 === this.fg && 0 === this.bg;
							}
							getFgColor() {
								switch (50331648 & this.fg) {
									case 16777216:
									case 33554432: return 255 & this.fg;
									case 50331648: return 16777215 & this.fg;
									default: return -1;
								}
							}
							getBgColor() {
								switch (50331648 & this.bg) {
									case 16777216:
									case 33554432: return 255 & this.bg;
									case 50331648: return 16777215 & this.bg;
									default: return -1;
								}
							}
							hasExtendedAttrs() {
								return 268435456 & this.bg;
							}
							updateExtended() {
								this.extended.isEmpty() ? this.bg &= -268435457 : this.bg |= 268435456;
							}
							getUnderlineColor() {
								if (268435456 & this.bg && ~this.extended.underlineColor) switch (50331648 & this.extended.underlineColor) {
									case 16777216:
									case 33554432: return 255 & this.extended.underlineColor;
									case 50331648: return 16777215 & this.extended.underlineColor;
									default: return this.getFgColor();
								}
								return this.getFgColor();
							}
							getUnderlineColorMode() {
								return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 & this.extended.underlineColor : this.getFgColorMode();
							}
							isUnderlineColorRGB() {
								return 268435456 & this.bg && ~this.extended.underlineColor ? 50331648 == (50331648 & this.extended.underlineColor) : this.isFgRGB();
							}
							isUnderlineColorPalette() {
								return 268435456 & this.bg && ~this.extended.underlineColor ? 16777216 == (50331648 & this.extended.underlineColor) || 33554432 == (50331648 & this.extended.underlineColor) : this.isFgPalette();
							}
							isUnderlineColorDefault() {
								return 268435456 & this.bg && ~this.extended.underlineColor ? 0 == (50331648 & this.extended.underlineColor) : this.isFgDefault();
							}
							getUnderlineStyle() {
								return 268435456 & this.fg ? 268435456 & this.bg ? this.extended.underlineStyle : 1 : 0;
							}
							getUnderlineVariantOffset() {
								return this.extended.underlineVariantOffset;
							}
						}
						t.AttributeData = i;
						class s {
							get ext() {
								return this._urlId ? -469762049 & this._ext | this.underlineStyle << 26 : this._ext;
							}
							set ext(e) {
								this._ext = e;
							}
							get underlineStyle() {
								return this._urlId ? 5 : (469762048 & this._ext) >> 26;
							}
							set underlineStyle(e) {
								this._ext &= -469762049, this._ext |= e << 26 & 469762048;
							}
							get underlineColor() {
								return 67108863 & this._ext;
							}
							set underlineColor(e) {
								this._ext &= -67108864, this._ext |= 67108863 & e;
							}
							get urlId() {
								return this._urlId;
							}
							set urlId(e) {
								this._urlId = e;
							}
							get underlineVariantOffset() {
								const e = (3758096384 & this._ext) >> 29;
								return e < 0 ? 4294967288 ^ e : e;
							}
							set underlineVariantOffset(e) {
								this._ext &= 536870911, this._ext |= e << 29 & 3758096384;
							}
							constructor(e = 0, t = 0) {
								this._ext = 0, this._urlId = 0, this._ext = e, this._urlId = t;
							}
							clone() {
								return new s(this._ext, this._urlId);
							}
							isEmpty() {
								return 0 === this.underlineStyle && 0 === this._urlId;
							}
						}
						t.ExtendedAttrs = s;
					},
					9092: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Buffer = t.MAX_BUFFER_SIZE = void 0;
						const s = i(6349), r = i(7226), n = i(3734), o = i(8437), a = i(4634), h = i(511), c = i(643), l = i(4863), d = i(7116);
						t.MAX_BUFFER_SIZE = 4294967295, t.Buffer = class {
							constructor(e, t, i) {
								this._hasScrollback = e, this._optionsService = t, this._bufferService = i, this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.tabs = {}, this.savedY = 0, this.savedX = 0, this.savedCurAttrData = o.DEFAULT_ATTR_DATA.clone(), this.savedCharset = d.DEFAULT_CHARSET, this.markers = [], this._nullCell = h.CellData.fromCharData([
									0,
									c.NULL_CELL_CHAR,
									c.NULL_CELL_WIDTH,
									c.NULL_CELL_CODE
								]), this._whitespaceCell = h.CellData.fromCharData([
									0,
									c.WHITESPACE_CELL_CHAR,
									c.WHITESPACE_CELL_WIDTH,
									c.WHITESPACE_CELL_CODE
								]), this._isClearing = !1, this._memoryCleanupQueue = new r.IdleTaskQueue(), this._memoryCleanupPosition = 0, this._cols = this._bufferService.cols, this._rows = this._bufferService.rows, this.lines = new s.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
							}
							getNullCell(e) {
								return e ? (this._nullCell.fg = e.fg, this._nullCell.bg = e.bg, this._nullCell.extended = e.extended) : (this._nullCell.fg = 0, this._nullCell.bg = 0, this._nullCell.extended = new n.ExtendedAttrs()), this._nullCell;
							}
							getWhitespaceCell(e) {
								return e ? (this._whitespaceCell.fg = e.fg, this._whitespaceCell.bg = e.bg, this._whitespaceCell.extended = e.extended) : (this._whitespaceCell.fg = 0, this._whitespaceCell.bg = 0, this._whitespaceCell.extended = new n.ExtendedAttrs()), this._whitespaceCell;
							}
							getBlankLine(e, t) {
								return new o.BufferLine(this._bufferService.cols, this.getNullCell(e), t);
							}
							get hasScrollback() {
								return this._hasScrollback && this.lines.maxLength > this._rows;
							}
							get isCursorInViewport() {
								const e = this.ybase + this.y - this.ydisp;
								return e >= 0 && e < this._rows;
							}
							_getCorrectBufferLength(e) {
								if (!this._hasScrollback) return e;
								const i = e + this._optionsService.rawOptions.scrollback;
								return i > t.MAX_BUFFER_SIZE ? t.MAX_BUFFER_SIZE : i;
							}
							fillViewportRows(e) {
								if (0 === this.lines.length) {
									void 0 === e && (e = o.DEFAULT_ATTR_DATA);
									let t = this._rows;
									for (; t--;) this.lines.push(this.getBlankLine(e));
								}
							}
							clear() {
								this.ydisp = 0, this.ybase = 0, this.y = 0, this.x = 0, this.lines = new s.CircularList(this._getCorrectBufferLength(this._rows)), this.scrollTop = 0, this.scrollBottom = this._rows - 1, this.setupTabStops();
							}
							resize(e, t) {
								const i = this.getNullCell(o.DEFAULT_ATTR_DATA);
								let s = 0;
								const r = this._getCorrectBufferLength(t);
								if (r > this.lines.maxLength && (this.lines.maxLength = r), this.lines.length > 0) {
									if (this._cols < e) for (let t = 0; t < this.lines.length; t++) s += +this.lines.get(t).resize(e, i);
									let n = 0;
									if (this._rows < t) for (let s = this._rows; s < t; s++) this.lines.length < t + this.ybase && (this._optionsService.rawOptions.windowsMode || void 0 !== this._optionsService.rawOptions.windowsPty.backend || void 0 !== this._optionsService.rawOptions.windowsPty.buildNumber ? this.lines.push(new o.BufferLine(e, i)) : this.ybase > 0 && this.lines.length <= this.ybase + this.y + n + 1 ? (this.ybase--, n++, this.ydisp > 0 && this.ydisp--) : this.lines.push(new o.BufferLine(e, i)));
									else for (let e = this._rows; e > t; e--) this.lines.length > t + this.ybase && (this.lines.length > this.ybase + this.y + 1 ? this.lines.pop() : (this.ybase++, this.ydisp++));
									if (r < this.lines.maxLength) {
										const e = this.lines.length - r;
										e > 0 && (this.lines.trimStart(e), this.ybase = Math.max(this.ybase - e, 0), this.ydisp = Math.max(this.ydisp - e, 0), this.savedY = Math.max(this.savedY - e, 0)), this.lines.maxLength = r;
									}
									this.x = Math.min(this.x, e - 1), this.y = Math.min(this.y, t - 1), n && (this.y += n), this.savedX = Math.min(this.savedX, e - 1), this.scrollTop = 0;
								}
								if (this.scrollBottom = t - 1, this._isReflowEnabled && (this._reflow(e, t), this._cols > e)) for (let t = 0; t < this.lines.length; t++) s += +this.lines.get(t).resize(e, i);
								this._cols = e, this._rows = t, this._memoryCleanupQueue.clear(), s > .1 * this.lines.length && (this._memoryCleanupPosition = 0, this._memoryCleanupQueue.enqueue((() => this._batchedMemoryCleanup())));
							}
							_batchedMemoryCleanup() {
								let e = !0;
								this._memoryCleanupPosition >= this.lines.length && (this._memoryCleanupPosition = 0, e = !1);
								let t = 0;
								for (; this._memoryCleanupPosition < this.lines.length;) if (t += this.lines.get(this._memoryCleanupPosition++).cleanupMemory(), t > 100) return !0;
								return e;
							}
							get _isReflowEnabled() {
								const e = this._optionsService.rawOptions.windowsPty;
								return e && e.buildNumber ? this._hasScrollback && "conpty" === e.backend && e.buildNumber >= 21376 : this._hasScrollback && !this._optionsService.rawOptions.windowsMode;
							}
							_reflow(e, t) {
								this._cols !== e && (e > this._cols ? this._reflowLarger(e, t) : this._reflowSmaller(e, t));
							}
							_reflowLarger(e, t) {
								const i = (0, a.reflowLargerGetLinesToRemove)(this.lines, this._cols, e, this.ybase + this.y, this.getNullCell(o.DEFAULT_ATTR_DATA));
								if (i.length > 0) {
									const s = (0, a.reflowLargerCreateNewLayout)(this.lines, i);
									(0, a.reflowLargerApplyNewLayout)(this.lines, s.layout), this._reflowLargerAdjustViewport(e, t, s.countRemoved);
								}
							}
							_reflowLargerAdjustViewport(e, t, i) {
								const s = this.getNullCell(o.DEFAULT_ATTR_DATA);
								let r = i;
								for (; r-- > 0;) 0 === this.ybase ? (this.y > 0 && this.y--, this.lines.length < t && this.lines.push(new o.BufferLine(e, s))) : (this.ydisp === this.ybase && this.ydisp--, this.ybase--);
								this.savedY = Math.max(this.savedY - i, 0);
							}
							_reflowSmaller(e, t) {
								const i = this.getNullCell(o.DEFAULT_ATTR_DATA), s = [];
								let r = 0;
								for (let n = this.lines.length - 1; n >= 0; n--) {
									let h = this.lines.get(n);
									if (!h || !h.isWrapped && h.getTrimmedLength() <= e) continue;
									const c = [h];
									for (; h.isWrapped && n > 0;) h = this.lines.get(--n), c.unshift(h);
									const l = this.ybase + this.y;
									if (l >= n && l < n + c.length) continue;
									const d = c[c.length - 1].getTrimmedLength(), _ = (0, a.reflowSmallerGetNewLineLengths)(c, this._cols, e), u = _.length - c.length;
									let f;
									f = 0 === this.ybase && this.y !== this.lines.length - 1 ? Math.max(0, this.y - this.lines.maxLength + u) : Math.max(0, this.lines.length - this.lines.maxLength + u);
									const v = [];
									for (let e = 0; e < u; e++) {
										const e = this.getBlankLine(o.DEFAULT_ATTR_DATA, !0);
										v.push(e);
									}
									v.length > 0 && (s.push({
										start: n + c.length + r,
										newLines: v
									}), r += v.length), c.push(...v);
									let p = _.length - 1, g = _[p];
									0 === g && (p--, g = _[p]);
									let m = c.length - u - 1, S = d;
									for (; m >= 0;) {
										const e = Math.min(S, g);
										if (void 0 === c[p]) break;
										if (c[p].copyCellsFrom(c[m], S - e, g - e, e, !0), g -= e, 0 === g && (p--, g = _[p]), S -= e, 0 === S) {
											m--;
											const e = Math.max(m, 0);
											S = (0, a.getWrappedLineTrimmedLength)(c, e, this._cols);
										}
									}
									for (let t = 0; t < c.length; t++) _[t] < e && c[t].setCell(_[t], i);
									let C = u - f;
									for (; C-- > 0;) 0 === this.ybase ? this.y < t - 1 ? (this.y++, this.lines.pop()) : (this.ybase++, this.ydisp++) : this.ybase < Math.min(this.lines.maxLength, this.lines.length + r) - t && (this.ybase === this.ydisp && this.ydisp++, this.ybase++);
									this.savedY = Math.min(this.savedY + u, this.ybase + t - 1);
								}
								if (s.length > 0) {
									const e = [], t = [];
									for (let e = 0; e < this.lines.length; e++) t.push(this.lines.get(e));
									const i = this.lines.length;
									let n = i - 1, o = 0, a = s[o];
									this.lines.length = Math.min(this.lines.maxLength, this.lines.length + r);
									let h = 0;
									for (let c = Math.min(this.lines.maxLength - 1, i + r - 1); c >= 0; c--) if (a && a.start > n + h) {
										for (let e = a.newLines.length - 1; e >= 0; e--) this.lines.set(c--, a.newLines[e]);
										c++, e.push({
											index: n + 1,
											amount: a.newLines.length
										}), h += a.newLines.length, a = s[++o];
									} else this.lines.set(c, t[n--]);
									let c = 0;
									for (let t = e.length - 1; t >= 0; t--) e[t].index += c, this.lines.onInsertEmitter.fire(e[t]), c += e[t].amount;
									const l = Math.max(0, i + r - this.lines.maxLength);
									l > 0 && this.lines.onTrimEmitter.fire(l);
								}
							}
							translateBufferLineToString(e, t, i = 0, s) {
								const r = this.lines.get(e);
								return r ? r.translateToString(t, i, s) : "";
							}
							getWrappedRangeForLine(e) {
								let t = e, i = e;
								for (; t > 0 && this.lines.get(t).isWrapped;) t--;
								for (; i + 1 < this.lines.length && this.lines.get(i + 1).isWrapped;) i++;
								return {
									first: t,
									last: i
								};
							}
							setupTabStops(e) {
								for (null != e ? this.tabs[e] || (e = this.prevStop(e)) : (this.tabs = {}, e = 0); e < this._cols; e += this._optionsService.rawOptions.tabStopWidth) this.tabs[e] = !0;
							}
							prevStop(e) {
								for (e ??= this.x; !this.tabs[--e] && e > 0;);
								return e >= this._cols ? this._cols - 1 : e < 0 ? 0 : e;
							}
							nextStop(e) {
								for (e ??= this.x; !this.tabs[++e] && e < this._cols;);
								return e >= this._cols ? this._cols - 1 : e < 0 ? 0 : e;
							}
							clearMarkers(e) {
								this._isClearing = !0;
								for (let t = 0; t < this.markers.length; t++) this.markers[t].line === e && (this.markers[t].dispose(), this.markers.splice(t--, 1));
								this._isClearing = !1;
							}
							clearAllMarkers() {
								this._isClearing = !0;
								for (let e = 0; e < this.markers.length; e++) this.markers[e].dispose(), this.markers.splice(e--, 1);
								this._isClearing = !1;
							}
							addMarker(e) {
								const t = new l.Marker(e);
								return this.markers.push(t), t.register(this.lines.onTrim(((e) => {
									t.line -= e, t.line < 0 && t.dispose();
								}))), t.register(this.lines.onInsert(((e) => {
									t.line >= e.index && (t.line += e.amount);
								}))), t.register(this.lines.onDelete(((e) => {
									t.line >= e.index && t.line < e.index + e.amount && t.dispose(), t.line > e.index && (t.line -= e.amount);
								}))), t.register(t.onDispose((() => this._removeMarker(t)))), t;
							}
							_removeMarker(e) {
								this._isClearing || this.markers.splice(this.markers.indexOf(e), 1);
							}
						};
					},
					8437: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferLine = t.DEFAULT_ATTR_DATA = void 0;
						const s = i(3734), r = i(511), n = i(643), o = i(482);
						t.DEFAULT_ATTR_DATA = Object.freeze(new s.AttributeData());
						let a = 0;
						class h {
							constructor(e, t, i = !1) {
								this.isWrapped = i, this._combined = {}, this._extendedAttrs = {}, this._data = new Uint32Array(3 * e);
								const s = t || r.CellData.fromCharData([
									0,
									n.NULL_CELL_CHAR,
									n.NULL_CELL_WIDTH,
									n.NULL_CELL_CODE
								]);
								for (let t = 0; t < e; ++t) this.setCell(t, s);
								this.length = e;
							}
							get(e) {
								const t = this._data[3 * e + 0], i = 2097151 & t;
								return [
									this._data[3 * e + 1],
									2097152 & t ? this._combined[e] : i ? (0, o.stringFromCodePoint)(i) : "",
									t >> 22,
									2097152 & t ? this._combined[e].charCodeAt(this._combined[e].length - 1) : i
								];
							}
							set(e, t) {
								this._data[3 * e + 1] = t[n.CHAR_DATA_ATTR_INDEX], t[n.CHAR_DATA_CHAR_INDEX].length > 1 ? (this._combined[e] = t[1], this._data[3 * e + 0] = 2097152 | e | t[n.CHAR_DATA_WIDTH_INDEX] << 22) : this._data[3 * e + 0] = t[n.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | t[n.CHAR_DATA_WIDTH_INDEX] << 22;
							}
							getWidth(e) {
								return this._data[3 * e + 0] >> 22;
							}
							hasWidth(e) {
								return 12582912 & this._data[3 * e + 0];
							}
							getFg(e) {
								return this._data[3 * e + 1];
							}
							getBg(e) {
								return this._data[3 * e + 2];
							}
							hasContent(e) {
								return 4194303 & this._data[3 * e + 0];
							}
							getCodePoint(e) {
								const t = this._data[3 * e + 0];
								return 2097152 & t ? this._combined[e].charCodeAt(this._combined[e].length - 1) : 2097151 & t;
							}
							isCombined(e) {
								return 2097152 & this._data[3 * e + 0];
							}
							getString(e) {
								const t = this._data[3 * e + 0];
								return 2097152 & t ? this._combined[e] : 2097151 & t ? (0, o.stringFromCodePoint)(2097151 & t) : "";
							}
							isProtected(e) {
								return 536870912 & this._data[3 * e + 2];
							}
							loadCell(e, t) {
								return a = 3 * e, t.content = this._data[a + 0], t.fg = this._data[a + 1], t.bg = this._data[a + 2], 2097152 & t.content && (t.combinedData = this._combined[e]), 268435456 & t.bg && (t.extended = this._extendedAttrs[e]), t;
							}
							setCell(e, t) {
								2097152 & t.content && (this._combined[e] = t.combinedData), 268435456 & t.bg && (this._extendedAttrs[e] = t.extended), this._data[3 * e + 0] = t.content, this._data[3 * e + 1] = t.fg, this._data[3 * e + 2] = t.bg;
							}
							setCellFromCodepoint(e, t, i, s) {
								268435456 & s.bg && (this._extendedAttrs[e] = s.extended), this._data[3 * e + 0] = t | i << 22, this._data[3 * e + 1] = s.fg, this._data[3 * e + 2] = s.bg;
							}
							addCodepointToCell(e, t, i) {
								let s = this._data[3 * e + 0];
								2097152 & s ? this._combined[e] += (0, o.stringFromCodePoint)(t) : 2097151 & s ? (this._combined[e] = (0, o.stringFromCodePoint)(2097151 & s) + (0, o.stringFromCodePoint)(t), s &= -2097152, s |= 2097152) : s = t | 1 << 22, i && (s &= -12582913, s |= i << 22), this._data[3 * e + 0] = s;
							}
							insertCells(e, t, i) {
								if ((e %= this.length) && 2 === this.getWidth(e - 1) && this.setCellFromCodepoint(e - 1, 0, 1, i), t < this.length - e) {
									const s = new r.CellData();
									for (let i = this.length - e - t - 1; i >= 0; --i) this.setCell(e + t + i, this.loadCell(e + i, s));
									for (let s = 0; s < t; ++s) this.setCell(e + s, i);
								} else for (let t = e; t < this.length; ++t) this.setCell(t, i);
								2 === this.getWidth(this.length - 1) && this.setCellFromCodepoint(this.length - 1, 0, 1, i);
							}
							deleteCells(e, t, i) {
								if (e %= this.length, t < this.length - e) {
									const s = new r.CellData();
									for (let i = 0; i < this.length - e - t; ++i) this.setCell(e + i, this.loadCell(e + t + i, s));
									for (let e = this.length - t; e < this.length; ++e) this.setCell(e, i);
								} else for (let t = e; t < this.length; ++t) this.setCell(t, i);
								e && 2 === this.getWidth(e - 1) && this.setCellFromCodepoint(e - 1, 0, 1, i), 0 !== this.getWidth(e) || this.hasContent(e) || this.setCellFromCodepoint(e, 0, 1, i);
							}
							replaceCells(e, t, i, s = !1) {
								if (s) for (e && 2 === this.getWidth(e - 1) && !this.isProtected(e - 1) && this.setCellFromCodepoint(e - 1, 0, 1, i), t < this.length && 2 === this.getWidth(t - 1) && !this.isProtected(t) && this.setCellFromCodepoint(t, 0, 1, i); e < t && e < this.length;) this.isProtected(e) || this.setCell(e, i), e++;
								else for (e && 2 === this.getWidth(e - 1) && this.setCellFromCodepoint(e - 1, 0, 1, i), t < this.length && 2 === this.getWidth(t - 1) && this.setCellFromCodepoint(t, 0, 1, i); e < t && e < this.length;) this.setCell(e++, i);
							}
							resize(e, t) {
								if (e === this.length) return 4 * this._data.length * 2 < this._data.buffer.byteLength;
								const i = 3 * e;
								if (e > this.length) {
									if (this._data.buffer.byteLength >= 4 * i) this._data = new Uint32Array(this._data.buffer, 0, i);
									else {
										const e = new Uint32Array(i);
										e.set(this._data), this._data = e;
									}
									for (let i = this.length; i < e; ++i) this.setCell(i, t);
								} else {
									this._data = this._data.subarray(0, i);
									const t = Object.keys(this._combined);
									for (let i = 0; i < t.length; i++) {
										const s = parseInt(t[i], 10);
										s >= e && delete this._combined[s];
									}
									const s = Object.keys(this._extendedAttrs);
									for (let t = 0; t < s.length; t++) {
										const i = parseInt(s[t], 10);
										i >= e && delete this._extendedAttrs[i];
									}
								}
								return this.length = e, 4 * i * 2 < this._data.buffer.byteLength;
							}
							cleanupMemory() {
								if (4 * this._data.length * 2 < this._data.buffer.byteLength) {
									const e = new Uint32Array(this._data.length);
									return e.set(this._data), this._data = e, 1;
								}
								return 0;
							}
							fill(e, t = !1) {
								if (t) for (let t = 0; t < this.length; ++t) this.isProtected(t) || this.setCell(t, e);
								else {
									this._combined = {}, this._extendedAttrs = {};
									for (let t = 0; t < this.length; ++t) this.setCell(t, e);
								}
							}
							copyFrom(e) {
								this.length !== e.length ? this._data = new Uint32Array(e._data) : this._data.set(e._data), this.length = e.length, this._combined = {};
								for (const t in e._combined) this._combined[t] = e._combined[t];
								this._extendedAttrs = {};
								for (const t in e._extendedAttrs) this._extendedAttrs[t] = e._extendedAttrs[t];
								this.isWrapped = e.isWrapped;
							}
							clone() {
								const e = new h(0);
								e._data = new Uint32Array(this._data), e.length = this.length;
								for (const t in this._combined) e._combined[t] = this._combined[t];
								for (const t in this._extendedAttrs) e._extendedAttrs[t] = this._extendedAttrs[t];
								return e.isWrapped = this.isWrapped, e;
							}
							getTrimmedLength() {
								for (let e = this.length - 1; e >= 0; --e) if (4194303 & this._data[3 * e + 0]) return e + (this._data[3 * e + 0] >> 22);
								return 0;
							}
							getNoBgTrimmedLength() {
								for (let e = this.length - 1; e >= 0; --e) if (4194303 & this._data[3 * e + 0] || 50331648 & this._data[3 * e + 2]) return e + (this._data[3 * e + 0] >> 22);
								return 0;
							}
							copyCellsFrom(e, t, i, s, r) {
								const n = e._data;
								if (r) for (let r = s - 1; r >= 0; r--) {
									for (let e = 0; e < 3; e++) this._data[3 * (i + r) + e] = n[3 * (t + r) + e];
									268435456 & n[3 * (t + r) + 2] && (this._extendedAttrs[i + r] = e._extendedAttrs[t + r]);
								}
								else for (let r = 0; r < s; r++) {
									for (let e = 0; e < 3; e++) this._data[3 * (i + r) + e] = n[3 * (t + r) + e];
									268435456 & n[3 * (t + r) + 2] && (this._extendedAttrs[i + r] = e._extendedAttrs[t + r]);
								}
								const o = Object.keys(e._combined);
								for (let s = 0; s < o.length; s++) {
									const r = parseInt(o[s], 10);
									r >= t && (this._combined[r - t + i] = e._combined[r]);
								}
							}
							translateToString(e, t, i, s) {
								t = t ?? 0, i = i ?? this.length, e && (i = Math.min(i, this.getTrimmedLength())), s && (s.length = 0);
								let r = "";
								for (; t < i;) {
									const e = this._data[3 * t + 0], i = 2097151 & e, a = 2097152 & e ? this._combined[t] : i ? (0, o.stringFromCodePoint)(i) : n.WHITESPACE_CELL_CHAR;
									if (r += a, s) for (let e = 0; e < a.length; ++e) s.push(t);
									t += e >> 22 || 1;
								}
								return s && s.push(t), r;
							}
						}
						t.BufferLine = h;
					},
					4841: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.getRangeLength = void 0, t.getRangeLength = function(e, t) {
							if (e.start.y > e.end.y) throw new Error(`Buffer range end (${e.end.x}, ${e.end.y}) cannot be before start (${e.start.x}, ${e.start.y})`);
							return t * (e.end.y - e.start.y) + (e.end.x - e.start.x + 1);
						};
					},
					4634: (e, t) => {
						function i(e, t, i) {
							if (t === e.length - 1) return e[t].getTrimmedLength();
							const s = !e[t].hasContent(i - 1) && 1 === e[t].getWidth(i - 1), r = 2 === e[t + 1].getWidth(0);
							return s && r ? i - 1 : i;
						}
						Object.defineProperty(t, "__esModule", { value: !0 }), t.getWrappedLineTrimmedLength = t.reflowSmallerGetNewLineLengths = t.reflowLargerApplyNewLayout = t.reflowLargerCreateNewLayout = t.reflowLargerGetLinesToRemove = void 0, t.reflowLargerGetLinesToRemove = function(e, t, s, r, n) {
							const o = [];
							for (let a = 0; a < e.length - 1; a++) {
								let h = a, c = e.get(++h);
								if (!c.isWrapped) continue;
								const l = [e.get(a)];
								for (; h < e.length && c.isWrapped;) l.push(c), c = e.get(++h);
								if (r >= a && r < h) {
									a += l.length - 1;
									continue;
								}
								let d = 0, _ = i(l, d, t), u = 1, f = 0;
								for (; u < l.length;) {
									const e = i(l, u, t), r = e - f, o = s - _, a = Math.min(r, o);
									l[d].copyCellsFrom(l[u], f, _, a, !1), _ += a, _ === s && (d++, _ = 0), f += a, f === e && (u++, f = 0), 0 === _ && 0 !== d && 2 === l[d - 1].getWidth(s - 1) && (l[d].copyCellsFrom(l[d - 1], s - 1, _++, 1, !1), l[d - 1].setCell(s - 1, n));
								}
								l[d].replaceCells(_, s, n);
								let v = 0;
								for (let e = l.length - 1; e > 0 && (e > d || 0 === l[e].getTrimmedLength()); e--) v++;
								v > 0 && (o.push(a + l.length - v), o.push(v)), a += l.length - 1;
							}
							return o;
						}, t.reflowLargerCreateNewLayout = function(e, t) {
							const i = [];
							let s = 0, r = t[s], n = 0;
							for (let o = 0; o < e.length; o++) if (r === o) {
								const i = t[++s];
								e.onDeleteEmitter.fire({
									index: o - n,
									amount: i
								}), o += i - 1, n += i, r = t[++s];
							} else i.push(o);
							return {
								layout: i,
								countRemoved: n
							};
						}, t.reflowLargerApplyNewLayout = function(e, t) {
							const i = [];
							for (let s = 0; s < t.length; s++) i.push(e.get(t[s]));
							for (let t = 0; t < i.length; t++) e.set(t, i[t]);
							e.length = t.length;
						}, t.reflowSmallerGetNewLineLengths = function(e, t, s) {
							const r = [], n = e.map(((s, r) => i(e, r, t))).reduce(((e, t) => e + t));
							let o = 0, a = 0, h = 0;
							for (; h < n;) {
								if (n - h < s) {
									r.push(n - h);
									break;
								}
								o += s;
								const c = i(e, a, t);
								o > c && (o -= c, a++);
								const l = 2 === e[a].getWidth(o - 1);
								l && o--;
								const d = l ? s - 1 : s;
								r.push(d), h += d;
							}
							return r;
						}, t.getWrappedLineTrimmedLength = i;
					},
					5295: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferSet = void 0;
						const s = i(8460), r = i(844), n = i(9092);
						class o extends r.Disposable {
							constructor(e, t) {
								super(), this._optionsService = e, this._bufferService = t, this._onBufferActivate = this.register(new s.EventEmitter()), this.onBufferActivate = this._onBufferActivate.event, this.reset(), this.register(this._optionsService.onSpecificOptionChange("scrollback", (() => this.resize(this._bufferService.cols, this._bufferService.rows)))), this.register(this._optionsService.onSpecificOptionChange("tabStopWidth", (() => this.setupTabStops())));
							}
							reset() {
								this._normal = new n.Buffer(!0, this._optionsService, this._bufferService), this._normal.fillViewportRows(), this._alt = new n.Buffer(!1, this._optionsService, this._bufferService), this._activeBuffer = this._normal, this._onBufferActivate.fire({
									activeBuffer: this._normal,
									inactiveBuffer: this._alt
								}), this.setupTabStops();
							}
							get alt() {
								return this._alt;
							}
							get active() {
								return this._activeBuffer;
							}
							get normal() {
								return this._normal;
							}
							activateNormalBuffer() {
								this._activeBuffer !== this._normal && (this._normal.x = this._alt.x, this._normal.y = this._alt.y, this._alt.clearAllMarkers(), this._alt.clear(), this._activeBuffer = this._normal, this._onBufferActivate.fire({
									activeBuffer: this._normal,
									inactiveBuffer: this._alt
								}));
							}
							activateAltBuffer(e) {
								this._activeBuffer !== this._alt && (this._alt.fillViewportRows(e), this._alt.x = this._normal.x, this._alt.y = this._normal.y, this._activeBuffer = this._alt, this._onBufferActivate.fire({
									activeBuffer: this._alt,
									inactiveBuffer: this._normal
								}));
							}
							resize(e, t) {
								this._normal.resize(e, t), this._alt.resize(e, t), this.setupTabStops(e);
							}
							setupTabStops(e) {
								this._normal.setupTabStops(e), this._alt.setupTabStops(e);
							}
						}
						t.BufferSet = o;
					},
					511: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CellData = void 0;
						const s = i(482), r = i(643), n = i(3734);
						class o extends n.AttributeData {
							constructor() {
								super(...arguments), this.content = 0, this.fg = 0, this.bg = 0, this.extended = new n.ExtendedAttrs(), this.combinedData = "";
							}
							static fromCharData(e) {
								const t = new o();
								return t.setFromCharData(e), t;
							}
							isCombined() {
								return 2097152 & this.content;
							}
							getWidth() {
								return this.content >> 22;
							}
							getChars() {
								return 2097152 & this.content ? this.combinedData : 2097151 & this.content ? (0, s.stringFromCodePoint)(2097151 & this.content) : "";
							}
							getCode() {
								return this.isCombined() ? this.combinedData.charCodeAt(this.combinedData.length - 1) : 2097151 & this.content;
							}
							setFromCharData(e) {
								this.fg = e[r.CHAR_DATA_ATTR_INDEX], this.bg = 0;
								let t = !1;
								if (e[r.CHAR_DATA_CHAR_INDEX].length > 2) t = !0;
								else if (2 === e[r.CHAR_DATA_CHAR_INDEX].length) {
									const i = e[r.CHAR_DATA_CHAR_INDEX].charCodeAt(0);
									if (55296 <= i && i <= 56319) {
										const s = e[r.CHAR_DATA_CHAR_INDEX].charCodeAt(1);
										56320 <= s && s <= 57343 ? this.content = 1024 * (i - 55296) + s - 56320 + 65536 | e[r.CHAR_DATA_WIDTH_INDEX] << 22 : t = !0;
									} else t = !0;
								} else this.content = e[r.CHAR_DATA_CHAR_INDEX].charCodeAt(0) | e[r.CHAR_DATA_WIDTH_INDEX] << 22;
								t && (this.combinedData = e[r.CHAR_DATA_CHAR_INDEX], this.content = 2097152 | e[r.CHAR_DATA_WIDTH_INDEX] << 22);
							}
							getAsCharData() {
								return [
									this.fg,
									this.getChars(),
									this.getWidth(),
									this.getCode()
								];
							}
						}
						t.CellData = o;
					},
					643: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.WHITESPACE_CELL_CODE = t.WHITESPACE_CELL_WIDTH = t.WHITESPACE_CELL_CHAR = t.NULL_CELL_CODE = t.NULL_CELL_WIDTH = t.NULL_CELL_CHAR = t.CHAR_DATA_CODE_INDEX = t.CHAR_DATA_WIDTH_INDEX = t.CHAR_DATA_CHAR_INDEX = t.CHAR_DATA_ATTR_INDEX = t.DEFAULT_EXT = t.DEFAULT_ATTR = t.DEFAULT_COLOR = void 0, t.DEFAULT_COLOR = 0, t.DEFAULT_ATTR = 256 | t.DEFAULT_COLOR << 9, t.DEFAULT_EXT = 0, t.CHAR_DATA_ATTR_INDEX = 0, t.CHAR_DATA_CHAR_INDEX = 1, t.CHAR_DATA_WIDTH_INDEX = 2, t.CHAR_DATA_CODE_INDEX = 3, t.NULL_CELL_CHAR = "", t.NULL_CELL_WIDTH = 1, t.NULL_CELL_CODE = 0, t.WHITESPACE_CELL_CHAR = " ", t.WHITESPACE_CELL_WIDTH = 1, t.WHITESPACE_CELL_CODE = 32;
					},
					4863: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Marker = void 0;
						const s = i(8460), r = i(844);
						class n {
							get id() {
								return this._id;
							}
							constructor(e) {
								this.line = e, this.isDisposed = !1, this._disposables = [], this._id = n._nextId++, this._onDispose = this.register(new s.EventEmitter()), this.onDispose = this._onDispose.event;
							}
							dispose() {
								this.isDisposed || (this.isDisposed = !0, this.line = -1, this._onDispose.fire(), (0, r.disposeArray)(this._disposables), this._disposables.length = 0);
							}
							register(e) {
								return this._disposables.push(e), e;
							}
						}
						t.Marker = n, n._nextId = 1;
					},
					7116: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DEFAULT_CHARSET = t.CHARSETS = void 0, t.CHARSETS = {}, t.DEFAULT_CHARSET = t.CHARSETS.B, t.CHARSETS[0] = {
							"`": "◆",
							a: "▒",
							b: "␉",
							c: "␌",
							d: "␍",
							e: "␊",
							f: "°",
							g: "±",
							h: "␤",
							i: "␋",
							j: "┘",
							k: "┐",
							l: "┌",
							m: "└",
							n: "┼",
							o: "⎺",
							p: "⎻",
							q: "─",
							r: "⎼",
							s: "⎽",
							t: "├",
							u: "┤",
							v: "┴",
							w: "┬",
							x: "│",
							y: "≤",
							z: "≥",
							"{": "π",
							"|": "≠",
							"}": "£",
							"~": "·"
						}, t.CHARSETS.A = { "#": "£" }, t.CHARSETS.B = void 0, t.CHARSETS[4] = {
							"#": "£",
							"@": "¾",
							"[": "ij",
							"\\": "½",
							"]": "|",
							"{": "¨",
							"|": "f",
							"}": "¼",
							"~": "´"
						}, t.CHARSETS.C = t.CHARSETS[5] = {
							"[": "Ä",
							"\\": "Ö",
							"]": "Å",
							"^": "Ü",
							"`": "é",
							"{": "ä",
							"|": "ö",
							"}": "å",
							"~": "ü"
						}, t.CHARSETS.R = {
							"#": "£",
							"@": "à",
							"[": "°",
							"\\": "ç",
							"]": "§",
							"{": "é",
							"|": "ù",
							"}": "è",
							"~": "¨"
						}, t.CHARSETS.Q = {
							"@": "à",
							"[": "â",
							"\\": "ç",
							"]": "ê",
							"^": "î",
							"`": "ô",
							"{": "é",
							"|": "ù",
							"}": "è",
							"~": "û"
						}, t.CHARSETS.K = {
							"@": "§",
							"[": "Ä",
							"\\": "Ö",
							"]": "Ü",
							"{": "ä",
							"|": "ö",
							"}": "ü",
							"~": "ß"
						}, t.CHARSETS.Y = {
							"#": "£",
							"@": "§",
							"[": "°",
							"\\": "ç",
							"]": "é",
							"`": "ù",
							"{": "à",
							"|": "ò",
							"}": "è",
							"~": "ì"
						}, t.CHARSETS.E = t.CHARSETS[6] = {
							"@": "Ä",
							"[": "Æ",
							"\\": "Ø",
							"]": "Å",
							"^": "Ü",
							"`": "ä",
							"{": "æ",
							"|": "ø",
							"}": "å",
							"~": "ü"
						}, t.CHARSETS.Z = {
							"#": "£",
							"@": "§",
							"[": "¡",
							"\\": "Ñ",
							"]": "¿",
							"{": "°",
							"|": "ñ",
							"}": "ç"
						}, t.CHARSETS.H = t.CHARSETS[7] = {
							"@": "É",
							"[": "Ä",
							"\\": "Ö",
							"]": "Å",
							"^": "Ü",
							"`": "é",
							"{": "ä",
							"|": "ö",
							"}": "å",
							"~": "ü"
						}, t.CHARSETS["="] = {
							"#": "ù",
							"@": "à",
							"[": "é",
							"\\": "ç",
							"]": "ê",
							"^": "î",
							_: "è",
							"`": "ô",
							"{": "ä",
							"|": "ö",
							"}": "ü",
							"~": "û"
						};
					},
					2584: (e, t) => {
						var i, s, r;
						Object.defineProperty(t, "__esModule", { value: !0 }), t.C1_ESCAPED = t.C1 = t.C0 = void 0, function(e) {
							e.NUL = "\0", e.SOH = "", e.STX = "", e.ETX = "", e.EOT = "", e.ENQ = "", e.ACK = "", e.BEL = "\x07", e.BS = "\b", e.HT = "	", e.LF = "\n", e.VT = "\v", e.FF = "\f", e.CR = "\r", e.SO = "", e.SI = "", e.DLE = "", e.DC1 = "", e.DC2 = "", e.DC3 = "", e.DC4 = "", e.NAK = "", e.SYN = "", e.ETB = "", e.CAN = "", e.EM = "", e.SUB = "", e.ESC = "\x1B", e.FS = "", e.GS = "", e.RS = "", e.US = "", e.SP = " ", e.DEL = "";
						}(i || (t.C0 = i = {})), function(e) {
							e.PAD = "", e.HOP = "", e.BPH = "", e.NBH = "", e.IND = "", e.NEL = "", e.SSA = "", e.ESA = "", e.HTS = "", e.HTJ = "", e.VTS = "", e.PLD = "", e.PLU = "", e.RI = "", e.SS2 = "", e.SS3 = "", e.DCS = "", e.PU1 = "", e.PU2 = "", e.STS = "", e.CCH = "", e.MW = "", e.SPA = "", e.EPA = "", e.SOS = "", e.SGCI = "", e.SCI = "", e.CSI = "", e.ST = "", e.OSC = "", e.PM = "", e.APC = "";
						}(s || (t.C1 = s = {})), function(e) {
							e.ST = `${i.ESC}\\`;
						}(r || (t.C1_ESCAPED = r = {}));
					},
					7399: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.evaluateKeyboardEvent = void 0;
						const s = i(2584), r = {
							48: ["0", ")"],
							49: ["1", "!"],
							50: ["2", "@"],
							51: ["3", "#"],
							52: ["4", "$"],
							53: ["5", "%"],
							54: ["6", "^"],
							55: ["7", "&"],
							56: ["8", "*"],
							57: ["9", "("],
							186: [";", ":"],
							187: ["=", "+"],
							188: [",", "<"],
							189: ["-", "_"],
							190: [".", ">"],
							191: ["/", "?"],
							192: ["`", "~"],
							219: ["[", "{"],
							220: ["\\", "|"],
							221: ["]", "}"],
							222: ["'", "\""]
						};
						t.evaluateKeyboardEvent = function(e, t, i, n) {
							const o = {
								type: 0,
								cancel: !1,
								key: void 0
							}, a = (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0) | (e.metaKey ? 8 : 0);
							switch (e.keyCode) {
								case 0:
									"UIKeyInputUpArrow" === e.key ? o.key = t ? s.C0.ESC + "OA" : s.C0.ESC + "[A" : "UIKeyInputLeftArrow" === e.key ? o.key = t ? s.C0.ESC + "OD" : s.C0.ESC + "[D" : "UIKeyInputRightArrow" === e.key ? o.key = t ? s.C0.ESC + "OC" : s.C0.ESC + "[C" : "UIKeyInputDownArrow" === e.key && (o.key = t ? s.C0.ESC + "OB" : s.C0.ESC + "[B");
									break;
								case 8:
									o.key = e.ctrlKey ? "\b" : s.C0.DEL, e.altKey && (o.key = s.C0.ESC + o.key);
									break;
								case 9:
									if (e.shiftKey) {
										o.key = s.C0.ESC + "[Z";
										break;
									}
									o.key = s.C0.HT, o.cancel = !0;
									break;
								case 13:
									o.key = e.altKey ? s.C0.ESC + s.C0.CR : s.C0.CR, o.cancel = !0;
									break;
								case 27:
									o.key = s.C0.ESC, e.altKey && (o.key = s.C0.ESC + s.C0.ESC), o.cancel = !0;
									break;
								case 37:
									if (e.metaKey) break;
									a ? (o.key = s.C0.ESC + "[1;" + (a + 1) + "D", o.key === s.C0.ESC + "[1;3D" && (o.key = s.C0.ESC + (i ? "b" : "[1;5D"))) : o.key = t ? s.C0.ESC + "OD" : s.C0.ESC + "[D";
									break;
								case 39:
									if (e.metaKey) break;
									a ? (o.key = s.C0.ESC + "[1;" + (a + 1) + "C", o.key === s.C0.ESC + "[1;3C" && (o.key = s.C0.ESC + (i ? "f" : "[1;5C"))) : o.key = t ? s.C0.ESC + "OC" : s.C0.ESC + "[C";
									break;
								case 38:
									if (e.metaKey) break;
									a ? (o.key = s.C0.ESC + "[1;" + (a + 1) + "A", i || o.key !== s.C0.ESC + "[1;3A" || (o.key = s.C0.ESC + "[1;5A")) : o.key = t ? s.C0.ESC + "OA" : s.C0.ESC + "[A";
									break;
								case 40:
									if (e.metaKey) break;
									a ? (o.key = s.C0.ESC + "[1;" + (a + 1) + "B", i || o.key !== s.C0.ESC + "[1;3B" || (o.key = s.C0.ESC + "[1;5B")) : o.key = t ? s.C0.ESC + "OB" : s.C0.ESC + "[B";
									break;
								case 45:
									e.shiftKey || e.ctrlKey || (o.key = s.C0.ESC + "[2~");
									break;
								case 46:
									o.key = a ? s.C0.ESC + "[3;" + (a + 1) + "~" : s.C0.ESC + "[3~";
									break;
								case 36:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "H" : t ? s.C0.ESC + "OH" : s.C0.ESC + "[H";
									break;
								case 35:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "F" : t ? s.C0.ESC + "OF" : s.C0.ESC + "[F";
									break;
								case 33:
									e.shiftKey ? o.type = 2 : e.ctrlKey ? o.key = s.C0.ESC + "[5;" + (a + 1) + "~" : o.key = s.C0.ESC + "[5~";
									break;
								case 34:
									e.shiftKey ? o.type = 3 : e.ctrlKey ? o.key = s.C0.ESC + "[6;" + (a + 1) + "~" : o.key = s.C0.ESC + "[6~";
									break;
								case 112:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "P" : s.C0.ESC + "OP";
									break;
								case 113:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "Q" : s.C0.ESC + "OQ";
									break;
								case 114:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "R" : s.C0.ESC + "OR";
									break;
								case 115:
									o.key = a ? s.C0.ESC + "[1;" + (a + 1) + "S" : s.C0.ESC + "OS";
									break;
								case 116:
									o.key = a ? s.C0.ESC + "[15;" + (a + 1) + "~" : s.C0.ESC + "[15~";
									break;
								case 117:
									o.key = a ? s.C0.ESC + "[17;" + (a + 1) + "~" : s.C0.ESC + "[17~";
									break;
								case 118:
									o.key = a ? s.C0.ESC + "[18;" + (a + 1) + "~" : s.C0.ESC + "[18~";
									break;
								case 119:
									o.key = a ? s.C0.ESC + "[19;" + (a + 1) + "~" : s.C0.ESC + "[19~";
									break;
								case 120:
									o.key = a ? s.C0.ESC + "[20;" + (a + 1) + "~" : s.C0.ESC + "[20~";
									break;
								case 121:
									o.key = a ? s.C0.ESC + "[21;" + (a + 1) + "~" : s.C0.ESC + "[21~";
									break;
								case 122:
									o.key = a ? s.C0.ESC + "[23;" + (a + 1) + "~" : s.C0.ESC + "[23~";
									break;
								case 123:
									o.key = a ? s.C0.ESC + "[24;" + (a + 1) + "~" : s.C0.ESC + "[24~";
									break;
								default: if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) if (i && !n || !e.altKey || e.metaKey) !i || e.altKey || e.ctrlKey || e.shiftKey || !e.metaKey ? e.key && !e.ctrlKey && !e.altKey && !e.metaKey && e.keyCode >= 48 && 1 === e.key.length ? o.key = e.key : e.key && e.ctrlKey && ("_" === e.key && (o.key = s.C0.US), "@" === e.key && (o.key = s.C0.NUL)) : 65 === e.keyCode && (o.type = 1);
								else {
									const i = r[e.keyCode]?.[e.shiftKey ? 1 : 0];
									if (i) o.key = s.C0.ESC + i;
									else if (e.keyCode >= 65 && e.keyCode <= 90) {
										const t = e.ctrlKey ? e.keyCode - 64 : e.keyCode + 32;
										let i = String.fromCharCode(t);
										e.shiftKey && (i = i.toUpperCase()), o.key = s.C0.ESC + i;
									} else if (32 === e.keyCode) o.key = s.C0.ESC + (e.ctrlKey ? s.C0.NUL : " ");
									else if ("Dead" === e.key && e.code.startsWith("Key")) {
										let t = e.code.slice(3, 4);
										e.shiftKey || (t = t.toLowerCase()), o.key = s.C0.ESC + t, o.cancel = !0;
									}
								}
								else e.keyCode >= 65 && e.keyCode <= 90 ? o.key = String.fromCharCode(e.keyCode - 64) : 32 === e.keyCode ? o.key = s.C0.NUL : e.keyCode >= 51 && e.keyCode <= 55 ? o.key = String.fromCharCode(e.keyCode - 51 + 27) : 56 === e.keyCode ? o.key = s.C0.DEL : 219 === e.keyCode ? o.key = s.C0.ESC : 220 === e.keyCode ? o.key = s.C0.FS : 221 === e.keyCode && (o.key = s.C0.GS);
							}
							return o;
						};
					},
					482: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Utf8ToUtf32 = t.StringToUtf32 = t.utf32ToString = t.stringFromCodePoint = void 0, t.stringFromCodePoint = function(e) {
							return e > 65535 ? (e -= 65536, String.fromCharCode(55296 + (e >> 10)) + String.fromCharCode(e % 1024 + 56320)) : String.fromCharCode(e);
						}, t.utf32ToString = function(e, t = 0, i = e.length) {
							let s = "";
							for (let r = t; r < i; ++r) {
								let t = e[r];
								t > 65535 ? (t -= 65536, s += String.fromCharCode(55296 + (t >> 10)) + String.fromCharCode(t % 1024 + 56320)) : s += String.fromCharCode(t);
							}
							return s;
						}, t.StringToUtf32 = class {
							constructor() {
								this._interim = 0;
							}
							clear() {
								this._interim = 0;
							}
							decode(e, t) {
								const i = e.length;
								if (!i) return 0;
								let s = 0, r = 0;
								if (this._interim) {
									const i = e.charCodeAt(r++);
									56320 <= i && i <= 57343 ? t[s++] = 1024 * (this._interim - 55296) + i - 56320 + 65536 : (t[s++] = this._interim, t[s++] = i), this._interim = 0;
								}
								for (let n = r; n < i; ++n) {
									const r = e.charCodeAt(n);
									if (55296 <= r && r <= 56319) {
										if (++n >= i) return this._interim = r, s;
										const o = e.charCodeAt(n);
										56320 <= o && o <= 57343 ? t[s++] = 1024 * (r - 55296) + o - 56320 + 65536 : (t[s++] = r, t[s++] = o);
									} else 65279 !== r && (t[s++] = r);
								}
								return s;
							}
						}, t.Utf8ToUtf32 = class {
							constructor() {
								this.interim = /* @__PURE__ */ new Uint8Array(3);
							}
							clear() {
								this.interim.fill(0);
							}
							decode(e, t) {
								const i = e.length;
								if (!i) return 0;
								let s, r, n, o, a = 0, h = 0, c = 0;
								if (this.interim[0]) {
									let s = !1, r = this.interim[0];
									r &= 192 == (224 & r) ? 31 : 224 == (240 & r) ? 15 : 7;
									let n, o = 0;
									for (; (n = 63 & this.interim[++o]) && o < 4;) r <<= 6, r |= n;
									const h = 192 == (224 & this.interim[0]) ? 2 : 224 == (240 & this.interim[0]) ? 3 : 4, l = h - o;
									for (; c < l;) {
										if (c >= i) return 0;
										if (n = e[c++], 128 != (192 & n)) {
											c--, s = !0;
											break;
										}
										this.interim[o++] = n, r <<= 6, r |= 63 & n;
									}
									s || (2 === h ? r < 128 ? c-- : t[a++] = r : 3 === h ? r < 2048 || r >= 55296 && r <= 57343 || 65279 === r || (t[a++] = r) : r < 65536 || r > 1114111 || (t[a++] = r)), this.interim.fill(0);
								}
								const l = i - 4;
								let d = c;
								for (; d < i;) {
									for (; !(!(d < l) || 128 & (s = e[d]) || 128 & (r = e[d + 1]) || 128 & (n = e[d + 2]) || 128 & (o = e[d + 3]));) t[a++] = s, t[a++] = r, t[a++] = n, t[a++] = o, d += 4;
									if (s = e[d++], s < 128) t[a++] = s;
									else if (192 == (224 & s)) {
										if (d >= i) return this.interim[0] = s, a;
										if (r = e[d++], 128 != (192 & r)) {
											d--;
											continue;
										}
										if (h = (31 & s) << 6 | 63 & r, h < 128) {
											d--;
											continue;
										}
										t[a++] = h;
									} else if (224 == (240 & s)) {
										if (d >= i) return this.interim[0] = s, a;
										if (r = e[d++], 128 != (192 & r)) {
											d--;
											continue;
										}
										if (d >= i) return this.interim[0] = s, this.interim[1] = r, a;
										if (n = e[d++], 128 != (192 & n)) {
											d--;
											continue;
										}
										if (h = (15 & s) << 12 | (63 & r) << 6 | 63 & n, h < 2048 || h >= 55296 && h <= 57343 || 65279 === h) continue;
										t[a++] = h;
									} else if (240 == (248 & s)) {
										if (d >= i) return this.interim[0] = s, a;
										if (r = e[d++], 128 != (192 & r)) {
											d--;
											continue;
										}
										if (d >= i) return this.interim[0] = s, this.interim[1] = r, a;
										if (n = e[d++], 128 != (192 & n)) {
											d--;
											continue;
										}
										if (d >= i) return this.interim[0] = s, this.interim[1] = r, this.interim[2] = n, a;
										if (o = e[d++], 128 != (192 & o)) {
											d--;
											continue;
										}
										if (h = (7 & s) << 18 | (63 & r) << 12 | (63 & n) << 6 | 63 & o, h < 65536 || h > 1114111) continue;
										t[a++] = h;
									}
								}
								return a;
							}
						};
					},
					225: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeV6 = void 0;
						const s = i(1480), r = [
							[768, 879],
							[1155, 1158],
							[1160, 1161],
							[1425, 1469],
							[1471, 1471],
							[1473, 1474],
							[1476, 1477],
							[1479, 1479],
							[1536, 1539],
							[1552, 1557],
							[1611, 1630],
							[1648, 1648],
							[1750, 1764],
							[1767, 1768],
							[1770, 1773],
							[1807, 1807],
							[1809, 1809],
							[1840, 1866],
							[1958, 1968],
							[2027, 2035],
							[2305, 2306],
							[2364, 2364],
							[2369, 2376],
							[2381, 2381],
							[2385, 2388],
							[2402, 2403],
							[2433, 2433],
							[2492, 2492],
							[2497, 2500],
							[2509, 2509],
							[2530, 2531],
							[2561, 2562],
							[2620, 2620],
							[2625, 2626],
							[2631, 2632],
							[2635, 2637],
							[2672, 2673],
							[2689, 2690],
							[2748, 2748],
							[2753, 2757],
							[2759, 2760],
							[2765, 2765],
							[2786, 2787],
							[2817, 2817],
							[2876, 2876],
							[2879, 2879],
							[2881, 2883],
							[2893, 2893],
							[2902, 2902],
							[2946, 2946],
							[3008, 3008],
							[3021, 3021],
							[3134, 3136],
							[3142, 3144],
							[3146, 3149],
							[3157, 3158],
							[3260, 3260],
							[3263, 3263],
							[3270, 3270],
							[3276, 3277],
							[3298, 3299],
							[3393, 3395],
							[3405, 3405],
							[3530, 3530],
							[3538, 3540],
							[3542, 3542],
							[3633, 3633],
							[3636, 3642],
							[3655, 3662],
							[3761, 3761],
							[3764, 3769],
							[3771, 3772],
							[3784, 3789],
							[3864, 3865],
							[3893, 3893],
							[3895, 3895],
							[3897, 3897],
							[3953, 3966],
							[3968, 3972],
							[3974, 3975],
							[3984, 3991],
							[3993, 4028],
							[4038, 4038],
							[4141, 4144],
							[4146, 4146],
							[4150, 4151],
							[4153, 4153],
							[4184, 4185],
							[4448, 4607],
							[4959, 4959],
							[5906, 5908],
							[5938, 5940],
							[5970, 5971],
							[6002, 6003],
							[6068, 6069],
							[6071, 6077],
							[6086, 6086],
							[6089, 6099],
							[6109, 6109],
							[6155, 6157],
							[6313, 6313],
							[6432, 6434],
							[6439, 6440],
							[6450, 6450],
							[6457, 6459],
							[6679, 6680],
							[6912, 6915],
							[6964, 6964],
							[6966, 6970],
							[6972, 6972],
							[6978, 6978],
							[7019, 7027],
							[7616, 7626],
							[7678, 7679],
							[8203, 8207],
							[8234, 8238],
							[8288, 8291],
							[8298, 8303],
							[8400, 8431],
							[12330, 12335],
							[12441, 12442],
							[43014, 43014],
							[43019, 43019],
							[43045, 43046],
							[64286, 64286],
							[65024, 65039],
							[65056, 65059],
							[65279, 65279],
							[65529, 65531]
						], n = [
							[68097, 68099],
							[68101, 68102],
							[68108, 68111],
							[68152, 68154],
							[68159, 68159],
							[119143, 119145],
							[119155, 119170],
							[119173, 119179],
							[119210, 119213],
							[119362, 119364],
							[917505, 917505],
							[917536, 917631],
							[917760, 917999]
						];
						let o;
						t.UnicodeV6 = class {
							constructor() {
								if (this.version = "6", !o) {
									o = /* @__PURE__ */ new Uint8Array(65536), o.fill(1), o[0] = 0, o.fill(0, 1, 32), o.fill(0, 127, 160), o.fill(2, 4352, 4448), o[9001] = 2, o[9002] = 2, o.fill(2, 11904, 42192), o[12351] = 1, o.fill(2, 44032, 55204), o.fill(2, 63744, 64256), o.fill(2, 65040, 65050), o.fill(2, 65072, 65136), o.fill(2, 65280, 65377), o.fill(2, 65504, 65511);
									for (let e = 0; e < r.length; ++e) o.fill(0, r[e][0], r[e][1] + 1);
								}
							}
							wcwidth(e) {
								return e < 32 ? 0 : e < 127 ? 1 : e < 65536 ? o[e] : function(e, t) {
									let i, s = 0, r = t.length - 1;
									if (e < t[0][0] || e > t[r][1]) return !1;
									for (; r >= s;) if (i = s + r >> 1, e > t[i][1]) s = i + 1;
									else {
										if (!(e < t[i][0])) return !0;
										r = i - 1;
									}
									return !1;
								}(e, n) ? 0 : e >= 131072 && e <= 196605 || e >= 196608 && e <= 262141 ? 2 : 1;
							}
							charProperties(e, t) {
								let i = this.wcwidth(e), r = 0 === i && 0 !== t;
								if (r) {
									const e = s.UnicodeService.extractWidth(t);
									0 === e ? r = !1 : e > i && (i = e);
								}
								return s.UnicodeService.createPropertyValue(0, i, r);
							}
						};
					},
					5981: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.WriteBuffer = void 0;
						const s = i(8460), r = i(844);
						class n extends r.Disposable {
							constructor(e) {
								super(), this._action = e, this._writeBuffer = [], this._callbacks = [], this._pendingData = 0, this._bufferOffset = 0, this._isSyncWriting = !1, this._syncCalls = 0, this._didUserInput = !1, this._onWriteParsed = this.register(new s.EventEmitter()), this.onWriteParsed = this._onWriteParsed.event;
							}
							handleUserInput() {
								this._didUserInput = !0;
							}
							writeSync(e, t) {
								if (void 0 !== t && this._syncCalls > t) return void (this._syncCalls = 0);
								if (this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(void 0), this._syncCalls++, this._isSyncWriting) return;
								let i;
								for (this._isSyncWriting = !0; i = this._writeBuffer.shift();) {
									this._action(i);
									const e = this._callbacks.shift();
									e && e();
								}
								this._pendingData = 0, this._bufferOffset = 2147483647, this._isSyncWriting = !1, this._syncCalls = 0;
							}
							write(e, t) {
								if (this._pendingData > 5e7) throw new Error("write data discarded, use flow control to avoid losing data");
								if (!this._writeBuffer.length) {
									if (this._bufferOffset = 0, this._didUserInput) return this._didUserInput = !1, this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(t), void this._innerWrite();
									setTimeout((() => this._innerWrite()));
								}
								this._pendingData += e.length, this._writeBuffer.push(e), this._callbacks.push(t);
							}
							_innerWrite(e = 0, t = !0) {
								const i = e || Date.now();
								for (; this._writeBuffer.length > this._bufferOffset;) {
									const e = this._writeBuffer[this._bufferOffset], s = this._action(e, t);
									if (s) {
										const e = (e) => Date.now() - i >= 12 ? setTimeout((() => this._innerWrite(0, e))) : this._innerWrite(i, e);
										s.catch(((e) => (queueMicrotask((() => {
											throw e;
										})), Promise.resolve(!1)))).then(e);
										return;
									}
									const r = this._callbacks[this._bufferOffset];
									if (r && r(), this._bufferOffset++, this._pendingData -= e.length, Date.now() - i >= 12) break;
								}
								this._writeBuffer.length > this._bufferOffset ? (this._bufferOffset > 50 && (this._writeBuffer = this._writeBuffer.slice(this._bufferOffset), this._callbacks = this._callbacks.slice(this._bufferOffset), this._bufferOffset = 0), setTimeout((() => this._innerWrite()))) : (this._writeBuffer.length = 0, this._callbacks.length = 0, this._pendingData = 0, this._bufferOffset = 0), this._onWriteParsed.fire();
							}
						}
						t.WriteBuffer = n;
					},
					5941: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.toRgbString = t.parseColor = void 0;
						const i = /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/, s = /^[\da-f]+$/;
						function r(e, t) {
							const i = e.toString(16), s = i.length < 2 ? "0" + i : i;
							switch (t) {
								case 4: return i[0];
								case 8: return s;
								case 12: return (s + s).slice(0, 3);
								default: return s + s;
							}
						}
						t.parseColor = function(e) {
							if (!e) return;
							let t = e.toLowerCase();
							if (0 === t.indexOf("rgb:")) {
								t = t.slice(4);
								const e = i.exec(t);
								if (e) {
									const t = e[1] ? 15 : e[4] ? 255 : e[7] ? 4095 : 65535;
									return [
										Math.round(parseInt(e[1] || e[4] || e[7] || e[10], 16) / t * 255),
										Math.round(parseInt(e[2] || e[5] || e[8] || e[11], 16) / t * 255),
										Math.round(parseInt(e[3] || e[6] || e[9] || e[12], 16) / t * 255)
									];
								}
							} else if (0 === t.indexOf("#") && (t = t.slice(1), s.exec(t) && [
								3,
								6,
								9,
								12
							].includes(t.length))) {
								const e = t.length / 3, i = [
									0,
									0,
									0
								];
								for (let s = 0; s < 3; ++s) {
									const r = parseInt(t.slice(e * s, e * s + e), 16);
									i[s] = 1 === e ? r << 4 : 2 === e ? r : 3 === e ? r >> 4 : r >> 8;
								}
								return i;
							}
						}, t.toRgbString = function(e, t = 16) {
							const [i, s, n] = e;
							return `rgb:${r(i, t)}/${r(s, t)}/${r(n, t)}`;
						};
					},
					5770: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.PAYLOAD_LIMIT = void 0, t.PAYLOAD_LIMIT = 1e7;
					},
					6351: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DcsHandler = t.DcsParser = void 0;
						const s = i(482), r = i(8742), n = i(5770), o = [];
						t.DcsParser = class {
							constructor() {
								this._handlers = Object.create(null), this._active = o, this._ident = 0, this._handlerFb = () => {}, this._stack = {
									paused: !1,
									loopPosition: 0,
									fallThrough: !1
								};
							}
							dispose() {
								this._handlers = Object.create(null), this._handlerFb = () => {}, this._active = o;
							}
							registerHandler(e, t) {
								void 0 === this._handlers[e] && (this._handlers[e] = []);
								const i = this._handlers[e];
								return i.push(t), { dispose: () => {
									const e = i.indexOf(t);
									-1 !== e && i.splice(e, 1);
								} };
							}
							clearHandler(e) {
								this._handlers[e] && delete this._handlers[e];
							}
							setHandlerFallback(e) {
								this._handlerFb = e;
							}
							reset() {
								if (this._active.length) for (let e = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e >= 0; --e) this._active[e].unhook(!1);
								this._stack.paused = !1, this._active = o, this._ident = 0;
							}
							hook(e, t) {
								if (this.reset(), this._ident = e, this._active = this._handlers[e] || o, this._active.length) for (let e = this._active.length - 1; e >= 0; e--) this._active[e].hook(t);
								else this._handlerFb(this._ident, "HOOK", t);
							}
							put(e, t, i) {
								if (this._active.length) for (let s = this._active.length - 1; s >= 0; s--) this._active[s].put(e, t, i);
								else this._handlerFb(this._ident, "PUT", (0, s.utf32ToString)(e, t, i));
							}
							unhook(e, t = !0) {
								if (this._active.length) {
									let i = !1, s = this._active.length - 1, r = !1;
									if (this._stack.paused && (s = this._stack.loopPosition - 1, i = t, r = this._stack.fallThrough, this._stack.paused = !1), !r && !1 === i) {
										for (; s >= 0 && (i = this._active[s].unhook(e), !0 !== i); s--) if (i instanceof Promise) return this._stack.paused = !0, this._stack.loopPosition = s, this._stack.fallThrough = !1, i;
										s--;
									}
									for (; s >= 0; s--) if (i = this._active[s].unhook(!1), i instanceof Promise) return this._stack.paused = !0, this._stack.loopPosition = s, this._stack.fallThrough = !0, i;
								} else this._handlerFb(this._ident, "UNHOOK", e);
								this._active = o, this._ident = 0;
							}
						};
						const a = new r.Params();
						a.addParam(0), t.DcsHandler = class {
							constructor(e) {
								this._handler = e, this._data = "", this._params = a, this._hitLimit = !1;
							}
							hook(e) {
								this._params = e.length > 1 || e.params[0] ? e.clone() : a, this._data = "", this._hitLimit = !1;
							}
							put(e, t, i) {
								this._hitLimit || (this._data += (0, s.utf32ToString)(e, t, i), this._data.length > n.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = !0));
							}
							unhook(e) {
								let t = !1;
								if (this._hitLimit) t = !1;
								else if (e && (t = this._handler(this._data, this._params), t instanceof Promise)) return t.then(((e) => (this._params = a, this._data = "", this._hitLimit = !1, e)));
								return this._params = a, this._data = "", this._hitLimit = !1, t;
							}
						};
					},
					2015: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.EscapeSequenceParser = t.VT500_TRANSITION_TABLE = t.TransitionTable = void 0;
						const s = i(844), r = i(8742), n = i(6242), o = i(6351);
						class a {
							constructor(e) {
								this.table = new Uint8Array(e);
							}
							setDefault(e, t) {
								this.table.fill(e << 4 | t);
							}
							add(e, t, i, s) {
								this.table[t << 8 | e] = i << 4 | s;
							}
							addMany(e, t, i, s) {
								for (let r = 0; r < e.length; r++) this.table[t << 8 | e[r]] = i << 4 | s;
							}
						}
						t.TransitionTable = a;
						const h = 160;
						t.VT500_TRANSITION_TABLE = function() {
							const e = new a(4095), t = Array.apply(null, Array(256)).map(((e, t) => t)), i = (e, i) => t.slice(e, i), s = i(32, 127), r = i(0, 24);
							r.push(25), r.push.apply(r, i(28, 32));
							const n = i(0, 14);
							let o;
							for (o in e.setDefault(1, 0), e.addMany(s, 0, 2, 0), n) e.addMany([
								24,
								26,
								153,
								154
							], o, 3, 0), e.addMany(i(128, 144), o, 3, 0), e.addMany(i(144, 152), o, 3, 0), e.add(156, o, 0, 0), e.add(27, o, 11, 1), e.add(157, o, 4, 8), e.addMany([
								152,
								158,
								159
							], o, 0, 7), e.add(155, o, 11, 3), e.add(144, o, 11, 9);
							return e.addMany(r, 0, 3, 0), e.addMany(r, 1, 3, 1), e.add(127, 1, 0, 1), e.addMany(r, 8, 0, 8), e.addMany(r, 3, 3, 3), e.add(127, 3, 0, 3), e.addMany(r, 4, 3, 4), e.add(127, 4, 0, 4), e.addMany(r, 6, 3, 6), e.addMany(r, 5, 3, 5), e.add(127, 5, 0, 5), e.addMany(r, 2, 3, 2), e.add(127, 2, 0, 2), e.add(93, 1, 4, 8), e.addMany(s, 8, 5, 8), e.add(127, 8, 5, 8), e.addMany([
								156,
								27,
								24,
								26,
								7
							], 8, 6, 0), e.addMany(i(28, 32), 8, 0, 8), e.addMany([
								88,
								94,
								95
							], 1, 0, 7), e.addMany(s, 7, 0, 7), e.addMany(r, 7, 0, 7), e.add(156, 7, 0, 0), e.add(127, 7, 0, 7), e.add(91, 1, 11, 3), e.addMany(i(64, 127), 3, 7, 0), e.addMany(i(48, 60), 3, 8, 4), e.addMany([
								60,
								61,
								62,
								63
							], 3, 9, 4), e.addMany(i(48, 60), 4, 8, 4), e.addMany(i(64, 127), 4, 7, 0), e.addMany([
								60,
								61,
								62,
								63
							], 4, 0, 6), e.addMany(i(32, 64), 6, 0, 6), e.add(127, 6, 0, 6), e.addMany(i(64, 127), 6, 0, 0), e.addMany(i(32, 48), 3, 9, 5), e.addMany(i(32, 48), 5, 9, 5), e.addMany(i(48, 64), 5, 0, 6), e.addMany(i(64, 127), 5, 7, 0), e.addMany(i(32, 48), 4, 9, 5), e.addMany(i(32, 48), 1, 9, 2), e.addMany(i(32, 48), 2, 9, 2), e.addMany(i(48, 127), 2, 10, 0), e.addMany(i(48, 80), 1, 10, 0), e.addMany(i(81, 88), 1, 10, 0), e.addMany([
								89,
								90,
								92
							], 1, 10, 0), e.addMany(i(96, 127), 1, 10, 0), e.add(80, 1, 11, 9), e.addMany(r, 9, 0, 9), e.add(127, 9, 0, 9), e.addMany(i(28, 32), 9, 0, 9), e.addMany(i(32, 48), 9, 9, 12), e.addMany(i(48, 60), 9, 8, 10), e.addMany([
								60,
								61,
								62,
								63
							], 9, 9, 10), e.addMany(r, 11, 0, 11), e.addMany(i(32, 128), 11, 0, 11), e.addMany(i(28, 32), 11, 0, 11), e.addMany(r, 10, 0, 10), e.add(127, 10, 0, 10), e.addMany(i(28, 32), 10, 0, 10), e.addMany(i(48, 60), 10, 8, 10), e.addMany([
								60,
								61,
								62,
								63
							], 10, 0, 11), e.addMany(i(32, 48), 10, 9, 12), e.addMany(r, 12, 0, 12), e.add(127, 12, 0, 12), e.addMany(i(28, 32), 12, 0, 12), e.addMany(i(32, 48), 12, 9, 12), e.addMany(i(48, 64), 12, 0, 11), e.addMany(i(64, 127), 12, 12, 13), e.addMany(i(64, 127), 10, 12, 13), e.addMany(i(64, 127), 9, 12, 13), e.addMany(r, 13, 13, 13), e.addMany(s, 13, 13, 13), e.add(127, 13, 0, 13), e.addMany([
								27,
								156,
								24,
								26
							], 13, 14, 0), e.add(h, 0, 2, 0), e.add(h, 8, 5, 8), e.add(h, 6, 0, 6), e.add(h, 11, 0, 11), e.add(h, 13, 13, 13), e;
						}();
						class c extends s.Disposable {
							constructor(e = t.VT500_TRANSITION_TABLE) {
								super(), this._transitions = e, this._parseStack = {
									state: 0,
									handlers: [],
									handlerPos: 0,
									transition: 0,
									chunkPos: 0
								}, this.initialState = 0, this.currentState = this.initialState, this._params = new r.Params(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, this._printHandlerFb = (e, t, i) => {}, this._executeHandlerFb = (e) => {}, this._csiHandlerFb = (e, t) => {}, this._escHandlerFb = (e) => {}, this._errorHandlerFb = (e) => e, this._printHandler = this._printHandlerFb, this._executeHandlers = Object.create(null), this._csiHandlers = Object.create(null), this._escHandlers = Object.create(null), this.register((0, s.toDisposable)((() => {
									this._csiHandlers = Object.create(null), this._executeHandlers = Object.create(null), this._escHandlers = Object.create(null);
								}))), this._oscParser = this.register(new n.OscParser()), this._dcsParser = this.register(new o.DcsParser()), this._errorHandler = this._errorHandlerFb, this.registerEscHandler({ final: "\\" }, (() => !0));
							}
							_identifier(e, t = [64, 126]) {
								let i = 0;
								if (e.prefix) {
									if (e.prefix.length > 1) throw new Error("only one byte as prefix supported");
									if (i = e.prefix.charCodeAt(0), i && 60 > i || i > 63) throw new Error("prefix must be in range 0x3c .. 0x3f");
								}
								if (e.intermediates) {
									if (e.intermediates.length > 2) throw new Error("only two bytes as intermediates are supported");
									for (let t = 0; t < e.intermediates.length; ++t) {
										const s = e.intermediates.charCodeAt(t);
										if (32 > s || s > 47) throw new Error("intermediate must be in range 0x20 .. 0x2f");
										i <<= 8, i |= s;
									}
								}
								if (1 !== e.final.length) throw new Error("final must be a single byte");
								const s = e.final.charCodeAt(0);
								if (t[0] > s || s > t[1]) throw new Error(`final must be in range ${t[0]} .. ${t[1]}`);
								return i <<= 8, i |= s, i;
							}
							identToString(e) {
								const t = [];
								for (; e;) t.push(String.fromCharCode(255 & e)), e >>= 8;
								return t.reverse().join("");
							}
							setPrintHandler(e) {
								this._printHandler = e;
							}
							clearPrintHandler() {
								this._printHandler = this._printHandlerFb;
							}
							registerEscHandler(e, t) {
								const i = this._identifier(e, [48, 126]);
								void 0 === this._escHandlers[i] && (this._escHandlers[i] = []);
								const s = this._escHandlers[i];
								return s.push(t), { dispose: () => {
									const e = s.indexOf(t);
									-1 !== e && s.splice(e, 1);
								} };
							}
							clearEscHandler(e) {
								this._escHandlers[this._identifier(e, [48, 126])] && delete this._escHandlers[this._identifier(e, [48, 126])];
							}
							setEscHandlerFallback(e) {
								this._escHandlerFb = e;
							}
							setExecuteHandler(e, t) {
								this._executeHandlers[e.charCodeAt(0)] = t;
							}
							clearExecuteHandler(e) {
								this._executeHandlers[e.charCodeAt(0)] && delete this._executeHandlers[e.charCodeAt(0)];
							}
							setExecuteHandlerFallback(e) {
								this._executeHandlerFb = e;
							}
							registerCsiHandler(e, t) {
								const i = this._identifier(e);
								void 0 === this._csiHandlers[i] && (this._csiHandlers[i] = []);
								const s = this._csiHandlers[i];
								return s.push(t), { dispose: () => {
									const e = s.indexOf(t);
									-1 !== e && s.splice(e, 1);
								} };
							}
							clearCsiHandler(e) {
								this._csiHandlers[this._identifier(e)] && delete this._csiHandlers[this._identifier(e)];
							}
							setCsiHandlerFallback(e) {
								this._csiHandlerFb = e;
							}
							registerDcsHandler(e, t) {
								return this._dcsParser.registerHandler(this._identifier(e), t);
							}
							clearDcsHandler(e) {
								this._dcsParser.clearHandler(this._identifier(e));
							}
							setDcsHandlerFallback(e) {
								this._dcsParser.setHandlerFallback(e);
							}
							registerOscHandler(e, t) {
								return this._oscParser.registerHandler(e, t);
							}
							clearOscHandler(e) {
								this._oscParser.clearHandler(e);
							}
							setOscHandlerFallback(e) {
								this._oscParser.setHandlerFallback(e);
							}
							setErrorHandler(e) {
								this._errorHandler = e;
							}
							clearErrorHandler() {
								this._errorHandler = this._errorHandlerFb;
							}
							reset() {
								this.currentState = this.initialState, this._oscParser.reset(), this._dcsParser.reset(), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0, 0 !== this._parseStack.state && (this._parseStack.state = 2, this._parseStack.handlers = []);
							}
							_preserveStack(e, t, i, s, r) {
								this._parseStack.state = e, this._parseStack.handlers = t, this._parseStack.handlerPos = i, this._parseStack.transition = s, this._parseStack.chunkPos = r;
							}
							parse(e, t, i) {
								let s, r = 0, n = 0, o = 0;
								if (this._parseStack.state) if (2 === this._parseStack.state) this._parseStack.state = 0, o = this._parseStack.chunkPos + 1;
								else {
									if (void 0 === i || 1 === this._parseStack.state) throw this._parseStack.state = 1, /* @__PURE__ */ new Error("improper continuation due to previous async handler, giving up parsing");
									const t = this._parseStack.handlers;
									let n = this._parseStack.handlerPos - 1;
									switch (this._parseStack.state) {
										case 3:
											if (!1 === i && n > -1) {
												for (; n >= 0 && (s = t[n](this._params), !0 !== s); n--) if (s instanceof Promise) return this._parseStack.handlerPos = n, s;
											}
											this._parseStack.handlers = [];
											break;
										case 4:
											if (!1 === i && n > -1) {
												for (; n >= 0 && (s = t[n](), !0 !== s); n--) if (s instanceof Promise) return this._parseStack.handlerPos = n, s;
											}
											this._parseStack.handlers = [];
											break;
										case 6:
											if (r = e[this._parseStack.chunkPos], s = this._dcsParser.unhook(24 !== r && 26 !== r, i), s) return s;
											27 === r && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
											break;
										case 5:
											if (r = e[this._parseStack.chunkPos], s = this._oscParser.end(24 !== r && 26 !== r, i), s) return s;
											27 === r && (this._parseStack.transition |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0;
									}
									this._parseStack.state = 0, o = this._parseStack.chunkPos + 1, this.precedingJoinState = 0, this.currentState = 15 & this._parseStack.transition;
								}
								for (let i = o; i < t; ++i) {
									switch (r = e[i], n = this._transitions.table[this.currentState << 8 | (r < 160 ? r : h)], n >> 4) {
										case 2:
											for (let s = i + 1;; ++s) {
												if (s >= t || (r = e[s]) < 32 || r > 126 && r < h) {
													this._printHandler(e, i, s), i = s - 1;
													break;
												}
												if (++s >= t || (r = e[s]) < 32 || r > 126 && r < h) {
													this._printHandler(e, i, s), i = s - 1;
													break;
												}
												if (++s >= t || (r = e[s]) < 32 || r > 126 && r < h) {
													this._printHandler(e, i, s), i = s - 1;
													break;
												}
												if (++s >= t || (r = e[s]) < 32 || r > 126 && r < h) {
													this._printHandler(e, i, s), i = s - 1;
													break;
												}
											}
											break;
										case 3:
											this._executeHandlers[r] ? this._executeHandlers[r]() : this._executeHandlerFb(r), this.precedingJoinState = 0;
											break;
										case 0: break;
										case 1:
											if (this._errorHandler({
												position: i,
												code: r,
												currentState: this.currentState,
												collect: this._collect,
												params: this._params,
												abort: !1
											}).abort) return;
											break;
										case 7:
											const o = this._csiHandlers[this._collect << 8 | r];
											let a = o ? o.length - 1 : -1;
											for (; a >= 0 && (s = o[a](this._params), !0 !== s); a--) if (s instanceof Promise) return this._preserveStack(3, o, a, n, i), s;
											a < 0 && this._csiHandlerFb(this._collect << 8 | r, this._params), this.precedingJoinState = 0;
											break;
										case 8:
											do
												switch (r) {
													case 59:
														this._params.addParam(0);
														break;
													case 58:
														this._params.addSubParam(-1);
														break;
													default: this._params.addDigit(r - 48);
												}
											while (++i < t && (r = e[i]) > 47 && r < 60);
											i--;
											break;
										case 9:
											this._collect <<= 8, this._collect |= r;
											break;
										case 10:
											const c = this._escHandlers[this._collect << 8 | r];
											let l = c ? c.length - 1 : -1;
											for (; l >= 0 && (s = c[l](), !0 !== s); l--) if (s instanceof Promise) return this._preserveStack(4, c, l, n, i), s;
											l < 0 && this._escHandlerFb(this._collect << 8 | r), this.precedingJoinState = 0;
											break;
										case 11:
											this._params.reset(), this._params.addParam(0), this._collect = 0;
											break;
										case 12:
											this._dcsParser.hook(this._collect << 8 | r, this._params);
											break;
										case 13:
											for (let s = i + 1;; ++s) if (s >= t || 24 === (r = e[s]) || 26 === r || 27 === r || r > 127 && r < h) {
												this._dcsParser.put(e, i, s), i = s - 1;
												break;
											}
											break;
										case 14:
											if (s = this._dcsParser.unhook(24 !== r && 26 !== r), s) return this._preserveStack(6, [], 0, n, i), s;
											27 === r && (n |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
											break;
										case 4:
											this._oscParser.start();
											break;
										case 5:
											for (let s = i + 1;; s++) if (s >= t || (r = e[s]) < 32 || r > 127 && r < h) {
												this._oscParser.put(e, i, s), i = s - 1;
												break;
											}
											break;
										case 6:
											if (s = this._oscParser.end(24 !== r && 26 !== r), s) return this._preserveStack(5, [], 0, n, i), s;
											27 === r && (n |= 1), this._params.reset(), this._params.addParam(0), this._collect = 0, this.precedingJoinState = 0;
									}
									this.currentState = 15 & n;
								}
							}
						}
						t.EscapeSequenceParser = c;
					},
					6242: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.OscHandler = t.OscParser = void 0;
						const s = i(5770), r = i(482), n = [];
						t.OscParser = class {
							constructor() {
								this._state = 0, this._active = n, this._id = -1, this._handlers = Object.create(null), this._handlerFb = () => {}, this._stack = {
									paused: !1,
									loopPosition: 0,
									fallThrough: !1
								};
							}
							registerHandler(e, t) {
								void 0 === this._handlers[e] && (this._handlers[e] = []);
								const i = this._handlers[e];
								return i.push(t), { dispose: () => {
									const e = i.indexOf(t);
									-1 !== e && i.splice(e, 1);
								} };
							}
							clearHandler(e) {
								this._handlers[e] && delete this._handlers[e];
							}
							setHandlerFallback(e) {
								this._handlerFb = e;
							}
							dispose() {
								this._handlers = Object.create(null), this._handlerFb = () => {}, this._active = n;
							}
							reset() {
								if (2 === this._state) for (let e = this._stack.paused ? this._stack.loopPosition - 1 : this._active.length - 1; e >= 0; --e) this._active[e].end(!1);
								this._stack.paused = !1, this._active = n, this._id = -1, this._state = 0;
							}
							_start() {
								if (this._active = this._handlers[this._id] || n, this._active.length) for (let e = this._active.length - 1; e >= 0; e--) this._active[e].start();
								else this._handlerFb(this._id, "START");
							}
							_put(e, t, i) {
								if (this._active.length) for (let s = this._active.length - 1; s >= 0; s--) this._active[s].put(e, t, i);
								else this._handlerFb(this._id, "PUT", (0, r.utf32ToString)(e, t, i));
							}
							start() {
								this.reset(), this._state = 1;
							}
							put(e, t, i) {
								if (3 !== this._state) {
									if (1 === this._state) for (; t < i;) {
										const i = e[t++];
										if (59 === i) {
											this._state = 2, this._start();
											break;
										}
										if (i < 48 || 57 < i) return void (this._state = 3);
										-1 === this._id && (this._id = 0), this._id = 10 * this._id + i - 48;
									}
									2 === this._state && i - t > 0 && this._put(e, t, i);
								}
							}
							end(e, t = !0) {
								if (0 !== this._state) {
									if (3 !== this._state) if (1 === this._state && this._start(), this._active.length) {
										let i = !1, s = this._active.length - 1, r = !1;
										if (this._stack.paused && (s = this._stack.loopPosition - 1, i = t, r = this._stack.fallThrough, this._stack.paused = !1), !r && !1 === i) {
											for (; s >= 0 && (i = this._active[s].end(e), !0 !== i); s--) if (i instanceof Promise) return this._stack.paused = !0, this._stack.loopPosition = s, this._stack.fallThrough = !1, i;
											s--;
										}
										for (; s >= 0; s--) if (i = this._active[s].end(!1), i instanceof Promise) return this._stack.paused = !0, this._stack.loopPosition = s, this._stack.fallThrough = !0, i;
									} else this._handlerFb(this._id, "END", e);
									this._active = n, this._id = -1, this._state = 0;
								}
							}
						}, t.OscHandler = class {
							constructor(e) {
								this._handler = e, this._data = "", this._hitLimit = !1;
							}
							start() {
								this._data = "", this._hitLimit = !1;
							}
							put(e, t, i) {
								this._hitLimit || (this._data += (0, r.utf32ToString)(e, t, i), this._data.length > s.PAYLOAD_LIMIT && (this._data = "", this._hitLimit = !0));
							}
							end(e) {
								let t = !1;
								if (this._hitLimit) t = !1;
								else if (e && (t = this._handler(this._data), t instanceof Promise)) return t.then(((e) => (this._data = "", this._hitLimit = !1, e)));
								return this._data = "", this._hitLimit = !1, t;
							}
						};
					},
					8742: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.Params = void 0;
						const i = 2147483647;
						class s {
							static fromArray(e) {
								const t = new s();
								if (!e.length) return t;
								for (let i = Array.isArray(e[0]) ? 1 : 0; i < e.length; ++i) {
									const s = e[i];
									if (Array.isArray(s)) for (let e = 0; e < s.length; ++e) t.addSubParam(s[e]);
									else t.addParam(s);
								}
								return t;
							}
							constructor(e = 32, t = 32) {
								if (this.maxLength = e, this.maxSubParamsLength = t, t > 256) throw new Error("maxSubParamsLength must not be greater than 256");
								this.params = new Int32Array(e), this.length = 0, this._subParams = new Int32Array(t), this._subParamsLength = 0, this._subParamsIdx = new Uint16Array(e), this._rejectDigits = !1, this._rejectSubDigits = !1, this._digitIsSub = !1;
							}
							clone() {
								const e = new s(this.maxLength, this.maxSubParamsLength);
								return e.params.set(this.params), e.length = this.length, e._subParams.set(this._subParams), e._subParamsLength = this._subParamsLength, e._subParamsIdx.set(this._subParamsIdx), e._rejectDigits = this._rejectDigits, e._rejectSubDigits = this._rejectSubDigits, e._digitIsSub = this._digitIsSub, e;
							}
							toArray() {
								const e = [];
								for (let t = 0; t < this.length; ++t) {
									e.push(this.params[t]);
									const i = this._subParamsIdx[t] >> 8, s = 255 & this._subParamsIdx[t];
									s - i > 0 && e.push(Array.prototype.slice.call(this._subParams, i, s));
								}
								return e;
							}
							reset() {
								this.length = 0, this._subParamsLength = 0, this._rejectDigits = !1, this._rejectSubDigits = !1, this._digitIsSub = !1;
							}
							addParam(e) {
								if (this._digitIsSub = !1, this.length >= this.maxLength) this._rejectDigits = !0;
								else {
									if (e < -1) throw new Error("values lesser than -1 are not allowed");
									this._subParamsIdx[this.length] = this._subParamsLength << 8 | this._subParamsLength, this.params[this.length++] = e > i ? i : e;
								}
							}
							addSubParam(e) {
								if (this._digitIsSub = !0, this.length) if (this._rejectDigits || this._subParamsLength >= this.maxSubParamsLength) this._rejectSubDigits = !0;
								else {
									if (e < -1) throw new Error("values lesser than -1 are not allowed");
									this._subParams[this._subParamsLength++] = e > i ? i : e, this._subParamsIdx[this.length - 1]++;
								}
							}
							hasSubParams(e) {
								return (255 & this._subParamsIdx[e]) - (this._subParamsIdx[e] >> 8) > 0;
							}
							getSubParams(e) {
								const t = this._subParamsIdx[e] >> 8, i = 255 & this._subParamsIdx[e];
								return i - t > 0 ? this._subParams.subarray(t, i) : null;
							}
							getSubParamsAll() {
								const e = {};
								for (let t = 0; t < this.length; ++t) {
									const i = this._subParamsIdx[t] >> 8, s = 255 & this._subParamsIdx[t];
									s - i > 0 && (e[t] = this._subParams.slice(i, s));
								}
								return e;
							}
							addDigit(e) {
								let t;
								if (this._rejectDigits || !(t = this._digitIsSub ? this._subParamsLength : this.length) || this._digitIsSub && this._rejectSubDigits) return;
								const s = this._digitIsSub ? this._subParams : this.params, r = s[t - 1];
								s[t - 1] = ~r ? Math.min(10 * r + e, i) : e;
							}
						}
						t.Params = s;
					},
					5741: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.AddonManager = void 0, t.AddonManager = class {
							constructor() {
								this._addons = [];
							}
							dispose() {
								for (let e = this._addons.length - 1; e >= 0; e--) this._addons[e].instance.dispose();
							}
							loadAddon(e, t) {
								const i = {
									instance: t,
									dispose: t.dispose,
									isDisposed: !1
								};
								this._addons.push(i), t.dispose = () => this._wrappedAddonDispose(i), t.activate(e);
							}
							_wrappedAddonDispose(e) {
								if (e.isDisposed) return;
								let t = -1;
								for (let i = 0; i < this._addons.length; i++) if (this._addons[i] === e) {
									t = i;
									break;
								}
								if (-1 === t) throw new Error("Could not dispose an addon that has not been loaded");
								e.isDisposed = !0, e.dispose.apply(e.instance), this._addons.splice(t, 1);
							}
						};
					},
					8771: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferApiView = void 0;
						const s = i(3785), r = i(511);
						t.BufferApiView = class {
							constructor(e, t) {
								this._buffer = e, this.type = t;
							}
							init(e) {
								return this._buffer = e, this;
							}
							get cursorY() {
								return this._buffer.y;
							}
							get cursorX() {
								return this._buffer.x;
							}
							get viewportY() {
								return this._buffer.ydisp;
							}
							get baseY() {
								return this._buffer.ybase;
							}
							get length() {
								return this._buffer.lines.length;
							}
							getLine(e) {
								const t = this._buffer.lines.get(e);
								if (t) return new s.BufferLineApiView(t);
							}
							getNullCell() {
								return new r.CellData();
							}
						};
					},
					3785: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferLineApiView = void 0;
						const s = i(511);
						t.BufferLineApiView = class {
							constructor(e) {
								this._line = e;
							}
							get isWrapped() {
								return this._line.isWrapped;
							}
							get length() {
								return this._line.length;
							}
							getCell(e, t) {
								if (!(e < 0 || e >= this._line.length)) return t ? (this._line.loadCell(e, t), t) : this._line.loadCell(e, new s.CellData());
							}
							translateToString(e, t, i) {
								return this._line.translateToString(e, t, i);
							}
						};
					},
					8285: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferNamespaceApi = void 0;
						const s = i(8771), r = i(8460), n = i(844);
						class o extends n.Disposable {
							constructor(e) {
								super(), this._core = e, this._onBufferChange = this.register(new r.EventEmitter()), this.onBufferChange = this._onBufferChange.event, this._normal = new s.BufferApiView(this._core.buffers.normal, "normal"), this._alternate = new s.BufferApiView(this._core.buffers.alt, "alternate"), this._core.buffers.onBufferActivate((() => this._onBufferChange.fire(this.active)));
							}
							get active() {
								if (this._core.buffers.active === this._core.buffers.normal) return this.normal;
								if (this._core.buffers.active === this._core.buffers.alt) return this.alternate;
								throw new Error("Active buffer is neither normal nor alternate");
							}
							get normal() {
								return this._normal.init(this._core.buffers.normal);
							}
							get alternate() {
								return this._alternate.init(this._core.buffers.alt);
							}
						}
						t.BufferNamespaceApi = o;
					},
					7975: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.ParserApi = void 0, t.ParserApi = class {
							constructor(e) {
								this._core = e;
							}
							registerCsiHandler(e, t) {
								return this._core.registerCsiHandler(e, ((e) => t(e.toArray())));
							}
							addCsiHandler(e, t) {
								return this.registerCsiHandler(e, t);
							}
							registerDcsHandler(e, t) {
								return this._core.registerDcsHandler(e, ((e, i) => t(e, i.toArray())));
							}
							addDcsHandler(e, t) {
								return this.registerDcsHandler(e, t);
							}
							registerEscHandler(e, t) {
								return this._core.registerEscHandler(e, t);
							}
							addEscHandler(e, t) {
								return this.registerEscHandler(e, t);
							}
							registerOscHandler(e, t) {
								return this._core.registerOscHandler(e, t);
							}
							addOscHandler(e, t) {
								return this.registerOscHandler(e, t);
							}
						};
					},
					7090: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeApi = void 0, t.UnicodeApi = class {
							constructor(e) {
								this._core = e;
							}
							register(e) {
								this._core.unicodeService.register(e);
							}
							get versions() {
								return this._core.unicodeService.versions;
							}
							get activeVersion() {
								return this._core.unicodeService.activeVersion;
							}
							set activeVersion(e) {
								this._core.unicodeService.activeVersion = e;
							}
						};
					},
					744: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.BufferService = t.MINIMUM_ROWS = t.MINIMUM_COLS = void 0;
						const n = i(8460), o = i(844), a = i(5295), h = i(2585);
						t.MINIMUM_COLS = 2, t.MINIMUM_ROWS = 1;
						let c = t.BufferService = class extends o.Disposable {
							get buffer() {
								return this.buffers.active;
							}
							constructor(e) {
								super(), this.isUserScrolling = !1, this._onResize = this.register(new n.EventEmitter()), this.onResize = this._onResize.event, this._onScroll = this.register(new n.EventEmitter()), this.onScroll = this._onScroll.event, this.cols = Math.max(e.rawOptions.cols || 0, t.MINIMUM_COLS), this.rows = Math.max(e.rawOptions.rows || 0, t.MINIMUM_ROWS), this.buffers = this.register(new a.BufferSet(e, this));
							}
							resize(e, t) {
								this.cols = e, this.rows = t, this.buffers.resize(e, t), this._onResize.fire({
									cols: e,
									rows: t
								});
							}
							reset() {
								this.buffers.reset(), this.isUserScrolling = !1;
							}
							scroll(e, t = !1) {
								const i = this.buffer;
								let s;
								s = this._cachedBlankLine, s && s.length === this.cols && s.getFg(0) === e.fg && s.getBg(0) === e.bg || (s = i.getBlankLine(e, t), this._cachedBlankLine = s), s.isWrapped = t;
								const r = i.ybase + i.scrollTop, n = i.ybase + i.scrollBottom;
								if (0 === i.scrollTop) {
									const e = i.lines.isFull;
									n === i.lines.length - 1 ? e ? i.lines.recycle().copyFrom(s) : i.lines.push(s.clone()) : i.lines.splice(n + 1, 0, s.clone()), e ? this.isUserScrolling && (i.ydisp = Math.max(i.ydisp - 1, 0)) : (i.ybase++, this.isUserScrolling || i.ydisp++);
								} else {
									const e = n - r + 1;
									i.lines.shiftElements(r + 1, e - 1, -1), i.lines.set(n, s.clone());
								}
								this.isUserScrolling || (i.ydisp = i.ybase), this._onScroll.fire(i.ydisp);
							}
							scrollLines(e, t, i) {
								const s = this.buffer;
								if (e < 0) {
									if (0 === s.ydisp) return;
									this.isUserScrolling = !0;
								} else e + s.ydisp >= s.ybase && (this.isUserScrolling = !1);
								const r = s.ydisp;
								s.ydisp = Math.max(Math.min(s.ydisp + e, s.ybase), 0), r !== s.ydisp && (t || this._onScroll.fire(s.ydisp));
							}
						};
						t.BufferService = c = s([r(0, h.IOptionsService)], c);
					},
					7994: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CharsetService = void 0, t.CharsetService = class {
							constructor() {
								this.glevel = 0, this._charsets = [];
							}
							reset() {
								this.charset = void 0, this._charsets = [], this.glevel = 0;
							}
							setgLevel(e) {
								this.glevel = e, this.charset = this._charsets[e];
							}
							setgCharset(e, t) {
								this._charsets[e] = t, this.glevel === e && (this.charset = t);
							}
						};
					},
					1753: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CoreMouseService = void 0;
						const n = i(2585), o = i(8460), a = i(844), h = {
							NONE: {
								events: 0,
								restrict: () => !1
							},
							X10: {
								events: 1,
								restrict: (e) => 4 !== e.button && 1 === e.action && (e.ctrl = !1, e.alt = !1, e.shift = !1, !0)
							},
							VT200: {
								events: 19,
								restrict: (e) => 32 !== e.action
							},
							DRAG: {
								events: 23,
								restrict: (e) => 32 !== e.action || 3 !== e.button
							},
							ANY: {
								events: 31,
								restrict: (e) => !0
							}
						};
						function c(e, t) {
							let i = (e.ctrl ? 16 : 0) | (e.shift ? 4 : 0) | (e.alt ? 8 : 0);
							return 4 === e.button ? (i |= 64, i |= e.action) : (i |= 3 & e.button, 4 & e.button && (i |= 64), 8 & e.button && (i |= 128), 32 === e.action ? i |= 32 : 0 !== e.action || t || (i |= 3)), i;
						}
						const l = String.fromCharCode, d = {
							DEFAULT: (e) => {
								const t = [
									c(e, !1) + 32,
									e.col + 32,
									e.row + 32
								];
								return t[0] > 255 || t[1] > 255 || t[2] > 255 ? "" : `[M${l(t[0])}${l(t[1])}${l(t[2])}`;
							},
							SGR: (e) => {
								const t = 0 === e.action && 4 !== e.button ? "m" : "M";
								return `[<${c(e, !0)};${e.col};${e.row}${t}`;
							},
							SGR_PIXELS: (e) => {
								const t = 0 === e.action && 4 !== e.button ? "m" : "M";
								return `[<${c(e, !0)};${e.x};${e.y}${t}`;
							}
						};
						let _ = t.CoreMouseService = class extends a.Disposable {
							constructor(e, t) {
								super(), this._bufferService = e, this._coreService = t, this._protocols = {}, this._encodings = {}, this._activeProtocol = "", this._activeEncoding = "", this._lastEvent = null, this._onProtocolChange = this.register(new o.EventEmitter()), this.onProtocolChange = this._onProtocolChange.event;
								for (const e of Object.keys(h)) this.addProtocol(e, h[e]);
								for (const e of Object.keys(d)) this.addEncoding(e, d[e]);
								this.reset();
							}
							addProtocol(e, t) {
								this._protocols[e] = t;
							}
							addEncoding(e, t) {
								this._encodings[e] = t;
							}
							get activeProtocol() {
								return this._activeProtocol;
							}
							get areMouseEventsActive() {
								return 0 !== this._protocols[this._activeProtocol].events;
							}
							set activeProtocol(e) {
								if (!this._protocols[e]) throw new Error(`unknown protocol "${e}"`);
								this._activeProtocol = e, this._onProtocolChange.fire(this._protocols[e].events);
							}
							get activeEncoding() {
								return this._activeEncoding;
							}
							set activeEncoding(e) {
								if (!this._encodings[e]) throw new Error(`unknown encoding "${e}"`);
								this._activeEncoding = e;
							}
							reset() {
								this.activeProtocol = "NONE", this.activeEncoding = "DEFAULT", this._lastEvent = null;
							}
							triggerMouseEvent(e) {
								if (e.col < 0 || e.col >= this._bufferService.cols || e.row < 0 || e.row >= this._bufferService.rows) return !1;
								if (4 === e.button && 32 === e.action) return !1;
								if (3 === e.button && 32 !== e.action) return !1;
								if (4 !== e.button && (2 === e.action || 3 === e.action)) return !1;
								if (e.col++, e.row++, 32 === e.action && this._lastEvent && this._equalEvents(this._lastEvent, e, "SGR_PIXELS" === this._activeEncoding)) return !1;
								if (!this._protocols[this._activeProtocol].restrict(e)) return !1;
								const t = this._encodings[this._activeEncoding](e);
								return t && ("DEFAULT" === this._activeEncoding ? this._coreService.triggerBinaryEvent(t) : this._coreService.triggerDataEvent(t, !0)), this._lastEvent = e, !0;
							}
							explainEvents(e) {
								return {
									down: !!(1 & e),
									up: !!(2 & e),
									drag: !!(4 & e),
									move: !!(8 & e),
									wheel: !!(16 & e)
								};
							}
							_equalEvents(e, t, i) {
								if (i) {
									if (e.x !== t.x) return !1;
									if (e.y !== t.y) return !1;
								} else {
									if (e.col !== t.col) return !1;
									if (e.row !== t.row) return !1;
								}
								return e.button === t.button && e.action === t.action && e.ctrl === t.ctrl && e.alt === t.alt && e.shift === t.shift;
							}
						};
						t.CoreMouseService = _ = s([r(0, n.IBufferService), r(1, n.ICoreService)], _);
					},
					6975: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.CoreService = void 0;
						const n = i(1439), o = i(8460), a = i(844), h = i(2585), c = Object.freeze({ insertMode: !1 }), l = Object.freeze({
							applicationCursorKeys: !1,
							applicationKeypad: !1,
							bracketedPasteMode: !1,
							origin: !1,
							reverseWraparound: !1,
							sendFocus: !1,
							wraparound: !0
						});
						let d = t.CoreService = class extends a.Disposable {
							constructor(e, t, i) {
								super(), this._bufferService = e, this._logService = t, this._optionsService = i, this.isCursorInitialized = !1, this.isCursorHidden = !1, this._onData = this.register(new o.EventEmitter()), this.onData = this._onData.event, this._onUserInput = this.register(new o.EventEmitter()), this.onUserInput = this._onUserInput.event, this._onBinary = this.register(new o.EventEmitter()), this.onBinary = this._onBinary.event, this._onRequestScrollToBottom = this.register(new o.EventEmitter()), this.onRequestScrollToBottom = this._onRequestScrollToBottom.event, this.modes = (0, n.clone)(c), this.decPrivateModes = (0, n.clone)(l);
							}
							reset() {
								this.modes = (0, n.clone)(c), this.decPrivateModes = (0, n.clone)(l);
							}
							triggerDataEvent(e, t = !1) {
								if (this._optionsService.rawOptions.disableStdin) return;
								const i = this._bufferService.buffer;
								t && this._optionsService.rawOptions.scrollOnUserInput && i.ybase !== i.ydisp && this._onRequestScrollToBottom.fire(), t && this._onUserInput.fire(), this._logService.debug(`sending data "${e}"`, (() => e.split("").map(((e) => e.charCodeAt(0))))), this._onData.fire(e);
							}
							triggerBinaryEvent(e) {
								this._optionsService.rawOptions.disableStdin || (this._logService.debug(`sending binary "${e}"`, (() => e.split("").map(((e) => e.charCodeAt(0))))), this._onBinary.fire(e));
							}
						};
						t.CoreService = d = s([
							r(0, h.IBufferService),
							r(1, h.ILogService),
							r(2, h.IOptionsService)
						], d);
					},
					9074: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.DecorationService = void 0;
						const s = i(8055), r = i(8460), n = i(844), o = i(6106);
						let a = 0, h = 0;
						class c extends n.Disposable {
							get decorations() {
								return this._decorations.values();
							}
							constructor() {
								super(), this._decorations = new o.SortedList(((e) => e?.marker.line)), this._onDecorationRegistered = this.register(new r.EventEmitter()), this.onDecorationRegistered = this._onDecorationRegistered.event, this._onDecorationRemoved = this.register(new r.EventEmitter()), this.onDecorationRemoved = this._onDecorationRemoved.event, this.register((0, n.toDisposable)((() => this.reset())));
							}
							registerDecoration(e) {
								if (e.marker.isDisposed) return;
								const t = new l(e);
								if (t) {
									const e = t.marker.onDispose((() => t.dispose()));
									t.onDispose((() => {
										t && (this._decorations.delete(t) && this._onDecorationRemoved.fire(t), e.dispose());
									})), this._decorations.insert(t), this._onDecorationRegistered.fire(t);
								}
								return t;
							}
							reset() {
								for (const e of this._decorations.values()) e.dispose();
								this._decorations.clear();
							}
							*getDecorationsAtCell(e, t, i) {
								let s = 0, r = 0;
								for (const n of this._decorations.getKeyIterator(t)) s = n.options.x ?? 0, r = s + (n.options.width ?? 1), e >= s && e < r && (!i || (n.options.layer ?? "bottom") === i) && (yield n);
							}
							forEachDecorationAtCell(e, t, i, s) {
								this._decorations.forEachByKey(t, ((t) => {
									a = t.options.x ?? 0, h = a + (t.options.width ?? 1), e >= a && e < h && (!i || (t.options.layer ?? "bottom") === i) && s(t);
								}));
							}
						}
						t.DecorationService = c;
						class l extends n.Disposable {
							get isDisposed() {
								return this._isDisposed;
							}
							get backgroundColorRGB() {
								return null === this._cachedBg && (this.options.backgroundColor ? this._cachedBg = s.css.toColor(this.options.backgroundColor) : this._cachedBg = void 0), this._cachedBg;
							}
							get foregroundColorRGB() {
								return null === this._cachedFg && (this.options.foregroundColor ? this._cachedFg = s.css.toColor(this.options.foregroundColor) : this._cachedFg = void 0), this._cachedFg;
							}
							constructor(e) {
								super(), this.options = e, this.onRenderEmitter = this.register(new r.EventEmitter()), this.onRender = this.onRenderEmitter.event, this._onDispose = this.register(new r.EventEmitter()), this.onDispose = this._onDispose.event, this._cachedBg = null, this._cachedFg = null, this.marker = e.marker, this.options.overviewRulerOptions && !this.options.overviewRulerOptions.position && (this.options.overviewRulerOptions.position = "full");
							}
							dispose() {
								this._onDispose.fire(), super.dispose();
							}
						}
					},
					4348: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.InstantiationService = t.ServiceCollection = void 0;
						const s = i(2585), r = i(8343);
						class n {
							constructor(...e) {
								this._entries = /* @__PURE__ */ new Map();
								for (const [t, i] of e) this.set(t, i);
							}
							set(e, t) {
								const i = this._entries.get(e);
								return this._entries.set(e, t), i;
							}
							forEach(e) {
								for (const [t, i] of this._entries.entries()) e(t, i);
							}
							has(e) {
								return this._entries.has(e);
							}
							get(e) {
								return this._entries.get(e);
							}
						}
						t.ServiceCollection = n, t.InstantiationService = class {
							constructor() {
								this._services = new n(), this._services.set(s.IInstantiationService, this);
							}
							setService(e, t) {
								this._services.set(e, t);
							}
							getService(e) {
								return this._services.get(e);
							}
							createInstance(e, ...t) {
								const i = (0, r.getServiceDependencies)(e).sort(((e, t) => e.index - t.index)), s = [];
								for (const t of i) {
									const i = this._services.get(t.id);
									if (!i) throw new Error(`[createInstance] ${e.name} depends on UNKNOWN service ${t.id}.`);
									s.push(i);
								}
								const n = i.length > 0 ? i[0].index : t.length;
								if (t.length !== n) throw new Error(`[createInstance] First service dependency of ${e.name} at position ${n + 1} conflicts with ${t.length} static arguments`);
								return new e(...[...t, ...s]);
							}
						};
					},
					7866: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.traceCall = t.setTraceLogger = t.LogService = void 0;
						const n = i(844), o = i(2585), a = {
							trace: o.LogLevelEnum.TRACE,
							debug: o.LogLevelEnum.DEBUG,
							info: o.LogLevelEnum.INFO,
							warn: o.LogLevelEnum.WARN,
							error: o.LogLevelEnum.ERROR,
							off: o.LogLevelEnum.OFF
						};
						let h, c = t.LogService = class extends n.Disposable {
							get logLevel() {
								return this._logLevel;
							}
							constructor(e) {
								super(), this._optionsService = e, this._logLevel = o.LogLevelEnum.OFF, this._updateLogLevel(), this.register(this._optionsService.onSpecificOptionChange("logLevel", (() => this._updateLogLevel()))), h = this;
							}
							_updateLogLevel() {
								this._logLevel = a[this._optionsService.rawOptions.logLevel];
							}
							_evalLazyOptionalParams(e) {
								for (let t = 0; t < e.length; t++) "function" == typeof e[t] && (e[t] = e[t]());
							}
							_log(e, t, i) {
								this._evalLazyOptionalParams(i), e.call(console, (this._optionsService.options.logger ? "" : "xterm.js: ") + t, ...i);
							}
							trace(e, ...t) {
								this._logLevel <= o.LogLevelEnum.TRACE && this._log(this._optionsService.options.logger?.trace.bind(this._optionsService.options.logger) ?? console.log, e, t);
							}
							debug(e, ...t) {
								this._logLevel <= o.LogLevelEnum.DEBUG && this._log(this._optionsService.options.logger?.debug.bind(this._optionsService.options.logger) ?? console.log, e, t);
							}
							info(e, ...t) {
								this._logLevel <= o.LogLevelEnum.INFO && this._log(this._optionsService.options.logger?.info.bind(this._optionsService.options.logger) ?? console.info, e, t);
							}
							warn(e, ...t) {
								this._logLevel <= o.LogLevelEnum.WARN && this._log(this._optionsService.options.logger?.warn.bind(this._optionsService.options.logger) ?? console.warn, e, t);
							}
							error(e, ...t) {
								this._logLevel <= o.LogLevelEnum.ERROR && this._log(this._optionsService.options.logger?.error.bind(this._optionsService.options.logger) ?? console.error, e, t);
							}
						};
						t.LogService = c = s([r(0, o.IOptionsService)], c), t.setTraceLogger = function(e) {
							h = e;
						}, t.traceCall = function(e, t, i) {
							if ("function" != typeof i.value) throw new Error("not supported");
							const s = i.value;
							i.value = function(...e) {
								if (h.logLevel !== o.LogLevelEnum.TRACE) return s.apply(this, e);
								h.trace(`GlyphRenderer#${s.name}(${e.map(((e) => JSON.stringify(e))).join(", ")})`);
								const t = s.apply(this, e);
								return h.trace(`GlyphRenderer#${s.name} return`, t), t;
							};
						};
					},
					7302: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.OptionsService = t.DEFAULT_OPTIONS = void 0;
						const s = i(8460), r = i(844);
						t.DEFAULT_OPTIONS = {
							cols: 80,
							rows: 24,
							cursorBlink: !1,
							cursorStyle: "block",
							cursorWidth: 1,
							cursorInactiveStyle: "outline",
							customGlyphs: !0,
							drawBoldTextInBrightColors: !0,
							documentOverride: null,
							fastScrollModifier: "alt",
							fastScrollSensitivity: 5,
							fontFamily: "courier-new, courier, monospace",
							fontSize: 15,
							fontWeight: "normal",
							fontWeightBold: "bold",
							ignoreBracketedPasteMode: !1,
							lineHeight: 1,
							letterSpacing: 0,
							linkHandler: null,
							logLevel: "info",
							logger: null,
							scrollback: 1e3,
							scrollOnUserInput: !0,
							scrollSensitivity: 1,
							screenReaderMode: !1,
							smoothScrollDuration: 0,
							macOptionIsMeta: !1,
							macOptionClickForcesSelection: !1,
							minimumContrastRatio: 1,
							disableStdin: !1,
							allowProposedApi: !1,
							allowTransparency: !1,
							tabStopWidth: 8,
							theme: {},
							rescaleOverlappingGlyphs: !1,
							rightClickSelectsWord: i(6114).isMac,
							windowOptions: {},
							windowsMode: !1,
							windowsPty: {},
							wordSeparator: " ()[]{}',\"`",
							altClickMovesCursor: !0,
							convertEol: !1,
							termName: "xterm",
							cancelEvents: !1,
							overviewRulerWidth: 0
						};
						const o = [
							"normal",
							"bold",
							"100",
							"200",
							"300",
							"400",
							"500",
							"600",
							"700",
							"800",
							"900"
						];
						class a extends r.Disposable {
							constructor(e) {
								super(), this._onOptionChange = this.register(new s.EventEmitter()), this.onOptionChange = this._onOptionChange.event;
								const i = { ...t.DEFAULT_OPTIONS };
								for (const t in e) if (t in i) try {
									const s = e[t];
									i[t] = this._sanitizeAndValidateOption(t, s);
								} catch (e) {
									console.error(e);
								}
								this.rawOptions = i, this.options = { ...i }, this._setupOptions(), this.register((0, r.toDisposable)((() => {
									this.rawOptions.linkHandler = null, this.rawOptions.documentOverride = null;
								})));
							}
							onSpecificOptionChange(e, t) {
								return this.onOptionChange(((i) => {
									i === e && t(this.rawOptions[e]);
								}));
							}
							onMultipleOptionChange(e, t) {
								return this.onOptionChange(((i) => {
									-1 !== e.indexOf(i) && t();
								}));
							}
							_setupOptions() {
								const e = (e) => {
									if (!(e in t.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e}"`);
									return this.rawOptions[e];
								}, i = (e, i) => {
									if (!(e in t.DEFAULT_OPTIONS)) throw new Error(`No option with key "${e}"`);
									i = this._sanitizeAndValidateOption(e, i), this.rawOptions[e] !== i && (this.rawOptions[e] = i, this._onOptionChange.fire(e));
								};
								for (const t in this.rawOptions) {
									const s = {
										get: e.bind(this, t),
										set: i.bind(this, t)
									};
									Object.defineProperty(this.options, t, s);
								}
							}
							_sanitizeAndValidateOption(e, i) {
								switch (e) {
									case "cursorStyle":
										if (i || (i = t.DEFAULT_OPTIONS[e]), !function(e) {
											return "block" === e || "underline" === e || "bar" === e;
										}(i)) throw new Error(`"${i}" is not a valid value for ${e}`);
										break;
									case "wordSeparator":
										i || (i = t.DEFAULT_OPTIONS[e]);
										break;
									case "fontWeight":
									case "fontWeightBold":
										if ("number" == typeof i && 1 <= i && i <= 1e3) break;
										i = o.includes(i) ? i : t.DEFAULT_OPTIONS[e];
										break;
									case "cursorWidth": i = Math.floor(i);
									case "lineHeight":
									case "tabStopWidth":
										if (i < 1) throw new Error(`${e} cannot be less than 1, value: ${i}`);
										break;
									case "minimumContrastRatio":
										i = Math.max(1, Math.min(21, Math.round(10 * i) / 10));
										break;
									case "scrollback":
										if ((i = Math.min(i, 4294967295)) < 0) throw new Error(`${e} cannot be less than 0, value: ${i}`);
										break;
									case "fastScrollSensitivity":
									case "scrollSensitivity":
										if (i <= 0) throw new Error(`${e} cannot be less than or equal to 0, value: ${i}`);
										break;
									case "rows":
									case "cols":
										if (!i && 0 !== i) throw new Error(`${e} must be numeric, value: ${i}`);
										break;
									case "windowsPty": i = i ?? {};
								}
								return i;
							}
						}
						t.OptionsService = a;
					},
					2660: function(e, t, i) {
						var s = this && this.__decorate || function(e, t, i, s) {
							var r, n = arguments.length, o = n < 3 ? t : null === s ? s = Object.getOwnPropertyDescriptor(t, i) : s;
							if ("object" == typeof Reflect && "function" == typeof Reflect.decorate) o = Reflect.decorate(e, t, i, s);
							else for (var a = e.length - 1; a >= 0; a--) (r = e[a]) && (o = (n < 3 ? r(o) : n > 3 ? r(t, i, o) : r(t, i)) || o);
							return n > 3 && o && Object.defineProperty(t, i, o), o;
						}, r = this && this.__param || function(e, t) {
							return function(i, s) {
								t(i, s, e);
							};
						};
						Object.defineProperty(t, "__esModule", { value: !0 }), t.OscLinkService = void 0;
						const n = i(2585);
						let o = t.OscLinkService = class {
							constructor(e) {
								this._bufferService = e, this._nextId = 1, this._entriesWithId = /* @__PURE__ */ new Map(), this._dataByLinkId = /* @__PURE__ */ new Map();
							}
							registerLink(e) {
								const t = this._bufferService.buffer;
								if (void 0 === e.id) {
									const i = t.addMarker(t.ybase + t.y), s = {
										data: e,
										id: this._nextId++,
										lines: [i]
									};
									return i.onDispose((() => this._removeMarkerFromLink(s, i))), this._dataByLinkId.set(s.id, s), s.id;
								}
								const i = e, s = this._getEntryIdKey(i), r = this._entriesWithId.get(s);
								if (r) return this.addLineToLink(r.id, t.ybase + t.y), r.id;
								const n = t.addMarker(t.ybase + t.y), o = {
									id: this._nextId++,
									key: this._getEntryIdKey(i),
									data: i,
									lines: [n]
								};
								return n.onDispose((() => this._removeMarkerFromLink(o, n))), this._entriesWithId.set(o.key, o), this._dataByLinkId.set(o.id, o), o.id;
							}
							addLineToLink(e, t) {
								const i = this._dataByLinkId.get(e);
								if (i && i.lines.every(((e) => e.line !== t))) {
									const e = this._bufferService.buffer.addMarker(t);
									i.lines.push(e), e.onDispose((() => this._removeMarkerFromLink(i, e)));
								}
							}
							getLinkData(e) {
								return this._dataByLinkId.get(e)?.data;
							}
							_getEntryIdKey(e) {
								return `${e.id};;${e.uri}`;
							}
							_removeMarkerFromLink(e, t) {
								const i = e.lines.indexOf(t);
								-1 !== i && (e.lines.splice(i, 1), 0 === e.lines.length && (void 0 !== e.data.id && this._entriesWithId.delete(e.key), this._dataByLinkId.delete(e.id)));
							}
						};
						t.OscLinkService = o = s([r(0, n.IBufferService)], o);
					},
					8343: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.createDecorator = t.getServiceDependencies = t.serviceRegistry = void 0;
						const i = "di$target", s = "di$dependencies";
						t.serviceRegistry = /* @__PURE__ */ new Map(), t.getServiceDependencies = function(e) {
							return e[s] || [];
						}, t.createDecorator = function(e) {
							if (t.serviceRegistry.has(e)) return t.serviceRegistry.get(e);
							const r = function(e, t, n) {
								if (3 !== arguments.length) throw new Error("@IServiceName-decorator can only be used to decorate a parameter");
								(function(e, t, r) {
									t[i] === t ? t[s].push({
										id: e,
										index: r
									}) : (t[s] = [{
										id: e,
										index: r
									}], t[i] = t);
								})(r, e, n);
							};
							return r.toString = () => e, t.serviceRegistry.set(e, r), r;
						};
					},
					2585: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.IDecorationService = t.IUnicodeService = t.IOscLinkService = t.IOptionsService = t.ILogService = t.LogLevelEnum = t.IInstantiationService = t.ICharsetService = t.ICoreService = t.ICoreMouseService = t.IBufferService = void 0;
						const s = i(8343);
						var r;
						t.IBufferService = (0, s.createDecorator)("BufferService"), t.ICoreMouseService = (0, s.createDecorator)("CoreMouseService"), t.ICoreService = (0, s.createDecorator)("CoreService"), t.ICharsetService = (0, s.createDecorator)("CharsetService"), t.IInstantiationService = (0, s.createDecorator)("InstantiationService"), function(e) {
							e[e.TRACE = 0] = "TRACE", e[e.DEBUG = 1] = "DEBUG", e[e.INFO = 2] = "INFO", e[e.WARN = 3] = "WARN", e[e.ERROR = 4] = "ERROR", e[e.OFF = 5] = "OFF";
						}(r || (t.LogLevelEnum = r = {})), t.ILogService = (0, s.createDecorator)("LogService"), t.IOptionsService = (0, s.createDecorator)("OptionsService"), t.IOscLinkService = (0, s.createDecorator)("OscLinkService"), t.IUnicodeService = (0, s.createDecorator)("UnicodeService"), t.IDecorationService = (0, s.createDecorator)("DecorationService");
					},
					1480: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeService = void 0;
						const s = i(8460), r = i(225);
						class n {
							static extractShouldJoin(e) {
								return 0 != (1 & e);
							}
							static extractWidth(e) {
								return e >> 1 & 3;
							}
							static extractCharKind(e) {
								return e >> 3;
							}
							static createPropertyValue(e, t, i = !1) {
								return (16777215 & e) << 3 | (3 & t) << 1 | (i ? 1 : 0);
							}
							constructor() {
								this._providers = Object.create(null), this._active = "", this._onChange = new s.EventEmitter(), this.onChange = this._onChange.event;
								const e = new r.UnicodeV6();
								this.register(e), this._active = e.version, this._activeProvider = e;
							}
							dispose() {
								this._onChange.dispose();
							}
							get versions() {
								return Object.keys(this._providers);
							}
							get activeVersion() {
								return this._active;
							}
							set activeVersion(e) {
								if (!this._providers[e]) throw new Error(`unknown Unicode version "${e}"`);
								this._active = e, this._activeProvider = this._providers[e], this._onChange.fire(e);
							}
							register(e) {
								this._providers[e.version] = e;
							}
							wcwidth(e) {
								return this._activeProvider.wcwidth(e);
							}
							getStringCellWidth(e) {
								let t = 0, i = 0;
								const s = e.length;
								for (let r = 0; r < s; ++r) {
									let o = e.charCodeAt(r);
									if (55296 <= o && o <= 56319) {
										if (++r >= s) return t + this.wcwidth(o);
										const i = e.charCodeAt(r);
										56320 <= i && i <= 57343 ? o = 1024 * (o - 55296) + i - 56320 + 65536 : t += this.wcwidth(i);
									}
									const a = this.charProperties(o, i);
									let h = n.extractWidth(a);
									n.extractShouldJoin(a) && (h -= n.extractWidth(i)), t += h, i = a;
								}
								return t;
							}
							charProperties(e, t) {
								return this._activeProvider.charProperties(e, t);
							}
						}
						t.UnicodeService = n;
					}
				}, t = {};
				function i(s) {
					var r = t[s];
					if (void 0 !== r) return r.exports;
					var n = t[s] = { exports: {} };
					return e[s].call(n.exports, n, n.exports, i), n.exports;
				}
				var s = {};
				return (() => {
					var e = s;
					Object.defineProperty(e, "__esModule", { value: !0 }), e.Terminal = void 0;
					const t = i(9042), r = i(3236), n = i(844), o = i(5741), a = i(8285), h = i(7975), c = i(7090), l = ["cols", "rows"];
					class d extends n.Disposable {
						constructor(e) {
							super(), this._core = this.register(new r.Terminal(e)), this._addonManager = this.register(new o.AddonManager()), this._publicOptions = { ...this._core.options };
							const t = (e) => this._core.options[e], i = (e, t) => {
								this._checkReadonlyOptions(e), this._core.options[e] = t;
							};
							for (const e in this._core.options) {
								const s = {
									get: t.bind(this, e),
									set: i.bind(this, e)
								};
								Object.defineProperty(this._publicOptions, e, s);
							}
						}
						_checkReadonlyOptions(e) {
							if (l.includes(e)) throw new Error(`Option "${e}" can only be set in the constructor`);
						}
						_checkProposedApi() {
							if (!this._core.optionsService.rawOptions.allowProposedApi) throw new Error("You must set the allowProposedApi option to true to use proposed API");
						}
						get onBell() {
							return this._core.onBell;
						}
						get onBinary() {
							return this._core.onBinary;
						}
						get onCursorMove() {
							return this._core.onCursorMove;
						}
						get onData() {
							return this._core.onData;
						}
						get onKey() {
							return this._core.onKey;
						}
						get onLineFeed() {
							return this._core.onLineFeed;
						}
						get onRender() {
							return this._core.onRender;
						}
						get onResize() {
							return this._core.onResize;
						}
						get onScroll() {
							return this._core.onScroll;
						}
						get onSelectionChange() {
							return this._core.onSelectionChange;
						}
						get onTitleChange() {
							return this._core.onTitleChange;
						}
						get onWriteParsed() {
							return this._core.onWriteParsed;
						}
						get element() {
							return this._core.element;
						}
						get parser() {
							return this._parser || (this._parser = new h.ParserApi(this._core)), this._parser;
						}
						get unicode() {
							return this._checkProposedApi(), new c.UnicodeApi(this._core);
						}
						get textarea() {
							return this._core.textarea;
						}
						get rows() {
							return this._core.rows;
						}
						get cols() {
							return this._core.cols;
						}
						get buffer() {
							return this._buffer || (this._buffer = this.register(new a.BufferNamespaceApi(this._core))), this._buffer;
						}
						get markers() {
							return this._checkProposedApi(), this._core.markers;
						}
						get modes() {
							const e = this._core.coreService.decPrivateModes;
							let t = "none";
							switch (this._core.coreMouseService.activeProtocol) {
								case "X10":
									t = "x10";
									break;
								case "VT200":
									t = "vt200";
									break;
								case "DRAG":
									t = "drag";
									break;
								case "ANY": t = "any";
							}
							return {
								applicationCursorKeysMode: e.applicationCursorKeys,
								applicationKeypadMode: e.applicationKeypad,
								bracketedPasteMode: e.bracketedPasteMode,
								insertMode: this._core.coreService.modes.insertMode,
								mouseTrackingMode: t,
								originMode: e.origin,
								reverseWraparoundMode: e.reverseWraparound,
								sendFocusMode: e.sendFocus,
								wraparoundMode: e.wraparound
							};
						}
						get options() {
							return this._publicOptions;
						}
						set options(e) {
							for (const t in e) this._publicOptions[t] = e[t];
						}
						blur() {
							this._core.blur();
						}
						focus() {
							this._core.focus();
						}
						input(e, t = !0) {
							this._core.input(e, t);
						}
						resize(e, t) {
							this._verifyIntegers(e, t), this._core.resize(e, t);
						}
						open(e) {
							this._core.open(e);
						}
						attachCustomKeyEventHandler(e) {
							this._core.attachCustomKeyEventHandler(e);
						}
						attachCustomWheelEventHandler(e) {
							this._core.attachCustomWheelEventHandler(e);
						}
						registerLinkProvider(e) {
							return this._core.registerLinkProvider(e);
						}
						registerCharacterJoiner(e) {
							return this._checkProposedApi(), this._core.registerCharacterJoiner(e);
						}
						deregisterCharacterJoiner(e) {
							this._checkProposedApi(), this._core.deregisterCharacterJoiner(e);
						}
						registerMarker(e = 0) {
							return this._verifyIntegers(e), this._core.registerMarker(e);
						}
						registerDecoration(e) {
							return this._checkProposedApi(), this._verifyPositiveIntegers(e.x ?? 0, e.width ?? 0, e.height ?? 0), this._core.registerDecoration(e);
						}
						hasSelection() {
							return this._core.hasSelection();
						}
						select(e, t, i) {
							this._verifyIntegers(e, t, i), this._core.select(e, t, i);
						}
						getSelection() {
							return this._core.getSelection();
						}
						getSelectionPosition() {
							return this._core.getSelectionPosition();
						}
						clearSelection() {
							this._core.clearSelection();
						}
						selectAll() {
							this._core.selectAll();
						}
						selectLines(e, t) {
							this._verifyIntegers(e, t), this._core.selectLines(e, t);
						}
						dispose() {
							super.dispose();
						}
						scrollLines(e) {
							this._verifyIntegers(e), this._core.scrollLines(e);
						}
						scrollPages(e) {
							this._verifyIntegers(e), this._core.scrollPages(e);
						}
						scrollToTop() {
							this._core.scrollToTop();
						}
						scrollToBottom() {
							this._core.scrollToBottom();
						}
						scrollToLine(e) {
							this._verifyIntegers(e), this._core.scrollToLine(e);
						}
						clear() {
							this._core.clear();
						}
						write(e, t) {
							this._core.write(e, t);
						}
						writeln(e, t) {
							this._core.write(e), this._core.write("\r\n", t);
						}
						paste(e) {
							this._core.paste(e);
						}
						refresh(e, t) {
							this._verifyIntegers(e, t), this._core.refresh(e, t);
						}
						reset() {
							this._core.reset();
						}
						clearTextureAtlas() {
							this._core.clearTextureAtlas();
						}
						loadAddon(e) {
							this._addonManager.loadAddon(this, e);
						}
						static get strings() {
							return t;
						}
						_verifyIntegers(...e) {
							for (const t of e) if (t === 1 / 0 || isNaN(t) || t % 1 != 0) throw new Error("This API only accepts integers");
						}
						_verifyPositiveIntegers(...e) {
							for (const t of e) if (t && (t === 1 / 0 || isNaN(t) || t % 1 != 0 || t < 0)) throw new Error("This API only accepts positive integers");
						}
					}
					e.Terminal = d;
				})(), s;
			})()));
		}));
		//#endregion
		//#region node_modules/.pnpm/@xterm+addon-fit@0.10.0_@xterm+xterm@5.5.0/node_modules/@xterm/addon-fit/lib/addon-fit.js
		var require_addon_fit = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			(function(e, t) {
				"object" == typeof exports && "object" == typeof module ? module.exports = t() : "function" == typeof define && define.amd ? define([], t) : "object" == typeof exports ? exports.FitAddon = t() : e.FitAddon = t();
			})(self, (() => (() => {
				"use strict";
				var e = {};
				return (() => {
					var t = e;
					Object.defineProperty(t, "__esModule", { value: !0 }), t.FitAddon = void 0, t.FitAddon = class {
						activate(e) {
							this._terminal = e;
						}
						dispose() {}
						fit() {
							const e = this.proposeDimensions();
							if (!e || !this._terminal || isNaN(e.cols) || isNaN(e.rows)) return;
							const t = this._terminal._core;
							this._terminal.rows === e.rows && this._terminal.cols === e.cols || (t._renderService.clear(), this._terminal.resize(e.cols, e.rows));
						}
						proposeDimensions() {
							if (!this._terminal) return;
							if (!this._terminal.element || !this._terminal.element.parentElement) return;
							const e = this._terminal._core, t = e._renderService.dimensions;
							if (0 === t.css.cell.width || 0 === t.css.cell.height) return;
							const r = 0 === this._terminal.options.scrollback ? 0 : e.viewport.scrollBarWidth, i = window.getComputedStyle(this._terminal.element.parentElement), o = parseInt(i.getPropertyValue("height")), s = Math.max(0, parseInt(i.getPropertyValue("width"))), n = window.getComputedStyle(this._terminal.element), l = o - (parseInt(n.getPropertyValue("padding-top")) + parseInt(n.getPropertyValue("padding-bottom"))), a = s - (parseInt(n.getPropertyValue("padding-right")) + parseInt(n.getPropertyValue("padding-left"))) - r;
							return {
								cols: Math.max(2, Math.floor(a / t.css.cell.width)),
								rows: Math.max(1, Math.floor(l / t.css.cell.height))
							};
						}
					};
				})(), e;
			})()));
		}));
		//#endregion
		//#region node_modules/.pnpm/@xterm+addon-unicode11@0.8.0_@xterm+xterm@5.5.0/node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js
		var require_addon_unicode11 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
			(function(e, t) {
				"object" == typeof exports && "object" == typeof module ? module.exports = t() : "function" == typeof define && define.amd ? define([], t) : "object" == typeof exports ? exports.Unicode11Addon = t() : e.Unicode11Addon = t();
			})(exports, (() => (() => {
				"use strict";
				var e = {
					433: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeV11 = void 0;
						const r = i(938), s = [
							[768, 879],
							[1155, 1161],
							[1425, 1469],
							[1471, 1471],
							[1473, 1474],
							[1476, 1477],
							[1479, 1479],
							[1536, 1541],
							[1552, 1562],
							[1564, 1564],
							[1611, 1631],
							[1648, 1648],
							[1750, 1757],
							[1759, 1764],
							[1767, 1768],
							[1770, 1773],
							[1807, 1807],
							[1809, 1809],
							[1840, 1866],
							[1958, 1968],
							[2027, 2035],
							[2045, 2045],
							[2070, 2073],
							[2075, 2083],
							[2085, 2087],
							[2089, 2093],
							[2137, 2139],
							[2259, 2306],
							[2362, 2362],
							[2364, 2364],
							[2369, 2376],
							[2381, 2381],
							[2385, 2391],
							[2402, 2403],
							[2433, 2433],
							[2492, 2492],
							[2497, 2500],
							[2509, 2509],
							[2530, 2531],
							[2558, 2558],
							[2561, 2562],
							[2620, 2620],
							[2625, 2626],
							[2631, 2632],
							[2635, 2637],
							[2641, 2641],
							[2672, 2673],
							[2677, 2677],
							[2689, 2690],
							[2748, 2748],
							[2753, 2757],
							[2759, 2760],
							[2765, 2765],
							[2786, 2787],
							[2810, 2815],
							[2817, 2817],
							[2876, 2876],
							[2879, 2879],
							[2881, 2884],
							[2893, 2893],
							[2902, 2902],
							[2914, 2915],
							[2946, 2946],
							[3008, 3008],
							[3021, 3021],
							[3072, 3072],
							[3076, 3076],
							[3134, 3136],
							[3142, 3144],
							[3146, 3149],
							[3157, 3158],
							[3170, 3171],
							[3201, 3201],
							[3260, 3260],
							[3263, 3263],
							[3270, 3270],
							[3276, 3277],
							[3298, 3299],
							[3328, 3329],
							[3387, 3388],
							[3393, 3396],
							[3405, 3405],
							[3426, 3427],
							[3530, 3530],
							[3538, 3540],
							[3542, 3542],
							[3633, 3633],
							[3636, 3642],
							[3655, 3662],
							[3761, 3761],
							[3764, 3772],
							[3784, 3789],
							[3864, 3865],
							[3893, 3893],
							[3895, 3895],
							[3897, 3897],
							[3953, 3966],
							[3968, 3972],
							[3974, 3975],
							[3981, 3991],
							[3993, 4028],
							[4038, 4038],
							[4141, 4144],
							[4146, 4151],
							[4153, 4154],
							[4157, 4158],
							[4184, 4185],
							[4190, 4192],
							[4209, 4212],
							[4226, 4226],
							[4229, 4230],
							[4237, 4237],
							[4253, 4253],
							[4448, 4607],
							[4957, 4959],
							[5906, 5908],
							[5938, 5940],
							[5970, 5971],
							[6002, 6003],
							[6068, 6069],
							[6071, 6077],
							[6086, 6086],
							[6089, 6099],
							[6109, 6109],
							[6155, 6158],
							[6277, 6278],
							[6313, 6313],
							[6432, 6434],
							[6439, 6440],
							[6450, 6450],
							[6457, 6459],
							[6679, 6680],
							[6683, 6683],
							[6742, 6742],
							[6744, 6750],
							[6752, 6752],
							[6754, 6754],
							[6757, 6764],
							[6771, 6780],
							[6783, 6783],
							[6832, 6846],
							[6912, 6915],
							[6964, 6964],
							[6966, 6970],
							[6972, 6972],
							[6978, 6978],
							[7019, 7027],
							[7040, 7041],
							[7074, 7077],
							[7080, 7081],
							[7083, 7085],
							[7142, 7142],
							[7144, 7145],
							[7149, 7149],
							[7151, 7153],
							[7212, 7219],
							[7222, 7223],
							[7376, 7378],
							[7380, 7392],
							[7394, 7400],
							[7405, 7405],
							[7412, 7412],
							[7416, 7417],
							[7616, 7673],
							[7675, 7679],
							[8203, 8207],
							[8234, 8238],
							[8288, 8292],
							[8294, 8303],
							[8400, 8432],
							[11503, 11505],
							[11647, 11647],
							[11744, 11775],
							[12330, 12333],
							[12441, 12442],
							[42607, 42610],
							[42612, 42621],
							[42654, 42655],
							[42736, 42737],
							[43010, 43010],
							[43014, 43014],
							[43019, 43019],
							[43045, 43046],
							[43204, 43205],
							[43232, 43249],
							[43263, 43263],
							[43302, 43309],
							[43335, 43345],
							[43392, 43394],
							[43443, 43443],
							[43446, 43449],
							[43452, 43453],
							[43493, 43493],
							[43561, 43566],
							[43569, 43570],
							[43573, 43574],
							[43587, 43587],
							[43596, 43596],
							[43644, 43644],
							[43696, 43696],
							[43698, 43700],
							[43703, 43704],
							[43710, 43711],
							[43713, 43713],
							[43756, 43757],
							[43766, 43766],
							[44005, 44005],
							[44008, 44008],
							[44013, 44013],
							[64286, 64286],
							[65024, 65039],
							[65056, 65071],
							[65279, 65279],
							[65529, 65531]
						], n = [
							[66045, 66045],
							[66272, 66272],
							[66422, 66426],
							[68097, 68099],
							[68101, 68102],
							[68108, 68111],
							[68152, 68154],
							[68159, 68159],
							[68325, 68326],
							[68900, 68903],
							[69446, 69456],
							[69633, 69633],
							[69688, 69702],
							[69759, 69761],
							[69811, 69814],
							[69817, 69818],
							[69821, 69821],
							[69837, 69837],
							[69888, 69890],
							[69927, 69931],
							[69933, 69940],
							[70003, 70003],
							[70016, 70017],
							[70070, 70078],
							[70089, 70092],
							[70191, 70193],
							[70196, 70196],
							[70198, 70199],
							[70206, 70206],
							[70367, 70367],
							[70371, 70378],
							[70400, 70401],
							[70459, 70460],
							[70464, 70464],
							[70502, 70508],
							[70512, 70516],
							[70712, 70719],
							[70722, 70724],
							[70726, 70726],
							[70750, 70750],
							[70835, 70840],
							[70842, 70842],
							[70847, 70848],
							[70850, 70851],
							[71090, 71093],
							[71100, 71101],
							[71103, 71104],
							[71132, 71133],
							[71219, 71226],
							[71229, 71229],
							[71231, 71232],
							[71339, 71339],
							[71341, 71341],
							[71344, 71349],
							[71351, 71351],
							[71453, 71455],
							[71458, 71461],
							[71463, 71467],
							[71727, 71735],
							[71737, 71738],
							[72148, 72151],
							[72154, 72155],
							[72160, 72160],
							[72193, 72202],
							[72243, 72248],
							[72251, 72254],
							[72263, 72263],
							[72273, 72278],
							[72281, 72283],
							[72330, 72342],
							[72344, 72345],
							[72752, 72758],
							[72760, 72765],
							[72767, 72767],
							[72850, 72871],
							[72874, 72880],
							[72882, 72883],
							[72885, 72886],
							[73009, 73014],
							[73018, 73018],
							[73020, 73021],
							[73023, 73029],
							[73031, 73031],
							[73104, 73105],
							[73109, 73109],
							[73111, 73111],
							[73459, 73460],
							[78896, 78904],
							[92912, 92916],
							[92976, 92982],
							[94031, 94031],
							[94095, 94098],
							[113821, 113822],
							[113824, 113827],
							[119143, 119145],
							[119155, 119170],
							[119173, 119179],
							[119210, 119213],
							[119362, 119364],
							[121344, 121398],
							[121403, 121452],
							[121461, 121461],
							[121476, 121476],
							[121499, 121503],
							[121505, 121519],
							[122880, 122886],
							[122888, 122904],
							[122907, 122913],
							[122915, 122916],
							[122918, 122922],
							[123184, 123190],
							[123628, 123631],
							[125136, 125142],
							[125252, 125258],
							[917505, 917505],
							[917536, 917631],
							[917760, 917999]
						], o = [
							[4352, 4447],
							[8986, 8987],
							[9001, 9002],
							[9193, 9196],
							[9200, 9200],
							[9203, 9203],
							[9725, 9726],
							[9748, 9749],
							[9800, 9811],
							[9855, 9855],
							[9875, 9875],
							[9889, 9889],
							[9898, 9899],
							[9917, 9918],
							[9924, 9925],
							[9934, 9934],
							[9940, 9940],
							[9962, 9962],
							[9970, 9971],
							[9973, 9973],
							[9978, 9978],
							[9981, 9981],
							[9989, 9989],
							[9994, 9995],
							[10024, 10024],
							[10060, 10060],
							[10062, 10062],
							[10067, 10069],
							[10071, 10071],
							[10133, 10135],
							[10160, 10160],
							[10175, 10175],
							[11035, 11036],
							[11088, 11088],
							[11093, 11093],
							[11904, 11929],
							[11931, 12019],
							[12032, 12245],
							[12272, 12283],
							[12288, 12329],
							[12334, 12350],
							[12353, 12438],
							[12443, 12543],
							[12549, 12591],
							[12593, 12686],
							[12688, 12730],
							[12736, 12771],
							[12784, 12830],
							[12832, 12871],
							[12880, 19903],
							[19968, 42124],
							[42128, 42182],
							[43360, 43388],
							[44032, 55203],
							[63744, 64255],
							[65040, 65049],
							[65072, 65106],
							[65108, 65126],
							[65128, 65131],
							[65281, 65376],
							[65504, 65510]
						], c = [
							[94176, 94179],
							[94208, 100343],
							[100352, 101106],
							[110592, 110878],
							[110928, 110930],
							[110948, 110951],
							[110960, 111355],
							[126980, 126980],
							[127183, 127183],
							[127374, 127374],
							[127377, 127386],
							[127488, 127490],
							[127504, 127547],
							[127552, 127560],
							[127568, 127569],
							[127584, 127589],
							[127744, 127776],
							[127789, 127797],
							[127799, 127868],
							[127870, 127891],
							[127904, 127946],
							[127951, 127955],
							[127968, 127984],
							[127988, 127988],
							[127992, 128062],
							[128064, 128064],
							[128066, 128252],
							[128255, 128317],
							[128331, 128334],
							[128336, 128359],
							[128378, 128378],
							[128405, 128406],
							[128420, 128420],
							[128507, 128591],
							[128640, 128709],
							[128716, 128716],
							[128720, 128722],
							[128725, 128725],
							[128747, 128748],
							[128756, 128762],
							[128992, 129003],
							[129293, 129393],
							[129395, 129398],
							[129402, 129442],
							[129445, 129450],
							[129454, 129482],
							[129485, 129535],
							[129648, 129651],
							[129656, 129658],
							[129664, 129666],
							[129680, 129685],
							[131072, 196605],
							[196608, 262141]
						];
						let l;
						function d(e, t) {
							let i, r = 0, s = t.length - 1;
							if (e < t[0][0] || e > t[s][1]) return !1;
							for (; s >= r;) if (i = r + s >> 1, e > t[i][1]) r = i + 1;
							else {
								if (!(e < t[i][0])) return !0;
								s = i - 1;
							}
							return !1;
						}
						t.UnicodeV11 = class {
							constructor() {
								if (this.version = "11", !l) {
									l = /* @__PURE__ */ new Uint8Array(65536), l.fill(1), l[0] = 0, l.fill(0, 1, 32), l.fill(0, 127, 160);
									for (let e = 0; e < s.length; ++e) l.fill(0, s[e][0], s[e][1] + 1);
									for (let e = 0; e < o.length; ++e) l.fill(2, o[e][0], o[e][1] + 1);
								}
							}
							wcwidth(e) {
								return e < 32 ? 0 : e < 127 ? 1 : e < 65536 ? l[e] : d(e, n) ? 0 : d(e, c) ? 2 : 1;
							}
							charProperties(e, t) {
								let i = this.wcwidth(e), s = 0 === i && 0 !== t;
								if (s) {
									const e = r.UnicodeService.extractWidth(t);
									0 === e ? s = !1 : e > i && (i = e);
								}
								return r.UnicodeService.createPropertyValue(0, i, s);
							}
						};
					},
					345: (e, t) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.runAndSubscribe = t.forwardEvent = t.EventEmitter = void 0, t.EventEmitter = class {
							constructor() {
								this._listeners = [], this._disposed = !1;
							}
							get event() {
								return this._event || (this._event = (e) => (this._listeners.push(e), { dispose: () => {
									if (!this._disposed) {
										for (let t = 0; t < this._listeners.length; t++) if (this._listeners[t] === e) return void this._listeners.splice(t, 1);
									}
								} })), this._event;
							}
							fire(e, t) {
								const i = [];
								for (let e = 0; e < this._listeners.length; e++) i.push(this._listeners[e]);
								for (let r = 0; r < i.length; r++) i[r].call(void 0, e, t);
							}
							dispose() {
								this.clearListeners(), this._disposed = !0;
							}
							clearListeners() {
								this._listeners && (this._listeners.length = 0);
							}
						}, t.forwardEvent = function(e, t) {
							return e(((e) => t.fire(e)));
						}, t.runAndSubscribe = function(e, t) {
							return t(void 0), e(((e) => t(e)));
						};
					},
					490: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeV6 = void 0;
						const r = i(938), s = [
							[768, 879],
							[1155, 1158],
							[1160, 1161],
							[1425, 1469],
							[1471, 1471],
							[1473, 1474],
							[1476, 1477],
							[1479, 1479],
							[1536, 1539],
							[1552, 1557],
							[1611, 1630],
							[1648, 1648],
							[1750, 1764],
							[1767, 1768],
							[1770, 1773],
							[1807, 1807],
							[1809, 1809],
							[1840, 1866],
							[1958, 1968],
							[2027, 2035],
							[2305, 2306],
							[2364, 2364],
							[2369, 2376],
							[2381, 2381],
							[2385, 2388],
							[2402, 2403],
							[2433, 2433],
							[2492, 2492],
							[2497, 2500],
							[2509, 2509],
							[2530, 2531],
							[2561, 2562],
							[2620, 2620],
							[2625, 2626],
							[2631, 2632],
							[2635, 2637],
							[2672, 2673],
							[2689, 2690],
							[2748, 2748],
							[2753, 2757],
							[2759, 2760],
							[2765, 2765],
							[2786, 2787],
							[2817, 2817],
							[2876, 2876],
							[2879, 2879],
							[2881, 2883],
							[2893, 2893],
							[2902, 2902],
							[2946, 2946],
							[3008, 3008],
							[3021, 3021],
							[3134, 3136],
							[3142, 3144],
							[3146, 3149],
							[3157, 3158],
							[3260, 3260],
							[3263, 3263],
							[3270, 3270],
							[3276, 3277],
							[3298, 3299],
							[3393, 3395],
							[3405, 3405],
							[3530, 3530],
							[3538, 3540],
							[3542, 3542],
							[3633, 3633],
							[3636, 3642],
							[3655, 3662],
							[3761, 3761],
							[3764, 3769],
							[3771, 3772],
							[3784, 3789],
							[3864, 3865],
							[3893, 3893],
							[3895, 3895],
							[3897, 3897],
							[3953, 3966],
							[3968, 3972],
							[3974, 3975],
							[3984, 3991],
							[3993, 4028],
							[4038, 4038],
							[4141, 4144],
							[4146, 4146],
							[4150, 4151],
							[4153, 4153],
							[4184, 4185],
							[4448, 4607],
							[4959, 4959],
							[5906, 5908],
							[5938, 5940],
							[5970, 5971],
							[6002, 6003],
							[6068, 6069],
							[6071, 6077],
							[6086, 6086],
							[6089, 6099],
							[6109, 6109],
							[6155, 6157],
							[6313, 6313],
							[6432, 6434],
							[6439, 6440],
							[6450, 6450],
							[6457, 6459],
							[6679, 6680],
							[6912, 6915],
							[6964, 6964],
							[6966, 6970],
							[6972, 6972],
							[6978, 6978],
							[7019, 7027],
							[7616, 7626],
							[7678, 7679],
							[8203, 8207],
							[8234, 8238],
							[8288, 8291],
							[8298, 8303],
							[8400, 8431],
							[12330, 12335],
							[12441, 12442],
							[43014, 43014],
							[43019, 43019],
							[43045, 43046],
							[64286, 64286],
							[65024, 65039],
							[65056, 65059],
							[65279, 65279],
							[65529, 65531]
						], n = [
							[68097, 68099],
							[68101, 68102],
							[68108, 68111],
							[68152, 68154],
							[68159, 68159],
							[119143, 119145],
							[119155, 119170],
							[119173, 119179],
							[119210, 119213],
							[119362, 119364],
							[917505, 917505],
							[917536, 917631],
							[917760, 917999]
						];
						let o;
						t.UnicodeV6 = class {
							constructor() {
								if (this.version = "6", !o) {
									o = /* @__PURE__ */ new Uint8Array(65536), o.fill(1), o[0] = 0, o.fill(0, 1, 32), o.fill(0, 127, 160), o.fill(2, 4352, 4448), o[9001] = 2, o[9002] = 2, o.fill(2, 11904, 42192), o[12351] = 1, o.fill(2, 44032, 55204), o.fill(2, 63744, 64256), o.fill(2, 65040, 65050), o.fill(2, 65072, 65136), o.fill(2, 65280, 65377), o.fill(2, 65504, 65511);
									for (let e = 0; e < s.length; ++e) o.fill(0, s[e][0], s[e][1] + 1);
								}
							}
							wcwidth(e) {
								return e < 32 ? 0 : e < 127 ? 1 : e < 65536 ? o[e] : function(e, t) {
									let i, r = 0, s = t.length - 1;
									if (e < t[0][0] || e > t[s][1]) return !1;
									for (; s >= r;) if (i = r + s >> 1, e > t[i][1]) r = i + 1;
									else {
										if (!(e < t[i][0])) return !0;
										s = i - 1;
									}
									return !1;
								}(e, n) ? 0 : e >= 131072 && e <= 196605 || e >= 196608 && e <= 262141 ? 2 : 1;
							}
							charProperties(e, t) {
								let i = this.wcwidth(e), s = 0 === i && 0 !== t;
								if (s) {
									const e = r.UnicodeService.extractWidth(t);
									0 === e ? s = !1 : e > i && (i = e);
								}
								return r.UnicodeService.createPropertyValue(0, i, s);
							}
						};
					},
					938: (e, t, i) => {
						Object.defineProperty(t, "__esModule", { value: !0 }), t.UnicodeService = void 0;
						const r = i(345), s = i(490);
						class n {
							static extractShouldJoin(e) {
								return 0 != (1 & e);
							}
							static extractWidth(e) {
								return e >> 1 & 3;
							}
							static extractCharKind(e) {
								return e >> 3;
							}
							static createPropertyValue(e, t, i = !1) {
								return (16777215 & e) << 3 | (3 & t) << 1 | (i ? 1 : 0);
							}
							constructor() {
								this._providers = Object.create(null), this._active = "", this._onChange = new r.EventEmitter(), this.onChange = this._onChange.event;
								const e = new s.UnicodeV6();
								this.register(e), this._active = e.version, this._activeProvider = e;
							}
							dispose() {
								this._onChange.dispose();
							}
							get versions() {
								return Object.keys(this._providers);
							}
							get activeVersion() {
								return this._active;
							}
							set activeVersion(e) {
								if (!this._providers[e]) throw new Error(`unknown Unicode version "${e}"`);
								this._active = e, this._activeProvider = this._providers[e], this._onChange.fire(e);
							}
							register(e) {
								this._providers[e.version] = e;
							}
							wcwidth(e) {
								return this._activeProvider.wcwidth(e);
							}
							getStringCellWidth(e) {
								let t = 0, i = 0;
								const r = e.length;
								for (let s = 0; s < r; ++s) {
									let o = e.charCodeAt(s);
									if (55296 <= o && o <= 56319) {
										if (++s >= r) return t + this.wcwidth(o);
										const i = e.charCodeAt(s);
										56320 <= i && i <= 57343 ? o = 1024 * (o - 55296) + i - 56320 + 65536 : t += this.wcwidth(i);
									}
									const c = this.charProperties(o, i);
									let l = n.extractWidth(c);
									n.extractShouldJoin(c) && (l -= n.extractWidth(i)), t += l, i = c;
								}
								return t;
							}
							charProperties(e, t) {
								return this._activeProvider.charProperties(e, t);
							}
						}
						t.UnicodeService = n;
					}
				}, t = {};
				function i(r) {
					var s = t[r];
					if (void 0 !== s) return s.exports;
					var n = t[r] = { exports: {} };
					return e[r](n, n.exports, i), n.exports;
				}
				var r = {};
				return (() => {
					var e = r;
					Object.defineProperty(e, "__esModule", { value: !0 }), e.Unicode11Addon = void 0;
					const t = i(433);
					e.Unicode11Addon = class {
						activate(e) {
							e.unicode.register(new t.UnicodeV11());
						}
						dispose() {}
					};
				})(), r;
			})()));
		}));
		//#endregion
		//#region src/client/terminal-theme.ts
		var import_xterm = require_xterm();
		var import_addon_fit = require_addon_fit();
		var import_addon_unicode11 = require_addon_unicode11();
		/** CSS custom properties defined on .dcs-term, each aliasing a DSH token. */
		const TERMINAL_THEME_VARS = {
			background: "--dcs-term-bg",
			foreground: "--dcs-term-fg",
			cursor: "--dcs-term-cursor",
			cursorAccent: "--dcs-term-cursor-accent",
			selectionBackground: "--dcs-term-selection",
			black: "--dcs-term-black",
			red: "--dcs-term-red",
			green: "--dcs-term-green",
			yellow: "--dcs-term-yellow",
			blue: "--dcs-term-blue",
			magenta: "--dcs-term-magenta",
			cyan: "--dcs-term-cyan",
			white: "--dcs-term-white",
			brightBlack: "--dcs-term-bright-black",
			brightRed: "--dcs-term-bright-red",
			brightGreen: "--dcs-term-bright-green",
			brightYellow: "--dcs-term-bright-yellow",
			brightBlue: "--dcs-term-bright-blue",
			brightMagenta: "--dcs-term-bright-magenta",
			brightCyan: "--dcs-term-bright-cyan",
			brightWhite: "--dcs-term-bright-white"
		};
		function readTerminalTheme(el, readVar) {
			const read = readVar ?? ((name) => {
				return getComputedStyle(el).getPropertyValue(name).trim();
			});
			const theme = {};
			for (const key of Object.keys(TERMINAL_THEME_VARS)) theme[key] = read(TERMINAL_THEME_VARS[key]);
			return theme;
		}
		function watchTerminalTheme(el, apply) {
			const push = () => {
				apply(readTerminalTheme(el));
			};
			push();
			if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
			const obs = new MutationObserver(push);
			obs.observe(document.body, {
				attributes: true,
				attributeFilter: [
					"data-ds-dark-theme",
					"style",
					"class"
				]
			});
			obs.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["style", "class"]
			});
			const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : void 0;
			mq?.addEventListener("change", push);
			return () => {
				obs.disconnect();
				mq?.removeEventListener("change", push);
			};
		}
		//#endregion
		//#region src/client/terminal-options.ts
		/** xterm constructor options shared with the Unicode 11 addon contract test. */
		const TERMINAL_GRAPHICS_FONT = "\"DCS Terminal Graphics\"";
		function terminalFontFamily(hostFont) {
			const themed = hostFont.trim();
			return `${TERMINAL_GRAPHICS_FONT}, ${themed.length > 0 ? themed + ", " : ""}ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
		}
		function terminalOptions(fontFamily) {
			return {
				allowProposedApi: true,
				convertEol: false,
				cursorBlink: true,
				fontSize: 13,
				lineHeight: 1,
				letterSpacing: 0,
				customGlyphs: true,
				rescaleOverlappingGlyphs: false,
				fontFamily
			};
		}
		//#endregion
		//#region src/client/serial-pull.ts
		function startSerialPull(options) {
			let inFlight = false;
			let stopped = false;
			const tick = () => {
				if (stopped || inFlight) return;
				inFlight = true;
				options.pull().then((pulled) => {
					if (stopped || pulled === void 0) return;
					options.onResult(pulled);
				}).catch(() => {}).finally(() => {
					inFlight = false;
				});
			};
			const timer = setInterval(tick, options.intervalMs);
			return () => {
				stopped = true;
				clearInterval(timer);
			};
		}
		//#endregion
		//#region src/client/TerminalPane.tsx
		/** Terminal 工具 pane: xterm.js over the human pty, one emulator per Tab. */
		function TerminalPane({ snapshot, onIntent, tabId, onPull }) {
			const hostRef = (0, react.useRef)(null);
			const termRef = (0, react.useRef)(null);
			const seqRef = (0, react.useRef)(0);
			const onPullRef = (0, react.useRef)(onPull);
			const onIntentRef = (0, react.useRef)(onIntent);
			onPullRef.current = onPull;
			onIntentRef.current = onIntent;
			const pty = snapshot.terminal.byTab[tabId];
			(0, react.useEffect)(() => {
				const host = hostRef.current;
				if (host === null) return;
				seqRef.current = 0;
				const hostFont = getComputedStyle(host).getPropertyValue("--ds-font-family-code").trim();
				const term = new import_xterm.Terminal(terminalOptions(terminalFontFamily(hostFont)));
				const fit = new import_addon_fit.FitAddon();
				const unicode11 = new import_addon_unicode11.Unicode11Addon();
				term.loadAddon(fit);
				term.loadAddon(unicode11);
				term.unicode.activeVersion = "11";
				term.open(host);
				const stopTheme = watchTerminalTheme(host, (theme) => {
					term.options.theme = theme;
				});
				try {
					fit.fit();
				} catch {}
				termRef.current = term;
				const writeSub = term.onData((bytes) => {
					onIntent({
						type: "terminal-write",
						tabId,
						bytes
					});
				});
				const sendSize = () => {
					try {
						fit.fit();
					} catch {
						return;
					}
					onIntent({
						type: "terminal-resize",
						tabId,
						cols: term.cols,
						rows: term.rows
					});
				};
				onIntent({
					type: "terminal-open",
					tabId,
					cols: term.cols,
					rows: term.rows
				});
				const ro = new ResizeObserver(() => {
					sendSize();
				});
				ro.observe(host);
				term.focus();
				return () => {
					stopTheme();
					ro.disconnect();
					writeSub.dispose();
					termRef.current = null;
					term.dispose();
				};
			}, [tabId]);
			(0, react.useEffect)(() => {
				return startSerialPull({
					intervalMs: 80,
					pull: () => {
						const pull = onPullRef.current;
						if (pull !== void 0) return pull(tabId, seqRef.current);
						onIntentRef.current({
							type: "terminal-refresh",
							tabId,
							since: seqRef.current
						});
						return Promise.resolve(void 0);
					},
					onResult: (pulled) => {
						if (pulled.seq <= seqRef.current || pulled.chunk.length === 0) return;
						termRef.current?.write(pulled.chunk);
						seqRef.current = pulled.seq;
					}
				});
			}, [tabId]);
			(0, react.useEffect)(() => {
				const live = new Set(snapshot.tabs.filter((tab) => tab.kind === "Terminal").map((tab) => tab.id));
				for (const id of Object.keys(snapshot.terminal.byTab)) if (!live.has(id)) onIntent({
					type: "terminal-destroy",
					tabId: id
				});
			}, [snapshot.tabs, snapshot.terminal.byTab]);
			(0, react.useEffect)(() => {
				const seq = pty?.seq ?? 0;
				const chunk = pty?.chunk ?? "";
				if (seq <= seqRef.current || chunk.length === 0) return;
				termRef.current?.write(chunk);
				seqRef.current = seq;
			}, [pty?.seq, pty?.chunk]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: hostRef,
				className: "dcs-term",
				onClick: () => {
					termRef.current?.focus();
				}
			});
		}
		//#endregion
		//#region src/client/TerminalRail.tsx
		/** Session rail inside Terminal: list, create, and switch human ptys. */
		function TerminalRail({ snapshot, onIntent, tabId, t }) {
			const [collapsed, setCollapsed] = (0, react.useState)(false);
			const sessions = snapshot.tabs.filter((tab) => tab.kind === "Terminal");
			if (collapsed) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dcs-term-rail",
				"data-collapsed": "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: "dcs-term-rail-icon",
					title: t("expandTerminals"),
					"aria-label": t("expandTerminals"),
					onClick: () => {
						setCollapsed(false);
					},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
						name: "panel",
						size: 14
					})
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-term-rail",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-term-rail-head",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dcs-term-rail-count",
							children: [sessions.length, " Terminal"]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-term-rail-icon",
							title: t("newTerminal"),
							"aria-label": t("newTerminal"),
							onClick: () => {
								onIntent({ type: "open-terminal" });
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "plus",
								size: 14
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-term-rail-icon",
							title: t("collapseTerminals"),
							"aria-label": t("collapseTerminals"),
							onClick: () => {
								setCollapsed(true);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "panel",
								size: 14
							})
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcs-term-rail-list",
					children: sessions.map((tab) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "dcs-term-session",
						"data-on": tab.id === tabId || void 0,
						onClick: () => {
							onIntent({
								type: "select-tab",
								id: tab.id
							});
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "terminal",
								size: 13
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcs-term-session-name",
								children: tab.title || "bash"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcs-term-session-x",
								role: "button",
								"aria-label": t("closeTab"),
								title: t("closeTab"),
								onClick: (event) => {
									event.stopPropagation();
									onIntent({
										type: "close-tab",
										id: tab.id
									});
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
									name: "x",
									size: 11
								})
							})
						]
					}, tab.id))
				})]
			});
		}
		function stripAnnotationDraftSentinel(draft) {
			return draft.replaceAll("​", "");
		}
		function annotationDraftProjection(draft, annotationCount, imageCount) {
			const visible = stripAnnotationDraftSentinel(draft);
			if (annotationCount <= 0 || imageCount > 0 || visible.trim().length > 0) return visible;
			return visible + "​";
		}
		//#endregion
		//#region src/client/AttachmentChips.tsx
		/** Stacked 批注 chips: 主会话 dock and 侧栏 chrome share this strip. */
		function AttachmentChips({ sessionId, useSidebar, controller, input, inputActions }) {
			const attachments = useSidebar((state) => state.bySession[String(sessionId)]?.attachments) ?? [];
			const projectedDraft = annotationDraftProjection(input.draft, attachments.length, input.imageIds.length);
			(0, react.useEffect)(() => {
				if (projectedDraft === input.draft) return;
				inputActions.setDraft(projectedDraft);
			}, [
				input.draft,
				inputActions,
				projectedDraft
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentStrip, {
				attachments,
				dock: true,
				onEdit: (id) => {
					controller.dispatch(String(sessionId), {
						type: "edit-attachment",
						id
					});
				},
				onRemove: (id) => {
					controller.dispatch(String(sessionId), {
						type: "remove-attachment",
						id
					});
				}
			});
		}
		function AttachmentStrip({ attachments, onRemove, onEdit, onSend, dock }) {
			if (attachments.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: dock ? "dcs-chips dcs-chips-dock" : "dcs-chips",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcs-chip dcs-chip-count",
						children: [attachments.length, " 批注"]
					}),
					attachments.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: "dcs-chip",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dcs-chip-open",
							"aria-label": `编辑批注 ${index + 1}`,
							onClick: () => {
								onEdit?.(item.id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcs-chip-n",
								children: index + 1
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dcs-chip-from",
								children: item.from
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dcs-chip-x",
							"aria-label": "移除批注",
							onClick: () => {
								onRemove(item.id);
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
								name: "x",
								size: 10
							})
						})]
					}, item.id)),
					onSend !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dcs-chips-send",
						title: "发送批注",
						"aria-label": "发送批注",
						onClick: onSend,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
							name: "send",
							size: 13
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/occupant-hold.ts
		function retainDetailsOccupantAfterRenderError(error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				abdicate: false,
				message: message.length > 0 ? message : "Sidebar pane crashed"
			};
		}
		//#endregion
		//#region src/client/OccupantBoundary.tsx
		/** Catch tool-pane crashes so the details slot does not abdicate to DetailsPanel. */
		var OccupantBoundary = class extends react.Component {
			state = { message: null };
			static getDerivedStateFromError(error) {
				return { message: retainDetailsOccupantAfterRenderError(error).message };
			}
			componentDidCatch(error, info) {
				console.error("[dsh-codex-sidebar] details occupant held after render error", error, info.componentStack);
			}
			render() {
				if (this.state.message !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dcs-root dcs-occupant-error",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: this.props.label }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: this.state.message }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: () => {
								this.setState({ message: null });
								this.props.onRetry?.();
							},
							children: this.props.retryLabel
						})
					]
				});
				return this.props.children;
			}
		};
		//#endregion
		//#region src/client/Sidebar.tsx
		/** Details-column occupant: Tab strip, Palette, and the active 工具. */
		function SidebarPanel({ sessionId, useSessions, useSidebar, controller, t }) {
			(0, react.useEffect)(() => {
				const abort = new AbortController();
				controller.refresh(String(sessionId), abort.signal);
				return () => {
					abort.abort();
				};
			}, [controller, sessionId]);
			const snapshot = useSidebar((state) => state.bySession[String(sessionId)]);
			const workspaceName = basename(useSessions((list) => list.byId[sessionId]?.cwd));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OccupantBoundary, {
				label: t("occupantError"),
				retryLabel: t("occupantRetry"),
				onRetry: () => {
					controller.refresh(String(sessionId));
				},
				children: snapshot !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dcs-col",
					"data-collapsed": snapshot.collapsed || void 0,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarChrome, {
						snapshot,
						workspaceName,
						t,
						onIntent: (intent) => {
							controller.dispatch(String(sessionId), intent);
						},
						onPullTerminal: (tabId, since) => controller.pullTerminal(String(sessionId), tabId, since),
						onBrowserTicket: (tabId) => controller.browserStreamTicket(String(sessionId), tabId),
						onBrowserCapture: (tabId) => controller.browserCapture(String(sessionId), tabId),
						onFilePreview: (path) => controller.readFilePreview(String(sessionId), path)
					})
				})
			});
		}
		const TAB_DRAG_PX = 6;
		function tabIndexFromPoint(x, y) {
			const node = document.elementFromPoint(x, y);
			const tab = node instanceof Element ? node.closest(".dcs-tab") : null;
			if (!(tab instanceof HTMLElement) || tab.parentElement === null) return null;
			const index = [...tab.parentElement.querySelectorAll(":scope > .dcs-tab")].indexOf(tab);
			return index < 0 ? null : index;
		}
		function SidebarChrome({ snapshot, workspaceName, t, onIntent, onPullTerminal, onBrowserTicket, onBrowserCapture, onFilePreview }) {
			const active = snapshot.tabs.find((tab) => tab.id === snapshot.active);
			const fill = active?.kind === "Files" || active?.kind === "Review" || active?.kind === "Terminal" || active?.kind === "Browser";
			const [dragFrom, setDragFrom] = (0, react.useState)(null);
			const [menu, setMenu] = (0, react.useState)(false);
			const tabPointer = (0, react.useRef)(null);
			const ignoreTabClick = (0, react.useRef)(false);
			const stripRef = (0, react.useRef)(null);
			const addRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const el = stripRef.current;
				if (el === null) return;
				const onWheel = (event) => {
					if (el.scrollWidth <= el.clientWidth) return;
					if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
					event.preventDefault();
					el.scrollLeft += event.deltaY;
				};
				el.addEventListener("wheel", onWheel, { passive: false });
				return () => {
					el.removeEventListener("wheel", onWheel);
				};
			}, []);
			(0, react.useEffect)(() => {
				const strip = stripRef.current;
				if (strip === null) return;
				const frame = requestAnimationFrame(() => {
					const el = strip.querySelector(".dcs-tab[data-on]");
					if (el === null) return;
					revealTab(strip, el);
				});
				return () => {
					cancelAnimationFrame(frame);
				};
			}, [snapshot.active, snapshot.tabs.length]);
			(0, react.useEffect)(() => {
				if (!menu) return;
				const onPointer = (event) => {
					const root = addRef.current;
					if (root !== null && !root.contains(event.target)) setMenu(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setMenu(false);
				};
				document.addEventListener("pointerdown", onPointer);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer);
					document.removeEventListener("keydown", onKey);
				};
			}, [menu]);
			function pick(kind) {
				setMenu(false);
				onIntent({
					type: "pick-tool",
					kind
				});
			}
			function onTabPointerDown(index, event) {
				if (event.button !== 0) return;
				if (event.target instanceof Element && event.target.closest(".dcs-x")) return;
				tabPointer.current = {
					from: index,
					x: event.clientX,
					y: event.clientY,
					pointerId: event.pointerId,
					armed: false
				};
				event.currentTarget.setPointerCapture(event.pointerId);
			}
			function onTabPointerMove(event) {
				const pending = tabPointer.current;
				if (pending === null || pending.pointerId !== event.pointerId || pending.armed) return;
				if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < TAB_DRAG_PX) return;
				pending.armed = true;
				setDragFrom(pending.from);
			}
			function onTabPointerUp(event) {
				const pending = tabPointer.current;
				if (pending === null || pending.pointerId !== event.pointerId) return;
				tabPointer.current = null;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				if (!pending.armed) {
					setDragFrom(null);
					return;
				}
				ignoreTabClick.current = true;
				const to = tabIndexFromPoint(event.clientX, event.clientY);
				if (to !== null && to !== pending.from) onIntent({
					type: "reorder-tabs",
					from: pending.from,
					to
				});
				setDragFrom(null);
			}
			function onTabPointerCancel(event) {
				if (tabPointer.current?.pointerId !== event.pointerId) return;
				tabPointer.current = null;
				setDragFrom(null);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dcs-root",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-tabbar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dcs-tab-scroll",
							ref: stripRef,
							"data-reordering": dragFrom !== null || void 0,
							children: snapshot.tabs.map((tab, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dcs-tab",
								"data-on": tab.id === snapshot.active || void 0,
								"data-drag": dragFrom === index || void 0,
								onClick: () => {
									if (ignoreTabClick.current) {
										ignoreTabClick.current = false;
										return;
									}
									onIntent({
										type: "select-tab",
										id: tab.id
									});
								},
								onAuxClick: (event) => {
									const intent = tabAuxIntent(event.button, tab.id);
									if (intent === void 0) return;
									event.preventDefault();
									onIntent(intent);
								},
								onPointerDown: (event) => {
									onTabPointerDown(index, event);
								},
								onPointerMove: onTabPointerMove,
								onPointerUp: onTabPointerUp,
								onPointerCancel: onTabPointerCancel,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
										name: tabIcon(tab.kind),
										size: 13
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-title",
										children: tab.title || t("newTab")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dcs-x",
										role: "button",
										"aria-label": t("closeTab"),
										onPointerDown: (event) => {
											event.stopPropagation();
										},
										onClick: (event) => {
											event.stopPropagation();
											onIntent({
												type: "close-tab",
												id: tab.id
											});
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
											name: "x",
											size: 11
										})
									})
								]
							}, tab.id))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dcs-add",
							ref: addRef,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dcs-plus",
								title: t("newTab"),
								"aria-haspopup": "menu",
								"aria-expanded": menu,
								onClick: () => {
									setMenu((open) => !open);
								},
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
									name: "plus",
									size: 14
								})
							}), menu && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AddMenu, { onPick: pick })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AttachmentStrip, {
						attachments: snapshot.attachments,
						onEdit: (id) => {
							onIntent({
								type: "edit-attachment",
								id
							});
						},
						onSend: () => {
							onIntent({
								type: "composer-send",
								text: ""
							});
						},
						onRemove: (id) => {
							onIntent({
								type: "remove-attachment",
								id
							});
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dcs-body",
						"data-center": snapshot.showPalette || void 0,
						"data-fill": fill && !snapshot.showPalette || void 0,
						children: [
							snapshot.showPalette && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Palette, { onPick: (kind) => {
								onIntent({
									type: "pick-tool",
									kind
								});
							} }),
							!snapshot.showPalette && active?.kind === "Files" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilesPane, {
								snapshot,
								workspaceName,
								onIntent,
								onFilePreview,
								annotateLabel: t("annotate"),
								openTreeLabel: t("openTree"),
								closeTreeLabel: t("closeTree"),
								notePlaceholder: t("notePlaceholder"),
								sendLabel: t("noteSend"),
								addLabel: t("noteAdd"),
								deleteLabel: t("noteDelete"),
								previewLabel: t("filesPreview"),
								diffLabel: t("filesDiff")
							}),
							!snapshot.showPalette && active?.kind === "Review" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReviewPane, {
								snapshot,
								onIntent
							}),
							!snapshot.showPalette && active?.kind === "Browser" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrowserPane, {
								snapshot,
								onIntent,
								requestTicket: onBrowserTicket,
								requestCapture: onBrowserCapture,
								sendLabel: t("noteSend"),
								addLabel: t("noteAdd"),
								deleteLabel: t("noteDelete")
							}),
							!snapshot.showPalette && active?.kind === "Terminal" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dcs-term-wrap",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TerminalPane, {
									snapshot,
									onIntent,
									tabId: active.id,
									onPull: onPullTerminal
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TerminalRail, {
									snapshot,
									onIntent,
									tabId: active.id,
									t
								})]
							})
						]
					})
				]
			});
		}
		function revealTab(strip, tab) {
			const pad = 12;
			const track = strip.getBoundingClientRect();
			const box = tab.getBoundingClientRect();
			if (box.width >= track.width) {
				strip.scrollLeft += box.left - track.left;
				return;
			}
			if (box.left < track.left + pad) {
				strip.scrollLeft += box.left - track.left - pad;
				return;
			}
			if (box.right > track.right - pad) strip.scrollLeft += box.right - track.right + pad;
		}
		function basename(cwd) {
			if (cwd === void 0 || cwd.length === 0) return "workspace";
			const parts = cwd.replace(/\/$/, "").split("/");
			return parts[parts.length - 1] ?? "workspace";
		}
		//#endregion
		//#region src/client/chrome.ts
		/** Placement of the 侧栏开关 and resize handle. */
		/** Overlay 侧栏开关 stays mounted whenever a 主会话 is open. */
		function overlayToggleVisible(sessionId) {
			return sessionId !== void 0;
		}
		/** Overlay resize handle only while the 侧栏 is open. */
		function overlayHandleVisible(collapsed) {
			return collapsed === false;
		}
		/** Pixel offset of the details seam relative to the handle's positioning origin. */
		function seamOffsetPx(originLeft, detailsLeft) {
			return Math.round(detailsLeft - originLeft);
		}
		//#endregion
		//#region src/client/Toggle.tsx
		function SidebarToggleButton({ collapsed, t, onClick }) {
			const label = collapsed ? t("toggleShow") : t("toggleHide");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "dcs-toggle",
				"data-on": !collapsed || void 0,
				"aria-label": label,
				title: label,
				onClick,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Ico, {
					name: "panel",
					size: 16
				})
			});
		}
		//#endregion
		//#region src/client/NarrowDrawer.tsx
		/**
		* Pins AppFrame's third grid track to the 侧栏 width so the center column
		* is squeezed (3-column layout). The 侧栏开关 and resize handle live here
		* so the switch stays put and the pill stays on the real seam.
		*/
		function NarrowDrawer(props) {
			const sessionId = props.useSessions((list) => list.current);
			const collapsed = props.useSidebar((state) => sessionId === void 0 ? void 0 : state.bySession[String(sessionId)]?.collapsed);
			usePinFrameColumns(sessionId !== void 0, collapsed);
			(0, react.useLayoutEffect)(() => {
				if (sessionId === void 0) {
					props.controller.syncTrack(true);
					return;
				}
				props.controller.syncTrack(collapsed);
			}, [
				sessionId,
				collapsed,
				props.controller
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dcs-overlay",
				children: [overlayToggleVisible(sessionId === void 0 ? void 0 : String(sessionId)) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarToggleButton, {
					collapsed: collapsed !== false,
					t: props.t,
					onClick: () => {
						if (sessionId === void 0) return;
						if (collapsed !== false) props.controller.reveal(String(sessionId));
						else props.controller.hide(String(sessionId));
					}
				}), overlayHandleVisible(collapsed) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarResizeHandle, { label: props.t("resizeDrawer") })]
			});
		}
		function usePinFrameColumns(active, collapsed) {
			(0, react.useLayoutEffect)(() => {
				const frame = document.querySelector("[data-shell-overlay]")?.parentElement;
				if (!active) {
					if (frame instanceof HTMLElement) clearDetailsTrackStyle(frame);
					return;
				}
				const apply = () => {
					if (frame === null || frame === void 0) return;
					if (frame instanceof HTMLElement) markHostFrame(frame);
					const viewport = frame.getBoundingClientRect().width || window.innerWidth;
					const fromInline = sidebarTrackFromGrid(frame.style.gridTemplateColumns);
					const fromComputed = sidebarTrackFromGrid(getComputedStyle(frame).gridTemplateColumns);
					const sidebar = fromInline ?? fromComputed;
					if (sidebar !== void 0 && frame.style.getPropertyValue("--dcs-sidebar-track") !== sidebar) frame.style.setProperty("--dcs-sidebar-track", sidebar);
					const details = detailsTrackPx(collapsed, peekDrawerWidth(viewport));
					if (frame.style.getPropertyValue("--dcs-details-track") !== details) frame.style.setProperty("--dcs-details-track", details);
					if (frame.getAttribute("data-dcs-pin") !== "") frame.setAttribute("data-dcs-pin", "");
					if (collapsed === false) frame.setAttribute("data-dcs-open", "");
					else frame.removeAttribute("data-dcs-open");
				};
				apply();
				const unsub = subscribeDrawerWidth(() => {
					apply();
				});
				const observer = new MutationObserver(apply);
				if (frame !== null && frame !== void 0) {
					observer.observe(frame, {
						attributes: true,
						attributeFilter: ["style"]
					});
					const resize = new ResizeObserver(apply);
					resize.observe(frame);
					return () => {
						unsub();
						observer.disconnect();
						resize.disconnect();
						clearDetailsTrackStyle(frame);
					};
				}
				return () => {
					unsub();
				};
			}, [active, collapsed]);
		}
		function pinHandleToSeam(handle) {
			const frame = handle.closest("[data-shell-overlay]")?.parentElement;
			const details = detailsColumnOf(frame);
			if (!(details instanceof HTMLElement)) return;
			const origin = handle.offsetParent instanceof HTMLElement ? handle.offsetParent : handle.parentElement;
			if (origin === null) return;
			handle.style.left = `${seamOffsetPx(origin.getBoundingClientRect().left, details.getBoundingClientRect().left)}px`;
		}
		function SidebarResizeHandle({ label }) {
			const handleRef = (0, react.useRef)(null);
			const [dragging, setDragging] = (0, react.useState)(false);
			const drag = (0, react.useRef)(null);
			const viewportRef = (0, react.useRef)(typeof window === "undefined" ? 1280 : window.innerWidth);
			(0, react.useLayoutEffect)(() => {
				const handle = handleRef.current;
				if (handle === null) return;
				const frame = document.querySelector("[data-shell-overlay]")?.parentElement;
				const details = detailsColumnOf(frame);
				const read = () => {
					const next = (frame ?? document.body).getBoundingClientRect().width;
					if (next > 0) viewportRef.current = next;
					pinHandleToSeam(handle);
				};
				read();
				const unsub = subscribeDrawerWidth(() => {
					read();
				});
				const resize = new ResizeObserver(read);
				if (frame instanceof HTMLElement) resize.observe(frame);
				if (details instanceof HTMLElement) resize.observe(details);
				return () => {
					unsub();
					resize.disconnect();
				};
			}, []);
			function onPointerDown(event) {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = {
					originX: event.clientX,
					startWidth: peekDrawerWidth(viewportRef.current)
				};
				setDragging(true);
			}
			function onPointerMove(event) {
				if (drag.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				publishDrawerWidth(clampDrawerWidth(drag.current.startWidth + (drag.current.originX - event.clientX), viewportRef.current), viewportRef.current);
				pinHandleToSeam(event.currentTarget);
			}
			function onPointerUp(event) {
				if (drag.current === null) return;
				if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
				drag.current = null;
				setDragging(false);
				publishDrawerWidth(peekDrawerWidth(viewportRef.current), viewportRef.current);
				pinHandleToSeam(event.currentTarget);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: handleRef,
				className: "dcs-col-handle",
				role: "separator",
				"aria-orientation": "vertical",
				"aria-label": label,
				"data-dragging": dragging || void 0,
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onPointerCancel: onPointerUp
			});
		}
		//#endregion
		//#region src/client/annotation-chips.ts
		/** Paint 批注 chips under the official user bubble. Does not replace the node renderer. */
		const MARK$1 = "dcs-msg-chips-row";
		const painted = /* @__PURE__ */ new WeakMap();
		const latest = /* @__PURE__ */ new WeakMap();
		function sourceForFlowKey(snapshot, key) {
			if (typeof snapshot !== "object" || snapshot === null) return void 0;
			const nodes = snapshot.chat?.nodes;
			if (nodes === void 0 || nodes === null) return void 0;
			const rec = nodes;
			return (typeof rec.get === "function" ? rec.get(key) : rec[key])?.data?.source;
		}
		function decorate$1(ports, root = document) {
			const sessionId = ports.sessionId();
			const rows = root.querySelectorAll("[data-chat-flow-kind=\"user\"], [data-chat-flow-kind=\"steering\"]");
			for (const row of rows) {
				if (!(row instanceof HTMLElement)) continue;
				const key = row.getAttribute("data-chat-flow-key") ?? "";
				const marks = key.length === 0 || sessionId === void 0 ? void 0 : annotationMarksFromSource(ports.nodeSource(key));
				const existing = row.querySelector(":scope > .dcs-msg-chips-row");
				if (marks === void 0 || marks.length === 0) {
					existing?.remove();
					painted.delete(row);
					continue;
				}
				const signature = marksSignature(sessionId, marks);
				const host = existing instanceof HTMLElement ? existing : document.createElement("div");
				host.className = MARK$1;
				if (existing instanceof HTMLElement && painted.get(row) === signature) {
					bindExisting(host, marks, sessionId);
					continue;
				}
				host.replaceChildren(...marks.map((mark, index) => chipButton(mark, index, sessionId, ports)));
				painted.set(row, signature);
				if (existing === null) row.append(host);
			}
		}
		function marksSignature(sessionId, marks) {
			return sessionId + "\0" + marks.map((mark) => [
				mark.id,
				mark.from,
				mark.source,
				mark.selector ?? "",
				mark.path ?? "",
				mark.line === void 0 ? "" : String(mark.line),
				mark.url ?? ""
			].join("")).join("");
		}
		function bindExisting(host, marks, sessionId) {
			for (let i = 0; i < host.children.length; i++) {
				const button = host.children[i];
				const mark = marks[i];
				if (!(button instanceof HTMLButtonElement) || mark === void 0) continue;
				latest.set(button, {
					sessionId,
					mark: markToAnnotation(mark)
				});
			}
		}
		function chipButton(mark, index, sessionId, ports) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "dcs-chip dcs-msg-chip";
			button.setAttribute("aria-label", ports.label(index + 1, mark.from));
			const n = document.createElement("span");
			n.className = "dcs-chip-n";
			n.textContent = String(index + 1);
			const from = document.createElement("span");
			from.className = "dcs-chip-from";
			from.textContent = mark.from;
			button.append(n, from);
			latest.set(button, {
				sessionId,
				mark: markToAnnotation(mark)
			});
			button.addEventListener("click", () => {
				const current = latest.get(button);
				if (current === void 0) return;
				ports.reveal(current.sessionId, current.mark);
			});
			return button;
		}
		function markToAnnotation(mark) {
			return hydrateAnnotation({
				id: mark.id,
				from: mark.from,
				source: mark.source,
				...mark.selector === void 0 ? {} : { selector: mark.selector },
				...mark.path === void 0 ? {} : { path: mark.path },
				...mark.line === void 0 ? {} : { line: mark.line },
				...mark.url === void 0 ? {} : { url: mark.url },
				...mark.rect === void 0 ? {} : { rect: mark.rect },
				...mark.selection === void 0 ? {} : { selection: mark.selection }
			});
		}
		//#endregion
		//#region src/client/path-links.ts
		/** Turn transcript file paths into clicks that open Files. */
		const MARK = "dcs-path-link";
		const FILE_EXT = /\.(tsx?|jsx?|mjs|cjs|md|json|css|html?|vue|svelte|py|rs|go|toml|ya?ml|svg|png|jpe?g|gif|webp|txt|map|lock|sh|bash)$/i;
		function transcriptPath(text) {
			const trimmed = text.trim();
			if (trimmed.length === 0 || trimmed.length > 512) return void 0;
			if (/\s/.test(trimmed)) return void 0;
			if (/^https?:/i.test(trimmed)) return void 0;
			if (trimmed.startsWith("/") || trimmed.startsWith("~/") || trimmed.startsWith("./") || trimmed.startsWith("../")) return trimmed;
			if (trimmed.includes("/") && FILE_EXT.test(trimmed)) return trimmed;
			if (FILE_EXT.test(trimmed) && !trimmed.startsWith(".")) return trimmed;
		}
		function decorate(root = document) {
			const nodes = root.querySelectorAll("code");
			for (const node of nodes) {
				if (!(node instanceof HTMLElement)) continue;
				if (node.closest(".dcs-root, .dcs-col, [data-shell-overlay]")) {
					clearMark(node);
					continue;
				}
				if (node.closest("a, button, [data-tool]")) {
					clearMark(node);
					continue;
				}
				const closest = (selector) => node.closest(selector);
				if (!allowTranscriptTakeover(closest)) {
					clearMark(node);
					continue;
				}
				const path = transcriptPath(node.textContent ?? "");
				if (path === void 0) {
					clearMark(node);
					continue;
				}
				node.dataset.dcsPath = path;
				node.classList.add(MARK);
				node.title = path;
			}
		}
		function pathFromClick(event) {
			const target = event.target;
			if (!(target instanceof Element)) return void 0;
			const code = target.closest("code.dcs-path-link");
			if (!(code instanceof HTMLElement)) return void 0;
			const path = code.dataset.dcsPath;
			return path === void 0 || path.length === 0 ? void 0 : path;
		}
		function clearMark(node) {
			if (node.dataset.dcsPath === void 0) return;
			delete node.dataset.dcsPath;
			node.classList.remove(MARK);
			node.removeAttribute("title");
		}
		//#endregion
		//#region src/client/transcript-decorators.ts
		/** One transcript MutationObserver for tool stats, 批注 chips, and path links. */
		const OBSERVE = {
			childList: true,
			subtree: true
		};
		const IGNORE = ".dcs-root, .dcs-col, [data-shell-overlay], [data-side=\"details\"], [data-side=\"sidebar\"]";
		function ignoredTranscriptTarget(node) {
			const el = node instanceof Element ? node : node?.parentElement ?? null;
			if (el === null) return false;
			return el.closest(IGNORE) !== null;
		}
		function transcriptMutationIsIgnored(record) {
			return ignoredTranscriptTarget(record.target);
		}
		function createPendingThrottle(paint, ms) {
			let timer;
			return {
				schedule() {
					if (timer !== void 0) return;
					timer = setTimeout(() => {
						timer = void 0;
						paint();
					}, ms);
				},
				cancel() {
					if (timer === void 0) return;
					clearTimeout(timer);
					timer = void 0;
				}
			};
		}
		function shouldRebindSession(boundId, boundStore, nextId, nextStore) {
			return boundId !== nextId || boundStore !== nextStore;
		}
		function installTranscriptDecorators(paints) {
			if (typeof document === "undefined" || document.documentElement === null) return {
				paintData() {},
				stop() {}
			};
			let frame = 0;
			let observer;
			const isolate = (paint) => {
				try {
					paint();
				} catch (err) {
					console.error("[dsh-codex-sidebar] transcript decorator failed", err);
				}
			};
			const run = (pass) => {
				observer.disconnect();
				try {
					pass();
				} finally {
					observer.observe(document.documentElement, OBSERVE);
				}
			};
			const paintDom = () => {
				run(() => {
					isolate(paints.paintStats);
					isolate(paints.paintChips);
					isolate(paints.paintPaths);
				});
			};
			const paintData = () => {
				run(() => {
					isolate(paints.paintStats);
					isolate(paints.paintChips);
				});
			};
			const scheduleDom = () => {
				if (frame !== 0) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					paintDom();
				});
			};
			const onClick = (event) => {
				const path = pathFromClick(event);
				if (path === void 0) return;
				event.preventDefault();
				event.stopPropagation();
				paints.openPath(path);
			};
			observer = new MutationObserver((records) => {
				for (const record of records) {
					if (transcriptMutationIsIgnored(record)) continue;
					scheduleDom();
					return;
				}
			});
			observer.observe(document.documentElement, OBSERVE);
			document.addEventListener("click", onClick, true);
			paintDom();
			return {
				paintData,
				stop() {
					observer.disconnect();
					document.removeEventListener("click", onClick, true);
					if (frame === 0) return;
					cancelAnimationFrame(frame);
					frame = 0;
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		const name = "dsh-codex-sidebar-client";
		const inject = [...CLIENT_INJECT];
		function apply(ctx) {
			ctx.locale.register(NS, {
				zh,
				en
			});
			ensureSidebarStyles();
			const controller = new SidebarController(ctx);
			const face = () => ({
				hooks: { sidebar: controller },
				controller
			});
			occupyDetails(ctx.slots, face, SidebarPanel, NS);
			try {
				controller.installPathTakeover();
			} catch (err) {
				console.error("[dsh-codex-sidebar] path takeover skipped", err);
			}
			ctx.effect(() => {
				let lastSource;
				let lastStats = [];
				const readStats = () => {
					const current = ctx.sessions.list.getSnapshot().current;
					if (current === void 0) return [];
					const binding = ctx.sessions.binding(current);
					if (binding === void 0) return [];
					const source = binding.session.getSnapshot();
					if (source === lastSource) return lastStats;
					lastSource = source;
					lastStats = rowHunksFromSnapshot(source);
					return lastStats;
				};
				const chipPorts = {
					sessionId: () => {
						const current = ctx.sessions.list.getSnapshot().current;
						return current === void 0 ? void 0 : String(current);
					},
					nodeSource: (key) => {
						const current = ctx.sessions.list.getSnapshot().current;
						if (current === void 0) return void 0;
						const binding = ctx.sessions.binding(current);
						if (binding === void 0) return void 0;
						return sourceForFlowKey(binding.session.getSnapshot(), key);
					},
					reveal: (sessionId, mark) => {
						controller.dispatch(sessionId, {
							type: "reveal-mark",
							mark
						});
					},
					label: (n, from) => en.openMark.replace("{n}", String(n)).replace("{from}", from)
				};
				const decorators = installTranscriptDecorators({
					paintStats: () => {
						decorate$2(readStats());
					},
					paintChips: () => {
						decorate$1(chipPorts);
					},
					paintPaths: () => {
						decorate();
					},
					openPath: (path) => {
						const open = ctx.workspaces?.openPath;
						if (open !== void 0) open(path);
					}
				});
				const throttle = createPendingThrottle(decorators.paintData, 200);
				let unsubSession;
				let boundId;
				let boundStore;
				const bindSession = () => {
					const current = ctx.sessions.list.getSnapshot().current;
					const id = current === void 0 ? void 0 : String(current);
					const store = (current === void 0 ? void 0 : ctx.sessions.binding(current))?.session;
					if (!shouldRebindSession(boundId, boundStore, id, store)) return;
					unsubSession?.();
					unsubSession = void 0;
					throttle.cancel();
					lastSource = void 0;
					lastStats = [];
					boundId = id;
					boundStore = store;
					if (id === void 0 || store === void 0) return;
					unsubSession = store.subscribe(() => {
						throttle.schedule();
					});
					decorators.paintData();
				};
				bindSession();
				const stopList = ctx.sessions.list.subscribe(bindSession);
				return () => {
					decorators.stop();
					stopList();
					unsubSession?.();
					throttle.cancel();
				};
			}, "dsh-codex-sidebar: edit +/− and 批注 chips");
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "codex-sidebar-attachments",
				order: 5,
				locale: NS,
				inject: face
			}, AttachmentChips));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "codex-sidebar-drawer",
				locale: NS,
				inject: face
			}, NarrowDrawer));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
