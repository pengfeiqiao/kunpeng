import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { SkillLoader, type SkillLoaderAdapter } from './skillLoader.ts';

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\nvisibility: toolbar\n---\nHello {{userContent}}`;
}

test('shared agent loader hot reloads the next catalog snapshot', async () => {
  let names = ['one'];
  const files = new Map<string, string>([
    ['/skills/one/SKILL.md', skillMd('one', 'first')],
    ['/skills/one/skill.json', JSON.stringify({ id: 'one', name: 'One' })],
  ]);
  const adapter: SkillLoaderAdapter = {
    scan: async () => names,
    read: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw new Error('missing');
      return value;
    },
  };
  const loader = new SkillLoader(['/skills'], adapter);
  await loader.loadAll();
  assert.deepEqual(loader.getAll().map((skill) => skill.id), ['one']);

  names = ['one', 'two'];
  files.set('/skills/two/SKILL.md', skillMd('two', 'second'));
  files.set('/skills/two/skill.json', JSON.stringify({ id: 'two', name: 'Two' }));
  await loader.refreshIfDue(0);
  assert.deepEqual(loader.getAll().map((skill) => skill.id), ['one', 'two']);
  assert.equal(loader.renderPrompt(loader.getAll()[1], { userContent: 'world' }), 'Hello world');
});

test('SKILL.md-only entries remain reference skills and cannot be invoked', async () => {
  const adapter: SkillLoaderAdapter = {
    scan: async () => ['reference'],
    read: async (path) => {
      if (path.endsWith('skill.json')) throw new Error('missing');
      return skillMd('reference', 'reference only');
    },
  };
  const loader = new SkillLoader(['/skills'], adapter);
  const [skill] = await loader.loadAll();
  assert.equal(skill.invokable, false);
  assert.equal(skill.id, undefined);
});

test('legacy auto skills are exposed as library references immediately', async () => {
  const adapter: SkillLoaderAdapter = {
    scan: async () => ['auto-old', 'core-rule'],
    read: async (path) => {
      if (path.endsWith('skill.json')) throw new Error('missing');
      if (path.includes('/auto-old/')) {
        return '---\nname: auto-old\ndescription: old auto skill\nvisibility: internal\n---\nAUTO BODY';
      }
      return '---\nname: core-rule\ndescription: core rule\nvisibility: internal\n---\nCORE BODY';
    },
  };
  const loader = new SkillLoader(['/skills'], adapter);
  const skills = await loader.loadAll();
  assert.equal(skills.find((skill) => skill.name === 'auto-old')?.visibility, 'library');
  assert.equal(skills.find((skill) => skill.name === 'core-rule')?.visibility, 'internal');
});

test('prompt rendering preserves shell and JS interpolation examples', async () => {
  const adapter: SkillLoaderAdapter = {
    scan: async () => ['template'],
    read: async (path) => {
      if (path.endsWith('skill.json')) throw new Error('missing');
      return [
        '---',
        'name: template',
        'description: template test',
        'visibility: toolbar',
        '---',
        'Input: {{ userContent }}',
        'Shell: ${HOME}',
        'JavaScript: `${value}`',
        'Missing explicit: {{missing}}',
        'Missing secret: ${dmxApiKey}',
      ].join('\n');
    },
  };
  const loader = new SkillLoader(['/skills'], adapter);
  const [skill] = await loader.loadAll();
  const rendered = loader.renderPrompt(skill, { userContent: 'cost $1 and $&' });
  assert.match(rendered, /Input: cost \$1 and \$&/);
  assert.match(rendered, /Shell: \$\{HOME\}/);
  assert.match(rendered, /JavaScript: `\$\{value\}`/);
  assert.match(rendered, /Missing explicit:\s*\n/);
  assert.match(rendered, /Missing secret:\s*$/);
});

test('UI catalog and skill_invoke use the shared agent loader instead of independent scans', () => {
  const uiLoader = readFileSync(new URL('../skillLoader.ts', import.meta.url), 'utf8');
  const invokeTool = readFileSync(new URL('./tools/skillInvokeTool.ts', import.meta.url), 'utf8');
  assert.match(uiLoader, /getSharedSkillLoader/);
  assert.doesNotMatch(uiLoader, /invoke\s*<[^>]*>\s*\(\s*['"]scan_skills_dir/);
  assert.match(invokeTool, /getSharedSkillLoader/);
});
