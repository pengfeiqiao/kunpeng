import type { ShotNarrativeFunction, WorkshopStoryFact, WsCharacter, WsShot } from './types.ts';
import { auditDirectorDecisionSequence } from './directorReasoning.ts';

const WIDE_SCALE_RE = /(?:大远景|大全景|远景|全景)/u;
const EXTREME_CLOSE_SCALE_RE = /(?:大特写|微距)/u;
const EMPTY_SHOT_REASON_RE = /(?:空镜|无人|无人物|空无一人|环境建立|空间建立|地理交代|时间过渡|地点转换|转场|余波|事后|结果状态|静物细节|线索特写)/u;
const VISIBLE_ACTION_RE = /(?:驾驶|开车|行驶|驶入|驶出|刹车|转向|撞|追|跑|走|进入|离开|上车|下车|说|喊|看|望|盯|凝视|注视|听|回头|抬头|拿|递|推|拉|打|抓|躲|倒下|停下|启动|发现|反应|坐|站|跪|蹲|卧|躺|醒|睡|等待|沉默|呼吸|颤抖|操作|握|抬|放|转身|靠近|后退|挣扎|哭|笑)/u;
const FUNCTIONAL_ROLE_RE = /(?:司机|乘客|店员|保安|警察|医生|护士|老师|学生|服务员|快递员|工人|路人|群众|主持人|记者|摄影师|售票员|列车员|船员|机长|空乘|老板|顾客)/gu;
const RELATION_COVERAGE_RE = /(?:双人同框|两人同框|多人同框|关系镜头|过肩|正反打|视线匹配|轴线|相对位置|前后关系|左右关系|全貌|空间关系)/u;
const CLOSEUP_EXCEPTION_RE = /(?:蒙太奇|匹配剪辑|动作连接|视觉对照|线索递进|插入镜头|细节组接|主观碎片|记忆碎片|先细节后揭示|悬念揭示|拉远揭示|显露全貌)/u;

type ScaleFamily = 'wide' | 'medium' | 'close' | 'extreme-close' | 'unknown';

export interface NarrativeAuditResult {
  errors: string[];
  warnings: string[];
}

function emptyResult(): NarrativeAuditResult {
  return { errors: [], warnings: [] };
}

function mergeResult(target: NarrativeAuditResult, source: NarrativeAuditResult): void {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
}

function shotFacts(shot: Partial<WsShot>): string {
  return [shot.sourceExcerpt, shot.description, shot.dialogue, shot.emptyShotPurpose]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .join('\n');
}

function normalizeScale(value?: string): string {
  const text = value?.trim() ?? '';
  if (/大远景/u.test(text)) return '大远景';
  if (/大全景/u.test(text)) return '大全景';
  if (/远景/u.test(text)) return '远景';
  if (/全景/u.test(text)) return '全景';
  if (/中景/u.test(text)) return '中景';
  if (/(?:大特写|微距)/u.test(text)) return '大特写';
  if (/特写/u.test(text)) return '特写';
  if (/(?:中近景|近景)/u.test(text)) return '近景';
  return text;
}

function scaleFamily(value?: string): ScaleFamily {
  const scale = normalizeScale(value);
  if (WIDE_SCALE_RE.test(scale)) return 'wide';
  if (scale === '中景') return 'medium';
  if (scale === '近景' || scale === '特写') return 'close';
  if (scale === '大特写') return 'extreme-close';
  return 'unknown';
}

function sameScene(shots: Array<Partial<WsShot>>): boolean {
  return Boolean(shots[0]?.sceneId && shots.every((shot) => shot.sceneId === shots[0].sceneId));
}

function hasCloseupException(shots: Array<Partial<WsShot>>): boolean {
  return CLOSEUP_EXCEPTION_RE.test(shots.map((shot) => [shot.description, shot.camera, shot.emptyShotPurpose].filter(Boolean).join(' ')).join('\n'));
}

function mentionedCharacters(text: string, characters: WsCharacter[]): WsCharacter[] {
  return characters.filter((character) => {
    const name = character.name.trim();
    return name.length >= 2 && text.includes(name);
  });
}

export function findFunctionalRoles(text: string): string[] {
  return [...new Set(text.match(FUNCTIONAL_ROLE_RE) ?? [])];
}

