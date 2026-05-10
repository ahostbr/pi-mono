/**
 * Sentinel Footer — Claude Code-style status line for Pi.
 *
 * Replaces the built-in footer with a single dense line showing:
 * - LiteHarness agent name + short UUID + git branch (left)
 * - Token stats + colored context bar (middle)
 * - Provider + model + thinking level (right)
 */

import { createHash } from "node:crypto";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── LiteHarness deterministic naming ────────────────────────────────────────

const ADJECTIVES = [
	"swift",
	"iron",
	"shadow",
	"bright",
	"cold",
	"dark",
	"keen",
	"bold",
	"stark",
	"rust",
	"deep",
	"wild",
	"sharp",
	"pale",
	"grim",
	"red",
	"ash",
	"storm",
	"frost",
	"vivid",
	"stone",
	"glass",
	"black",
	"white",
	"silver",
	"amber",
	"jade",
	"cobalt",
	"copper",
	"steel",
	"burnt",
	"hollow",
	"ghost",
	"silent",
	"rapid",
	"wired",
	"raw",
	"dry",
	"thin",
	"dense",
	"neon",
	"void",
	"zero",
	"live",
	"dual",
	"hex",
	"arc",
	"prime",
	"flux",
	"pulse",
	"acid",
	"apex",
	"bare",
	"brisk",
	"broad",
	"coiled",
	"crisp",
	"cyan",
	"dim",
	"dusk",
	"elite",
	"even",
	"faint",
	"far",
	"fast",
	"fell",
	"firm",
	"flat",
	"free",
	"full",
	"gold",
	"gray",
	"hard",
	"haze",
	"high",
	"hot",
	"long",
	"loud",
	"low",
	"mute",
	"nano",
	"neat",
	"null",
	"odd",
	"open",
	"pink",
	"plain",
	"pure",
	"rare",
	"rich",
	"rigid",
	"rough",
	"sheer",
	"slim",
	"slow",
	"soft",
	"solid",
	"sour",
	"stale",
	"true",
];

const NOUNS = [
	"relay",
	"watch",
	"cairn",
	"ridge",
	"flint",
	"rivet",
	"bolt",
	"shard",
	"forge",
	"vault",
	"spire",
	"crest",
	"node",
	"wire",
	"blade",
	"drift",
	"gate",
	"mark",
	"lens",
	"core",
	"frame",
	"link",
	"port",
	"span",
	"grid",
	"rail",
	"edge",
	"root",
	"stem",
	"axis",
	"helm",
	"crow",
	"pike",
	"latch",
	"rune",
	"glyph",
	"prism",
	"orbit",
	"coil",
	"band",
	"lock",
	"scout",
	"ward",
	"clip",
	"notch",
	"wedge",
	"strut",
	"brace",
	"fuse",
	"loop",
	"amp",
	"arch",
	"base",
	"beam",
	"bin",
	"bit",
	"byte",
	"cap",
	"cell",
	"chain",
	"chip",
	"choke",
	"clamp",
	"clause",
	"cluster",
	"codex",
	"cone",
	"crank",
	"crypt",
	"cube",
	"curve",
	"deck",
	"depth",
	"disc",
	"dome",
	"duct",
	"field",
	"flag",
	"flak",
	"flash",
	"fork",
	"hatch",
	"hook",
	"knob",
	"layer",
	"mesh",
	"mint",
	"mast",
	"pack",
	"pad",
	"path",
	"peak",
	"pipe",
	"plug",
	"pod",
	"rack",
	"ramp",
	"ring",
	"rod",
	"tile",
];

function capitalize(s: string): string {
	return s[0].toUpperCase() + s.slice(1);
}

function agentName(uuid: string): string {
	const hash = createHash("sha256").update(uuid).digest();
	const adjIdx = hash.readUInt16LE(0) % ADJECTIVES.length;
	const nounIdx = hash.readUInt16LE(2) % NOUNS.length;
	return capitalize(ADJECTIVES[adjIdx]) + capitalize(NOUNS[nounIdx]);
}

