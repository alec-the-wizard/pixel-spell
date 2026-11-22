import { TOOLS, TOOL_BY_ID, type ToolDef } from "./tools.js";
import type { ToolId } from "./types.js";

export const TOOL_LAYOUT_STORAGE_KEY = "pixel-spell-tools";

const TOOL_IDS = new Set<ToolId>(TOOLS.map((tool) => tool.id));

function defaultOrder(): ToolId[] {
	return TOOLS.map((tool) => tool.id);
}

function defaultEnabled(): Record<ToolId, boolean> {
	const enabled = {} as Record<ToolId, boolean>;
	for (const tool of TOOLS) enabled[tool.id] = tool.enabledByDefault !== false;
	return enabled;
}

/** Keeps stored order entries valid, unique, and complete. */
function sanitizeOrder(value: unknown): ToolId[] {
	const order: ToolId[] = [];
	if (Array.isArray(value)) {
		for (const entry of value) {
			if (typeof entry !== "string" || !TOOL_IDS.has(entry as ToolId)) continue;
			if (order.includes(entry as ToolId)) continue;
			order.push(entry as ToolId);
		}
	}
	for (const id of defaultOrder()) {
		if (!order.includes(id)) order.push(id);
	}
	return order;
}

/**
 * Stored visibility wins for known tools; anything missing falls back to the
 * tool definition, so newly added tools start visible unless they opt out.
 */
function sanitizeEnabled(
	value: unknown,
	order: readonly ToolId[],
): Record<ToolId, boolean> {
	const stored =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: {};
	const enabled = {} as Record<ToolId, boolean>;
	for (const tool of TOOLS) {
		const entry = stored[tool.id];
		enabled[tool.id] =
			typeof entry === "boolean" ? entry : tool.enabledByDefault !== false;
	}

	// The strip must always keep one tool usable.
	if (!order.some((id) => enabled[id])) {
		const fallback = TOOLS.find((tool) => tool.enabledByDefault !== false) ?? TOOLS[0];
		if (fallback) enabled[fallback.id] = true;
	}
	return enabled;
}

function loadLayout(): { order: ToolId[]; enabled: Record<ToolId, boolean> } {
	try {
		const raw = localStorage.getItem(TOOL_LAYOUT_STORAGE_KEY);
		if (!raw) return { order: defaultOrder(), enabled: defaultEnabled() };
		const parsed = JSON.parse(raw) as { order?: unknown; enabled?: unknown };
		const order = sanitizeOrder(parsed?.order);
		return { order, enabled: sanitizeEnabled(parsed?.enabled, order) };
	} catch {
		return { order: defaultOrder(), enabled: defaultEnabled() };
	}
}

/**
 * Workspace-wide tool strip order and visibility. These are preferences, not
 * project data: they never touch the document, history, or the dirty flag.
 */
class ToolLayoutState {
	/** Every tool id in strip order, including hidden tools. */
	order = $state<ToolId[]>([]);
	/** Visibility per tool id. Hidden tools stay in the order. */
	enabled = $state<Record<ToolId, boolean>>(defaultEnabled());

	constructor() {
		const layout = loadLayout();
		this.order = layout.order;
		this.enabled = layout.enabled;
	}

	/** Every tool in strip order, visible or not. */
	get tools(): ToolDef[] {
		return this.order.map((id) => TOOL_BY_ID[id]);
	}

	/** Tools rendered in the strip, in order. */
	get enabledTools(): ToolDef[] {
		return this.order
			.filter((id) => this.isEnabled(id))
			.map((id) => TOOL_BY_ID[id]);
	}

	get enabledCount(): number {
		return this.order.reduce(
			(count, id) => count + (this.isEnabled(id) ? 1 : 0),
			0,
		);
	}

	isEnabled(id: ToolId): boolean {
		return this.enabled[id] !== false;
	}

	firstEnabled(): ToolId | null {
		return this.order.find((id) => this.isEnabled(id)) ?? null;
	}

	/** Hides or shows a tool. The last visible tool cannot be hidden. */
	setEnabled(id: ToolId, enabled: boolean): void {
		if (this.enabled[id] === enabled) return;
		if (!enabled && this.enabledCount <= 1) return;
		this.enabled = { ...this.enabled, [id]: enabled };
		this.#persist();
	}

	toggle(id: ToolId): void {
		this.setEnabled(id, !this.isEnabled(id));
	}

	/**
	 * Moves a tool to an insertion index in the full order. Hidden tools keep
	 * their positions, so the strip reorders only the visible sequence.
	 */
	moveTool(id: ToolId, targetIndex: number): void {
		const current = this.order.indexOf(id);
		if (current === -1) return;

		const next = this.order.filter((entry) => entry !== id);
		const clamped = Math.max(0, Math.min(targetIndex, this.order.length));
		const insertAt = Math.max(
			0,
			Math.min(clamped - (current < clamped ? 1 : 0), next.length),
		);
		next.splice(insertAt, 0, id);

		if (next.every((entry, index) => entry === this.order[index])) return;
		this.order = next;
		this.#persist();
	}

	/** Restores the default order and the default visibility of every tool. */
	reset(): void {
		this.order = defaultOrder();
		this.enabled = defaultEnabled();
		try {
			localStorage.removeItem(TOOL_LAYOUT_STORAGE_KEY);
		} catch {
			// Storage can be unavailable in private browsing contexts.
		}
	}

	#persist(): void {
		try {
			localStorage.setItem(
				TOOL_LAYOUT_STORAGE_KEY,
				JSON.stringify({ order: this.order, enabled: this.enabled }),
			);
		} catch {
			// Storage can be unavailable in private browsing contexts.
		}
	}
}

export const toolLayout = new ToolLayoutState();