export function auditShotNarrative(
  shot: Partial<WsShot>,
  characters: WsCharacter[],
): NarrativeAuditResult {
  const result = emptyResult();
  const label = shot.shotNo || '未知镜号';
  const facts = shotFacts(shot);
  const characterIds = shot.characterIds ?? [];

  if (!shot.narrativeFunction) {
    result.errors.push(`${label}: 缺少 narrativeFunction。请明确本镜是建立空间、推进事件、人物反应、关键细节、事件结果或必要转场。`);
  }

  for (const character of mentionedCharacters(facts, characters)) {
    if (!characterIds.includes(character.id)) {
      result.errors.push(`${label}: 原文/画面描述出现“${character.name}”，但 characterIds 未关联 ${character.id}。功能角色（如司机、乘客、店员、保安）也必须作为人物保留，不能被改成空镜。`);
    }
  }

  if (characterIds.length === 0) {
    const reason = shot.emptyShotPurpose?.trim() ?? '';
    if (!reason || !EMPTY_SHOT_REASON_RE.test(reason)) {
      result.errors.push(`${label}: 无人物镜头必须填写 emptyShotPurpose，并说明它承担空间建立、转场、线索、余波或结果状态中的哪一种不可替代用途。不能用“氛围空镜”代替剧本事件。`);
    }
    if (shot.narrativeFunction === 'event' || shot.narrativeFunction === 'reaction') {
      result.errors.push(`${label}: narrativeFunction=${shot.narrativeFunction} 却没有关联人物。事件/反应镜头必须保留事件承担者。`);
    }
  } else if (!VISIBLE_ACTION_RE.test(facts)) {
    result.errors.push(`${label}: 已关联人物但 description/sourceExcerpt 没有可见动作或反应。请写清“谁做什么、触发什么、结果是什么”，不要只写环境和氛围。`);
  }

  const family = scaleFamily(shot.shotType);
  if (
    shot.narrativeFunction === 'establish'
    && (family === 'close' || family === 'extreme-close')
    && !CLOSEUP_EXCEPTION_RE.test([shot.description, shot.camera, shot.emptyShotPurpose].filter(Boolean).join(' '))
  ) {
    result.errors.push(`${label}: 建立镜头使用“${normalizeScale(shot.shotType)}”，却没有写明先细节后揭示、悬念揭示或拉远显露空间。建立镜头必须让观众看清必要的空间/人物关系，不能只给局部。`);
  }

  if (
    shot.narrativeFunction === 'event'
    && characterIds.length >= 2
    && family === 'extreme-close'
    && !RELATION_COVERAGE_RE.test([shot.description, shot.camera].filter(Boolean).join(' '))
  ) {
    result.errors.push(`${label}: 多人物事件的主景别是大特写，但没有关系镜头、过肩、正反打或视线匹配说明。局部细节不能替代“谁对谁做了什么”的人物关系。`);
  }

  return result;
}

export function auditShotSequence(
  shots: Array<Partial<WsShot>>,
  characters: WsCharacter[],
  options: { validateShots?: boolean } = {},
): NarrativeAuditResult {
  const result = emptyResult();
  if (options.validateShots !== false) {
    shots.forEach((shot) => mergeResult(result, auditShotNarrative(shot, characters)));
  }
  const directorAudit = auditDirectorDecisionSequence(shots);
  // Missing decisions and repeated information are deterministic failures.
  // Continuity wording is intentionally advisory: two equivalent states may
  // be phrased very differently, so it must not block a valid save.
  result.errors.push(...directorAudit.errors);

  for (let i = 1; i < shots.length; i += 1) {
    const previous = shots[i - 1];
    const current = shots[i];
    const sameScene = Boolean(previous.sceneId && previous.sceneId === current.sceneId);
    if (!sameScene) continue;

    const previousEmpty = (previous.characterIds?.length ?? 0) === 0;
    const currentEmpty = (current.characterIds?.length ?? 0) === 0;
    if (previousEmpty && currentEmpty) {
      result.errors.push(`${previous.shotNo} → ${current.shotNo}: 同一场景连续两条空镜会吞掉剧情。请保留事件人物，或合并为空镜过渡后立即回到人物/事件。`);
    }

  }

  for (let i = 2; i < shots.length; i += 1) {
    const trio = shots.slice(i - 2, i + 1);
    if (
      sameScene(trio)
      && trio.every((shot) => WIDE_SCALE_RE.test(shot.shotType ?? ''))
    ) {
      result.errors.push(`${trio.map((shot) => shot.shotNo).join(' → ')}: 同一场景连续三条远景/全景。请从空间关系进入事件主体、反应或关键细节，建立镜头不能反复建立。`);
    }

    const families = trio.map((shot) => scaleFamily(shot.shotType));
    if (
      sameScene(trio)
      && families.every((family) => family === 'close' || family === 'extreme-close')
      && !hasCloseupException(trio)
    ) {
      result.errors.push(`${trio.map((shot) => shot.shotNo).join(' → ')}: 同一场景连续三条近景/特写，观众会失去人物关系、动作全貌和空间方位。请补中景/关系镜头，或明确这是蒙太奇、匹配剪辑或先细节后揭示。`);
    }
  }


  for (let i = 1; i < shots.length; i += 1) {
    const pair = shots.slice(i - 1, i + 1);
    if (
      sameScene(pair)
      && pair.every((shot) => EXTREME_CLOSE_SCALE_RE.test(shot.shotType ?? ''))
      && !hasCloseupException(pair)
    ) {
      result.errors.push(`${pair.map((shot) => shot.shotNo).join(' → ')}: 连续两条大特写没有说明细节递进或剪辑关系。大特写应承担关键线索、动作触点或情绪峰值，不能作为通用景别反复使用。`);
    }
  }

  return result;
}

