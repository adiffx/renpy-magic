import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';
import { extractLabelsFromText } from './server/labelMap';
import { buildFileGraph } from './server/labelGraph';

let client: LanguageClient;
const outputChannel = vscode.window.createOutputChannel("Ren'Py LSP");

export function activate(context: ExtensionContext) {
	outputChannel.appendLine("Activating Ren'Py Language Support...");
	// Path to the server module
	const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));

	// Server options - run the server as a Node module
	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ['--nolazy', '--inspect=6009']
			}
		}
	};

	// Client options
	const clientOptions: LanguageClientOptions = {
		// Register the server for Ren'Py files
		documentSelector: [
			{ scheme: 'file', language: 'renpy' }
		],
		synchronize: {
			// Watch for .rpy file changes and image/audio asset changes on disk
			// (asset changes affect what Ren'Py lint considers defined)
			fileEvents: [
				vscode.workspace.createFileSystemWatcher('**/*.{rpy,rpym}'),
				vscode.workspace.createFileSystemWatcher('**/game/**/*.{png,jpg,jpeg,webp,webm,mp4,ogv,avi,mkv}')
			],
			// Notify server when configuration changes
			configurationSection: 'renpyMagic'
		},
		middleware: {
			// Mark hover content as trusted so `command:` links (used by the
			// "Play in default app" action for videos) actually fire instead
			// of being stripped as untrusted.
			provideHover: async (document, position, token, next) => {
				const hover = await next(document, position, token);
				if (hover) {
					hover.contents = hover.contents.map((c) => {
						if (c instanceof vscode.MarkdownString) {
							c.isTrusted = true;
						}
						return c;
					});
				}
				return hover;
			}
		}
	};

	// Open a file URI with the OS's default handler. Used by hover links
	// for media types VS Code's built-in viewer can't play (e.g. .webm).
	context.subscriptions.push(
		vscode.commands.registerCommand('renpy.openExternal', async (uri: string) => {
			try {
				await vscode.env.openExternal(vscode.Uri.parse(uri));
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to open ${uri}: ${err}`);
			}
		})
	);

	// Open the label graph webview for the current file.
	context.subscriptions.push(
		vscode.commands.registerCommand('renpy.showLabelGraph', async () => {
			await showLabelGraph(context);
		})
	);

	// Create and start the client
	client = new LanguageClient(
		'renpyLanguageServer',
		"Ren'Py Language Server",
		serverOptions,
		clientOptions
	);

	// Start the client (also starts the server)
	client.start().then(() => {
		outputChannel.appendLine("Language server started successfully!");
	}).catch((error) => {
		outputChannel.appendLine("Failed to start language server: " + error);
	});

	outputChannel.appendLine("Ren'Py Language Support is now active!");
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

async function showLabelGraph(context: ExtensionContext) {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'renpy') {
		vscode.window.showInformationMessage("Open a Ren'Py file first.");
		return;
	}

	const doc = editor.document;
	const labels = extractLabelsFromText(doc.getText());
	if (labels.length === 0) {
		vscode.window.showInformationMessage('No labels found in this file.');
		return;
	}

	const graph = buildFileGraph(doc.uri.toString(), labels);

	const vendorDir = vscode.Uri.file(context.asAbsolutePath(path.join('out', 'vendor')));
	const panel = vscode.window.createWebviewPanel(
		'renpyLabelGraph',
		`Label Graph — ${path.basename(doc.uri.fsPath)}`,
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vendorDir],
		}
	);
	const scriptUris = {
		cytoscape: panel.webview.asWebviewUri(vscode.Uri.joinPath(vendorDir, 'cytoscape.min.js')).toString(),
		dagre: panel.webview.asWebviewUri(vscode.Uri.joinPath(vendorDir, 'dagre.min.js')).toString(),
		cytoscapeDagre: panel.webview.asWebviewUri(vscode.Uri.joinPath(vendorDir, 'cytoscape-dagre.js')).toString(),
	};
	panel.webview.html = renderLabelGraphHtml(graph, path.basename(doc.uri.fsPath), scriptUris);

	panel.webview.onDidReceiveMessage(async (msg: { type: string; uri?: string; line?: number }) => {
		if (msg.type === 'reveal' && msg.uri) {
			try {
				const target = await vscode.workspace.openTextDocument(vscode.Uri.parse(msg.uri));
				const targetEditor = await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.One });
				if (typeof msg.line === 'number') {
					const pos = new vscode.Position(msg.line, 0);
					targetEditor.selection = new vscode.Selection(pos, pos);
					targetEditor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to open ${msg.uri}: ${err}`);
			}
		}
	});

	// Live refresh: when the graph's source file changes, re-parse and
	// push the new graph data to the webview. Debounced so we don't
	// re-parse on every keystroke.
	let refreshTimer: NodeJS.Timeout | undefined;
	const scheduleRefresh = () => {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			const freshDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === doc.uri.toString());
			if (!freshDoc) return;
			const freshLabels = extractLabelsFromText(freshDoc.getText());
			const freshGraph = buildFileGraph(doc.uri.toString(), freshLabels);
			panel.webview.postMessage({ type: 'refresh', graph: freshGraph });
		}, 1000);
	};

	const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
		if (e.document.uri.toString() === doc.uri.toString()) scheduleRefresh();
	});

	panel.onDidDispose(() => {
		if (refreshTimer) clearTimeout(refreshTimer);
		changeSubscription.dispose();
	});
}

