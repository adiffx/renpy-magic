import { buildFileGraph } from '../server/labelGraph';
import { extractLabelsFromText } from '../server/labelMap';

const FILE_URI = 'file:///game/ch01.rpy';

describe('buildFileGraph', () => {
	it('creates nodes for every label in the file', () => {
		const labels = extractLabelsFromText([
			'label start:',
			'    return',
			'label ending:',
			'    return',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		expect(g.nodes).toHaveLength(2);
		expect(g.nodes.map(n => n.label).sort()).toEqual(['ending', 'start']);
		expect(g.nodes.every(n => n.kind === 'global')).toBe(true);
	});

	it('surfaces jump, call, and fallthrough edges', () => {
		const labels = extractLabelsFromText([
			'label a:',
			'    call b',
			'    jump c',
			'label b:',
			'    return',
			'label c:',
			'    return',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		const a = g.nodes.find(n => n.label === 'a')!;
		const b = g.nodes.find(n => n.label === 'b')!;
		const c = g.nodes.find(n => n.label === 'c')!;
		const jumps = g.edges.filter(e => e.kind === 'jump');
		const calls = g.edges.filter(e => e.kind === 'call');
		expect(jumps).toContainEqual(expect.objectContaining({ source: a.id, target: c.id }));
		expect(calls).toContainEqual(expect.objectContaining({ source: a.id, target: b.id }));
	});

	it('attributes local labels to the preceding global as their parent', () => {
		const labels = extractLabelsFromText([
			'label chapter:',
			'    jump .intro',
			'label .intro:',
			'    return',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		const chapter = g.nodes.find(n => n.label === 'chapter')!;
		const intro = g.nodes.find(n => n.label === '.intro')!;
		expect(intro.kind).toBe('local');
		expect(intro.parent).toBe(chapter.id);
	});

	it('creates an external node for unresolved global targets', () => {
		const labels = extractLabelsFromText([
			'label start:',
			'    jump somewhere_else',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		const external = g.nodes.find(n => n.kind === 'external');
		expect(external).toBeDefined();
		expect(external!.label).toBe('somewhere_else');
		// External nodes have no uri (nowhere to jump to).
		expect(external!.uri).toBeUndefined();
	});

	it('deduplicates external nodes across multiple jump edges', () => {
		const labels = extractLabelsFromText([
			'label a:',
			'    jump elsewhere',
			'label b:',
			'    jump elsewhere',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		const externals = g.nodes.filter(n => n.kind === 'external');
		expect(externals).toHaveLength(1);
		expect(g.edges).toHaveLength(2);
	});

	it('creates an external node for a call target that lives elsewhere', () => {
		const labels = extractLabelsFromText([
			'label start:',
			'    call helper',
			'    return',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		const external = g.nodes.find(n => n.kind === 'external');
		expect(external).toBeDefined();
		expect(external!.label).toBe('helper');
		expect(g.edges.some(e => e.kind === 'call' && e.target === external!.id)).toBe(true);
	});
});
