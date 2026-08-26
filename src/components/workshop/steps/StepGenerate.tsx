/**
 * StepGenerate — ⑤生成：分镜网格，单镜图/视频生成、重生成、取消，
 * 批量补缺失项。并发由 canvasGen MAX 3 槽位队列控制（与画布共享）。
 */
import { useState, useMemo, useRef, useEffect } from 'react';
import { AlertTriangle, Check, Clapperboard, ChevronDown, ImageIcon, Loader2, MonitorPlay, MoreHorizontal, Pause, Play, Plus, RefreshCw, SlidersHorizontal, Sparkles, Upload, XCircle, X, FolderOutput } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { invoke } from '@tauri-apps/api/tauri';
import { copyFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { confirm as tauriConfirm, message as tauriMessage, open as openDialog } from '@tauri-apps/api/dialog';
import { useShallow } from 'zustand/react/shallow';
import { getSceneReferencePaths, useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { nanoid } from 'nanoid';
import { ensureVideoThumb, useVideoThumb } from '@/lib/canvas/videoThumbs';
import { MAX_CONCURRENT_CANVAS_TASKS, useCanvasTaskStore } from '@/stores/canvasTaskStore';
import SmartTextarea from '../SmartTextarea';
import ArtifactPickerPanel from '../../canvas/ArtifactPickerPanel';
import type { WorkshopData, WsShot } from '@/lib/workshop/types';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { Z, useEscapeClose } from '@/lib/ui/layers';
import VideoPromptVersionSwitch from '../VideoPromptVersionSwitch';
import { formatSeedanceValidation, validateSeedancePrompt } from '@/lib/seedance/validation';
import {
  applyVideoPlanningReferencePrefixes,
  buildRefAwarePatch,
  buildVideoRefBindings,
  videoPromptForShot,
} from '@/lib/workshop/shotRefs';
import { auditUniversalVideoPrompt, rewriteUniversalVideoPrompt, type VideoPromptTemplate } from '@/lib/videoPrompt/prompt';

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

const VIDEO_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'];

type ShotAssetRef = {
  label: string;
  url: string;
  path: string;
  type?: 'audio' | 'video';
  removable?: boolean;
  removeKind?: 'scene' | 'character' | 'prop' | 'palette' | 'extra' | 'storyboardBoard' | 'directorConstraintCard' | 'voice' | 'generatedAudio';
  id?: string;
};

/** ShotCard 渲染实际用到的 data 子集；helper 据此收窄，避免整订 data 导致的放大重渲染 */
type ShotVideoContext = Pick<
  WorkshopData,
  'scenes' | 'characters' | 'props' | 'colorPalettes' | 'globalColorPaletteId' | 'videoModel' | 'videoRatio' | 'videoPromptTemplate'
>;

function effectiveVideoModel(shot: WsShot, data: ShotVideoContext): string {
  return shot.videoModel || data.videoModel || 'seedance-2.0';
}

/** 自定义视频插件选项（issue #7）：启用的视频插件追加到模型下拉尾部 */
function useCustomVideoModelOptions(): { value: string; label: string }[] {
  const customMediaApis = useSettingsStore((s) => s.customMediaApis);
  return useMemo(
    () => (customMediaApis ?? [])
      .filter((api) => api.kind === 'video' && api.enabled)
      .map((api) => ({ value: `custom-media:${api.id}`, label: api.label })),
    [customMediaApis],
  );
}

/** 自定义图片插件选项：启用的图片插件追加到生图模型下拉尾部 */
function useCustomImageModelOptions(): { value: string; label: string }[] {
  const customMediaApis = useSettingsStore((s) => s.customMediaApis);
  return useMemo(
    () => (customMediaApis ?? [])
      .filter((api) => api.kind === 'image' && api.enabled)
      .map((api) => ({ value: `custom-media:${api.id}`, label: api.label })),
    [customMediaApis],
  );
}

function effectiveVideoPromptTemplate(
  shot: WsShot,
  data: ShotVideoContext,
): VideoPromptTemplate {
  return shot.videoPromptTemplate || data.videoPromptTemplate || 'legacy';
}

function buildShotVideoRefs(
  shot: WsShot,
  data: ShotVideoContext,
  model = effectiveVideoModel(shot, data),
): ShotAssetRef[] {
  const refContext = {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
  const refs: ShotAssetRef[] = buildVideoRefBindings(shot, refContext, {
    includeStoryboardBoards: model !== 'seedance-2.5',
  }).map((binding) => ({
    label: `@图片${numToCn(binding.index)} ${binding.label}`,
    url: convertFileSrc(binding.path),
    path: binding.path,
    removable: true,
    removeKind: binding.kind,
    id: binding.id,
  }));
  for (const [index, path] of (shot.directorPrevisVideoPaths ?? []).entries()) {
    refs.push({
      label: `@视频${numToCn(index + 1)} 导演预演`,
      url: convertFileSrc(path),
      path,
      type: 'video',
    });
  }
  let audioIdx = 1;
  if (shot.audioInjected && shot.generatedAudios?.length) {
    for (const audio of shot.generatedAudios) {
      const path = audio.trimmedPath || audio.path;
      refs.push({ label: `@配音${numToCn(audioIdx)} ${audio.characterName}`, url: convertFileSrc(path), path, type: 'audio', removable: true, removeKind: 'generatedAudio', id: audio.characterId });
      audioIdx++;
    }
  } else {
    for (const cid of (shot.voiceCharacterIds ?? [])) {
      const ch = data.characters.find((c) => c.id === cid);
      if (ch?.voicePath) {
        refs.push({ label: `@音频${numToCn(audioIdx)} ${ch.name}`, url: convertFileSrc(ch.voicePath), path: ch.voicePath, type: 'audio', removable: true, removeKind: 'voice', id: cid });
        audioIdx++;
      }
    }
  }
  return refs;
}

function removeShotRef(ref: ShotAssetRef, shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>): Partial<WsShot> | null {
  if (ref.removeKind === 'scene') {
    const active = getSceneReferencePaths(shot, data.scenes);
    return { sceneImagePaths: active.filter((p) => p !== ref.path), promptNeedsRefresh: true };
  }
  if (ref.removeKind === 'character' && ref.id) {
    return {
      characterIds: (shot.characterIds ?? []).filter((id) => id !== ref.id),
      voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id),
      audioPrompts: (shot.audioPrompts ?? []).filter((p) => p.characterId !== ref.id),
      generatedAudios: (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id),
    };
  }
  if (ref.removeKind === 'prop' && ref.id) return { propIds: (shot.propIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'palette') return { colorPaletteId: '__none__', promptNeedsRefresh: true };
  if (ref.removeKind === 'extra') return { extraRefImages: (shot.extraRefImages ?? []).filter((p) => p !== ref.path) };
  if (ref.removeKind === 'storyboardBoard' && ref.id) return { storyboardBoards: (shot.storyboardBoards ?? []).map((b) => b.id === ref.id ? { ...b, useInVideo: false } : b) };
  if (ref.removeKind === 'directorConstraintCard' && shot.directorConstraintCard) {
    return { directorConstraintCard: { ...shot.directorConstraintCard, useInVideo: false } };
  }
  if (ref.removeKind === 'voice' && ref.id) return { voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'generatedAudio' && ref.id) {
    const nextAudios = (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id);
    return { generatedAudios: nextAudios, audioInjected: nextAudios.length > 0 ? shot.audioInjected : false };
  }
  return null;
}

function validateShotPromptForVideo(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>) {
  const model = effectiveVideoModel(shot, data);
  const refs = buildShotVideoRefs(shot, data, model).filter((ref) => ref.label.startsWith('@图片'));
  if (refs.length === 0) return { ok: true, message: '' };
  const requiredRefs = refs.map((ref, i) => ({ index: i + 1, label: ref.label.replace(/^@图片[一二三四五六七八九十\d]*\s*/, '') || `参考图 ${i + 1}` }));
  const sceneRefs = getSceneReferencePaths(shot, data.scenes);
  const ctx = { scenes: data.scenes, characters: data.characters, props: data.props ?? [], colorPalettes: data.colorPalettes ?? [], globalColorPaletteId: data.globalColorPaletteId };
  const prompt = videoPromptForShot(shot, ctx, {
    template: effectiveVideoPromptTemplate(shot, data),
    includeStoryboardBoards: model !== 'seedance-2.5',
  });
  const validation = validateSeedancePrompt(prompt, {
    refCount: refs.length,
    requiredRefs,
    requireSceneRef: sceneRefs.length > 0,
    maxImageRefs: model === 'seedance-2.5' ? 30 : 10,
  });
  return { ok: validation.ok, message: formatSeedanceValidation(validation) };
}

async function organizeVideos(projectId: string, shots: WsShot[], selectedNos: Set<string>) {
  const home = await homeDir();
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const relDir = `.kunpeng/aigc-memory/projects/${projectId}/整理-${stamp}`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
  const absDir = `${home}${relDir}`;
  let copied = 0;
  for (const shot of shots) {
    if (!selectedNos.has(shot.shotNo) || !shot.videoPath) continue;
    const ext = shot.videoPath.includes('.') ? shot.videoPath.slice(shot.videoPath.lastIndexOf('.')) : '.mp4';
    const safeShotNo = shot.shotNo.replace(/[^\w一-龥-]+/g, '_');
    const destRel = `${relDir}/${safeShotNo}-视频${ext}`;
    await copyFile(shot.videoPath, destRel, { dir: BaseDirectory.Home });
    copied++;
  }
  await tauriMessage(`已整理 ${copied} 个视频到：\n${absDir}`, { title: '整理完成' });
  void invoke('open_path', { path: absDir }).catch(() => {});
}

export default function StepGenerate() {
  // 浅比较对象选择器：只订本页用到的字段，无关 data 写入（changelog/其他步骤状态等）不重渲染
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    shots: s.data.shots,
    videoModel: s.data.videoModel,
    imageModel: s.data.imageModel,
    videoRatio: s.data.videoRatio,
    videoPromptTemplate: s.data.videoPromptTemplate,
    generateStatus: s.data.steps.generate.status,
  })));
  const project = useWorkshopStore((s) => s.project);
  const generateAll = useWorkshopStore((s) => s.generateAll);
  const customVideoOptions = useCustomVideoModelOptions();
  const setVideoRatio = useWorkshopStore((s) => s.setVideoRatio);
  const setVideoModel = useWorkshopStore((s) => s.setVideoModel);
  const setImageModel = useWorkshopStore((s) => s.setImageModel);
  const customImageOptions = useCustomImageModelOptions();
  const setVideoPromptTemplate = useWorkshopStore((s) => s.setVideoPromptTemplate);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const setCurrentStep = useWorkshopStore((s) => s.setCurrentStep);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);

  // 全部分镜视频就绪后自动标记完成；条件不再满足时把 done 降回 in-progress（不动 stale 等其他状态）
  const allVideosDone = !!data && data.shots.length > 0 && data.shots.every((s) => !!s.videoPath);
  const generateStatus = data?.generateStatus;
  useEffect(() => {
    if (allVideosDone && generateStatus !== 'done') markStepStatus('generate', 'done');
    else if (!allVideosDone && generateStatus === 'done') markStepStatus('generate', 'in-progress');
  }, [allVideosDone, generateStatus, markStepStatus]);

  if (!data) return null;

  const imgDone = data.shots.filter((s) => s.imagePath).length;
  const vidDone = data.shots.filter((s) => s.videoPath).length;
  const busy = data.shots.some((s) => s.genStatus === 'queued' || s.genStatus === 'generating');

  const missingRatio = data.shots.filter((s) => !s.videoPath && !s.videoRatio && !data.videoRatio).length;

  const toggleSelect = (shotNo: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shotNo)) next.delete(shotNo); else next.add(shotNo);
      return next;
    });
  };

  const handleOrganize = async () => {
    if (!project || selected.size === 0 || organizing) return;
    setOrganizing(true);
    try {
      await organizeVideos(project.id, data.shots, selected);
      setSelected(new Set());
    } catch (err) {
      await tauriMessage(`整理失败：${err}`, { title: '错误' });
    } finally {
      setOrganizing(false);
    }
  };

  const handleGenerateAllVideos = async () => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    if (!latestData || latestData.shots.some((shot) => shot.genStatus === 'queued' || shot.genStatus === 'generating')) return;
    const targets = latestData.shots.filter((shot) => !shot.videoPath);
    if (targets.length === 0) return;
    const invalid = targets
      .map((shot) => ({ shot, check: validateShotPromptForVideo(shot, latestData) }))
      .filter((item) => !item.check.ok);
    const skipPromptValidation = invalid.length > 0
      ? await tauriConfirm(
          `有 ${invalid.length} 个分镜的提示词缺少 @图片 引用或引用顺序不完整。\n\n${invalid.slice(0, 3).map((item) => `${item.shot.shotNo}：${item.check.message}`).join('\n\n')}${invalid.length > 3 ? '\n\n...' : ''}\n\n仍然继续生成吗？`,
          { title: '提示词引用提醒', type: 'warning' },
        ).catch(() => false)
      : false;
    if (invalid.length > 0 && !skipPromptValidation) return;
    await Promise.allSettled(targets.map((shot) => store.generateShot(shot.shotNo, 'video', { skipPromptValidation })));
  };

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">⑤ 生成</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            分镜图 {imgDone}/{data.shots.length} · 视频 {vidDone}/{data.shots.length} · 并发上限 {MAX_CONCURRENT_CANVAS_TASKS}（与画布共享队列）
            {missingRatio > 0 && (
              <span className="text-amber-400 ml-2 inline-flex items-center gap-1" title="这些分镜未设置视频比例，无法生成视频">
                <AlertTriangle size={11} /> {missingRatio} 镜未设置视频比例
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => void handleOrganize()}
              disabled={organizing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
            >
              <FolderOutput size={12} />
              整理 {selected.size} 个视频
            </button>
          )}
          <button
            onClick={() => void generateAll('image', true)}
            disabled={busy || imgDone === data.shots.length}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
          >
            {busy ? (
              <><Loader2 size={12} className="animate-spin" /> 生成中 {imgDone}/{data.shots.length}</>
            ) : (
              <><ImageIcon size={12} /> 补齐分镜图</>
            )}
          </button>
          <button
            onClick={() => void handleGenerateAllVideos()}
            disabled={busy || allVideosDone}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--canvas-accent)' }}
          >
            {busy ? (
              <><Loader2 size={12} className="animate-spin" /> 生成中 {vidDone}/{data.shots.length}</>
            ) : (
              <><Clapperboard size={12} /> 批量生成视频</>
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 rounded-xl border border-[var(--canvas-node-border)] bg-black/15 px-4 py-3">
        <div className="flex min-w-[130px] items-center gap-2 self-center">
          <SlidersHorizontal size={13} className="text-[var(--canvas-text-2)]" />
          <div>
            <div className="text-[11px] font-medium text-[var(--canvas-text-1)]">视频生成设置</div>
            <div className="text-[10px] text-[var(--canvas-text-3)]">应用于未单独设置的分镜</div>
          </div>
        </div>
        <label className="block min-w-[190px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">生图模型</span>
          <select
            value={data.imageModel ?? ''}
            onChange={(e) => setImageModel(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          >
            <option value="">GPT-Image-2 智能通道（默认）</option>
            {customImageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-[190px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">视频模型</span>
          <select
            value={data.videoModel ?? 'seedance-2.0'}
            onChange={(e) => setVideoModel(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          >
            <option value="seedance-2.0">Seedance 2.0</option>
            <option value="seedance-2.5">Seedance 2.5</option>
            <option value="minimax-h3">MiniMax H3</option>
            <option value="seedance-2.0-mini">Seedance 2.0 Mini</option>
            <option value="wan-3.0">万相 3.0</option>
            {customVideoOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-[130px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">全局比例</span>
          <select
            value={data.videoRatio ?? ''}
            onChange={(e) => setVideoRatio(e.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          >
            <option value="">未设置</option>
            {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="block min-w-[250px]">
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">全局提示词版本</span>
          <VideoPromptVersionSwitch value={data.videoPromptTemplate ?? 'legacy'} onChange={setVideoPromptTemplate} />
        </div>
      </div>

      {data.shots.length === 0 ? (
        <div className="mt-5 flex justify-center py-14">
          <div
            className="flex flex-col items-center gap-3 rounded-xl border border-[var(--canvas-node-border)] px-10 py-8 text-center"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            <Clapperboard size={26} className="text-[var(--canvas-text-3)]" />
            <p className="text-[12px] text-[var(--canvas-text-2)]">还没有分镜，先完成第②步拆解、第④步准备提示词</p>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => setCurrentStep('breakdown')}
                className="px-3 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--canvas-accent)' }}
              >
                去第②步拆解
              </button>
              <button
                onClick={() => setCurrentStep('prompts')}
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
              >
                去第④步准备提示词
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-4">
          {data.shots.map((shot) => (
            <ShotCard
              key={shot.shotNo}
              shot={shot}
              checked={selected.has(shot.shotNo)}
              onToggle={() => toggleSelect(shot.shotNo)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShotAudioRow({ audios, limitSec = 15 }: { audios: NonNullable<WsShot['generatedAudios']>; limitSec?: number }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const totalDuration = audios.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0);
  const rounded = Math.round(totalDuration * 10) / 10;

  const play = (id: string, path: string) => {
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    if (playingId === id) { setPlayingId(null); return; }
    const el = new Audio(convertFileSrc(path));
    el.onended = () => setPlayingId(null);
    el.play();
    audioElRef.current = el;
    setPlayingId(id);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--canvas-text-3)]">
      <span>已生成配音：</span>
      {audios.map((a) => (
        <button
          key={a.characterId}
          onClick={() => play(a.characterId, a.trimmedPath || a.path)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] hover:text-[var(--canvas-text-1)] transition-colors"
          title={playingId === a.characterId ? '暂停' : '播放'}
        >
          {playingId === a.characterId ? <Pause size={12} /> : <Play size={12} />} {a.characterName} {(a.trimmedDuration ?? a.duration).toFixed(1)}s
        </button>
      ))}
      <span
        className={`inline-flex items-center gap-1 ${rounded > limitSec ? 'text-red-400' : ''}`}
        title={rounded <= limitSec ? `配音总时长未超 ${limitSec}s 限制` : `配音总时长超过 ${limitSec}s，超出视频时长`}
      >
        总计 {rounded}s/{limitSec}s {rounded <= limitSec ? <Check size={12} /> : <AlertTriangle size={12} />}
      </span>
    </div>
  );
}

function ShotCard({ shot, checked, onToggle }: { shot: WsShot; checked: boolean; onToggle: () => void }) {
  const customVideoOptions = useCustomVideoModelOptions();
  // 只订视频生成上下文子集（ShotVideoContext）：分镜文本等无关写入不会让全部卡片重渲染
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    videoModel: s.data.videoModel,
    videoRatio: s.data.videoRatio,
    videoPromptTemplate: s.data.videoPromptTemplate,
    scenes: s.data.scenes,
    characters: s.data.characters,
    props: s.data.props,
    colorPalettes: s.data.colorPalettes,
    globalColorPaletteId: s.data.globalColorPaletteId,
  })));
  const generateShot = useWorkshopStore((s) => s.generateShot);
  const cancelShot = useWorkshopStore((s) => s.cancelShot);
  const updateShot = useWorkshopStore((s) => s.updateShot);
  const videoThumb = useVideoThumb(shot.videoPath);
  const [expanded, setExpanded] = useState(false);
  const [playingVideo, setPlayingVideo] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [universalRewriting, setUniversalRewriting] = useState(false);
  // 素材选择器接入 Esc 全局栈：打开时 Esc 只关选择器
  useEscapeClose(pickerOpen, () => setPickerOpen(false));
  const taskProgress = useCanvasTaskStore((s) => {
    if (!shot.genTaskId) return undefined;
    return s.tasks.find((t) => t.id === shot.genTaskId)?.progress;
  });

  const model = data ? effectiveVideoModel(shot, data) : 'seedance-2.0';
  const isSeedance25 = model === 'seedance-2.5';
  const promptTemplate = data ? effectiveVideoPromptTemplate(shot, data) : 'legacy';
  const refContext = data ? { scenes: data.scenes, characters: data.characters, props: data.props ?? [], colorPalettes: data.colorPalettes ?? [], globalColorPaletteId: data.globalColorPaletteId } : null;
  const displayedVideoPrompt = refContext
    ? videoPromptForShot(shot, refContext, {
        template: promptTemplate,
        includeStoryboardBoards: !isSeedance25,
      })
    : promptTemplate === 'universal'
      ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || shot.videoPrompt || ''
      : shot.videoPrompt || '';
  const hiddenStoryboardCount = isSeedance25
    ? (shot.storyboardBoards ?? []).filter((board) => board.imagePath && board.useInVideo !== false).length
    : 0;

  const refImages = useMemo(() => {
    if (!expanded || !data) return [];
    return buildShotVideoRefs(shot, data, model);
  }, [expanded, data, shot, model]);

  const handleUniversalRewrite = async () => {
    if (!data || !refContext || !displayedVideoPrompt.trim() || universalRewriting) return;
    setUniversalRewriting(true);
    try {
      const rewritten = await rewriteUniversalVideoPrompt({
        prompt: displayedVideoPrompt,
        references: refImages.map((ref) => ({
          label: ref.label,
          kind: ref.type === 'video' ? '视频' : ref.type === 'audio' ? '音频' : ref.removeKind === 'directorConstraintCard' ? '导演约束卡' : '图片',
        })),
        duration: Math.min(30, Math.max(4, shot.durationSec ?? 5)),
        ratio: shot.videoRatio || data.videoRatio || '16:9',
      });
      updateShot(shot.shotNo, { universalVideoPrompt: rewritten });
    } catch (error) {
      await tauriMessage(`通用视频提示词优化失败：${error instanceof Error ? error.message : String(error)}`, { title: '优化失败' });
    } finally {
      setUniversalRewriting(false);
    }
  };

  const handleUploadRef = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = selected.split('.').pop() ?? 'png';
    const rel = `.kunpeng/aigc-memory/projects/${project.id}/assets/shot-ref-${shot.shotNo.replace(/[^\w-]+/g, '_')}-${Date.now()}.${ext}`;
    await copyFile(selected, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    const absPath = `${home}${rel}`;
    updateShot(shot.shotNo, { extraRefImages: [...(shot.extraRefImages ?? []), absPath] });
    setAddMenuOpen(false);
  };

  const handlePickArtifact = async (entry: { path: string }) => {
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = entry.path.split('.').pop() ?? 'png';
    const rel = `.kunpeng/aigc-memory/projects/${project.id}/assets/shot-ref-${shot.shotNo.replace(/[^\w-]+/g, '_')}-lib-${Date.now()}.${ext}`;
    await copyFile(entry.path, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    const absPath = `${home}${rel}`;
    updateShot(shot.shotNo, { extraRefImages: [...(shot.extraRefImages ?? []), absPath] });
    setPickerOpen(false);
    setAddMenuOpen(false);
  };

  const removeRef = (ref: ShotAssetRef) => {
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    const latestShot = latestData?.shots.find((item) => item.shotNo === shot.shotNo);
    if (!latestData || !latestShot) return;
    const patch = removeShotRef(ref, latestShot, latestData);
    if (!patch) return;
    // 删除参考会移动 @图片N 编号——必须同步重排提示词（曾经裸 updateShot，
    // 删中间一张后提示词残留旧编号，生成时指错素材）
    const ctx = { scenes: latestData.scenes, characters: latestData.characters, props: latestData.props ?? [], colorPalettes: latestData.colorPalettes ?? [], globalColorPaletteId: latestData.globalColorPaletteId };
    const refAwarePatch = buildRefAwarePatch(latestShot, patch, ctx);
    const nextShot = { ...latestShot, ...refAwarePatch, ...patch };
    const planningAssetChanged = ref.removeKind === 'storyboardBoard' || ref.removeKind === 'directorConstraintCard';
    store.updateShot(shot.shotNo, {
      ...refAwarePatch,
      ...patch,
      ...(planningAssetChanged
        ? { videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, refAwarePatch.videoPrompt ?? latestShot.videoPrompt) }
        : {}),
      promptNeedsRefresh: true,
    });
  };

  const handleGenerateVideo = async () => {
    // 始终从 store 读取点击瞬间的分镜，避免展开编辑器或 Agent 刚写回后，
    // React props 尚未完成下一次渲染就拿旧 prompt/旧资产做校验。
    const store = useWorkshopStore.getState();
    const latestData = store.data;
    const latestShot = latestData?.shots.find((item) => item.shotNo === shot.shotNo);
    if (!latestData || !latestShot) return;
    const check = validateShotPromptForVideo(latestShot, latestData);
    let skipPromptValidation = false;
    if (!check.ok) {
      skipPromptValidation = await tauriConfirm(
        `这个分镜的视频提示词缺少 @图片 引用或引用顺序不完整。\n\n${check.message}\n\n仍然继续生成吗？`,
        { title: '提示词引用提醒', type: 'warning' },
      ).catch(() => false);
      if (!skipPromptValidation) return;
    }
    await store.generateShot(latestShot.shotNo, 'video', { skipPromptValidation });
  };

  const busy = shot.genStatus === 'queued' || shot.genStatus === 'generating';
  useEffect(() => {
    if (!shot.videoPath || shot.videoThumbPath) return;
    let alive = true;
    void ensureVideoThumb(shot.videoPath).then((thumb) => {
      if (alive && thumb?.path) updateShot(shot.shotNo, { videoThumbPath: thumb.path });
    });
    return () => { alive = false; };
  }, [shot.shotNo, shot.videoPath, shot.videoThumbPath, updateShot]);

  const persistedVideoThumb = shot.videoThumbPath ? convertFileSrc(shot.videoThumbPath) : null;
  const cover = shot.videoPath
    ? (persistedVideoThumb ?? videoThumb ?? (shot.imagePath ? convertFileSrc(shot.imagePath) : null))
    : shot.imagePath ? convertFileSrc(shot.imagePath) : null;

  return (
    <div className={`rounded-xl border overflow-hidden group ${shot.genStatus === 'failed' ? 'border-red-500/60' : 'border-[var(--canvas-node-border)]'}`} style={{ background: 'var(--canvas-node-bg)' }} data-shot-no={shot.shotNo}>
      <div className="relative aspect-video bg-black/30 flex items-center justify-center">
        {playingVideo && shot.videoPath ? (
          <video
            src={convertFileSrc(shot.videoPath)}
            autoPlay
            controls
            className="w-full h-full object-contain bg-black"
            onEnded={() => setPlayingVideo(false)}
          />
        ) : cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" />
        ) : busy ? null : (
          <ImageIcon size={18} className="text-[var(--canvas-text-3)]" />
        )}
        {shot.videoPath && !playingVideo && (
          <button
            onClick={() => setPlayingVideo(true)}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors">
              <Play size={18} className="text-white ml-0.5" fill="white" />
            </div>
          </button>
        )}
        {shot.genStatus === 'failed' && (
          <span
            className="absolute top-1.5 left-1.5 w-5 h-5 rounded bg-black/60 flex items-center justify-center"
            title={shot.genError ?? '生成失败'}
          >
            <AlertTriangle size={11} className="text-red-400" />
          </span>
        )}
        {shot.videoPath && !playingVideo && (
          <span className={`absolute top-1.5 ${shot.genStatus === 'failed' ? 'left-8' : 'left-1.5'} px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] flex items-center gap-1`}>
            <Play size={8} /> 视频
          </span>
        )}
        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
            <Loader2 size={18} className="animate-spin text-white" />
            <span className="text-[10px] text-white/80">{shot.genStatus === 'queued' ? '排队中…' : (taskProgress || '生成中…')}</span>
            <button
              onClick={() => cancelShot(shot.shotNo)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-white/70 hover:text-white transition-colors"
            >
              <XCircle size={10} /> 取消
            </button>
          </div>
        )}
        {!busy && (
          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            <button
              onClick={() => void handleGenerateVideo()}
              disabled={!shot.videoRatio && !data?.videoRatio}
              className="px-2 py-1 rounded-lg text-white text-[10px] transition-opacity opacity-70 hover:opacity-100 flex items-center gap-1 disabled:opacity-40"
              style={{ background: 'var(--canvas-accent)' }}
              title={(shot.videoRatio || data?.videoRatio) ? (shot.videoPath ? '重新生成视频' : '生成视频') : '请先设置视频比例'}
            >
              {shot.videoPath ? <RefreshCw size={10} /> : <Clapperboard size={10} />} 视频
            </button>
            <div className="relative">
              <button
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
                title="更多操作"
              >
                <MoreHorizontal size={12} />
              </button>
              {moreMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10 cursor-default" onClick={() => setMoreMenuOpen(false)} />
                  <div
                    className="absolute bottom-full right-0 mb-1 z-20 min-w-[124px] rounded-lg border border-[var(--canvas-node-border)] py-1 shadow-lg"
                    style={{ background: 'var(--canvas-panel)' }}
                  >
                    <button
                      onClick={() => { setMoreMenuOpen(false); void generateShot(shot.shotNo, 'image'); }}
                      className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                    >
                      {shot.imagePath ? <RefreshCw size={11} /> : <ImageIcon size={11} />} {shot.imagePath ? '重新生成分镜图' : '生成分镜图'}
                    </button>
                    {shot.imagePath && (
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          const { addNode } = useCanvasStore.getState();
                          addNode({
                            id: `node-${nanoid(8)}`,
                            type: 'image',
                            position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
                            style: defaultNodeStyle('image'),
                            data: { generatedImageUrl: convertFileSrc(shot.imagePath!), localPath: shot.imagePath, description: shot.description },
                          });
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                      >
                        <MonitorPlay size={11} /> 图→画布
                      </button>
                    )}
                    {shot.videoPath && (
                      <button
                        onClick={() => {
                          setMoreMenuOpen(false);
                          const { addNode } = useCanvasStore.getState();
                          addNode({
                            id: `node-${nanoid(8)}`,
                            type: 'video',
                            position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
                            style: defaultNodeStyle('video'),
                            data: {
                              generatedVideoUrl: convertFileSrc(shot.videoPath!),
                              localPath: shot.videoPath,
                              mediaRole: 'output',
                              description: shot.description,
                            },
                          });
                        }}
                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                      >
                        <Clapperboard size={11} /> 视频→画布
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-2">
          {shot.videoPath && (
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              className="shrink-0 w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
            />
          )}
          <span className="font-mono text-[10px] text-[var(--canvas-text-3)]">{shot.shotNo}</span>
          <p className="flex-1 text-[11px] text-[var(--canvas-text-1)] truncate" title={shot.description}>{shot.description}</p>
          <select
            value={shot.videoModel ?? ''}
            onChange={(e) => updateShot(shot.shotNo, { videoModel: e.target.value || undefined })}
            className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] focus:outline-none focus-visible:border-[var(--canvas-accent)]"
            title={shot.videoModel ? `单独模型: ${shot.videoModel}` : `继承全局: ${data?.videoModel ?? 'Seedance 2.0'}`}
          >
            <option value="">{data?.videoModel === 'seedance-2.5' ? '全局(2.5)' : data?.videoModel === 'seedance-2.0-mini' ? '全局(Mini)' : data?.videoModel === 'minimax-h3' ? '全局(H3)' : data?.videoModel === 'wan-3.0' ? '全局(万相3)' : data?.videoModel?.startsWith('custom-media:') ? '全局(插件)' : '全局(2.0)'}</option>
            <option value="seedance-2.0">Seedance 2.0</option>
            <option value="seedance-2.5">Seedance 2.5</option>
            <option value="minimax-h3">MiniMax H3</option>
            <option value="seedance-2.0-mini">Mini</option>
            <option value="wan-3.0">万相 3.0</option>
            {customVideoOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={shot.videoRatio ?? ''}
            onChange={(e) => updateShot(shot.shotNo, { videoRatio: e.target.value || undefined })}
            className="shrink-0 px-1 py-0.5 rounded text-[10px] bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] focus:outline-none focus-visible:border-[var(--canvas-accent)]"
            title={shot.videoRatio ? `单独比例: ${shot.videoRatio}` : data?.videoRatio ? `继承全局: ${data.videoRatio}` : '未设置比例'}
          >
            <option value="">{data?.videoRatio ? `全局(${data.videoRatio})` : '比例'}</option>
            {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-1.5 rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors"
            title={expanded ? '收起' : '展开详情'}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {shot.genStatus === 'failed' && shot.genError && (
          <div className="mt-1">
            <div className="flex items-center gap-1.5">
              <p className="flex-1 min-w-0 truncate text-[10px] text-red-400" title={shot.genError}>{shot.genError}</p>
              <button
                onClick={() => void handleGenerateVideo()}
                disabled={!shot.videoRatio && !data?.videoRatio}
                className="shrink-0 px-1.5 py-0.5 rounded text-[10px] text-red-300 border border-red-500/50 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                title={(shot.videoRatio || data?.videoRatio) ? '重新生成视频' : '请先设置视频比例'}
              >
                重试
              </button>
              <button
                onClick={() => setErrorExpanded((v) => !v)}
                className="shrink-0 text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors"
              >
                {errorExpanded ? '收起' : '查看详情'}
              </button>
            </div>
            {errorExpanded && (
              <p className="mt-1 text-[10px] leading-relaxed text-red-300/80 whitespace-pre-wrap break-all">{shot.genError}</p>
            )}
            {(shot.imagePath || shot.videoPath) && (
              <button
                onClick={() => updateShot(shot.shotNo, { genStatus: 'done', genError: undefined, genTaskId: undefined })}
                className="text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] mt-0.5 transition-colors"
              >
                文件已存在，点击修复
              </button>
            )}
          </div>
        )}
      </div>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-[var(--canvas-node-border)]">
          <div className="flex items-center gap-1.5 pt-2 flex-wrap">
            <span className="text-[10px] text-[var(--canvas-text-3)]">资产</span>
            {refImages.map((ref, i) => (
              <div key={i} className="shrink-0 flex flex-col items-center gap-0.5 relative group/ref">
                {ref.type === 'audio' ? (
                  <div className="w-8 h-8 rounded border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.06)] flex items-center justify-center text-[10px] text-[var(--canvas-text-2)]">音</div>
                ) : ref.type === 'video' ? (
                  <div className="w-8 h-8 rounded border border-[var(--canvas-node-border)] bg-black/50 flex items-center justify-center text-[10px] text-[var(--canvas-text-2)]">视</div>
                ) : (
                  <img src={ref.url} className="w-8 h-8 rounded object-cover border border-[var(--canvas-node-border)]" alt="" />
                )}
                <span className="text-[10px] text-[var(--canvas-accent)]">{ref.label}</span>
                {ref.removable && (
                  <button
                    onClick={() => removeRef(ref)}
                    className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-opacity"
                    title="移除"
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-red-500/80 flex items-center justify-center">
                      <X size={8} className="text-white" />
                    </span>
                  </button>
                )}
              </div>
            ))}
            <div className="relative shrink-0">
              <button
                onClick={() => setAddMenuOpen(!addMenuOpen)}
                className="w-8 h-8 rounded border border-dashed border-[var(--canvas-node-border)] flex items-center justify-center text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-text-2)] transition-colors"
                title="添加参考图"
              >
                <Plus size={12} />
              </button>
              {addMenuOpen && (
                <div
                  className="absolute top-9 left-0 z-20 rounded-lg border border-[var(--canvas-node-border)] py-1 min-w-[120px] shadow-lg"
                  style={{ background: 'var(--canvas-panel)' }}
                >
                  <button
                    onClick={() => void handleUploadRef()}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                  >
                    <Upload size={10} /> 上传本地图
                  </button>
                  <button
                    onClick={() => { setPickerOpen(true); setAddMenuOpen(false); }}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-1.5 transition-colors"
                  >
                    <ImageIcon size={10} /> 从素材库选
                  </button>
                </div>
              )}
            </div>
          </div>
          <SmartTextarea
            value={shot.imagePrompt ?? ''}
            onChange={(v) => updateShot(shot.shotNo, { imagePrompt: v })}
            placeholder="生图提示词"
            mentionHighlight
            referenceImages={refImages}
            rows={2}
          />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--canvas-node-border)] bg-black/10 px-2.5 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-[var(--canvas-text-2)]">本镜提示词模板</div>
              <div className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">
                {shot.videoPromptTemplate ? '已覆盖项目全局设置' : `跟随全局：${promptTemplate === 'universal' ? '新版' : '经典版'}`}
              </div>
            </div>
            <div className="flex shrink-0 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-0.5">
              {([
                ['', '跟随全局'],
                ['legacy', '经典版'],
                ['universal', '新版'],
              ] as const).map(([value, label]) => {
                const active = (shot.videoPromptTemplate ?? '') === value;
                return (
                  <button
                    key={value || 'global'}
                    type="button"
                    onClick={() => updateShot(shot.shotNo, { videoPromptTemplate: value || undefined })}
                    className="h-7 rounded-md px-2.5 text-[10px] font-medium transition-colors"
                    style={{
                      background: active ? 'var(--canvas-controls-hover)' : 'transparent',
                      color: active ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {promptTemplate === 'universal' && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/8 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium text-cyan-200">新版提示词</div>
                  <div className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">
                    {isSeedance25 && hiddenStoryboardCount > 0 ? `2.5 已隐藏 ${hiddenStoryboardCount} 张分镜板；` : ''}统一素材身份、空间站位、时间戳动作、机位和物理一致性。
                  </div>
                  {(() => {
                    const audit = auditUniversalVideoPrompt(displayedVideoPrompt, shot.durationSec ?? 5);
                    const message = audit.errors[0] || audit.warnings[0];
                    return message ? <div className="mt-1 text-[10px] text-amber-300/80">检查提醒：{message}</div> : null;
                  })()}
                </div>
                <button
                  onClick={() => void handleUniversalRewrite()}
                  disabled={!displayedVideoPrompt.trim() || universalRewriting}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-cyan-500 px-2.5 text-[11px] font-medium text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-40"
                  title="按新版规范优化当前提示词"
                >
                  {universalRewriting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {universalRewriting ? '优化中' : '优化视频提示词'}
                </button>
              </div>
            </div>
          )}
          <SmartTextarea
            value={displayedVideoPrompt}
            onChange={(v) => updateShot(shot.shotNo,
              promptTemplate === 'universal'
                ? isSeedance25 ? { seedance25VideoPrompt: v } : { universalVideoPrompt: v }
                : { videoPrompt: v })}
            placeholder={promptTemplate === 'universal' ? '输入新版视频提示词' : '输入经典版视频提示词'}
            mentionHighlight
            referenceImages={refImages}
            rows={2}
          />
          {(shot.generatedAudios?.length ?? 0) > 0 && (
            <ShotAudioRow audios={shot.generatedAudios!} limitSec={isSeedance25 ? 30 : 15} />
          )}
        </div>
      )}
      {pickerOpen && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)', zIndex: Z.picker }} onClick={() => setPickerOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ArtifactPickerPanel
              open
              onClose={() => setPickerOpen(false)}
              onPick={(entry) => void handlePickArtifact(entry)}
              inline
            />
          </div>
        </div>
      )}
    </div>
  );
}
