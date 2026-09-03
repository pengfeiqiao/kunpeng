import test from 'node:test';
import assert from 'node:assert/strict';
import { auditShotSequence, auditStoryFactCoverage, auditVideoPromptNarrative } from './shotNarrativeAudit.ts';
import { auditDirectorDecisionSequence } from './directorReasoning.ts';
import type { WsCharacter, WsShot } from './types.ts';

const characters: WsCharacter[] = [
  { id: 'driver', name: '司机', personality: '', appearance: '' },
  { id: 'passenger', name: '乘客', personality: '', appearance: '' },
];

function shot(patch: Partial<WsShot>): WsShot {
  return {
    shotNo: '01-01',
    sceneId: 'road',
    description: '司机坐在驾驶位，双手握住方向盘向前行驶。',
    sourceExcerpt: '司机突然踩下刹车。',
    shotType: '中景',
    camera: '固定',
    mood: '紧张',
    durationSec: 10,
    narrativeFunction: 'event',
    characterIds: ['driver'],
    ...patch,
  };
}

test('functional roles mentioned by the script cannot disappear into an empty road shot', () => {
  const result = auditShotSequence([
    shot({
      description: '公路延伸到远方，车辆驶过扬起灰尘。',
      sourceExcerpt: '司机突然踩下刹车。',
      narrativeFunction: 'establish',
      characterIds: [],
      emptyShotPurpose: '环境建立',
    }),
  ], characters);
  assert.match(result.errors.join('\n'), /司机.*characterIds/u);
});

test('an intentional empty transition is allowed when its purpose is explicit', () => {
  const result = auditShotSequence([
    shot({
      description: '事故后的公路上只剩停止转动的车轮和散落碎片。',
      sourceExcerpt: '公路恢复寂静。',
      narrativeFunction: 'consequence',
      characterIds: [],
      emptyShotPurpose: '事故后的结果状态与余波',
    }),
  ], characters);
  assert.deepEqual(result.errors, []);
});

test('consecutive empty shots and repeated wide coverage are rejected', () => {
  const result = auditShotSequence([
    shot({ shotNo: '01-01', shotType: '大全景', narrativeFunction: 'establish', characterIds: [], emptyShotPurpose: '空间建立', description: '无人公路用于空间建立。', sourceExcerpt: '公路。' }),
    shot({ shotNo: '01-02', shotType: '全景', narrativeFunction: 'transition', characterIds: [], emptyShotPurpose: '地点转换转场', description: '无人路口作为地点转换转场。', sourceExcerpt: '路口。' }),
    shot({ shotNo: '01-03', shotType: '远景', narrativeFunction: 'event' }),
  ], characters);
  assert.match(result.errors.join('\n'), /连续两条空镜/u);
  assert.match(result.errors.join('\n'), /连续三条远景\/全景/u);
});

test('repeated close coverage and consecutive extreme closeups are rejected', () => {
  const result = auditShotSequence([
    shot({ shotNo: '01-01', shotType: '近景', narrativeFunction: 'event' }),
    shot({ shotNo: '01-02', shotType: '大特写', narrativeFunction: 'detail', description: '司机手指握紧方向盘。' }),
    shot({ shotNo: '01-03', shotType: '大特写', narrativeFunction: 'reaction', description: '司机盯住前方，眼睑颤抖。' }),
  ], characters);
  assert.match(result.errors.join('\n'), /连续三条近景\/特写/u);
  assert.match(result.errors.join('\n'), /连续两条大特写/u);
});

test('a closeup cannot establish a scene unless it promises a spatial reveal', () => {
  const rejected = auditShotSequence([
    shot({ shotType: '大特写', narrativeFunction: 'establish', description: '司机眼睛凝视前方。' }),
  ], characters);
  assert.match(rejected.errors.join('\n'), /建立镜头使用“大特写”/u);

  const accepted = auditShotSequence([
    shot({ shotType: '大特写', narrativeFunction: 'establish', description: '先细节后揭示，镜头从司机眼睛拉远显露驾驶舱和副驾驶位置。' }),
  ], characters);
  assert.deepEqual(accepted.errors, []);
});

test('video prompt must show linked people and cannot use only wide subshots', () => {
  const result = auditVideoPromptNarrative(
    shot({ characterIds: ['driver', 'passenger'] }),
    '镜头01-1 3s [大全景/固定] 公路延伸。镜头01-2 3s [全景/推] 汽车驶来。镜头01-3 4s [远景/固定] 尘土散开。',
    characters,
  );
  assert.match(result.errors.join('\n'), /司机/u);
  assert.match(result.errors.join('\n'), /乘客/u);
  assert.match(result.errors.join('\n'), /全部是远景\/全景/u);
});

