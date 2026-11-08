import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'inbox-directory-'));
after(() => rm(temporary, { recursive: true, force: true }));
const output = join(temporary, 'directory.mjs');
await build({ entryPoints: ['app/lib/mailbox-directory.ts'], bundle: true, platform: 'node', format: 'esm', outfile: output });
const { groupMailboxes, parseMailboxPreferences } = await import(pathToFileURL(output).href);
const mailboxes = [
  { id: 'reply@music.test', email: 'reply@music.test', name: 'Replies' },
  { id: 'support@photos.test', email: 'support@photos.test', name: 'Support' },
  { id: 'support@music.test', email: 'support@music.test', name: 'Support', settings: { fromName: '音乐服务' } },
];

test('groups projects without losing distinct mailboxes on the same domain', () => {
  const groups = groupMailboxes(mailboxes);
  assert.deepEqual(groups.map((group) => [group.domain, group.accounts.length]), [['music.test', 2], ['photos.test', 1]]);
  assert.equal(mailboxes[0].id, 'reply@music.test');
});

test('searches case-insensitively across address, display name and multiple terms', () => {
  assert.deepEqual(groupMailboxes(mailboxes, 'MUSIC support')[0].accounts.map((m) => m.id), ['support@music.test']);
  assert.equal(groupMailboxes(mailboxes, '音乐')[0].accounts[0].id, 'support@music.test');
  assert.equal(groupMailboxes(mailboxes, 'missing').length, 0);
});

test('filters individual pinned accounts and keeps recent projects in visit order', () => {
  assert.deepEqual(groupMailboxes(mailboxes, '', 'pinned', ['reply@music.test', 'deleted@old.test'])[0].accounts.map((m) => m.id), ['reply@music.test']);
  assert.deepEqual(groupMailboxes(mailboxes, '', 'recent', [], ['support@photos.test', 'support@music.test', 'reply@music.test']).map((g) => g.domain), ['photos.test', 'music.test']);
  assert.equal(groupMailboxes(mailboxes, 'photos', 'pinned', ['reply@music.test']).length, 0);
});

test('tolerates damaged browser preferences and limits and deduplicates history', () => {
  assert.deepEqual(parseMailboxPreferences('{bad'), { pinned: [], recent: [] });
  assert.deepEqual(parseMailboxPreferences('null'), { pinned: [], recent: [] });
  const value = parseMailboxPreferences(JSON.stringify({ pinned: ['one', 'one', null, 1, ''], recent: Array.from({ length: 12 }, (_, i) => String(i)) }));
  assert.deepEqual(value.pinned, ['one']);
  assert.equal(value.recent.length, 8);
});

const projectOutput = join(temporary, 'projects.mjs');
await build({ entryPoints: ['app/lib/mailbox-projects.ts'], bundle: true, platform: 'node', format: 'esm', outfile: projectOutput });
const { MAILBOX_PROJECTS, PROJECT_CATEGORIES, mailboxProject, paginateProjects } = await import(pathToFileURL(projectOutput).href);

test('classifies every configured project exactly once and keeps unknown projects visible', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = await readFile('wrangler.jsonc', 'utf8');
  const domains = config.match(/"DOMAINS":\s*"([^"]+)"/)[1].split(',').sort();
  assert.deepEqual(Object.keys(MAILBOX_PROJECTS).sort(), domains);
  assert.equal(Object.values(MAILBOX_PROJECTS).every((project) => PROJECT_CATEGORIES.some((category) => category.id === project.category)), true);
  assert.equal(mailboxProject('NEW.example').category, 'other');
  assert.equal(mailboxProject('TUVIMO.COM').category, 'ai');
  assert.equal(mailboxProject('size-it-up.org').category, 'games');
});

test('paginates project groups without splitting the addresses of one website', () => {
  const projects = Array.from({ length: 16 }, (_, i) => ({ domain: `${i}.test`, accounts: ['support', 'reply'] }));
  const first = paginateProjects(projects, 1, 10);
  const second = paginateProjects(projects, 2, 10);
  assert.deepEqual([first.items.length, first.start, first.end, first.totalPages], [10, 1, 10, 2]);
  assert.deepEqual([second.items.length, second.start, second.end], [6, 11, 16]);
  assert.deepEqual([...first.items, ...second.items], projects);
  assert.equal(second.items[0].accounts.length, 2);
});

test('clamps old page numbers after filtering and handles empty or malformed page inputs', () => {
  assert.equal(paginateProjects([1, 2, 3], 9, 10).page, 1);
  assert.equal(paginateProjects([1, 2, 3], NaN, 0).page, 1);
  const empty = paginateProjects([], 99, 10);
  assert.deepEqual([empty.items, empty.page, empty.start, empty.end, empty.totalPages], [[], 1, 0, 0, 1]);
});

test('Chinese search includes project purpose as well as mailbox metadata', () => {
  const results = groupMailboxes([{ id: 'support@aigenmusic.com', email: 'support@aigenmusic.com', name: 'support' }], '音乐');
  assert.equal(results[0].domain, 'aigenmusic.com');
});
