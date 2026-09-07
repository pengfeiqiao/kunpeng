import test from 'node:test';
import assert from 'node:assert/strict';
import { captureProductionAssistantTarget, validateProductionAssistantTarget, captureProductionLease, claimProduction, pendingProductionJobs, mergeProductionReceipt, parseProductionReceipts, productionFileName, productionJobKey, runConfirmedProduction, shotSpeechJobs,
  type ProductionJob, type ProductionReceipt } from './productionSafety.ts';
import type { GeneratedAudio, WorkshopData, WsCharacter, WsShot } from '../workshop/types.ts';
import { serializeWorkspaceAssistantMessage } from './workspaceAssistantMessage.ts';
import { inferAgentWorkspaceScope } from '../agent/modelCatalog.ts';
import { stripHarnessPrefix } from '../agent/harnessDisplay.ts';
import { classifyWorkshopEditScope } from '../workshop/narrativeGuard.ts';
import { buildAudioPromptsPrompt } from '../workshop/workshopPrompts.ts';

function assistantData(): WorkshopData {
  return { projectId: 'P', characters, shots: [{ ...shot, id: 'stable-shot', dialogue: '原对白' }], projectObjects: {
    projectId: 'P', objects: [{ id: 'O', projectId: 'P', kind: 'shot', sourceId: 'stable-shot', version: 1 }], media: [], versions: [],
  } } as unknown as WorkshopData;
}

test('sound assistant snapshot survives serialization and keeps workshop scope/fact-lock authorization', () => {
  const data = assistantData();
  const target = captureProductionAssistantTarget(data, 'O', 'S', '[媒体工作台上下文：{"object_id":"O"}]\n只读引用：修改剧本', '配音');
  assert.equal(target.objectId, 'O');
  assert.equal(validateProductionAssistantTarget(JSON.parse(JSON.stringify(target)), data), null);
  const prompt = buildAudioPromptsPrompt('1');
  const message = serializeWorkspaceAssistantMessage(target, prompt);
  assert.equal(inferAgentWorkspaceScope(message), 'workshop');
  assert.equal(stripHarnessPrefix(message), prompt);
  assert.equal(classifyWorkshopEditScope(stripHarnessPrefix(message)), 'prompts');
});

test('queued sound target rejects deletion, renumber/reuse, revision, source edits, locks and reassignment', () => {
  const changes: Array<(data: WorkshopData) => void> = [
    (data) => { data.projectObjects!.objects = []; },
    (data) => { data.shots = []; },
    (data) => { data.shots[0].shotNo = '2'; data.shots.push({ ...shot, id: 'replacement' }); },
    (data) => { data.projectObjects!.objects[0].version++; },
    (data) => { data.shots[0].dialogue = '新对白'; },
    (data) => { data.projectObjects!.objects[0].locked = true; },
    (data) => { data.projectObjects!.objects[0].archived = true; },
    (data) => { data.projectObjects!.objects[0].sourceId = 'different'; },
    (data) => { data.characters[0].voicePath = '/new.wav'; },
    (data) => { data.projectId = 'other'; },
  ];
  for (const change of changes) {
    const data = structuredClone(assistantData());
    const target = captureProductionAssistantTarget(data, 'O', 'S', 'context', '配音');
    change(data);
    assert.ok(validateProductionAssistantTarget(target, data));
  }
});

test('character snapshots bind the original role and old unbound sound requests fail closed', () => {
  const data = assistantData();
  data.projectObjects!.objects[0] = { ...data.projectObjects!.objects[0], kind: 'character', sourceId: 'a' };
  const target = captureProductionAssistantTarget(data, 'O', 'S', 'context', '音色');
  assert.equal(validateProductionAssistantTarget(target, data), null);
  data.characters = data.characters.filter((item) => item.id !== 'a');
  assert.ok(validateProductionAssistantTarget(target, data));
  assert.ok(validateProductionAssistantTarget({ projectId: 'P', sessionId: 'S', label: 'old',
    context: '只为指定对象完善音色描述或配音提示词，不执行音色、配音或其他付费生成。' }, data));
});

