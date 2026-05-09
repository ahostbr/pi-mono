/**
 * Claude Skills Loader
 *
 * Discovers and loads skills from ~/.claude/skills/ into Pi's skill system.
 * Each subdirectory containing a SKILL.md is registered as an available skill.
 * Also discovers agents from ~/.claude/agents/ as supplementary context.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CLAUDE_DIR = join(homedir(), ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");

function discoverSkillPaths(): string[] {
	if (!existsSync(SKILLS_DIR)) return [];

	const paths: string[] = [];
	for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			if (entry.name.endsWith(".md") && entry.name.toUpperCase().startsWith("SKILL")) {
				paths.push(join(SKILLS_DIR, entry.name));
			}
			continue;
		}
		const skillFile = join(SKILLS_DIR, entry.name, "SKILL.md");
		if (existsSync(skillFile)) {
			paths.push(skillFile);
		}
	}
	return paths;
}

export default function (pi: ExtensionAPI) {
	pi.on("resources_discover", () => {
		const skillPaths = discoverSkillPaths();
		return { skillPaths };
	});
}
