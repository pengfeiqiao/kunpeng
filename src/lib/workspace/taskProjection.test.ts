import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import { reserveWorkspaceSubmission, transitionWorkspaceSubmission } from './submissions.ts';
import { projectWorkspaceTasks } from './taskProjection.ts';
import type { CanvasTask } from '../../stores/canvasTaskStore';

function fixture() {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('project'), shots: [{ id: 's', shotNo: '1', description: '司机开车', characterIds: [], videoPrompt: '司机开车' }] }, 1);
  const draft = initialWorkspaceDraft(data, 'shot:s', 'video')!;
  const task: CanvasTask = { id: 'task', nodeId: '', engineId: draft.engineId, engineLabel: 'model', kind: 'video', endpoint: 'mock',
    prompt: draft.prompt, status: 'running', resultPaths: [], resultUrls: [], createdAt: 2,
    workspaceBinding: { submissionId: 'submission', snapshot: draft } };
  return { data, draft, task };
}

test('background recovery restores original owner and snapshot; never adopts result or changes selection', () => {
  const { data, task } = fixture();
  const before = { ...data, projectViewState: { workspaceObjectId: 'another-object' } };
  const next = projectWorkspaceTasks(before, [{ ...task, status: 'succeeded', resultPaths: ['/output.mp4'] }], new Set());
  const version = next.projectObjects!.versions[0];
  assert.equal(version.ownerObjectId, 'shot:s');
  assert.equal(version.selected, false);
  assert.equal(version.generationSnapshot!.prompt, task.prompt);
  assert.equal(next.projectViewState!.workspaceObjectId, 'another-object');
  assert.equal(next.shots[0].videoPath, undefined);
  assert.equal(projectWorkspaceTasks(next, [{ ...task, status: 'succeeded', resultPaths: ['/output.mp4'] }], new Set()), next);
  const other = migrateWorkshopProjectObjects(emptyWorkshopData('other'));
  assert.equal(projectWorkspaceTasks(other, [task], new Set()), other);
});

test('orphan pending confirmation cancels; post-boundary missing records remain uncertain and live requests are preserved', () => {
  const { data, draft } = fixture();
  const waiting = reserveWorkspaceSubmission(data, draft, 'submission')!;
  assert.equal(projectWorkspaceTasks(waiting, [], new Set()).workspaceSubmissions!.submission.status, 'cancelled');
  assert.equal(projectWorkspaceTasks(waiting, [], new Set(['submission'])), waiting);
  const submitted = transitionWorkspaceSubmission(waiting, 'submission', 'submitting');
  const recovered = projectWorkspaceTasks(submitted, [], new Set());
  assert.equal(recovered.workspaceSubmissions!.submission.status, 'uncertain');
  assert.equal(projectWorkspaceTasks(recovered, [], new Set()), recovered);
});

test('task receipt supersedes stale awaiting-confirmation state; failed receipt never grants retry', () => {
  const { data, draft, task } = fixture();
  const waiting = reserveWorkspaceSubmission(data, draft, 'submission')!;
  assert.equal(projectWorkspaceTasks(waiting, [task], new Set()).workspaceSubmissions!.submission.status, 'running');
  const failed = projectWorkspaceTasks(waiting, [{ ...task, status: 'failed' }], new Set());
  assert.equal(failed.workspaceSubmissions!.submission.status, 'uncertain');
  assert.equal(projectWorkspaceTasks(failed, [{ ...task, status: 'failed' }], new Set()), failed);
});