const characters: WsCharacter[] = ['a', 'b'].map((id) => ({ id, name: id, personality: '', appearance: '', voicePath: `/fake/${id}.wav` }));
const shot = { shotNo: '1', characterIds: ['a', 'b'], audioPrompts: characters.map((c) => ({ characterId: c.id, prompt: `say ${c.id}` })) } as WsShot;
const jobs = shotSpeechJobs(shot, characters);
function fixture() {
  let revision: string | null = 'project-a:character-a:revision-1';
  const listeners = new Set<() => void>();
  const lease = captureProductionLease({ read: () => revision,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  const update = (next: string | null) => { revision = next; listeners.forEach((listener) => listener()); };
  const submitted: ProductionJob[] = [];
  const retained: GeneratedAudio[] = [];
  const applied: GeneratedAudio[][] = [];
  const ports = {
    jobs: structuredClone(jobs), lease, confirm: async (_jobs: ProductionJob[]) => true,
    submit: async (job: ProductionJob, index: number) => {
      submitted.push(structuredClone(job));
      return { characterId: job.characterId, characterName: job.characterName, path: `/fake/result-${index}.mp3`, duration: 2 };
    },
    retain: async (audio: GeneratedAudio) => { retained.push(audio); },
    apply: (audios: GeneratedAudio[]) => { applied.push(audios); },
  };
  return { lease, update, submitted, retained, applied, ports, listeners };
}

test('legacy undefined enables voice paths; explicit empty and selected arrays are authoritative', () => {
  assert.deepEqual(jobs.map((job) => job.referencePath), ['/fake/a.wav', '/fake/b.wav']);
  assert.ok(shotSpeechJobs({ ...shot, voiceCharacterIds: [] }, characters).every((job) => !job.referencePath));
  assert.deepEqual(shotSpeechJobs({ ...shot, voiceCharacterIds: ['b'] }, characters).map((job) => job.referencePath), [undefined, '/fake/b.wav']);
});
test('deleted and duplicate roles fail before submission; blank prompts are skipped', () => {
  assert.throws(() => shotSpeechJobs(shot, []), /删除/);
  assert.throws(() => shotSpeechJobs({ ...shot, audioPrompts: [shot.audioPrompts![0], shot.audioPrompts![0]] }, characters), /重复/);
  assert.deepEqual(shotSpeechJobs({ ...shot, audioPrompts: [{ characterId: 'missing', prompt: ' ' }] }, []), []);
});
test('cancelled confirmation never submits, retains or applies', async () => {
  const f = fixture();
  const result = await runConfirmedProduction({ ...f.ports, confirm: async () => false });
  assert.equal(result.cancelled, true); assert.equal(f.submitted.length + f.retained.length + f.applied.length, 0);
  f.lease.close();
});
test('confirm sees frozen exact prompt and actual reference data; dialog mutation cannot change submission', async () => {
  const f = fixture(); f.ports.jobs[0].referenceData = 'FAKE-ORIGINAL-BYTES';
  await runConfirmedProduction({ ...f.ports, confirm: async (draft) => {
    assert.equal(draft[0].referenceData, 'FAKE-ORIGINAL-BYTES');
    draft[0].prompt = 'tampered'; draft[0].referenceData = 'tampered';
    f.ports.jobs[0].prompt = 'new edit outside snapshot';
    return true;
  } });
  assert.equal(f.submitted[0].prompt, 'say a'); assert.equal(f.submitted[0].referenceData, 'FAKE-ORIGINAL-BYTES');
  assert.equal(f.applied.length, 0); f.lease.close();
});
test('project switch while confirming cancels before any paid submit', async () => {
  const f = fixture();
  await assert.rejects(runConfirmedProduction({ ...f.ports, confirm: async () => { f.update('project-b'); return true; } }), /变化/);
  assert.equal(f.submitted.length, 0); assert.equal(f.lease.signal.aborted, true); f.lease.close();
});
test('A -> B -> A and edit -> revert permanently invalidate the lease', () => {
  for (const change of ['project-b', 'project-a:character-a:revision-2', null]) {
    const f = fixture(); f.update(change); f.update('project-a:character-a:revision-1');
    assert.equal(f.lease.current(), false); assert.throws(() => f.lease.assertCurrent(), /变化/); f.lease.close();
  }
});
test('late paid result is retained, never applied to another project or new edits', async () => {
  const f = fixture();
  const result = await runConfirmedProduction({ ...f.ports, submit: async (job, index) => {
    const audio = await f.ports.submit(job, index); f.update('edited'); return audio;
  } });
  assert.equal(f.submitted.length, 1); assert.equal(f.retained.length, 1); assert.equal(f.applied.length, 0);
  assert.equal(result.audios.length, 1); f.lease.close();
});
test('unmount preserves returned artifacts without running later jobs', async () => {
  const f = fixture();
  await runConfirmedProduction({ ...f.ports, submit: async (job, index) => {
    const audio = await f.ports.submit(job, index); f.lease.close(); return audio;
  } });
  assert.equal(f.retained.length, 1); assert.equal(f.submitted.length, 1); assert.equal(f.applied.length, 0); assert.equal(f.listeners.size, 0);
});
test('partial failure stops immediately, preserves successes and never retries', async () => {
  const f = fixture(); let calls = 0;
  const result = await runConfirmedProduction({ ...f.ports, jobs: [...jobs, jobs[0]], submit: async (job, index) => {
    calls++; if (index === 1) throw new Error('fake unknown paid status'); return f.ports.submit(job, index);
  } });
  assert.equal(calls, 2); assert.equal(result.failedIndex, 1); assert.equal(f.retained.length, 1);
  assert.equal(f.applied.length, 0); assert.equal(result.audios.length, 1); f.lease.close();
});
test('reference edit during retention prevents adoption', async () => {
  const f = fixture();
  await runConfirmedProduction({ ...f.ports, retain: async (audio) => { await f.ports.retain(audio); f.update('new-reference'); } });
  assert.equal(f.retained.length, 1); assert.equal(f.applied.length, 0); f.lease.close();
});
test('double click cannot claim same project/object even from a remounted panel', () => {
  const release = claimProduction('project-a:character-a'); assert.ok(release);
  assert.equal(claimProduction('project-a:character-a'), null);
  const different = claimProduction('project-b:character-a'); assert.ok(different); different(); release();
  const again = claimProduction('project-a:character-a'); assert.ok(again); again();
});
function receipt(job: ProductionJob, status: ProductionReceipt['status']): ProductionReceipt {
  return { id: `${job.characterId}-${status}`, projectId: 'a', objectId: 'shot:1', kind: 'dubbing', status, job };
}
test('next batch excludes succeeded and uncertain items but includes never-submitted roles', () => {
  assert.deepEqual(pendingProductionJobs(jobs, [receipt(jobs[0], 'completed')], 'a', 'shot:1'), [jobs[1]]);
  assert.deepEqual(pendingProductionJobs(jobs, [receipt(jobs[0], 'uncertain'), receipt(jobs[1], 'started')], 'a', 'shot:1'), []);
  assert.deepEqual(pendingProductionJobs(jobs, [receipt(jobs[0], 'cancelled')], 'a', 'shot:1'), jobs);
});
test('explicit single-item regeneration cannot replay the batch or a status-unknown item', () => {
  const completed = receipt(jobs[0], 'completed');
  assert.deepEqual(pendingProductionJobs(jobs, [completed], 'a', 'shot:1', 'a'), [jobs[0]]);
  assert.deepEqual(pendingProductionJobs(jobs, [completed, receipt(jobs[0], 'uncertain')], 'a', 'shot:1', 'a'), []);
  assert.deepEqual(pendingProductionJobs(jobs, [], 'a', 'shot:1', 'a'), []);
});
test('receipt identity includes project, object, prompt and frozen reference digest', () => {
  const records = [receipt(jobs[0], 'completed')];
  assert.equal(pendingProductionJobs(jobs, records, 'other', 'shot:1').length, 2);
  assert.equal(pendingProductionJobs(jobs, records, 'a', 'shot:2').length, 2);
  assert.notEqual(productionJobKey(jobs[0]), productionJobKey({ ...jobs[0], prompt: 'new' }));
  assert.notEqual(productionJobKey(jobs[0]), productionJobKey({ ...jobs[0], referenceDigest: 'new-bytes-same-path' }));
});
test('versioned output names are unique and cannot traverse directories', () => {
  assert.notEqual(productionFileName('same-role', 'one'), productionFileName('same-role', 'two'));
  assert.notEqual(productionFileName('same-role', 'one', 'wav'), productionFileName('same-role', 'two', 'wav'));
  assert.equal(productionFileName('../a/b', '../op', '../mp3').includes('/'), false);
});

test('completed wins over uncertain and started regardless of status-file order', () => {
  const audio = { characterId: 'a', characterName: 'a', path: '/fake/a.mp3', duration: 2 };
  const states: ProductionReceipt[] = ['started', 'uncertain', 'completed'].map((status) => ({
    ...receipt(jobs[0], status as ProductionReceipt['status']), id: 'one-attempt', ...(status === 'completed' ? { audio } : {}),
  }));
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const merged = order.reduce<ProductionReceipt[]>((items, index) => mergeProductionReceipt(items, states[index]), []);
    assert.equal(merged.length, 1); assert.equal(merged[0].status, 'completed'); assert.equal(merged[0].audio?.path, audio.path);
    const parsed = parseProductionReceipts(order.map((index) => JSON.stringify(states[index])), 'a', 'shot:1');
    assert.equal(parsed.invalidCount, 0); assert.equal(parsed.receipts[0].status, 'completed');
  }
});
test('a later uncertain attempt still prevents repeat despite an earlier completed attempt', () => {
  const completed = receipt(jobs[0], 'completed');
  const newer = { ...receipt(jobs[0], 'uncertain'), id: 'new-attempt' };
  const merged = mergeProductionReceipt([completed], newer);
  assert.deepEqual(pendingProductionJobs(jobs, merged, 'a', 'shot:1', 'a'), []);
});
test('bad JSON is isolated per row; valid artifacts remain recoverable, malformed receipts fail closed', () => {
  const completed = { ...receipt(jobs[0], 'completed'), audio: { characterId: 'a', characterName: 'a', path: '/fake/a.mp3', duration: 2 } };
  const parsed = parseProductionReceipts(['{broken', JSON.stringify(completed), 'null', JSON.stringify(receipt(jobs[1], 'completed'))], 'a', 'shot:1');
  assert.equal(parsed.invalidCount, 3); assert.equal(parsed.receipts.length, 1);
  assert.equal(parseProductionReceipts([JSON.stringify(completed)], 'a', 'shot:other').invalidCount, 1);
});

for (const executionPreference of [undefined, 'paid-only-confirm', 'always-confirm', 'direct-execute'] as const) {
  for (const risk of [undefined, 'ask', 'safe'] as const) {
    test(`speech execution preference ${executionPreference ?? 'default'} with ${risk ?? 'unknown'} risk`, async () => {
      const f = fixture(); let confirmations = 0;
      const result = await runConfirmedProduction({ ...f.ports, executionPreference, risk,
        confirm: async () => { confirmations++; return true; } });
      const mustConfirm = executionPreference === 'always-confirm'
        || (executionPreference !== 'direct-execute' && risk !== 'safe');
      assert.equal(confirmations, mustConfirm ? 1 : 0);
      assert.equal(f.submitted.length, jobs.length); assert.equal(f.retained.length, jobs.length);
      assert.equal(result.audios.length, jobs.length); assert.equal(f.applied.length, 0); f.lease.close();
    });
  }
}
test('deny risk cannot be bypassed even by direct execution preference', async () => {
  const f = fixture(); let confirmations = 0;
  await assert.rejects(runConfirmedProduction({ ...f.ports, executionPreference: 'direct-execute', risk: 'deny',
    confirm: async () => { confirmations++; return true; } }), /禁止执行/);
  assert.equal(confirmations + f.submitted.length + f.retained.length + f.applied.length, 0); f.lease.close();
});
test('direct mode still rejects an already cancelled lease before submit', async () => {
  const f = fixture(); f.lease.close();
  await assert.rejects(runConfirmedProduction({ ...f.ports, executionPreference: 'direct-execute', risk: 'ask' }), /变化/);
  assert.equal(f.submitted.length, 0);
});
test('direct mode retains a late artifact without adopting or submitting the next role', async () => {
  const f = fixture();
  const result = await runConfirmedProduction({ ...f.ports, executionPreference: 'direct-execute', risk: 'ask',
    confirm: async () => { assert.fail('direct mode must not open confirmation'); },
    submit: async (job, index) => { const audio = await f.ports.submit(job, index); f.update('other-project'); return audio; },
  });
  assert.equal(f.submitted.length, 1); assert.equal(f.retained.length, 1); assert.equal(f.applied.length, 0);
  assert.equal(result.audios.length, 1); f.lease.close();
});

test('generation has no adoption path even if a legacy caller supplies an apply callback', async () => {
  const f = fixture();
  await runConfirmedProduction(f.ports);
  assert.equal(f.retained.length, jobs.length); assert.equal(f.applied.length, 0); f.lease.close();
});
test('receipt persistence failure is not reported as a retained candidate and never writes a target', async () => {
  const f = fixture();
  const result = await runConfirmedProduction({ ...f.ports, retain: async () => { throw new Error('fake journal failure'); } });
  assert.equal(result.audios.length, 0); assert.equal(result.failedIndex, 0);
  assert.equal(f.submitted.length, 1); assert.equal(f.applied.length, 0); f.lease.close();
});
