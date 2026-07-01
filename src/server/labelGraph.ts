// Pure helpers for building the label-graph webview data. Kept out of
// extension.ts so it can be unit-tested without pulling in the vscode module.

import { LabelMapEntry } from './labelMap';

export interface GraphNode {
	id: string;
	label: string;
	kind: 'global' | 'local' | 'external';
	uri?: string;      // location for click-to-jump (missing for `external` unresolved targets)
	line?: number;
	parent?: string;   // parent node id (for local labels)
	preview?: string[]; // first few lines of the label body (for hover preview)
}

export interface GraphEdge {
	source: string;
	target: string;
	kind: 'jump' | 'call' | 'fallthrough';
	fromLine: number;
	fromUri: string;
	// When the edge originates from a `menu:` choice, this is the choice text.
	menuChoice?: string;
}

export interface Graph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

// Build a graph from a single file's parsed labels. `fileUri` is the
// file URI (used for node click-to-jump and edge source ranges).
export function buildFileGraph(fileUri: string, labels: LabelMapEntry[]): Graph {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];

	// Track globals in order so locals can attribute to their parent global.
	let currentGlobal: LabelMapEntry | null = null;
	const globalIds = new Map<string, string>(); // label name → node id
	const localIds = new Map<string, string>();  // .name → node id
	const nodeIdFor = (label: LabelMapEntry) =>
		label.isLocal
			? `${fileUri}#local:${label.name}`
			: `${fileUri}#global:${label.name}`;

	// First pass: create nodes for every label in this file.
	for (const label of labels) {
		const id = nodeIdFor(label);
		if (label.isLocal) {
			nodes.push({
				id,
				label: label.name,
				kind: 'local',
				uri: fileUri,
				line: label.line,
				parent: currentGlobal ? nodeIdFor(currentGlobal) : undefined,
				preview: label.preview.length ? label.preview : undefined,
			});
			localIds.set(label.name, id);
		} else {
			nodes.push({
				id,
				label: label.name,
				kind: 'global',
				uri: fileUri,
				line: label.line,
				preview: label.preview.length ? label.preview : undefined,
			});
			globalIds.set(label.name, id);
			currentGlobal = label;
		}
	}

	// Second pass: create edges. Surface `jump` and `fallthrough` — the
	// former is explicit branching, the latter is Ren'Py's implicit
	// "next label" flow when a label body doesn't end with a
	// terminator. `call` is skipped (function-call semantics, not
	// branching). Targets outside the current file become "external"
	// placeholder nodes so the graph stays self-contained.
	const externalIds = new Map<string, string>();
	for (const label of labels) {
		const sourceId = nodeIdFor(label);
		for (const edge of label.outgoing) {
			if (edge.kind !== 'jump' && edge.kind !== 'fallthrough') continue;
			let targetId: string;
			if (edge.target.startsWith('.')) {
				const existing = localIds.get(edge.target);
				if (existing) {
					targetId = existing;
				} else {
					// Unresolved local — synthesise an external node.
					targetId = `unresolved:${edge.target}`;
					if (!externalIds.has(targetId)) {
						externalIds.set(targetId, targetId);
						nodes.push({ id: targetId, label: edge.target, kind: 'external' });
					}
				}
			} else {
				const existing = globalIds.get(edge.target);
				if (existing) {
					targetId = existing;
				} else {
					targetId = `external:${edge.target}`;
					if (!externalIds.has(targetId)) {
						externalIds.set(targetId, targetId);
						nodes.push({ id: targetId, label: edge.target, kind: 'external' });
					}
				}
			}
			edges.push({
				source: sourceId,
				target: targetId,
				kind: edge.kind,
				fromLine: edge.line,
				fromUri: fileUri,
				menuChoice: edge.menuChoice,
			});
		}
	}

	return { nodes, edges };
}