function renderLabelGraphHtml(
	graph: ReturnType<typeof buildFileGraph>,
	fileName: string,
	scriptUris: { cytoscape: string; dagre: string; cytoscapeDagre: string }
): string {
	const escapeJson = (s: string) => s.replace(/</g, '\\u003c');
	const data = escapeJson(JSON.stringify(graph));

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; }
  #toolbar { padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 12px; font-size: 12px; }
  #toolbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  #toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  #toolbar .meta { color: var(--vscode-descriptionForeground); }
  #cy { flex: 1; position: relative; }
  #tooltip {
    position: absolute;
    display: none;
    max-width: 380px;
    padding: 8px 10px;
    background: var(--vscode-editorHoverWidget-background, #252526);
    color: var(--vscode-editorHoverWidget-foreground, #ccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    white-space: pre-wrap;
    pointer-events: none;
    z-index: 10;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  #tooltip .tt-name { font-weight: bold; margin-bottom: 4px; font-family: system-ui, sans-serif; }
  #tooltip .tt-body { opacity: 0.9; }
  #tooltip .tt-empty { opacity: 0.6; font-style: italic; }
  #error { display: none; padding: 2em; color: var(--vscode-errorForeground); }
  #error code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
<div id="toolbar">
  <strong id="filename">${fileName}</strong>
  <span class="meta" id="meta">${graph.nodes.length} nodes · ${graph.edges.length} edges</span>
  <span style="flex:1"></span>
  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
    <input type="checkbox" id="show-orphans" />
    Show unreferenced
  </label>
  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
    <input type="checkbox" id="show-fallthroughs" checked />
    Show fallthroughs
  </label>
  <label style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
    <input type="checkbox" id="show-calls" checked />
    Show calls
  </label>
  <button id="flip" title="Toggle horizontal / vertical layout">Flip</button>
  <button id="fit">Fit</button>
</div>
<div id="cy"><div id="tooltip"></div></div>
<script src="${scriptUris.cytoscape}"></script>
<script src="${scriptUris.dagre}"></script>
<script src="${scriptUris.cytoscapeDagre}"></script>
<script>
(function() {
  const vscode = acquireVsCodeApi();
  let graph = ${data};

  const buildElements = (g) => {
    // Orphan detection considers only branching edges (jumps). Labels
    // connected only by implicit textual flow (fallthrough) or by
    // function-call semantics (call) are still "structure-only" from
    // a branching perspective.
    const hasIncoming = new Set();
    const hasOutgoing = new Set();
    for (const e of g.edges) {
      if (e.kind !== 'jump') continue;
      hasIncoming.add(e.target);
      hasOutgoing.add(e.source);
    }
    const isOrphan = (id) => !hasIncoming.has(id) && !hasOutgoing.has(id);

    const els = [];
    for (const n of g.nodes) {
      const data = { id: n.id, label: n.label, kind: n.kind, orphan: isOrphan(n.id) };
      if (n.uri) { data.uri = n.uri; data.line = n.line; }
      if (n.preview) { data.preview = n.preview; }
      // Note: we intentionally do NOT set data.parent even though local
      // labels have a parent global label — compound nodes make layout
      // confusing when the parent has its own outgoing edges. Locals are
      // visually distinguished by color.
      els.push({ data });
    }
    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i];
      const data = {
        id: 'e' + i,
        source: e.source,
        target: e.target,
        kind: e.kind,
        fromUri: e.fromUri,
        fromLine: e.fromLine,
      };
      if (e.menuChoice) {
        data.menuChoice = e.menuChoice;
        data.isMenuEdge = 'yes';
      }
      els.push({ data });
    }
    return els;
  };

  const fg = getComputedStyle(document.body).getPropertyValue('--vscode-foreground') || '#ddd';

  let currentDir = 'LR';

  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements: buildElements(graph),
    layout: { name: 'dagre', rankDir: currentDir, nodeSep: 40, rankSep: 60 },
    wheelSensitivity: 1.0,
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-valign': 'center',
          'text-halign': 'center',
          'color': fg,
          'font-size': '11px',
          'font-family': 'system-ui, sans-serif',
          'width': 'label',
          'height': 'label',
          'padding': '8px',
          'shape': 'round-rectangle',
          'background-color': '#3b6ea8',
          'border-color': '#5a8fce',
          'border-width': 1,
          'text-wrap': 'wrap',
          'text-max-width': '200px',
        },
      },
      {
        selector: 'node[kind = "local"]',
        style: {
          'background-color': '#4c8055',
          'border-color': '#6ab074',
          'font-size': '10px',
        },
      },
      {
        selector: 'node[kind = "external"]',
        style: {
          'background-color': '#555',
          'border-color': '#888',
          'border-style': 'dashed',
          'color': '#aaa',
          'font-style': 'italic',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5,
          'line-color': '#888',
          'target-arrow-color': '#888',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'arrow-scale': 1.1,
        },
      },
      {
        selector: 'edge[kind = "fallthrough"]',
        style: {
          'line-style': 'dashed',
          'line-color': '#666',
          'target-arrow-color': '#666',
          'target-arrow-shape': 'chevron',
          'width': 1,
        },
      },
      {
        selector: 'edge[kind = "call"]',
        style: {
          'line-style': 'dotted',
          'line-color': '#c48a3a',
          'target-arrow-color': '#c48a3a',
          'width': 1.5,
        },
      },
      {
        selector: 'edge.hidden',
        style: { 'display': 'none' },
      },
      {
        selector: 'edge[isMenuEdge = "yes"]',
        style: {
          'label': 'data(menuChoice)',
          'font-size': '9px',
          'color': fg,
          'text-background-color': 'var(--vscode-editor-background, #1e1e1e)',
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          'text-background-shape': 'round-rectangle',
          'text-rotation': 'autorotate',
          'line-color': '#8a6dbf',
          'target-arrow-color': '#8a6dbf',
          'source-arrow-shape': 'tee',
          'source-arrow-color': '#8a6dbf',
          'width': 2,
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 3,
          'border-color': '#e0a020',
        },
      },
      {
        selector: 'node.hidden',
        style: { 'display': 'none' },
      },
      {
        selector: '.faded',
        style: { 'opacity': 0.3 },
      },
    ],
  });

  // Hide structure-only (orphan) labels by default.
  const applyOrphanVisibility = (showOrphans) => {
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        if (n.data('orphan')) {
          n.toggleClass('hidden', !showOrphans);
        }
      });
    });
  };
  applyOrphanVisibility(false);

  const applyEdgeKindVisibility = (kind, show) => {
    cy.batch(() => {
      cy.edges().forEach((e) => {
        if (e.data('kind') === kind) {
          e.toggleClass('hidden', !show);
        }
      });
    });
  };
  const applyFallthroughVisibility = (show) => applyEdgeKindVisibility('fallthrough', show);
  const applyCallVisibility = (show) => applyEdgeKindVisibility('call', show);
  applyFallthroughVisibility(true);
  applyCallVisibility(true);

  const clearFocus = () => {
    cy.batch(() => cy.elements().removeClass('faded'));
  };

  const focusNode = (node) => {
    const keep = node.closedNeighborhood(); // node itself + direct neighbors + connecting edges
    cy.batch(() => {
      cy.elements().addClass('faded');
      keep.removeClass('faded');
    });
  };

  cy.on('tap', 'node', (evt) => {
    focusNode(evt.target);
    const d = evt.target.data();
    if (d.uri) {
      vscode.postMessage({ type: 'reveal', uri: d.uri, line: d.line });
    }
  });
  cy.on('tap', 'edge', (evt) => {
    const d = evt.target.data();
    if (d.fromUri) {
      vscode.postMessage({ type: 'reveal', uri: d.fromUri, line: d.fromLine });
    }
  });
  // Tap on empty background clears the focus.
  cy.on('tap', (evt) => {
    if (evt.target === cy) clearFocus();
  });

  const relayout = (dir) => {
    currentDir = dir;
    clearFocus();
    cy.layout({ name: 'dagre', rankDir: dir, nodeSep: 40, rankSep: 60 }).run();
  };

  document.getElementById('fit').addEventListener('click', () => cy.fit(undefined, 30));
  document.getElementById('flip').addEventListener('click', () => {
    relayout(currentDir === 'LR' ? 'TB' : 'LR');
  });
  document.getElementById('show-orphans').addEventListener('change', (e) => {
    applyOrphanVisibility(e.target.checked);
    // Re-run the layout so the visible subset is arranged tightly.
    relayout(currentDir);
  });
  document.getElementById('show-fallthroughs').addEventListener('change', (e) => {
    applyFallthroughVisibility(e.target.checked);
    relayout(currentDir);
  });
  document.getElementById('show-calls').addEventListener('change', (e) => {
    applyCallVisibility(e.target.checked);
    relayout(currentDir);
  });

  // Fix pan/drag getting stuck when mouseup fires outside the webview
  // iframe (Cytoscape never sees the release). If the mouse re-enters
  // the graph with no button held, synthesize the missing release on
  // the canvas so Cytoscape stops tracking a phantom drag.
  const cyContainer = document.getElementById('cy');
  cyContainer.addEventListener('mousemove', (e) => {
    if (e.buttons === 0) {
      const target = cyContainer.querySelector('canvas') || cyContainer;
      const releaseAt = (type) => target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0, buttons: 0,
      }));
      releaseAt('mouseup');
      releaseAt('pointerup');
    }
  });

  // Hover preview: show a tooltip with the label's body preview.
  const tooltip = document.getElementById('tooltip');
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  cy.on('mouseover', 'node', (evt) => {
    const d = evt.target.data();
    if (d.kind === 'external') return;
    const preview = d.preview;
    const body = preview && preview.length
      ? '<div class="tt-body">' + preview.map(escapeHtml).join('\\n') + '</div>'
      : '<div class="tt-empty">(empty body)</div>';
    tooltip.innerHTML = '<div class="tt-name">' + escapeHtml(d.label) + '</div>' + body;
    tooltip.style.display = 'block';
  });
  cy.on('mouseout', 'node', () => {
    tooltip.style.display = 'none';
  });
  cyContainer.addEventListener('mousemove', (e) => {
    if (tooltip.style.display !== 'block') return;
    const rect = cyContainer.getBoundingClientRect();
    // Offset from cursor; flip to the left if we'd go past the right edge.
    const x = e.clientX - rect.left + 14;
    const y = e.clientY - rect.top + 14;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
    // Clamp so it stays visible if near the right/bottom edges.
    const ttRect = tooltip.getBoundingClientRect();
    if (ttRect.right > rect.right) {
      tooltip.style.left = (e.clientX - rect.left - ttRect.width - 14) + 'px';
    }
    if (ttRect.bottom > rect.bottom) {
      tooltip.style.top = (e.clientY - rect.top - ttRect.height - 14) + 'px';
    }
  });

  // Live refresh: the extension posts { type: 'refresh', graph } when
  // the source file changes. Replace elements without recreating the
  // Cytoscape instance so pan/zoom/direction survive.
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'refresh' && msg.graph) {
      graph = msg.graph;
      const showOrphans = document.getElementById('show-orphans').checked;
      const showFallthroughs = document.getElementById('show-fallthroughs').checked;
      const showCalls = document.getElementById('show-calls').checked;
      cy.batch(() => {
        cy.elements().remove();
        cy.add(buildElements(graph));
      });
      applyOrphanVisibility(showOrphans);
      applyFallthroughVisibility(showFallthroughs);
      applyCallVisibility(showCalls);
      // Preserve currentDir but re-run the layout so new nodes land in position.
      cy.layout({ name: 'dagre', rankDir: currentDir, nodeSep: 40, rankSep: 60 }).run();
      document.getElementById('meta').textContent = graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges';
      if (msg.fileName) {
        document.getElementById('filename').textContent = msg.fileName;
      }
    }
  });
})();
</script>
</body>
</html>`;
}