export function auditStoryFactCoverage(
  shots: Array<Partial<WsShot>>,
  storyFacts: WorkshopStoryFact[],
): NarrativeAuditResult {
  const result = emptyResult();
  for (const fact of storyFacts) {
    const linkedShots = shots.filter((shot) => shot.sourceFactIds?.includes(fact.id));
    if (linkedShots.length === 0) {
      result.errors.push(`剧情事实 ${fact.id} 尚未被任何分镜覆盖：${fact.event}`);
      continue;
    }

    const coveredParticipants = new Set(linkedShots.flatMap((shot) => shot.characterIds ?? []));
    const missingParticipants = fact.participantIds.filter((id) => !coveredParticipants.has(id));
    if (missingParticipants.length > 0) {
      result.errors.push(`剧情事实 ${fact.id} 的参与者未进入关联分镜：${missingParticipants.join('、')}。不能只引用事实 ID，却把司机、乘客等事件承担者画面外删除。`);
    }

    if (fact.event.trim() && !linkedShots.some((shot) => shot.narrativeFunction === 'event')) {
      result.errors.push(`剧情事实 ${fact.id} 没有 event 镜头承担事件“${fact.event}”。建立、细节或转场镜头不能代替事件发生本身。`);
    }
  }
  return result;
}

function extractPromptScales(prompt: string): string[] {
  const scales: string[] = [];
  for (const match of prompt.matchAll(/[\[【]([^\]】/／]{1,12})[\/／][^\]】]+[\]】]/gu)) {
    const scale = normalizeScale(match[1]);
    if (scale) scales.push(scale);
  }
  return scales;
}

export function auditVideoPromptNarrative(
  shot: WsShot,
  videoPrompt: string,
  characters: WsCharacter[],
): NarrativeAuditResult {
  const result = emptyResult();
  const linked = characters.filter((character) => shot.characterIds.includes(character.id));
  for (const character of linked) {
    if (!videoPrompt.includes(character.name)) {
      result.errors.push(`${shot.shotNo}: videoPrompt 遗漏已关联角色“${character.name}”。每个剧情参与者都必须在对应动作、反应或结果镜头中出现。`);
    }
  }

  if (linked.length > 0 && !VISIBLE_ACTION_RE.test(videoPrompt)) {
    result.errors.push(`${shot.shotNo}: videoPrompt 没有可见动作/反应，只剩环境描述。请落实本镜的事件主体、触发动作和结果。`);
  }

  const scales = extractPromptScales(videoPrompt);
  const families = scales.map(scaleFamily);
  if (scales.length >= 2 && families.every((family) => family === 'wide')) {
    result.errors.push(`${shot.shotNo}: ${scales.length} 个子镜头全部是远景/全景。建立空间后必须进入人物动作、反应或关键细节，不能用连续大全景完成剧情。`);
  } else if (
    scales.length >= 2
    && families.every((family) => family === 'close' || family === 'extreme-close')
    && !RELATION_COVERAGE_RE.test(videoPrompt)
    && !CLOSEUP_EXCEPTION_RE.test(videoPrompt)
  ) {
    result.errors.push(`${shot.shotNo}: ${scales.length} 个子镜头全部是近景/特写，缺少人物关系和动作全貌。请加入中景、过肩、双人同框或明确的揭示镜头；不能靠连续大特写完成整段事件。`);
  } else if (
    scales.length >= 3
    && new Set(families).size === 1
    && !/(?:正反打|过肩反打|对话|视线匹配)/u.test(videoPrompt)
  ) {
    result.warnings.push(`${shot.shotNo}: ${scales.length} 个子镜头都停留在“${families[0]}”信息距离。除非是明确的正反打、动作连续或蒙太奇，否则应让空间关系、事件动作、人物反应和关键细节分别得到合适的观察距离。`);
  }

  for (let i = 1; i < scales.length; i += 1) {
    if (
      families[i - 1] === 'extreme-close'
      && families[i] === 'extreme-close'
      && !CLOSEUP_EXCEPTION_RE.test(videoPrompt)
    ) {
      result.errors.push(`${shot.shotNo}: 子镜头 ${i} 与 ${i + 1} 连续使用大特写，却没有线索递进、匹配剪辑或先细节后揭示。请保留大特写作为真正的信息峰值。`);
      break;
    }
  }

  return result;
}

export const SHOT_NARRATIVE_FUNCTIONS: ShotNarrativeFunction[] = [
  'establish',
  'event',
  'reaction',
  'detail',
  'consequence',
  'transition',
];
