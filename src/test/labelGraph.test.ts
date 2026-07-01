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

	it('links jump edges to their targets and ignores call edges', () => {
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
		expect(g.edges).toHaveLength(1);
		const a = g.nodes.find(n => n.label === 'a')!;
		const c = g.nodes.find(n => n.label === 'c')!;
		expect(g.edges[0]).toMatchObject({ source: a.id, target: c.id, kind: 'jump' });
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

	it('does not create an external node when the only reference is a call', () => {
		const labels = extractLabelsFromText([
			'label start:',
			'    call helper',
		].join('\n'));
		const g = buildFileGraph(FILE_URI, labels);
		expect(g.edges).toHaveLength(0);
		expect(g.nodes.filter(n => n.kind === 'external')).toHaveLength(0);
	});
});