test('video prompt cannot replace a whole event with closeups', () => {
  const result = auditVideoPromptNarrative(
    shot({ characterIds: ['driver', 'passenger'] }),
    '镜头01-1 3s [大特写/固定] 司机眼睛盯住前方。镜头01-2 3s [大特写/固定] 司机手指握紧方向盘。镜头01-3 4s [近景/固定] 乘客回头看向司机。',
    characters,
  );
  assert.match(result.errors.join('\n'), /全部是近景\/特写/u);
  assert.match(result.errors.join('\n'), /连续使用大特写/u);
});

test('a character-led event sequence with varied information distance passes', () => {
  const result = auditVideoPromptNarrative(
    shot({ characterIds: ['driver', 'passenger'] }),
    '镜头01-1 3s [全景/跟] 司机驾驶汽车驶入弯道，乘客坐在副驾驶望向前方。镜头01-2 3s [近景/固定] 司机发现障碍并踩下刹车。镜头01-3 4s [特写/固定] 乘客被惯性带向前方后抬头看向司机。',
    characters,
  );
  assert.deepEqual(result.errors, []);
});

test('same-scale reaction shots remain valid for shot reverse shot', () => {
  const result = auditShotSequence([
    shot({ shotNo: '01-01', shotType: '近景', narrativeFunction: 'reaction', description: '司机坐在驾驶位凝视前方。' }),
    shot({ shotNo: '01-02', shotType: '近景', narrativeFunction: 'reaction', characterIds: ['passenger'], sourceExcerpt: '乘客回头。', description: '乘客坐在副驾驶回头注视画外左侧。' }),
  ], characters);

  assert.deepEqual(result.errors, []);
});

test('referencing a fact id cannot hide its functional-role participant', () => {
  const result = auditStoryFactCoverage([
    shot({ sourceFactIds: ['road-event'], characterIds: [], narrativeFunction: 'establish', emptyShotPurpose: '空间建立' }),
  ], [{
    id: 'road-event',
    sceneId: 'road',
    sourceExcerpt: '司机突然踩下刹车。',
    participantIds: ['driver'],
    event: '司机发现障碍并紧急刹车',
    result: '汽车停在障碍前',
  }]);

  assert.match(result.errors.join('\n'), /driver/u);
  assert.match(result.errors.join('\n'), /没有 event 镜头/u);
});

test('internal director decisions reject repeated information and warn about broken continuity', () => {
  const decisions = [
    shot({
      shotNo: '01-01',
      directorDecision: {
        entryState: '司机坐在驾驶位，汽车正在行驶',
        newInformation: '司机发现前方障碍',
        shotScaleReason: '中景同时看清驾驶动作和前方视线',
        cutTrigger: '司机视线突然定住',
        exitState: '司机仍在驾驶位，右脚开始移向刹车',
      },
    }),
    shot({
      shotNo: '01-02',
      directorDecision: {
        entryState: '司机已经站在车外，手中拿着手机',
        newInformation: '司机发现前方障碍',
        shotScaleReason: '特写看清眼神',
        cutTrigger: '司机眨眼',
        exitState: '司机站在车外',
      },
    }),
  ];
  const result = auditShotSequence(decisions, characters, { validateShots: false });
  const advisory = auditDirectorDecisionSequence(decisions);

  assert.match(result.errors.join('\n'), /主要新增信息高度重复/u);
  assert.match(advisory.warnings.join('\n'), /缺少明显承接/u);
});

test('old shots without internal director decisions remain compatible', () => {
  const result = auditShotSequence([
    shot({ shotNo: '01-01' }),
    shot({ shotNo: '01-02', description: '司机坐在驾驶位踩下刹车。' }),
  ], characters, { validateShots: false });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('continuity phrasing differences stay advisory and never block a save', () => {
  const result = auditShotSequence([
    shot({
      shotNo: '01-01',
      directorDecision: {
        entryState: '司机坐在驾驶位，双手扶方向盘',
        newInformation: '汽车接近路口',
        shotScaleReason: '中景看清驾驶状态',
        cutTrigger: '车辆驶入路口',
        exitState: '司机仍坐在车内，右手握方向盘，视线看向前方',
      },
    }),
    shot({
      shotNo: '01-02',
      directorDecision: {
        entryState: '驾驶员保持坐姿，面朝道路，手掌压在方向盘上',
        newInformation: '司机看见障碍物',
        shotScaleReason: '近景看清察觉反应',
        cutTrigger: '司机瞳孔收紧',
        exitState: '司机开始踩刹车',
      },
    }),
  ], characters, { validateShots: false });

  assert.deepEqual(result.errors, []);
});