// ── Token formatting (matches built-in footer) ─────────────────────────────

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

// ── Context bar ─────────────────────────────────────────────────────────────

const ORANGE_BG = "\x1b[48;2;204;120;50m";
const WHITE_FG = "\x1b[97m";
const RESET = "\x1b[0m";
const ORANGE_BG_WHITE = `${ORANGE_BG}${WHITE_FG}`;
const GRAY_BG = "\x1b[48;2;60;60;60m";
const GRAY_FG = "\x1b[38;2;140;140;140m";

function contextBadge(percent: number, tokens: number, contextWindow: number): string {
	const pctStr = `${Math.round(percent)}%`;
	const tokStr = formatTokens(tokens);
	const winStr = formatTokens(contextWindow);
	const label = ` ${pctStr} ${tokStr}/${winStr} `;
	const fillLen = Math.max(0, Math.round((percent / 100) * label.length));
	const filledPart = label.slice(0, fillLen);
	const emptyPart = label.slice(fillLen);
	const filled = filledPart.length > 0 ? `${ORANGE_BG_WHITE}${filledPart}${RESET}` : "";
	const empty = emptyPart.length > 0 ? `${GRAY_BG}${GRAY_FG}${emptyPart}${RESET}` : "";
	return filled + empty;
}

// ── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// ── Identity (left) ─────────────────────────────
					const sessionId = ctx.sessionManager.getSessionId();
					const name = agentName(sessionId);
					const shortId = sessionId.slice(0, 8);
					const branch = footerData.getGitBranch();
					const branchStr = branch ? ` ${theme.fg("dim", branch)}` : "";
					const left = `${theme.fg("accent", name)} ${theme.fg("dim", shortId)}${branchStr}`;

					// ── Token stats (middle) ─────────────────────────
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message as AssistantMessage;
							if (m.usage) {
								totalInput += m.usage.input;
								totalOutput += m.usage.output;
								totalCacheRead += m.usage.cacheRead ?? 0;
								totalCost += m.usage.cost?.total ?? 0;
							}
						}
					}

					const statParts: string[] = [];
					statParts.push(`↑${formatTokens(totalInput)}`);
					statParts.push(`↓${formatTokens(totalOutput)}`);
					if (totalCacheRead > 0) statParts.push(`R${formatTokens(totalCacheRead)}`);
					statParts.push(`$${totalCost.toFixed(2)}`);

					const usage = ctx.getContextUsage();
					const pct = usage?.percent ?? 0;
					const ctxTokens = usage?.tokens ?? 0;
					const ctxWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const badge = contextBadge(pct, ctxTokens, ctxWindow);

					const middle = theme.fg("dim", statParts.join(" ")) + ` ${badge}`;

					// ── Model info (right) ───────────────────────────
					const modelId = ctx.model?.id ?? "no-model";
					const provider = ctx.model?.provider ?? "";
					const providerStr = provider ? `(${provider}) ` : "";
					const thinkingLevel = pi.getThinkingLevel?.() ?? "";
					const thinkingStr = ctx.model?.reasoning && thinkingLevel ? ` • ${thinkingLevel}` : "";
					const right = theme.fg("dim", `${providerStr}${modelId}${thinkingStr}`);

					// ── Assembly ──────────────────────────────────────
					const leftW = visibleWidth(left);
					const middleW = visibleWidth(middle);
					const rightW = visibleWidth(right);
					const totalW = leftW + 3 + middleW + 3 + rightW;

					let line: string;
					if (totalW <= width) {
						const gap = width - leftW - middleW - rightW;
						const leftGap = Math.min(3, Math.floor(gap / 2));
						const rightGap = gap - leftGap;
						line = left + " ".repeat(leftGap) + middle + " ".repeat(rightGap) + right;
					} else {
						line = `${left}   ${middle}   ${right}`;
					}

					return [truncateToWidth(line, width, theme.fg("dim", "…"))];
				},
			};
		});
	});
}
