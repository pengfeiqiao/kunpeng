import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nanoid } from 'nanoid';
import {
  AlertTriangle, Aperture, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, Bug, Camera, Check, ChevronDown, Clapperboard, Eye, EyeOff,
  Copy, Download, Film, FolderOpen, Image as ImageIcon, Keyboard, Loader2, Lock, Move3D, Pause, PersonStanding, Search,
  MousePointer2, Play, Plus, Redo2, RefreshCw, Rotate3D, Save, Scaling, Send, SlidersHorizontal, Sparkles,
  Square, Trash2, Undo2, Video, X,
} from 'lucide-react';
import { confirm as tauriConfirm, message as tauriMessage, save as tauriSave } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { useDirectorStore, activeDirectorPlan, activeDirectorShot, newElementId, type TransformMode } from '@/stores/directorStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { hasDirectorProject } from '@/stores/directorStore';
import { DirectorEngine, type DirectorEngineDiagnostics } from '@/lib/director/engine';
import { buildWorkshopDirectorLaunch, mannequinFor, type WorkshopDirectorMode } from '@/lib/director/launch';
import { evaluateDirectorFrame, inspectDirectorPlan, planDuration } from '@/lib/director/playback';
import { consultDirectorPlan, generateDirectorMotionDraftProposals, generateDirectorPlanProposals, inferPromptActionsByShot, promptImpliesCharacterAction, type DirectorAgentCommand, type DirectorConsultMessage } from '@/lib/director/agentPlanning';
import { findPose, JOINT_SLIDERS, POSE_PRESETS } from '@/lib/director/poses';
import { createMotionKeyframes, motionTemplate, MOTION_TEMPLATES } from '@/lib/director/motionTemplates';
import { cornerPathFrame, smoothPathFrame } from '@/lib/director/pathCurve';
import { cameraPatchFromTemplate, cameraTemplate, CAMERA_TEMPLATES } from '@/lib/director/cameraTemplates';
import { CHARACTER_PERFORMANCE_TEMPLATES, characterPerformanceTemplate } from '@/lib/director/characterTemplates';
import type {
  DirectorActionId,
  DirectorActionClip,
  DirectorCameraMove,
  CrowdElement,
  DirectorElement,
  DirectorPlan,
  DirectorMotionKeyframe,
  DirectorSequenceShot,
  DirectorShotScale,
  JointName,
  MannequinElement,
  PrimitiveElement,
  Vec3,
} from '@/lib/director/types';
import { analyzeDirectorImage, analysisToElements, analysisToShotLayout, shotScaleLabel, type DirectorImageAnalysis } from '@/lib/director/imageAnalysis';
import { ACTOR_IDENTITY_COLORS, actorIdentityColor } from '@/lib/director/identityPalette';
import DirectorChatPanel, { openDirectorAssistant } from './DirectorChatPanel';
import { DIRECTOR_RUNTIME_COMMAND_EVENT, setDirectorRuntimeSnapshot, type DirectorRuntimeCommand } from '@/lib/director/runtimeControl';

type StagePhase = 'design' | 'adjust' | 'export';
type RightDockView = 'inspect' | 'export';
type TimelineKeyframeSelection =
  | { kind: 'action'; shotId: string; actionId: string; keyframeId: string }
  | { kind: 'camera'; shotId: string; keyframeId: string }
  | null;

const ACTIONS = MOTION_TEMPLATES.map(({ id, label }) => ({ id, label }));

const CAMERA_MOVES = CAMERA_TEMPLATES.map(({ id, label }) => ({ id, label }));

const PHASES: { id: StagePhase; label: string }[] = [
  { id: 'design', label: '设计方案' },
  { id: 'adjust', label: '调整预演' },
  { id: 'export', label: '导出回传' },
];

const ACTOR_PRESETS = [
  { id: 'person', label: '标准人物', description: '成年人白模', kind: 'person' },
  { id: 'tall-person', label: '高个人物', description: '较高体型，用于形成身高差', kind: 'person' },
  { id: 'child', label: '儿童人物', description: '较矮的人物比例', kind: 'person' },
  { id: 'quadruped', label: '四足动物', description: '中型动物走位白模', kind: 'animal' },
  { id: 'small-animal', label: '小型动物', description: '小型动物走位白模', kind: 'animal' },
  { id: 'crowd-3', label: '小型群众', description: '3 x 3 群众阵列', kind: 'crowd' },
  { id: 'crowd-5', label: '大型群众', description: '4 x 5 群众阵列', kind: 'crowd' },
] as const;

const PROP_PRESETS = [
  { id: 'table', label: '长桌', kind: 'box', scale: { x: 1.8, y: 0.75, z: 0.9 }, y: 0.375 },
  { id: 'round-table', label: '圆桌', kind: 'cylinder', scale: { x: 1.25, y: 0.75, z: 1.25 }, y: 0.375 },
  { id: 'chair', label: '椅子', kind: 'box', scale: { x: 0.55, y: 0.48, z: 0.55 }, y: 0.24 },
  { id: 'sofa', label: '沙发', kind: 'box', scale: { x: 2.1, y: 0.75, z: 0.9 }, y: 0.375 },
  { id: 'door', label: '门', kind: 'wall', scale: { x: 0.85, y: 1, z: 1 }, y: 1.2 },
  { id: 'wall', label: '墙体', kind: 'wall', scale: { x: 2.5, y: 2, z: 0.15 }, y: 1.2 },
  { id: 'column', label: '立柱', kind: 'cylinder', scale: { x: 0.55, y: 2.4, z: 0.55 }, y: 1.2 },
  { id: 'car', label: '车辆', kind: 'box', scale: { x: 2.2, y: 1.3, z: 4 }, y: 0.65 },
  { id: 'screen', label: '屏幕', kind: 'box', scale: { x: 2.2, y: 1.3, z: 0.12 }, y: 1.3 },
  { id: 'crate', label: '箱子', kind: 'box', scale: { x: 0.8, y: 0.8, z: 0.8 }, y: 0.4 },
] as const;

const INITIAL_DIRECTOR_CHAT: DirectorConsultMessage[] = [{
  role: 'assistant',
  content: '先说说你希望这一段让观众最先感受到什么。可以是人物动作、紧张感、轻松感，或者某个必须突出的瞬间。',
}];

function activePlanFrom(plans: DirectorPlan[], id: string | null): DirectorPlan | undefined {
  return plans.find((plan) => plan.id === id);
}

function fmtTime(value: number): string {
  const sec = Math.max(0, value);
  return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toFixed(1).padStart(4, '0')}`;
}

const DIRECTOR_FPS = 24;
const DIRECTOR_FRAME_SEC = 1 / DIRECTOR_FPS;

type MotionActorElement = MannequinElement | CrowdElement;

function isMotionActor(element?: DirectorElement): element is MotionActorElement {
  return element?.kind === 'mannequin' || element?.kind === 'crowd';
}

function motionActorLabel(element: MotionActorElement): string {
  return element.kind === 'crowd' ? '群演' : '人物';
}

function snapDirectorFrame(value: number): number {
  return Math.max(0, Math.round(value * DIRECTOR_FPS) / DIRECTOR_FPS);
}

function fmtTimecode(value: number): string {
  const totalFrames = Math.max(0, Math.round(value * DIRECTOR_FPS));
  const frames = totalFrames % DIRECTOR_FPS;
  const totalSeconds = Math.floor(totalFrames / DIRECTOR_FPS);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds, frames].map((part) => part.toString().padStart(2, '0')).join(':');
}

function fallbackActionMannequin(): MannequinElement {
  return {
    id: newElementId(), kind: 'mannequin', name: '人物',
    position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }, color: actorIdentityColor(0), visible: true, groupId: null,
    poseId: 'stand', joints: findPose('stand')?.joints ?? {}, heightM: 1.7, identitySource: 'temporary', performanceProfileId: 'neutral', dominantHand: 'right', motionScale: 1, personalSpaceM: 0.8,
  };
}

function directorSceneContext(plan: DirectorPlan, currentShot: DirectorSequenceShot | undefined, elements: DirectorElement[], diagnostics: DirectorEngineDiagnostics | null): string {
  const shot = currentShot ?? plan.shots[0];
  const people = elements.filter(isMotionActor).map((element) => {
    const state = shot?.elementStates[element.id];
    const rendered = diagnostics?.elements.find((item) => item.id === element.id);
    const identity = element.kind === 'mannequin' ? `身份=${element.identitySource ?? '旧数据'}，角色ID=${element.characterId ?? '无'}，` : '类型=群演阵列，';
    return `${element.name}[${element.id}]：${identity}数据可见=${state?.visible !== false}，渲染对象=${Boolean(rendered)}，摄影机内=${rendered?.insideShotFrustum ?? '未知'}，位置=${JSON.stringify(state?.position ?? element.position)}`;
  });
  const store = useDirectorStore.getState();
  const plans = store.plans.map((item) => ({
    id: item.id,
    name: item.name,
    active: item.id === store.activePlanId,
    shots: item.shots.map((entry, index) => ({
      id: entry.id,
      index,
      name: entry.name,
      active: entry.id === store.activeShotId,
      startSec: entry.startSec,
      durationSec: entry.durationSec,
      cameraMove: entry.cameraMove,
      shotScale: entry.shotScale,
      cameraKeyframes: entry.cameraKeyframes?.map((keyframe) => ({ id: keyframe.id, timeSec: keyframe.timeSec, position: keyframe.position, target: keyframe.target, fov: keyframe.fov, locked: keyframe.locked })),
      actions: entry.actions.map((action) => ({ id: action.id, personId: action.elementId, action: action.action, templateId: action.templateId, source: action.source, locked: action.locked, startSec: action.startSec, durationSec: action.durationSec, from: action.from, to: action.to, keyframes: action.keyframes?.map((keyframe) => ({ id: keyframe.id, timeSec: keyframe.timeSec, interpolation: keyframe.interpolation, locked: keyframe.locked, source: keyframe.source })) })),
    })),
  }));
  const sceneElements = elements.map((element) => ({ id: element.id, name: element.name, kind: element.kind, position: shot?.elementStates[element.id]?.position ?? element.position, rotationDeg: shot?.elementStates[element.id]?.rotationDeg ?? element.rotationDeg, visible: shot?.elementStates[element.id]?.visible ?? element.visible }));
  const evaluated = evaluateDirectorFrame(plan, elements, store.currentTimeSec);
  const sampledFrame = evaluated ? { shotId: evaluated.shot.id, localTimeSec: evaluated.localTimeSec, camera: evaluated.camera, elements: evaluated.elements.map((element) => ({ id: element.id, name: element.name, position: element.position, rotationDeg: element.rotationDeg, poseId: element.kind === 'mannequin' ? element.poseId : undefined, visible: element.visible })) } : null;
  const health = inspectDirectorPlan(plan, elements).map((issue) => ({ severity: issue.severity, shotId: issue.shotId, message: issue.message }));
  return `当前方案=${plan.name}[${plan.id}]；当前镜头=${shot?.name ?? '无'}[${shot?.id ?? ''}]；当前时间=${store.currentTimeSec.toFixed(2)}；播放=${store.playing}\n角色身份与渲染：\n${people.join('\n') || '当前没有人物白模'}\n全部场景元素：${JSON.stringify(sceneElements)}\n当前帧采样：${JSON.stringify(sampledFrame)}\n检查结果：${JSON.stringify(health)}\n完整方案与镜头：${JSON.stringify(plans)}\n渲染器=${diagnostics ? diagnostics.webglContextLost ? '上下文丢失' : '正常' : '尚未读取'}`;
}

function DirectorProjectSwitcher({ open, onOpenChange, currentValue, originTitle, shots, availability, switching, onSelect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentValue: string;
  originTitle: string;
  shots: Array<{ shotNo: string; description: string }>;
  availability: Record<string, { storyboard: boolean; videoPrompt: boolean }>;
  switching: boolean;
  onSelect: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const currentParts = currentValue.includes('::') ? currentValue.split('::') : [];
  const currentMode = currentParts[0];
  const currentShotNo = currentParts[1];
  const currentShot = shots.find((item) => item.shotNo === currentShotNo);
  const currentLabel = currentValue === '__canvas__'
    ? '画布来源'
    : !currentValue ? '空白导演台' : `${currentShotNo} · ${currentMode === 'storyboard' ? '分镜白模' : '动作预演'}`;
  const currentDescription = currentValue === '__canvas__'
    ? originTitle
    : currentShot?.description || (currentValue ? '未命名分镜' : '从空白舞台开始，或切换到项目分镜');
  const filtered = shots.filter((item) => `${item.shotNo} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (value: string) => {
    onOpenChange(false);
    setQuery('');
    onSelect(value);
  };

  return (
    <div className="relative ml-1">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={switching}
        className="flex h-9 w-[300px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.055] disabled:cursor-wait"
        title="切换导演工程，当前工程会自动保存"
      >
        {switching ? <Loader2 size={13} className="shrink-0 animate-spin text-white/45" /> : <Clapperboard size={13} className="shrink-0 text-white/55" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-medium text-white/75">{switching ? '正在切换工程…' : currentLabel}</span>
          <span className="block truncate text-[8px] text-white/30">{currentDescription}</span>
        </span>
        <ChevronDown size={12} className={`shrink-0 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && <>
        <button type="button" aria-label="关闭工程切换" className="fixed inset-0 z-40 cursor-default" onClick={() => onOpenChange(false)} />
        <div className="absolute left-0 top-11 z-50 w-[410px] overflow-hidden rounded-xl border border-white/10 bg-[#1a1b1e] shadow-2xl">
          <div className="border-b border-white/[0.07] p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium text-white/75">切换导演工程</span><span className="text-[8px] text-white/30">切换前自动保存</span></div>
            <label className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2.5 focus-within:border-white/15">
              <Search size={12} className="text-white/30" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="搜索分镜编号或画面描述" className="min-w-0 flex-1 bg-transparent text-[10px] text-white/70 outline-none placeholder:text-white/25" />
            </label>
          </div>

          <div className="max-h-[430px] overflow-y-auto p-2">
            <button type="button" onClick={() => choose('')} className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${!currentValue ? 'border-white/18 bg-white/[0.08]' : 'border-transparent hover:bg-white/[0.045]'}`}>
              <Square size={12} className="shrink-0 text-white/40" />
              <span className="min-w-0 flex-1"><span className="block text-[10px] text-white/70">空白导演台</span><span className="block text-[8px] text-white/30">不载入任何分镜资产</span></span>
              {!currentValue && <Check size={12} className="text-white/60" />}
            </button>
            {currentValue === '__canvas__' && <div className="mb-1 flex items-center gap-2 rounded-lg border border-white/18 bg-white/[0.08] px-2.5 py-2"><ImageIcon size={12} className="text-white/45" /><span className="min-w-0 flex-1"><span className="block text-[10px] text-white/70">画布来源</span><span className="block truncate text-[8px] text-white/30">{originTitle}</span></span><Check size={12} className="text-white/60" /></div>}

            <div className="my-2 flex items-center gap-2 px-1"><span className="text-[8px] font-medium text-white/30">项目分镜</span><span className="h-px flex-1 bg-white/[0.06]" /></div>
            {filtered.map((item) => {
              const status = availability[item.shotNo];
              const storyboardValue = `storyboard::${item.shotNo}`;
              const videoValue = `video-prompt::${item.shotNo}`;
              return <div key={item.shotNo} className="mb-1.5 rounded-lg border border-white/[0.06] bg-white/[0.018] p-2.5">
                <div className="mb-2 flex min-w-0 items-start gap-2">
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-1 font-mono text-[9px] text-white/55">{item.shotNo}</span>
                  <span className="min-w-0 flex-1 line-clamp-2 text-[9px] leading-relaxed text-white/45">{item.description || '未填写画面描述'}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button type="button" onClick={() => choose(storyboardValue)} className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-[9px] ${currentValue === storyboardValue ? 'border-white/20 bg-white/[0.1] text-white' : 'border-white/[0.07] text-white/50 hover:bg-white/[0.055] hover:text-white/75'}`}>
                    <ImageIcon size={10} /><span>分镜白模</span>{status?.storyboard && <span className="ml-auto rounded border border-white/10 px-1 py-0.5 text-[7px] text-white/45">已有</span>}{currentValue === storyboardValue && <Check size={9} className="ml-auto" />}
                  </button>
                  <button type="button" onClick={() => choose(videoValue)} className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-[9px] ${currentValue === videoValue ? 'border-white/20 bg-white/[0.1] text-white' : 'border-white/[0.07] text-white/50 hover:bg-white/[0.055] hover:text-white/75'}`}>
                    <Film size={10} /><span>动作预演</span>{status?.videoPrompt && <span className="ml-auto rounded border border-white/10 px-1 py-0.5 text-[7px] text-white/45">已有</span>}{currentValue === videoValue && <Check size={9} className="ml-auto" />}
                  </button>
                </div>
              </div>;
            })}
            {filtered.length === 0 && <div className="py-10 text-center text-[9px] text-white/30">没有匹配的分镜</div>}
          </div>
        </div>
      </>}
    </div>
  );
}

export default function DirectorStage({ onClose, onSendMessage, onAbort }: {
  onClose: () => void;
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const monitorRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DirectorEngine | null>(null);
  const playbackRef = useRef<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const cameraEditPointRef = useRef<'start' | 'current' | 'end'>('current');
  const [phase, setPhase] = useState<StagePhase>('design');
  const [schemePrompt, setSchemePrompt] = useState('');
  const [directorChat, setDirectorChat] = useState<DirectorConsultMessage[]>(INITIAL_DIRECTOR_CHAT);
  const [directorChatInput, setDirectorChatInput] = useState('');
  const [, setDirectorChatReady] = useState(false);
  const [directorChatLoading, setDirectorChatLoading] = useState(false);
  const [generatingPlans, setGeneratingPlans] = useState(false);
  const [proposals, setProposals] = useState<DirectorPlan[]>([]);
  const [actionMenu, setActionMenu] = useState(false);
  const [actionQuickBarOpen, setActionQuickBarOpen] = useState(false);
  const [libraryMenu, setLibraryMenu] = useState<'actors' | 'props' | null>(null);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [rightDockOpen, setRightDockOpen] = useState(true);
  const [rightDockView, setRightDockView] = useState<RightDockView>('inspect');
  const [cameraEditPoint, setCameraEditPoint] = useState<'start' | 'current' | 'end'>('current');
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [exportInSec, setExportInSec] = useState(0);
  const [exportOutSec, setExportOutSec] = useState(0);
  const [exportOutputPath, setExportOutputPath] = useState('');
  const [lastExportPath, setLastExportPath] = useState('');
  const [generationDialog, setGenerationDialog] = useState<'still' | 'previs' | 'image' | 'video' | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState<DirectorImageAnalysis | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [switchingShot, setSwitchingShot] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [shortcutPanelOpen, setShortcutPanelOpen] = useState(false);
  const [debugTick, setDebugTick] = useState(0);
  const [directorProjects, setDirectorProjects] = useState<Record<string, { storyboard: boolean; videoPrompt: boolean }>>({});
  const [motionPositioningReady, setMotionPositioningReady] = useState(false);
  const [characterIdentityReady, setCharacterIdentityReady] = useState(false);
  const [transformControlsVisible, setTransformControlsVisible] = useState(true);
  const [timelineSelection, setTimelineSelection] = useState<TimelineKeyframeSelection>(null);
  const imageAnalysisStarted = useRef(false);
  const motionDraftStarted = useRef(false);
  const motionPositioningStarted = useRef(false);
  const motionVisibilityRepairStarted = useRef(false);
  const characterIdentityReconciled = useRef(false);
  const exportRangePlanRef = useRef<string | null>(null);

  const loaded = useDirectorStore((state) => state.loaded);
  const loadedFromExisting = useDirectorStore((state) => state.loadedFromExisting);
  const origin = useDirectorStore((state) => state.origin);
  const elements = useDirectorStore((state) => state.elements);
  const plans = useDirectorStore((state) => state.plans);
  const activePlanId = useDirectorStore((state) => state.activePlanId);
  const activeShotId = useDirectorStore((state) => state.activeShotId);
  const selectedIds = useDirectorStore((state) => state.selectedIds);
  const currentTimeSec = useDirectorStore((state) => state.currentTimeSec);
  const playing = useDirectorStore((state) => state.playing);
  const transformMode = useDirectorStore((state) => state.transformMode);
  const undoCount = useDirectorStore((state) => state.undoStack.length);
  const redoCount = useDirectorStore((state) => state.redoStack.length);
  const workshopData = useWorkshopStore((state) => state.data);
  const plan = useMemo(() => activePlanFrom(plans, activePlanId), [plans, activePlanId]);
  const shot = useMemo(() => plan?.shots.find((item) => item.id === activeShotId), [plan, activeShotId]);
  const duration = plan ? planDuration(plan) : 0;
  const issues = useMemo(() => plan ? inspectDirectorPlan(plan, elements) : [], [plan, elements]);
  const selected = elements.find((element) => selectedIds.length === 1 && element.id === selectedIds[0]);
  const selectedActions = isMotionActor(selected) && shot
    ? shot.actions.filter((action) => action.elementId === selected.id)
    : [];
  const engineDiagnostics = debugOpen && debugTick >= 0 ? engineRef.current?.diagnostics() ?? null : null;
  const workshopMode: WorkshopDirectorMode | null = origin.kind === 'workshop-storyboard'
    ? 'storyboard'
    : origin.kind === 'workshop-video-prompt' ? 'video-prompt' : null;
  const projectSelectorValue = workshopMode
    ? `${workshopMode}::${origin.shotNo ?? ''}`
    : origin.kind === 'canvas-image' || origin.kind === 'canvas-prompt' ? '__canvas__' : '';

  useEffect(() => {
    if (!plan) return;
    if (exportRangePlanRef.current !== plan.id) {
      exportRangePlanRef.current = plan.id;
      setExportInSec(0);
      setExportOutSec(snapDirectorFrame(duration));
      return;
    }
    setExportInSec((value) => Math.max(0, Math.min(value, Math.max(0, duration - DIRECTOR_FRAME_SEC))));
    setExportOutSec((value) => Math.max(DIRECTOR_FRAME_SEC, Math.min(value || duration, duration)));
  }, [plan?.id, duration]);

  useEffect(() => {
    if (!workshopData?.projectId || workshopData.shots.length === 0) {
      setDirectorProjects({});
      return;
    }
    let cancelled = false;
    void Promise.all(workshopData.shots.map(async (item) => {
      const [storyboard, videoPrompt] = await Promise.all([
        hasDirectorProject(workshopData.projectId, item.shotNo, 'storyboard'),
        hasDirectorProject(workshopData.projectId, item.shotNo, 'video-prompt'),
      ]);
      return [item.shotNo, { storyboard, videoPrompt }] as const;
    })).then((entries) => {
      if (!cancelled) setDirectorProjects(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [origin.kind, origin.shotNo, workshopData?.projectId, workshopData?.shots]);

  const switchWorkshopShot = useCallback(async (selection: string) => {
    if (!workshopData || switchingShot || selection === projectSelectorValue || selection === '__canvas__') return;
    setSwitchingShot(true);
    try {
      const store = useDirectorStore.getState();
      await store.save();
      imageAnalysisStarted.current = false;
      motionDraftStarted.current = false;
      motionPositioningStarted.current = false;
      motionVisibilityRepairStarted.current = false;
      characterIdentityReconciled.current = false;
      setMotionPositioningReady(false);
      setCharacterIdentityReady(false);
      setImageAnalysis(null);
      setAnalyzingImage(false);
      setSchemePrompt('');
      setDirectorChat(INITIAL_DIRECTOR_CHAT);
      setDirectorChatInput('');
      setDirectorChatReady(false);
      setDirectorChatLoading(false);
      setProposals([]);
      if (!selection) {
        store.prepareLaunch({ kind: 'free', title: '空白导演台' }, { elements: [], forceNew: true });
      } else {
        const [requestedMode, shotNo] = selection.includes('::') ? selection.split('::') : ['', selection];
        const target = workshopData.shots.find((item) => item.shotNo === shotNo);
        if (!target) throw new Error(`找不到分镜 ${shotNo}`);
        const mode: WorkshopDirectorMode = requestedMode === 'storyboard' || requestedMode === 'video-prompt'
          ? requestedMode
          : workshopMode ?? ((target.storyboardFrames ?? []).some((frame) => frame.prompt || frame.imagePath) ? 'storyboard' : 'video-prompt');
        const launch = buildWorkshopDirectorLaunch(target, workshopData.characters, workshopData.projectId, mode);
        store.prepareLaunch(launch.origin, launch.seed);
      }
      await store.open();
      setPhase('adjust');
      setRightDockView('inspect');
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '切换分镜失败', type: 'error' });
    } finally {
      setSwitchingShot(false);
    }
  }, [projectSelectorValue, switchingShot, workshopData, workshopMode]);

  useEffect(() => {
    void useDirectorStore.getState().open();
    return () => useDirectorStore.getState().close();
  }, []);

  useEffect(() => {
    if (!loaded || !containerRef.current || engineRef.current) return;
    const engine = new DirectorEngine(containerRef.current);
    engineRef.current = engine;
    if (monitorRef.current) engine.attachMonitor(monitorRef.current);
    engine.onPick = (id, additive) => {
      const store = useDirectorStore.getState();
      const nextSelectedIds = !id ? [] : additive
        ? store.selectedIds.includes(id) ? store.selectedIds.filter((item) => item !== id) : [...store.selectedIds, id]
        : [id];
      store.setSelected(nextSelectedIds);
      const picked = id ? store.elements.find((element) => element.id === id) : undefined;
      setActionQuickBarOpen(nextSelectedIds.length === 1 && isMotionActor(picked));
      if (id) { setPropertyOpen(true); setRightDockOpen(true); setRightDockView('inspect'); }
    };
    engine.onDoublePick = (id) => {
      const store = useDirectorStore.getState();
      const actor = store.elements.find((element) => element.id === id);
      if (!isMotionActor(actor)) {
        store.setSelected([id]);
        setPhase('adjust');
        setPropertyOpen(true);
        setRightDockOpen(true);
        setRightDockView('inspect');
        return;
      }
      const currentShot = activeDirectorShot(store);
      if (!currentShot) return;
      if (!currentShot.actions.some((action) => action.elementId === id)) {
        const state = currentShot.elementStates[id];
        const from = state?.position ?? actor.position;
        const durationSec = Math.min(currentShot.durationSec, motionTemplate('stand').defaultDurationSec);
        store.addAction(currentShot.id, {
          elementId: id,
          action: 'stand',
          startSec: 0,
          durationSec,
          from: { ...from },
          to: { ...from },
          templateId: 'stand',
          source: 'manual',
          intensity: 1,
          keyframes: createMotionKeyframes('stand', durationSec, from, from, 'manual'),
        });
      }
      store.setSelected([id]);
      store.setCurrentTime(currentShot.startSec);
      store.setTransformMode('translate');
      setPhase('adjust');
      setTransformControlsVisible(true);
      setPropertyOpen(true);
      setRightDockOpen(true);
      setRightDockView('inspect');
      setActionQuickBarOpen(true);
    };
    engine.onActionPointPick = (actionId, keyframeId) => {
      const store = useDirectorStore.getState();
      const owner = store.plans.flatMap((item) => item.shots).find((item) => item.actions.some((action) => action.id === actionId));
      const action = owner?.actions.find((item) => item.id === actionId);
      const frame = action?.keyframes?.find((item) => item.id === keyframeId);
      if (!owner || !action || !frame) return;
      store.setActiveShot(owner.id);
      store.setSelected([action.elementId]);
      store.setCurrentTime(owner.startSec + action.startSec + frame.timeSec);
      setTimelineSelection({ kind: 'action', shotId: owner.id, actionId, keyframeId });
      setPhase('adjust');
      setPropertyOpen(true);
      setRightDockOpen(true);
      setRightDockView('inspect');
      setActionQuickBarOpen(true);
    };
    engine.onActionHandlePick = (actionId, keyframeId) => {
      const store = useDirectorStore.getState();
      const owner = store.plans.flatMap((item) => item.shots).find((item) => item.actions.some((action) => action.id === actionId));
      const action = owner?.actions.find((item) => item.id === actionId);
      if (!owner || !action) return;
      store.setPlaying(false);
      store.setActiveShot(owner.id);
      store.setSelected([action.elementId]);
      setTimelineSelection({ kind: 'action', shotId: owner.id, actionId, keyframeId });
      setPhase('adjust');
      setTransformControlsVisible(true);
    };
    engine.onActionHandleCommit = (actionId, keyframeId, side, offset) => {
      const store = useDirectorStore.getState();
      const owner = store.plans.flatMap((item) => item.shots).find((item) => item.actions.some((action) => action.id === actionId));
      const action = owner?.actions.find((item) => item.id === actionId);
      const frame = action?.keyframes?.find((item) => item.id === keyframeId);
      if (!owner || !action || !frame) return;
      store.checkpoint();
      const opposite = { x: -offset.x, y: -offset.y, z: -offset.z };
      const keyframes = (action.keyframes ?? []).map((item) => item.id === keyframeId
        ? {
            ...item,
            pathMode: 'smooth' as const,
            ...(side === 'in'
              ? { pathIn: offset, pathOut: opposite }
              : { pathOut: offset, pathIn: opposite }),
            locked: true,
            source: 'manual' as const,
          }
        : item);
      store.updateAction(owner.id, action.id, { keyframes, source: 'manual' });
    };
    engine.onTransformCommit = (id, transform, mode) => {
      const store = useDirectorStore.getState();
      store.checkpoint();
      if (mode === 'scale') {
        const scale = {
          x: Math.max(0.05, Math.min(20, transform.scale.x)),
          y: Math.max(0.05, Math.min(20, transform.scale.y)),
          z: Math.max(0.05, Math.min(20, transform.scale.z)),
        };
        store.updateElement(id, { scale });
        const element = store.elements.find((item) => item.id === id);
        if (element) engine.ackTransform(id, element);
        return;
      }
      const currentShot = activeDirectorShot(store);
      const currentPlan = activeDirectorPlan(store);
      const localTime = currentShot ? store.currentTimeSec - currentShot.startSec : -1;
      const activeAction = currentShot?.actions.find((action) => action.elementId === id && localTime >= action.startSec && localTime <= action.startSec + action.durationSec);
      if (currentShot && currentPlan && activeAction) {
        const actionTime = Math.max(0, Math.min(activeAction.durationSec, localTime - activeAction.startSec));
        const evaluated = evaluateDirectorFrame(currentPlan, store.elements, store.currentTimeSec)?.elements.find((item) => item.id === id);
        const next = { id: `kf-${nanoid(7)}`, timeSec: Number(actionTime.toFixed(3)), position: { ...transform.position }, rotationDeg: { ...transform.rotationDeg }, joints: evaluated?.kind === 'mannequin' ? evaluated.joints : undefined, interpolation: 'smooth' as const, locked: true, source: 'manual' as const, note: '舞台拖动 K 帧' };
        const keyframes = [...(activeAction.keyframes ?? []).filter((keyframe) => Math.abs(keyframe.timeSec - actionTime) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec);
        store.updateAction(currentShot.id, activeAction.id, { keyframes, source: 'manual' });
      } else store.updateElement(id, transform);
      const element = store.elements.find((item) => item.id === id);
      if (element) engine.ackTransform(id, { ...element, ...transform } as DirectorElement);
    };
    engine.onCameraRigPick = () => {
      const store = useDirectorStore.getState();
      store.setSelected([]);
      setPhase('adjust');
      setTransformControlsVisible(true);
      setPropertyOpen(true);
      setRightDockOpen(true);
      setRightDockView('inspect');
      setActionQuickBarOpen(false);
    };
    engine.onCameraRigCommit = (pose) => {
      const currentShot = activeDirectorShot();
      if (!currentShot) return;
      const store = useDirectorStore.getState();
      store.checkpoint();
      const timeSec = cameraEditPointRef.current === 'start'
        ? 0
        : cameraEditPointRef.current === 'end'
          ? currentShot.durationSec
          : Math.max(0, Math.min(currentShot.durationSec, store.currentTimeSec - currentShot.startSec));
      const existing = currentShot.cameraKeyframes?.find((keyframe) => Math.abs(keyframe.timeSec - timeSec) < 0.04);
      const next = { id: existing?.id ?? `ckf-${nanoid(7)}`, timeSec: Number(timeSec.toFixed(3)), position: { ...pose.position }, target: { ...pose.target }, fov: pose.fov, rollDeg: pose.rollDeg ?? 0, interpolation: existing?.interpolation ?? 'smooth' as const, locked: true, source: 'manual' as const, note: cameraEditPointRef.current === 'start' ? '人工起始机位' : cameraEditPointRef.current === 'end' ? '人工结束机位' : '人工摄影机 K 帧' };
      const cameraKeyframes = [...(currentShot.cameraKeyframes ?? []).filter((keyframe) => Math.abs(keyframe.timeSec - timeSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec);
      if (cameraEditPointRef.current === 'start') store.updateShot(currentShot.id, { position: pose.position, target: pose.target, fov: pose.fov, cameraKeyframes });
      else if (cameraEditPointRef.current === 'end') store.updateShot(currentShot.id, { cameraEnd: pose, cameraKeyframes });
      else store.updateShot(currentShot.id, { cameraKeyframes });
      setTimelineSelection({ kind: 'camera', shotId: currentShot.id, keyframeId: next.id });
    };
    engine.syncElements(elements);
    engine.setSelection(selectedIds);
    engine.setTransformMode(transformMode);
    engine.setTransformControlsVisible(transformControlsVisible && phase === 'adjust' && !playing);
    const resize = () => engine.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      engine.dispose();
      engineRef.current = null;
    };
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !workshopMode || !workshopData || characterIdentityReconciled.current) return;
    const sourceShot = workshopData.shots.find((item) => item.shotNo === origin.shotNo);
    if (!sourceShot) return;
    characterIdentityReconciled.current = true;
    const expected = (sourceShot.characterIds ?? []).map((id) => workshopData.characters.find((character) => character.id === id)).filter(Boolean).map((character, index) => mannequinFor(character!, index));
    useDirectorStore.getState().reconcileMannequins(expected);
    setCharacterIdentityReady(true);
  }, [loaded, origin.shotNo, workshopData, workshopMode]);

  useEffect(() => {
    if (!loaded || origin.kind !== 'workshop-video-prompt' || motionVisibilityRepairStarted.current) return;
    const mannequins = elements.filter((element) => element.kind === 'mannequin');
    if (mannequins.length === 0) return;
    motionVisibilityRepairStarted.current = true;
    const store = useDirectorStore.getState();
    let repaired = false;
    store.plans.forEach((item) => item.shots.forEach((targetShot) => {
      const allHidden = mannequins.every((element) => targetShot.elementStates[element.id]?.visible === false);
      if (!allHidden) return;
      repaired = true;
      store.updateShot(targetShot.id, {
        elementStates: Object.fromEntries(Object.entries(targetShot.elementStates).map(([id, state]) => [id, mannequins.some((element) => element.id === id) ? { ...state, visible: true } : state])),
      });
    }));
    if (repaired) void store.save();
  }, [elements, loaded, origin.kind]);

  useEffect(() => {
    if (!debugOpen) return;
    const timer = window.setInterval(() => setDebugTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [debugOpen]);

  useEffect(() => {
    const path = origin.kind === 'canvas-image' ? origin.referenceImagePaths?.[0] : undefined;
    if (!loaded || !path || elements.length > 0 || imageAnalysisStarted.current) return;
    imageAnalysisStarted.current = true;
    setAnalyzingImage(true);
    void analyzeDirectorImage(path)
      .then(setImageAnalysis)
      .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '图片站位识别失败', type: 'warning' }))
      .finally(() => setAnalyzingImage(false));
  }, [loaded, origin.kind, origin.referenceImagePaths, elements.length]);

  const recognizeStoryboard = useCallback(async (manual = false) => {
    const paths = origin.kind === 'workshop-storyboard' ? (origin.referenceImagePaths ?? []) : [];
    if (paths.length === 0 || analyzingImage) return;
    if (manual) {
      const accepted = await tauriConfirm('重新识别会更新当前方案中各镜头的人物站位、景别和摄影机位置。已经手动调整的镜头站位会被覆盖，动作轨道不会删除。是否继续？', {
        title: '重新识别分镜',
        type: 'warning',
        okLabel: '重新识别',
        cancelLabel: '取消',
      });
      if (!accepted) return;
    }
    imageAnalysisStarted.current = true;
    setAnalyzingImage(true);
    try {
      const expectedCharacterNames = useDirectorStore.getState().elements.filter((element) => element.kind === 'mannequin').map((element) => element.name);
      const analyses = await Promise.all(paths.map(async (path) => {
      try { return await analyzeDirectorImage(path, expectedCharacterNames); } catch { return null; }
      }));
      const valid = analyses.filter(Boolean) as DirectorImageAnalysis[];
      if (valid.length === 0) throw new Error('分镜站位识别失败，已保留基础白模方案，可手动调整');
      const store = useDirectorStore.getState();
      store.checkpoint();
      const current = useDirectorStore.getState();
      const active = activeDirectorPlan(current);
      if (!active) return;
      analyses.forEach((analysis, index) => {
        const targetShot = active.shots[index];
        if (!analysis || !targetShot) return;
        const layout = analysisToShotLayout(analysis, useDirectorStore.getState().elements);
        store.updateShot(targetShot.id, {
          position: layout.camera.position,
          target: layout.camera.target,
          fov: layout.camera.fov,
          rollDeg: layout.camera.rollDeg,
          focalLengthMm: layout.camera.focalLengthMm,
          shotScale: analysis.shotScale,
          primaryElementId: layout.primaryElementId,
          recognition: { ...layout.recognition, sourcePath: paths[index] },
          cameraEnd: { position: { ...layout.camera.position }, target: { ...layout.camera.target }, fov: layout.camera.fov, rollDeg: layout.camera.rollDeg },
          elementStates: layout.elementStates,
        });
      });
      await store.save();
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '分镜白模识别', type: 'warning' });
    } finally {
      setAnalyzingImage(false);
    }
  }, [analyzingImage, origin.kind, origin.referenceImagePaths]);

  useEffect(() => {
    const paths = origin.kind === 'workshop-storyboard' ? (origin.referenceImagePaths ?? []) : [];
    if (!loaded || !characterIdentityReady || loadedFromExisting || paths.length === 0 || imageAnalysisStarted.current) return;
    void recognizeStoryboard(false);
  }, [characterIdentityReady, loaded, loadedFromExisting, origin.kind, origin.referenceImagePaths, recognizeStoryboard]);

  useEffect(() => {
    if (!loaded || !characterIdentityReady || origin.kind !== 'workshop-video-prompt' || motionPositioningStarted.current) return;
    motionPositioningStarted.current = true;
    const path = origin.referenceImagePaths?.find(Boolean);
    if (loadedFromExisting || !path) {
      setMotionPositioningReady(true);
      return;
    }
    setAnalyzingImage(true);
    const expectedCharacterNames = elements.filter((element) => element.kind === 'mannequin').map((element) => element.name);
    void analyzeDirectorImage(path, expectedCharacterNames).then((analysis) => {
      const store = useDirectorStore.getState();
      const layout = analysisToShotLayout(analysis, store.elements);
      const active = activeDirectorPlan(store);
      if (!active) return;
      active.shots.forEach((targetShot, index) => store.updateShot(targetShot.id, index === 0 ? {
        elementStates: layout.elementStates, position: layout.camera.position, target: layout.camera.target, fov: layout.camera.fov,
        rollDeg: layout.camera.rollDeg, focalLengthMm: layout.camera.focalLengthMm, shotScale: analysis.shotScale,
        primaryElementId: layout.primaryElementId, recognition: { ...layout.recognition, sourcePath: path },
        cameraEnd: { position: { ...layout.camera.position }, target: { ...layout.camera.target }, fov: layout.camera.fov, rollDeg: layout.camera.rollDeg },
      } : { elementStates: layout.elementStates }));
    }).catch((error) => console.warn('[director] 动作预演初始站位识别失败，使用默认站位', error))
      .finally(() => { setAnalyzingImage(false); setMotionPositioningReady(true); });
  }, [characterIdentityReady, elements, loaded, loadedFromExisting, origin.kind, origin.referenceImagePaths]);

  useEffect(() => {
    if (!loaded || !characterIdentityReady || !motionPositioningReady || origin.kind !== 'workshop-video-prompt' || !origin.prompt?.trim() || motionDraftStarted.current || !plan) return;
    const elementIds = new Set(elements.map((element) => element.id));
    const hasActions = plan.shots.some((item) => item.actions.some((action) => elementIds.has(action.elementId)));
    const hasMeaningfulActions = plan.shots.some((item) => item.actions.some((action) => elementIds.has(action.elementId) && action.action !== 'stand' && action.action !== 'wait'));
    const promptNeedsActions = promptImpliesCharacterAction(origin.prompt);
    const expectedByShot = inferPromptActionsByShot(origin.prompt, elements, plan.shots.length);
    const expectedCount = expectedByShot.reduce((sum, actions) => sum + actions.length, 0);
    const matchedCount = expectedByShot.reduce((sum, actions, index) => sum + actions.filter((expected) => plan.shots[index]?.actions.some((actual) => {
      const person = elements.find((element) => element.id === actual.elementId);
      return person?.name === expected.elementName && actual.action === expected.action;
    })).length, 0);
    const actionCoverage = expectedCount > 0 ? matchedCount / expectedCount : hasMeaningfulActions ? 1 : 0;
    if ((promptNeedsActions && actionCoverage >= 0.6) || (!promptNeedsActions && hasActions)) return;
    if (!elements.some((element) => element.kind === 'mannequin')) return;
    motionDraftStarted.current = true;
    setGeneratingPlans(true);
    void generateDirectorMotionDraftProposals(origin, plan, elements)
      .then((drafts) => {
        if (drafts.length === 0) throw new Error('没有生成可用动作草案');
        useDirectorStore.getState().replacePlans(drafts);
        setPhase('adjust');
      })
      .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '动作草案生成失败', type: 'warning' }))
      .finally(() => setGeneratingPlans(false));
  }, [characterIdentityReady, elements, loaded, motionPositioningReady, origin, plan]);

  useEffect(() => { engineRef.current?.setSelection(selectedIds); }, [selectedIds]);
  useEffect(() => { engineRef.current?.setTransformMode(transformMode); }, [transformMode]);
  useEffect(() => {
    engineRef.current?.setTransformControlsVisible(transformControlsVisible && phase === 'adjust' && !playing);
  }, [phase, playing, transformControlsVisible]);
  useEffect(() => { cameraEditPointRef.current = cameraEditPoint; }, [cameraEditPoint]);

  useEffect(() => {
    if (!plan || !engineRef.current) return;
    const frame = evaluateDirectorFrame(plan, elements, currentTimeSec);
    if (!frame) return;
    engineRef.current.syncElements(frame.elements);
    engineRef.current.applyCameraPose(frame.camera);
    engineRef.current.setCameraPath((frame.shot.cameraKeyframes?.length
      ? [...frame.shot.cameraKeyframes].sort((a, b) => a.timeSec - b.timeSec)
      : [{ position: frame.shot.position, target: frame.shot.target, fov: frame.shot.fov }, frame.shot.cameraEnd]
    ).map((keyframe) => ({ position: keyframe.position, target: keyframe.target, fov: keyframe.fov, rollDeg: keyframe.rollDeg })));
    engineRef.current.setActionPaths(frame.shot.actions);
    if (frame.shot.id !== activeShotId) useDirectorStore.getState().setActiveShot(frame.shot.id);
  }, [plan, elements, currentTimeSec]);

  useEffect(() => {
    if (!playing || !plan) {
      if (playbackRef.current !== null) cancelAnimationFrame(playbackRef.current);
      playbackRef.current = null;
      return;
    }
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.08, (now - previous) / 1000);
      previous = now;
      const store = useDirectorStore.getState();
      const total = activeDirectorPlan(store) ? planDuration(activeDirectorPlan(store)!) : 0;
      const next = store.currentTimeSec + delta;
      if (next >= total) {
        store.setCurrentTime(0);
        store.setPlaying(false);
        return;
      }
      store.setCurrentTime(next);
      playbackRef.current = requestAnimationFrame(tick);
    };
    playbackRef.current = requestAnimationFrame(tick);
    return () => { if (playbackRef.current !== null) cancelAnimationFrame(playbackRef.current); };
  }, [playing, plan?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const store = useDirectorStore.getState();
      const commandPressed = event.metaKey || event.ctrlKey;
      if (commandPressed && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
      } else if (commandPressed && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
      } else if (commandPressed) {
        return;
      } else if (event.key === '?') {
        event.preventDefault();
        setShortcutPanelOpen((value) => !value);
      } else if (event.code === 'Space') {
        event.preventDefault();
        store.setPlaying(!store.playing);
      } else if (event.key === 'v' || event.key === 'V') store.setTransformMode('translate');
      else if (event.key === 'r' || event.key === 'R') store.setTransformMode('rotate');
      else if (event.key === 's' || event.key === 'S') store.setTransformMode('scale');
      else if ((event.key === 'Backspace' || event.key === 'Delete') && store.selectedIds.length) store.removeElements(store.selectedIds);
      else if (event.key === 'Escape') {
        if (shortcutPanelOpen) setShortcutPanelOpen(false);
        else store.selectedIds.length ? store.setSelected([]) : onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, shortcutPanelOpen]);

  const addActorPreset = (presetId: typeof ACTOR_PRESETS[number]['id']) => {
    const preset = ACTOR_PRESETS.find((item) => item.id === presetId) ?? ACTOR_PRESETS[0];
    const index = elements.filter((item) => item.kind === 'mannequin' || item.kind === 'crowd').length;
    const pose = findPose('stand');
    if (preset.kind === 'crowd') {
      const large = preset.id === 'crowd-5';
      useDirectorStore.getState().addElement({
        id: newElementId(), kind: 'crowd', name: `${preset.label} ${index + 1}`,
        position: { x: index * 1.2 - 0.6, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        color: actorIdentityColor(index), visible: true, groupId: null, rows: large ? 4 : 3, cols: large ? 5 : 3, spacing: 0.9, poseId: 'stand',
      } as CrowdElement);
      setLibraryMenu(null);
      return;
    }
    const animal = preset.kind === 'animal';
    const heightM = preset.id === 'tall-person' ? 1.88 : preset.id === 'child' ? 1.28 : animal ? preset.id === 'small-animal' ? 0.75 : 1.25 : 1.7;
    useDirectorStore.getState().addElement({
      id: newElementId(), kind: 'mannequin', name: `${preset.label} ${index + 1}`,
      position: { x: index * 1.1 - 0.55, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }, color: actorIdentityColor(index), visible: true, groupId: null,
      poseId: 'stand', joints: animal ? {} : pose?.joints ?? {}, heightM, identitySource: 'temporary', bodyType: animal ? 'animal' : 'person', animalSpecies: animal ? preset.id === 'small-animal' ? 'small' : 'quadruped' : undefined,
    } as MannequinElement);
    setLibraryMenu(null);
  };

  const addPropPreset = (presetId: typeof PROP_PRESETS[number]['id']) => {
    const preset = PROP_PRESETS.find((item) => item.id === presetId) ?? PROP_PRESETS[0];
    useDirectorStore.getState().addElement({
      id: newElementId(), kind: preset.kind, name: `${preset.label} ${elements.length + 1}`,
      position: { x: 1.5, y: preset.y, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: preset.scale,
      color: '#aeb3bb', visible: true, groupId: null,
    } as PrimitiveElement);
    setLibraryMenu(null);
  };

  const saveCameraStart = () => {
    if (!shot || !engineRef.current) return;
    const pose = engineRef.current.getCameraPose();
    useDirectorStore.getState().checkpoint();
    const next = { id: `ckf-${nanoid(7)}`, timeSec: 0, position: { ...pose.position }, target: { ...pose.target }, fov: pose.fov, rollDeg: pose.rollDeg ?? 0, interpolation: 'smooth' as const, locked: true, source: 'manual' as const, note: '人工起始机位' };
    const cameraKeyframes = [...(shot.cameraKeyframes ?? []).filter((keyframe) => keyframe.timeSec > 0.04), next].sort((a, b) => a.timeSec - b.timeSec);
    useDirectorStore.getState().updateShot(shot.id, { position: pose.position, target: pose.target, fov: pose.fov, cameraKeyframes });
  };

  const saveCameraEnd = () => {
    if (!shot || !engineRef.current) return;
    const pose = engineRef.current.getCameraPose();
    useDirectorStore.getState().checkpoint();
    const next = { id: `ckf-${nanoid(7)}`, timeSec: shot.durationSec, position: { ...pose.position }, target: { ...pose.target }, fov: pose.fov, rollDeg: pose.rollDeg ?? 0, interpolation: 'smooth' as const, locked: true, source: 'manual' as const, note: '人工结束机位' };
    const cameraKeyframes = [...(shot.cameraKeyframes ?? []).filter((keyframe) => Math.abs(keyframe.timeSec - shot.durationSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec);
    useDirectorStore.getState().updateShot(shot.id, { cameraEnd: pose, cameraKeyframes });
  };

  const addAction = (action: DirectorActionId, requestedElementId?: string) => {
    if (!shot) return;
    const actor = elements.find((element): element is MotionActorElement => element.id === requestedElementId && isMotionActor(element))
      ?? (isMotionActor(selected) ? selected : undefined);
    if (!actor) return;
    const state = shot.elementStates[actor.id];
    const from = state?.position ?? actor.position;
    const template = motionTemplate(action);
    const moving = Boolean(template.moving);
    const durationSec = Math.min(template.defaultDurationSec, shot.durationSec);
    const distance = template.suggestedDistance ?? 2;
    const to = moving ? { x: from.x + distance, y: from.y, z: from.z } : { ...from };
    useDirectorStore.getState().addAction(shot.id, {
      elementId: actor.id,
      action,
      startSec: 0,
      durationSec,
      from: { ...from },
      to,
      templateId: action,
      source: 'template',
      intensity: 1,
      keyframes: createMotionKeyframes(action, durationSec, from, to),
    });
    useDirectorStore.getState().setSelected([actor.id]);
    setPropertyOpen(true);
    setRightDockOpen(true);
    setRightDockView('inspect');
    setActionMenu(false);
    setActionQuickBarOpen(false);
  };

  const editSelectedAction = () => {
    if (!shot || !isMotionActor(selected)) return;
    const actions = shot.actions.filter((action) => action.elementId === selected.id);
    if (!actions.length) {
      setActionMenu(true);
      return;
    }
    const store = useDirectorStore.getState();
    const localTime = store.currentTimeSec - shot.startSec;
    const action = actions.find((item) => localTime >= item.startSec && localTime <= item.startSec + item.durationSec) ?? actions[0];
    const frames = [...(action.keyframes ?? [])].sort((left, right) => left.timeSec - right.timeSec);
    const relativeTime = Math.max(0, Math.min(action.durationSec, localTime - action.startSec));
    const focus = frames.reduce<DirectorMotionKeyframe | undefined>((best, frame) => {
      if (!best) return frame;
      return Math.abs(frame.timeSec - relativeTime) < Math.abs(best.timeSec - relativeTime) ? frame : best;
    }, undefined) ?? frames[Math.floor(frames.length / 2)];
    store.setPlaying(false);
    store.setSelected([selected.id]);
    store.setTransformMode('translate');
    store.setCurrentTime(shot.startSec + action.startSec + (focus?.timeSec ?? action.durationSec / 2));
    setPhase('adjust');
    setTransformControlsVisible(true);
    setPropertyOpen(true);
    setRightDockOpen(true);
    setRightDockView('inspect');
    setActionQuickBarOpen(false);
  };

  const startAiActionDirection = () => {
    const actorName = isMotionActor(selected) ? selected.name : '演员';
    setPhase('design');
    setRightDockOpen(false);
    openDirectorAssistant(`请先读取当前导演台状态，再帮我编排「${actorName}」的动作。我希望：`);
    setActionQuickBarOpen(false);
  };

  const generateSchemes = async (guidance = schemePrompt) => {
    if (generatingPlans) return;
    setGeneratingPlans(true);
    try {
      const store = useDirectorStore.getState();
      const base = activeDirectorPlan(store);
      if (!base) return;
      setProposals(origin.kind === 'workshop-video-prompt'
        ? await generateDirectorMotionDraftProposals(origin, base, elements, guidance)
        : await generateDirectorPlanProposals(origin, base, elements, guidance));
    } finally {
      setGeneratingPlans(false);
    }
  };

  const repairWhiteModels = useCallback(() => {
    const store = useDirectorStore.getState();
    let mannequins = store.elements.filter((element) => element.kind === 'mannequin');
    if (mannequins.length === 0) {
      const sourceShot = workshopData?.shots.find((item) => item.shotNo === origin.shotNo);
      const expected = sourceShot
        ? (sourceShot.characterIds ?? []).map((id) => workshopData?.characters.find((character) => character.id === id)).filter(Boolean).map((character, index) => mannequinFor(character!, index))
        : workshopMode ? [] : [fallbackActionMannequin()];
      store.reconcileMannequins(expected);
      mannequins = useDirectorStore.getState().elements.filter((element) => element.kind === 'mannequin');
    }
    const current = useDirectorStore.getState();
    current.plans.forEach((item) => item.shots.forEach((targetShot) => {
      const elementStates = { ...targetShot.elementStates };
      mannequins.forEach((element) => {
        const state = elementStates[element.id];
        elementStates[element.id] = state
          ? { ...state, visible: true }
          : { position: { ...element.position }, rotationDeg: { ...element.rotationDeg }, scale: { ...element.scale }, visible: true };
      });
      store.updateShot(targetShot.id, { elementStates });
    }));
    engineRef.current?.syncElements(useDirectorStore.getState().elements);
    void store.save();
    setDebugTick((value) => value + 1);
  }, [origin.shotNo, workshopData, workshopMode]);

  const applyDirectorCommands = useCallback((commands: DirectorAgentCommand[], userRequest: string): string[] => {
    const results: string[] = [];
    const destructiveAllowed = /删除|删掉|移除|清空|delete|remove/i.test(userRequest);
    const overrideAllowed = /覆盖|解锁|强制修改|重新制作|override|unlock/i.test(userRequest);
    const safeNumber = (value: unknown, fallback: number, min: number, max: number) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; };
    const safeVec3 = (value: Partial<Vec3> | undefined, fallback: Vec3, bounds: { x: [number, number]; y: [number, number]; z: [number, number] }): Vec3 => ({
      x: safeNumber(value?.x, fallback.x, bounds.x[0], bounds.x[1]),
      y: safeNumber(value?.y, fallback.y, bounds.y[0], bounds.y[1]),
      z: safeNumber(value?.z, fallback.z, bounds.z[0], bounds.z[1]),
    });
    for (const command of commands) {
      const store = useDirectorStore.getState();
      const resolveShot = (id?: string) => store.plans.flatMap((item) => item.shots).find((item) => item.id === id) ?? activeDirectorShot(store);
      const resolvePerson = (id?: string, name?: string) => store.elements.find((element) => isMotionActor(element) && (element.id === id || Boolean(name && (element.name === name || element.name.includes(name)))));
      if (command.type === 'repair_visibility') { repairWhiteModels(); results.push('已修复人物身份与可见性'); }
      else if (command.type === 'focus_people') {
        const ids = store.elements.filter(isMotionActor).map((element) => element.id);
        const focus = engineRef.current?.getFocusPoint(ids) ?? { x: 0, y: 0.85, z: 0 };
        engineRef.current?.applyPresetPose(-8, 25, 5.5, 45, focus); results.push('观察视角已聚焦人物');
      } else if (command.type === 'select_person') {
        const person = resolvePerson(undefined, command.name);
        if (person) { store.setSelected([person.id]); results.push(`已选择${person.name}`); } else results.push(`未找到人物「${command.name}」`);
      } else if (command.type === 'set_camera_move' && CAMERA_MOVES.some((item) => item.id === command.move)) {
        const target = resolveShot(command.shotId); if (target) { const generated = cameraPatchFromTemplate(target, command.move); const locked = target.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? []; store.updateShot(target.id, { ...generated, cameraKeyframes: [...(generated.cameraKeyframes ?? []).filter((candidate) => !locked.some((keyframe) => Math.abs(keyframe.timeSec - candidate.timeSec) < 0.04)), ...locked].sort((a, b) => a.timeSec - b.timeSec) }); results.push(`已为「${target.name}」应用${cameraTemplate(command.move).label}并生成摄影机关键帧`); }
      } else if (command.type === 'apply_camera_template' && CAMERA_MOVES.some((item) => item.id === command.templateId)) {
        const target = resolveShot(command.shotId); if (target) { const generated = cameraPatchFromTemplate(target, command.templateId); const locked = target.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? []; store.checkpoint(); store.updateShot(target.id, { ...generated, cameraKeyframes: [...(generated.cameraKeyframes ?? []).filter((candidate) => !locked.some((keyframe) => Math.abs(keyframe.timeSec - candidate.timeSec) < 0.04)), ...locked].sort((a, b) => a.timeSec - b.timeSec) }); results.push(`已应用运镜模板「${cameraTemplate(command.templateId).label}」，人工锁定机位已保留`); }
      } else if (command.type === 'set_active_plan') {
        if (store.plans.some((item) => item.id === command.planId)) { store.setActivePlan(command.planId); results.push('已切换方案'); }
      } else if (command.type === 'rename_plan') {
        if (command.name?.trim() && store.plans.some((item) => item.id === command.planId)) { store.updatePlan(command.planId, { name: command.name.trim() }); results.push('已重命名方案'); }
      } else if (command.type === 'add_plan') { store.addPlan({ name: command.name?.trim() || '新导演方案' }); results.push('已新增导演方案'); }
      else if (command.type === 'duplicate_plan') { if (store.duplicatePlan(command.planId)) results.push('已复制导演方案'); }
      else if (command.type === 'delete_plan') { if (!destructiveAllowed) results.push('删除方案需要明确提出，未执行'); else { const before = store.plans.length; store.removePlan(command.planId); results.push(before > 1 ? '已删除导演方案' : '至少保留一个方案，未删除'); } }
      else if (command.type === 'set_active_shot') {
        const owner = store.plans.find((item) => item.shots.some((entry) => entry.id === command.shotId));
        if (owner) { if (owner.id !== store.activePlanId) store.setActivePlan(owner.id); useDirectorStore.getState().setActiveShot(command.shotId); results.push('已切换镜头'); }
      } else if (command.type === 'add_shot') { store.addShot({ name: command.name?.trim() || undefined, durationSec: Math.max(0.5, Math.min(60, Number(command.durationSec) || 3.75)) }); results.push('已新增镜头'); }
      else if (command.type === 'delete_shot') {
        if (!destructiveAllowed) { results.push('删除镜头需要明确提出，未执行'); continue; }
        const owner = store.plans.find((item) => item.shots.some((entry) => entry.id === command.shotId));
        if (owner) { if (owner.id !== store.activePlanId) store.setActivePlan(owner.id); const before = owner.shots.length; useDirectorStore.getState().removeShot(command.shotId); results.push(before > 1 ? '已删除镜头' : '至少保留一个镜头，未删除'); }
      } else if (command.type === 'reorder_shot') {
        const owner = store.plans.find((item) => item.shots.some((entry) => entry.id === command.shotId));
        if (owner) { if (owner.id !== store.activePlanId) store.setActivePlan(owner.id); useDirectorStore.getState().reorderShot(command.shotId, Math.round(safeNumber(command.targetIndex, 0, 0, owner.shots.length - 1))); results.push('已调整镜头顺序'); }
      } else if (command.type === 'update_shot') {
        const target = resolveShot(command.shotId);
        if (target) {
          let patch: Partial<DirectorSequenceShot> = {};
          if (command.name?.trim()) patch.name = command.name.trim();
          if (Number.isFinite(command.durationSec)) patch.durationSec = Math.max(0.5, Math.min(60, Number(command.durationSec)));
          if (command.cameraMove && CAMERA_MOVES.some((item) => item.id === command.cameraMove)) {
            const generated = cameraPatchFromTemplate({ ...target, ...patch }, command.cameraMove);
            const locked = target.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? [];
            patch = {
              ...patch,
              ...generated,
              cameraKeyframes: [
                ...(generated.cameraKeyframes ?? []).filter((candidate) => !locked.some((keyframe) => Math.abs(keyframe.timeSec - candidate.timeSec) < 0.04)),
                ...locked,
              ].sort((a, b) => a.timeSec - b.timeSec),
            };
          }
          store.updateShot(target.id, patch);
          results.push(`已更新「${target.name}」并保留人工锁定数据`);
        }
      } else if (command.type === 'add_action' || command.type === 'apply_motion_template') {
        const target = resolveShot(command.shotId); const person = resolvePerson(command.personId, command.personName);
        const actionId = command.type === 'apply_motion_template' ? command.templateId : command.action;
        if (target && person && ACTIONS.some((item) => item.id === actionId)) {
          const state = target.elementStates[person.id];
          const from = state?.position ?? person.position;
          const template = motionTemplate(actionId);
          const existingEnd = target.actions.filter((action) => action.elementId === person.id).reduce((max, action) => Math.max(max, action.startSec + action.durationSec), 0);
          const requestedStart = command.startSec === undefined ? existingEnd : safeNumber(command.startSec, 0, 0, target.durationSec);
          if (requestedStart >= target.durationSec - 0.19) {
            results.push(`未添加「${template.label}」：${person.name}的镜头时间已排满，请先延长镜头或调整动作`);
            continue;
          }
          const startSec = Math.max(0, Math.min(target.durationSec - 0.2, requestedStart));
          const durationSec = Math.max(0.2, Math.min(target.durationSec - startSec, safeNumber(command.durationSec, template.defaultDurationSec, 0.2, 60)));
          const fallbackDistance = template.moving ? template.suggestedDistance ?? 1.5 : 0;
          const to = {
            x: from.x + safeNumber(command.moveX, fallbackDistance, -20, 20),
            y: from.y,
            z: from.z + safeNumber(command.moveZ, 0, -20, 20),
          };
          store.addAction(target.id, { elementId: person.id, action: actionId, startSec, durationSec, from: { ...from }, to, templateId: actionId, intensity: 1, locked: command.type === 'apply_motion_template' ? command.locked : false, source: 'agent', keyframes: createMotionKeyframes(actionId, durationSec, from, to, 'agent') });
          results.push(`已为${person.name}应用动作模板「${template.label}」，写入 5 个关键帧`);
        } else results.push('添加动作失败：镜头、人物或动作无效');
      } else if (command.type === 'update_action') {
        const target = resolveShot(command.shotId); const action = target?.actions.find((item) => item.id === command.actionId);
        if (target && action) { if (action.locked && !overrideAllowed) { results.push(`「${motionTemplate(action.action).label}」已被人工锁定，未覆盖`); } else { const startSec = command.startSec === undefined ? action.startSec : Math.max(0, Number(command.startSec)); const durationSec = Math.min(command.durationSec === undefined ? action.durationSec : Math.max(0.2, Number(command.durationSec)), target.durationSec - Math.min(startSec, target.durationSec - 0.2)); const safeStart = Math.min(startSec, target.durationSec - 0.2); const to = { x: action.from.x + (command.moveX === undefined ? action.to.x - action.from.x : Number(command.moveX)), y: action.to.y, z: action.from.z + (command.moveZ === undefined ? action.to.z - action.from.z : Number(command.moveZ)) }; const lockedFrames = (action.keyframes ?? []).filter((frame) => frame.locked); const generated = createMotionKeyframes(action.action, durationSec, action.from, to, 'agent').filter((frame) => !lockedFrames.some((locked) => Math.abs(locked.timeSec - frame.timeSec) < 0.04)); store.updateAction(target.id, action.id, { startSec: safeStart, durationSec, to, keyframes: [...generated, ...lockedFrames].sort((a, b) => a.timeSec - b.timeSec), source: 'agent' }); results.push('已更新动作并保留人工关键帧'); } }
      } else if (command.type === 'lock_action') {
        const target = resolveShot(command.shotId); const action = target?.actions.find((item) => item.id === command.actionId); if (target && action) { store.updateAction(target.id, action.id, { locked: command.locked, source: command.locked ? 'manual' : action.source }); results.push(command.locked ? '已锁定动作' : '已解锁动作'); }
      } else if (command.type === 'set_action_keyframe') {
        const target = resolveShot(command.shotId); const action = target?.actions.find((item) => item.id === command.actionId);
        if (target && action) { const timeSec = Math.max(0, Math.min(action.durationSec, Number(command.timeSec) || 0)); const pose = command.poseId ? findPose(command.poseId) : undefined; const currentPlan = activeDirectorPlan(store) ?? plan; const currentFrame = currentPlan ? evaluateDirectorFrame(currentPlan, store.elements, target.startSec + action.startSec + timeSec)?.elements.find((item) => item.id === action.elementId) : undefined; const fallbackPosition = currentFrame?.position ?? action.from; const fallbackRotation = currentFrame?.rotationDeg ?? { x: 0, y: 0, z: 0 }; const next = { id: `kf-${nanoid(7)}`, timeSec, position: safeVec3(command.position, fallbackPosition, { x: [-50, 50], y: [-5, 20], z: [-50, 50] }), rotationDeg: safeVec3(command.rotationDeg, fallbackRotation, { x: [-360, 360], y: [-360, 360], z: [-360, 360] }), joints: currentFrame?.kind === 'mannequin' ? pose?.joints ?? currentFrame.joints : undefined, interpolation: command.interpolation ?? 'smooth', source: 'agent' as const, note: currentFrame?.kind === 'mannequin' && pose ? pose.label : 'Agent K帧' }; const lockedAtTime = action.keyframes?.find((frame) => frame.locked && Math.abs(frame.timeSec - timeSec) < 0.04); if (lockedAtTime && !overrideAllowed) results.push('该时间点已有人工锁定关键帧，未覆盖'); else { const frames = [...(action.keyframes ?? []).filter((frame) => Math.abs(frame.timeSec - timeSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec); store.updateAction(target.id, action.id, { keyframes: frames, source: 'agent' }); results.push(`已在 ${timeSec.toFixed(2)} 秒写入动作关键帧`); } }
      } else if (command.type === 'delete_action_keyframe') {
        if (!destructiveAllowed) results.push('删除关键帧需要明确提出，未执行'); else { const target = resolveShot(command.shotId); const action = target?.actions.find((item) => item.id === command.actionId); const keyframe = action?.keyframes?.find((item) => item.id === command.keyframeId); if (target && action && keyframe && (!keyframe.locked || overrideAllowed)) { store.updateAction(target.id, action.id, { keyframes: action.keyframes?.filter((item) => item.id !== keyframe.id) }); results.push('已删除人物关键帧'); } else if (keyframe?.locked) results.push('关键帧已锁定，未删除'); }
      } else if (command.type === 'delete_action') { if (!destructiveAllowed) results.push('删除动作需要明确提出，未执行'); else { const target = resolveShot(command.shotId); if (target?.actions.some((item) => item.id === command.actionId)) { store.removeAction(target.id, command.actionId); results.push('已删除动作'); } } }
      else if (command.type === 'move_person' || command.type === 'rotate_person' || command.type === 'set_visibility') {
        const target = resolveShot(command.shotId); const person = resolvePerson(command.personId, command.personName);
        if (target && person) { const current = target.elementStates[person.id] ?? { position: person.position, rotationDeg: person.rotationDeg, scale: person.scale, visible: person.visible }; if (command.type === 'move_person') store.updateShotElementState(target.id, person.id, { position: { x: safeNumber(command.x, current.position.x, -50, 50), y: safeNumber(command.y, current.position.y, -5, 20), z: safeNumber(command.z, current.position.z, -50, 50) } }); else if (command.type === 'rotate_person') store.updateShotElementState(target.id, person.id, { rotationDeg: { ...current.rotationDeg, y: safeNumber(command.yawDeg, current.rotationDeg.y, -360, 360) } }); else store.updateShotElementState(target.id, person.id, { visible: command.visible === true }); results.push(`已调整${person.name}`); }
      } else if (command.type === 'select_element') {
        if (store.elements.some((element) => element.id === command.elementId)) { store.setSelected([command.elementId]); results.push('已选择场景元素'); }
      } else if (command.type === 'rename_element') {
        const element = store.elements.find((item) => item.id === command.elementId); if (element && command.name?.trim()) { store.updateElement(element.id, { name: command.name.trim() }); results.push(`已重命名${element.name}`); }
      } else if (command.type === 'move_element' || command.type === 'rotate_element' || command.type === 'set_element_visibility') {
        const element = store.elements.find((item) => item.id === command.elementId); const target = resolveShot(command.shotId);
        if (element && target) { const current = target.elementStates[element.id] ?? { position: element.position, rotationDeg: element.rotationDeg, scale: element.scale, visible: element.visible }; if (command.type === 'move_element') store.updateShotElementState(target.id, element.id, { position: { x: safeNumber(command.x, current.position.x, -50, 50), y: safeNumber(command.y, current.position.y, -5, 20), z: safeNumber(command.z, current.position.z, -50, 50) } }); else if (command.type === 'rotate_element') store.updateShotElementState(target.id, element.id, { rotationDeg: { ...current.rotationDeg, y: safeNumber(command.yawDeg, current.rotationDeg.y, -360, 360) } }); else store.updateShotElementState(target.id, element.id, { visible: command.visible === true }); results.push(`已调整${element.name}`); }
      } else if (command.type === 'add_proxy') {
        const kind = command.kind === 'wall' || command.kind === 'cylinder' ? command.kind : 'box'; const index = store.elements.length + 1;
        store.addElement({ id: newElementId(), kind, name: command.name?.trim() || `代理物 ${index}`, position: { x: safeNumber(command.x, 1.5, -50, 50), y: safeNumber(command.y, kind === 'wall' ? 1.2 : 0.5, -5, 20), z: safeNumber(command.z, 0, -50, 50) }, rotationDeg: { x: 0, y: 0, z: 0 }, scale: kind === 'wall' ? { x: 2.5, y: 2, z: 0.15 } : { x: 1, y: 1, z: 1 }, color: '#aeb3bb', visible: true, groupId: null } as PrimitiveElement); results.push('已新增代理物');
      } else if (command.type === 'duplicate_element') {
        if (store.elements.some((element) => element.id === command.elementId)) { store.duplicateElements([command.elementId]); results.push('已复制场景元素'); }
      } else if (command.type === 'delete_element') {
        if (!destructiveAllowed) results.push('删除场景元素需要明确提出，未执行'); else if (store.elements.some((element) => element.id === command.elementId)) { store.removeElements([command.elementId]); results.push('已删除场景元素'); }
      } else if (command.type === 'set_camera') { const target = resolveShot(command.shotId); if (target && command.position && command.target) { const position = { x: safeNumber(command.position.x, target.position.x, -100, 100), y: safeNumber(command.position.y, target.position.y, 0.1, 100), z: safeNumber(command.position.z, target.position.z, -100, 100) }; const lookTarget = { x: safeNumber(command.target.x, target.target.x, -100, 100), y: safeNumber(command.target.y, target.target.y, -20, 100), z: safeNumber(command.target.z, target.target.z, -100, 100) }; const fov = safeNumber(command.fov, target.fov, 10, 100); store.updateShot(target.id, { position, target: lookTarget, fov, cameraEnd: { ...target.cameraEnd, position: { ...position }, target: { ...lookTarget }, fov } }); results.push('已更新摄影机'); } }
      else if (command.type === 'set_camera_keyframe') { const target = resolveShot(command.shotId); if (target) { const timeSec = Math.max(0, Math.min(target.durationSec, Number(command.timeSec) || 0)); const existing = target.cameraKeyframes?.find((frame) => frame.locked && Math.abs(frame.timeSec - timeSec) < 0.04); if (existing && !overrideAllowed) results.push('该时间点已有人工锁定摄影机关键帧，未覆盖'); else { const next = { id: `ckf-${nanoid(7)}`, timeSec, position: safeVec3(command.position, target.position, { x: [-100, 100], y: [0.1, 100], z: [-100, 100] }), target: safeVec3(command.target, target.target, { x: [-100, 100], y: [-20, 100], z: [-100, 100] }), fov: safeNumber(command.fov, target.fov, 10, 100), rollDeg: safeNumber(command.rollDeg, target.rollDeg ?? 0, -90, 90), interpolation: command.interpolation ?? 'smooth', source: 'agent' as const }; store.updateShot(target.id, { cameraKeyframes: [...(target.cameraKeyframes ?? []).filter((frame) => Math.abs(frame.timeSec - timeSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec) }); results.push(`已在 ${timeSec.toFixed(2)} 秒写入摄影机关键帧`); } } }
      else if (command.type === 'delete_camera_keyframe') { if (!destructiveAllowed) results.push('删除摄影机关键帧需要明确提出，未执行'); else { const target = resolveShot(command.shotId); const keyframe = target?.cameraKeyframes?.find((item) => item.id === command.keyframeId); if (target && keyframe && (!keyframe.locked || overrideAllowed)) { store.updateShot(target.id, { cameraKeyframes: target.cameraKeyframes?.filter((item) => item.id !== keyframe.id) }); results.push('已删除摄影机关键帧'); } else if (keyframe?.locked) results.push('摄影机关键帧已锁定，未删除'); } }
      else if (command.type === 'inspect_frame') { const currentPlan = activeDirectorPlan(store) ?? plan; if (currentPlan) { const at = Math.max(0, Math.min(planDuration(currentPlan), Number(command.timeSec) || store.currentTimeSec)); const frame = evaluateDirectorFrame(currentPlan, store.elements, at); if (frame) { const visible = frame.elements.filter((item) => item.visible).map((item) => `${item.name}@(${item.position.x.toFixed(1)},${item.position.z.toFixed(1)})`).join('、'); results.push(`检查 ${at.toFixed(2)}s：${frame.shot.name}，可见对象 ${visible || '无'}，摄影机 FOV ${frame.camera.fov.toFixed(1)}`); } } }
      else if (command.type === 'play') { store.setPlaying(true); results.push('开始播放'); }
      else if (command.type === 'pause') { store.setPlaying(false); results.push('已暂停'); }
      else if (command.type === 'seek') { const currentPlan = activeDirectorPlan(store) ?? plan; if (currentPlan) { store.setCurrentTime(Math.max(0, Math.min(planDuration(currentPlan), Number(command.timeSec) || 0))); results.push('已定位时间轴'); } }
      else if (command.type === 'save') { void store.save(); results.push('已保存导演工程'); }
      else if (command.type === 'undo') { store.undo(); results.push('已撤销'); }
      else if (command.type === 'redo') { store.redo(); results.push('已重做'); }
      else if (command.type === 'switch_workshop_shot') {
        const exists = workshopData?.shots.some((item) => item.shotNo === command.shotNo);
        if (exists) { void switchWorkshopShot(`${command.mode}::${command.shotNo}`); results.push(`正在切换到 ${command.shotNo}`); } else results.push(`项目中没有分镜 ${command.shotNo}`);
      }
    }
    if (commands.length > 0) {
      const verifiedStore = useDirectorStore.getState();
      const verifiedPlan = activeDirectorPlan(verifiedStore);
      if (verifiedPlan) {
        const verifiedFrame = evaluateDirectorFrame(verifiedPlan, verifiedStore.elements, verifiedStore.currentTimeSec);
        const verifiedIssues = inspectDirectorPlan(verifiedPlan, verifiedStore.elements);
        const visibleCount = verifiedFrame?.elements.filter((element) => element.visible).length ?? 0;
        results.push(`复核完成：当前帧 ${visibleCount} 个可见对象，${verifiedIssues.length} 项检查，关键帧数据已重新读取`);
      }
    }
    return results;
  }, [plan, repairWhiteModels, switchWorkshopShot, workshopData?.shots]);

  const sendDirectorChat = async () => {
    const content = directorChatInput.trim();
    if (!content || directorChatLoading || generatingPlans || !plan) return;
    const next = [...directorChat, { role: 'user', content } as DirectorConsultMessage];
    setDirectorChat(next);
    setDirectorChatInput('');
    setDirectorChatReady(false);
    setDirectorChatLoading(true);
    try {
      const projectIndex = workshopData?.shots.map((item) => ({ shotNo: item.shotNo, characters: item.characterIds, description: item.description.slice(0, 80) })) ?? [];
      const reply = await consultDirectorPlan(origin, plan, elements, next, `${directorSceneContext(plan, shot, elements, engineRef.current?.diagnostics() ?? null)}\n项目分镜索引：${JSON.stringify(projectIndex)}`);
      const commandResults = applyDirectorCommands(reply.commands, content);
      setDirectorChat((current) => [...current, { role: 'assistant', content: reply.content }, ...(commandResults.length ? [{ role: 'assistant' as const, content: `已执行：${commandResults.join('；')}` }] : [])]);
      setDirectorChatReady(reply.ready);
    } catch (error) {
      setDirectorChat((current) => [...current, { role: 'assistant', content: `刚才没有听清。请再说一次你最在意的人物动作或镜头感觉。${error instanceof Error ? `（${error.message}）` : ''}` }]);
    } finally {
      setDirectorChatLoading(false);
    }
  };

  const confirmDirectorChat = () => {
    const guidance = directorChat.filter((message) => message.role === 'user').map((message) => message.content).join('；');
    setSchemePrompt(guidance);
    void generateSchemes(guidance);
  };

  // Keep the legacy command adapter available while old persisted director
  // conversations are migrated to the shared Agent drawer.
  void sendDirectorChat;
  void confirmDirectorChat;

  const updateExportIn = useCallback((value: number) => {
    setExportInSec(Math.max(0, Math.min(snapDirectorFrame(value), exportOutSec - DIRECTOR_FRAME_SEC)));
  }, [exportOutSec]);

  const updateExportOut = useCallback((value: number) => {
    setExportOutSec(Math.min(duration, Math.max(snapDirectorFrame(value), exportInSec + DIRECTOR_FRAME_SEC)));
  }, [duration, exportInSec]);

  const stepPlayhead = useCallback((frames: number) => {
    const nextFrame = Math.max(0, Math.min(Math.max(0, Math.floor(duration * DIRECTOR_FPS) - 1), Math.round(currentTimeSec * DIRECTOR_FPS) + frames));
    useDirectorStore.getState().setPlaying(false);
    useDirectorStore.getState().setCurrentTime(nextFrame / DIRECTOR_FPS);
  }, [currentTimeSec, duration]);

  const chooseExportOutputPath = useCallback(async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(new RegExp('[-:' + 'T]', 'g'), '');
    const defaultName = `director_previs_${stamp}.mp4`;
    const workspace = await invoke<string>('ensure_workspace').catch(() => '');
    const selected = await tauriSave({ defaultPath: exportOutputPath || (workspace ? `${workspace}/videos/${defaultName}` : defaultName), filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] }).catch(() => null);
    if (selected) {
      setExportOutputPath(selected.toLowerCase().endsWith('.mp4') ? selected : `${selected}.mp4`);
      setLastExportPath('');
    }
  }, [exportOutputPath]);

  const revealExportInFinder = useCallback(async () => {
    if (lastExportPath) {
      await invoke('open_path', { path: lastExportPath, reveal: true }).catch(() => {});
      return;
    }
    if (exportOutputPath) {
      const parent = exportOutputPath.split('/').slice(0, -1).join('/');
      if (parent) await invoke('open_path', { path: parent, reveal: false }).catch(() => {});
      return;
    }
    const workspace = await invoke<string>('ensure_workspace').catch(() => '');
    if (workspace) await invoke('open_path', { path: `${workspace}/videos`, reveal: false }).catch(() => {});
  }, [exportOutputPath, lastExportPath]);

  useEffect(() => {
    setDirectorRuntimeSnapshot({
      fps: DIRECTOR_FPS,
      currentTimeSec,
      exportInSec,
      exportOutSec,
      outputPath: exportOutputPath,
      lastExportPath,
      exporting,
    });
    return () => setDirectorRuntimeSnapshot(null);
  }, [currentTimeSec, exportInSec, exportOutSec, exportOutputPath, lastExportPath, exporting]);

  useEffect(() => {
    const handleRuntimeCommand = (event: Event) => {
      const command = (event as CustomEvent<DirectorRuntimeCommand>).detail;
      if (!command) return;
      if (command.type === 'set-export-range') {
        const nextIn = Math.max(0, Math.min(snapDirectorFrame(command.inSec), Math.max(0, duration - DIRECTOR_FRAME_SEC)));
        const nextOut = Math.min(duration, Math.max(snapDirectorFrame(command.outSec), nextIn + DIRECTOR_FRAME_SEC));
        setExportInSec(nextIn);
        setExportOutSec(nextOut);
        setPhase('export');
        setRightDockView('export');
        setRightDockOpen(true);
      } else if (command.type === 'set-output-path') {
        const path = command.path.trim();
        setExportOutputPath(path && !path.toLowerCase().endsWith('.mp4') ? `${path}.mp4` : path);
        setLastExportPath('');
      } else if (command.type === 'open-panel') {
        setRightDockView(command.panel);
        setPhase(command.panel === 'export' ? 'export' : 'adjust');
        setRightDockOpen(true);
      } else if (command.type === 'switch-workshop-shot') {
        void switchWorkshopShot(`${command.mode}::${command.shotNo}`);
      } else if (command.type === 'recognize-storyboard') {
        void recognizeStoryboard(true);
      } else if (command.type === 'repair-scene') {
        repairWhiteModels();
      }
    };
    window.addEventListener(DIRECTOR_RUNTIME_COMMAND_EVENT, handleRuntimeCommand);
    return () => window.removeEventListener(DIRECTOR_RUNTIME_COMMAND_EVENT, handleRuntimeCommand);
  }, [duration, recognizeStoryboard, repairWhiteModels, switchWorkshopShot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        stepPlayhead(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        updateExportIn(currentTimeSec);
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault();
        updateExportOut(currentTimeSec);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTimeSec, stepPlayhead, updateExportIn, updateExportOut]);

  const captureStill = useCallback(async (type: 'still' | 'top-view' | 'path-map' | 'transparent' = 'still') => {
    if (!engineRef.current || !plan || !shot) return;
    setExporting(true);
    setExportStatus('正在保存当前帧');
    try {
      const frameTime = Math.min(Math.max(0, duration - DIRECTOR_FRAME_SEC), snapDirectorFrame(currentTimeSec));
      const frame = evaluateDirectorFrame(plan, elements, frameTime);
      if (!frame) throw new Error('当前播放头没有可导出的画面');
      useDirectorStore.getState().setCurrentTime(frameTime);
      engineRef.current.syncElements(frame.elements);
      engineRef.current.applyCameraPose(frame.camera);
      const { exportDirectorStill } = await import('@/lib/director/export');
      const path = await exportDirectorStill(engineRef.current, frame.shot, origin, type);
      await tauriMessage(`${fmtTimecode(frameTime)} · 第 ${Math.round(frameTime * DIRECTOR_FPS)} 帧\n${path}`, { title: '当前帧已导出' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '导出失败', type: 'error' });
    } finally {
      setExporting(false);
      setExportStatus('');
    }
  }, [shot, origin, plan, elements, currentTimeSec, duration]);

  const onDirectorExportProgress = useCallback((progress: { label: string; detail?: string; percent: number }) => {
    setExportProgress(progress.percent);
    setExportStatus(progress.detail ? `${progress.label} · ${progress.detail}` : progress.label);
  }, []);

  const exportVideo = useCallback(async () => {
    if (!engineRef.current || !plan) return;
    setExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const { exportDirectorVideo } = await import('@/lib/director/export');
      const path = await exportDirectorVideo(engineRef.current, plan, elements, origin, { onProgress: onDirectorExportProgress, signal: controller.signal, startSec: exportInSec, endSec: exportOutSec, outputPath: exportOutputPath || undefined });
      setLastExportPath(path);
      await tauriMessage(`${fmtTimecode(exportInSec)} - ${fmtTimecode(exportOutSec)}\n1080p / 24fps / H.264\n${path}`, { title: '预演视频已导出' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '导出失败', type: 'error' });
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportStatus('');
      setExportProgress(0);
    }
  }, [plan, elements, origin, onDirectorExportProgress, exportInSec, exportOutSec, exportOutputPath]);

  const renderFinalImages = useCallback(async (options: { engineId: 'gpt-image-2' | 'seedream-v5-pro'; resolution: '1k' | '2k' | '4k'; scope: 'current' | 'all'; writeBack: boolean; placeOnCanvas: boolean }) => {
    if (!engineRef.current || !plan || !shot) return;
    setGenerationDialog(null);
    setExporting(true);
    try {
      const { renderDirectorFinalImage } = await import('@/lib/director/finalRender');
      const targets = options.scope === 'all' ? plan.shots : [shot];
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        setExportStatus(`正式渲染 ${index + 1}/${targets.length}`);
        const frame = evaluateDirectorFrame(plan, elements, target.startSec);
        if (frame) {
          engineRef.current.syncElements(frame.elements);
          engineRef.current.applyCameraPose(frame.camera);
        }
        await renderDirectorFinalImage(engineRef.current, target, origin, options);
      }
      await tauriMessage(`已完成 ${targets.length} 张正式分镜`, { title: '正式渲染完成' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '正式渲染失败', type: 'error' });
    } finally {
      setExporting(false);
      setExportStatus('');
    }
  }, [plan, shot, elements, origin]);

  const renderSeedance = useCallback(async (options: { writeBack: boolean; placeOnCanvas: boolean }) => {
    if (!engineRef.current || !plan) return;
    setGenerationDialog(null);
    setExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const { exportDirectorVideo } = await import('@/lib/director/export');
      const { generateDirectorSeedanceVideo } = await import('@/lib/director/finalRender');
      setExportStatus('准备白模参考视频');
      const previsPath = await exportDirectorVideo(engineRef.current, plan, elements, origin, { onProgress: onDirectorExportProgress, signal: controller.signal, startSec: exportInSec, endSec: exportOutSec });
      setExportStatus('已确认，正在提交 Seedance');
      const path = await generateDirectorSeedanceVideo(previsPath, origin, options.writeBack, options.placeOnCanvas);
      await tauriMessage(`Seedance 已生成\n${path}`, { title: '视频生成完成' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: 'Seedance 生成失败', type: 'error' });
    } finally {
      exportAbortRef.current = null;
      setExporting(false);
      setExportStatus('');
      setExportProgress(0);
    }
  }, [plan, elements, origin, onDirectorExportProgress, exportInSec, exportOutSec]);

  const exportWhiteReferences = useCallback(async (options: { scope: 'current' | 'all'; writeBack: boolean; placeOnCanvas: boolean }) => {
    if (!engineRef.current || !plan || !shot) return;
    setGenerationDialog(null);
    setExporting(true);
    try {
      const { exportDirectorStill } = await import('@/lib/director/export');
      const { writeBackDirectorStill } = await import('@/lib/director/finalRender');
      const targets = options.scope === 'all' ? plan.shots : [shot];
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        setExportStatus(`导出白模截图 ${index + 1}/${targets.length}`);
        const frame = evaluateDirectorFrame(plan, elements, target.startSec);
        if (frame) { engineRef.current.syncElements(frame.elements); engineRef.current.applyCameraPose(frame.camera); }
        const path = await exportDirectorStill(engineRef.current, target, origin, 'still', options.placeOnCanvas);
        if (options.writeBack) await writeBackDirectorStill(path, target, origin);
      }
      await tauriMessage(`已完成 ${targets.length} 张白模参考图`, { title: '白模回传完成' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '白模回传失败', type: 'error' });
    } finally { setExporting(false); setExportStatus(''); }
  }, [plan, shot, elements, origin]);

  const exportPrevisReference = useCallback(async (options: { writeBack: boolean; placeOnCanvas: boolean }) => {
    if (!engineRef.current || !plan) return;
    setGenerationDialog(null);
    setExporting(true);
    setExportProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const { exportDirectorVideo } = await import('@/lib/director/export');
      const { writeBackDirectorPrevisVideo } = await import('@/lib/director/finalRender');
      const path = await exportDirectorVideo(engineRef.current, plan, elements, origin, { onProgress: onDirectorExportProgress, signal: controller.signal, placeOnCanvas: options.placeOnCanvas, startSec: exportInSec, endSec: exportOutSec });
      if (options.writeBack) await writeBackDirectorPrevisVideo(path, origin);
      await tauriMessage(`已导出白模参考视频\n${path}`, { title: '预演回传完成' });
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '预演回传失败', type: 'error' });
    } finally { exportAbortRef.current = null; setExporting(false); setExportStatus(''); setExportProgress(0); }
  }, [plan, elements, origin, onDirectorExportProgress, exportInSec, exportOutSec]);

  if (!plan) return null;

  return createPortal(
    <div className="fixed inset-0 z-[96] flex flex-col bg-[#111214] text-[var(--canvas-text-1)] canvas-dark">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-white/[0.07] px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Camera size={16} className="text-[var(--canvas-text-2)]" />
          <span className="text-[13px] font-semibold">导演预演</span>
          {workshopData?.shots.length ? (
            <DirectorProjectSwitcher
              open={projectMenuOpen}
              onOpenChange={setProjectMenuOpen}
              currentValue={projectSelectorValue}
              originTitle={origin.title}
              shots={workshopData.shots}
              availability={directorProjects}
              switching={switchingShot}
              onSelect={(value) => void switchWorkshopShot(value)}
            />
          ) : <span className="max-w-[260px] truncate text-[10px] text-[var(--canvas-text-3)]">{origin.title}</span>}
        </div>
        <nav className="ml-5 flex h-8 items-center rounded-lg bg-black/20 p-1">
          {PHASES.map((item) => (
            <button key={item.id} onClick={() => { setPhase(item.id); setActionQuickBarOpen(false); if (item.id === 'design') { setRightDockOpen(false); openDirectorAssistant(); } else { setRightDockOpen(true); setRightDockView(item.id === 'export' ? 'export' : 'inspect'); } }} className={`h-6 rounded-md px-3 text-[11px] transition-colors ${phase === item.id ? 'bg-white/10 text-white' : 'text-[var(--canvas-text-3)] hover:text-white'}`}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex-1" />
        <button onClick={() => useDirectorStore.getState().undo()} disabled={!undoCount} className="director-icon-btn" title="撤销上一步（⌘Z）"><Undo2 size={15} /></button>
        <button onClick={() => useDirectorStore.getState().redo()} disabled={!redoCount} className="director-icon-btn" title="重做（⌘⇧Z）"><Redo2 size={15} /></button>
        <button onClick={() => void useDirectorStore.getState().save()} className="director-icon-btn" title="保存"><Save size={15} /></button>
        <button onClick={() => setShortcutPanelOpen(true)} className={`director-icon-btn ${shortcutPanelOpen ? 'bg-white/10 text-white' : ''}`} title="快捷键"><Keyboard size={15} /></button>
        <button onClick={() => setDebugOpen((value) => !value)} className={`director-icon-btn ${debugOpen ? 'bg-white/10 text-white' : ''}`} title="场景诊断"><Bug size={15} /></button>
        <button onClick={onClose} className="director-icon-btn" title="关闭"><X size={17} /></button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[250px] shrink-0 flex-col border-r border-white/[0.07] bg-[#151619]">
          <PlanRail plans={plans} activePlanId={activePlanId} />
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.07] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium">镜头</span>
              <button onClick={() => useDirectorStore.getState().addShot()} className="director-icon-btn h-7 w-7" title="添加镜头"><Plus size={13} /></button>
            </div>
            <ShotList plan={plan} activeShotId={activeShotId} />
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 bg-[#0d0e10]">
          {!loaded && <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#111214]"><Loader2 size={20} className="animate-spin" /></div>}
          {loaded && generatingPlans && origin.kind === 'workshop-video-prompt' && !plan.shots.some((item) => item.actions.length > 0) && <div className="absolute left-1/2 top-20 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-[9px] text-white/60 shadow-xl backdrop-blur"><Loader2 size={12} className="animate-spin" />正在理解人物动作、时间和镜头调度，建立可播放草案</div>}
          <div ref={containerRef} className={`absolute inset-y-0 left-0 bottom-[280px] transition-[right] ${rightDockOpen ? 'right-[340px]' : 'right-0'}`} />

          <aside className={`absolute bottom-[280px] right-0 top-0 z-30 flex w-[340px] min-h-0 flex-col overflow-hidden border-l border-white/[0.07] bg-[#151619] transition-transform ${rightDockOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}>
            <div className="shrink-0 border-b border-white/[0.07] p-3">
              <div className="mb-1.5 flex items-center justify-between px-0.5 text-[8px] text-white/35"><span>最终镜头 · 实时监看</span><span>{shot?.aspect}</span></div>
              <div className="relative aspect-video shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black shadow-xl">
              <div ref={monitorRef} className="absolute inset-0" />
              <div className="pointer-events-none absolute inset-[5%] border border-white/20">
                <span className="absolute bottom-0 top-0 left-1/3 w-px bg-white/15" /><span className="absolute bottom-0 top-0 left-2/3 w-px bg-white/15" />
                <span className="absolute left-0 right-0 top-1/3 h-px bg-white/15" /><span className="absolute left-0 right-0 top-2/3 h-px bg-white/15" />
              </div>
            </div>
            </div>
            <div className="grid h-10 shrink-0 grid-cols-2 border-b border-white/[0.07] bg-black/10 p-1">
              <button onClick={() => setRightDockView('inspect')} className={`flex items-center justify-center gap-1.5 rounded-md text-[9px] transition-colors ${rightDockView === 'inspect' ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/65'}`}><SlidersHorizontal size={11} />参数调整</button>
              <button onClick={() => setRightDockView('export')} className={`flex items-center justify-center gap-1.5 rounded-md text-[9px] transition-colors ${rightDockView === 'export' ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white/65'}`}><Download size={11} />导出回传</button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-3">
            {rightDockView === 'inspect' && ((propertyOpen || selected)
              ? <PropertyDrawer selected={selected} shot={shot} onBeginStageEdit={() => { setPhase('adjust'); setTransformControlsVisible(true); }} onClose={() => { setPropertyOpen(false); useDirectorStore.getState().setSelected([]); }} />
              : <div className="flex h-full flex-col"><div className="mb-3"><div className="text-[11px] font-medium text-white/75">调整预演</div><p className="mt-1 text-[9px] leading-relaxed text-white/35">选择舞台中的人物、群演或镜头，右侧会显示可直接操作的调度工具。</p></div><button onClick={() => setActionMenu(true)} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-white text-[10px] font-medium text-black"><Move3D size={13} />手动编排演员动作</button><button onClick={startAiActionDirection} className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] text-white/60 hover:bg-white/[0.05]"><Sparkles size={13} />让导演助手先出方案</button></div>)}
            {rightDockView === 'export' && <ExportPanel exporting={exporting} status={exportStatus} progress={exportProgress} issueCount={issues.length} currentTime={currentTimeSec} duration={duration} inSec={exportInSec} outSec={exportOutSec} outputPath={exportOutputPath} lastExportPath={lastExportPath} onChooseOutput={() => void chooseExportOutputPath()} onRevealOutput={() => void revealExportInFinder()} onResetOutput={() => { setExportOutputPath(''); setLastExportPath(''); }} onChangeIn={updateExportIn} onChangeOut={updateExportOut} onUseCurrentIn={() => updateExportIn(currentTimeSec)} onUseCurrentOut={() => updateExportOut(currentTimeSec)} onResetRange={() => { setExportInSec(0); setExportOutSec(snapDirectorFrame(duration)); }} onCancel={() => exportAbortRef.current?.abort()} onStill={() => void captureStill()} onTopView={() => void captureStill('top-view')} onPathMap={() => void captureStill('path-map')} onTransparent={() => void captureStill('transparent')} onVideo={() => void exportVideo()} onFinalImage={() => setGenerationDialog('image')} onSeedance={() => setGenerationDialog('video')} onStillWriteback={() => setGenerationDialog('still')} onPrevisWriteback={() => setGenerationDialog('previs')} />}
            </div>
          </aside>

          <button onClick={() => setRightDockOpen((value) => !value)} className={`absolute top-3 z-40 flex h-8 w-7 items-center justify-center rounded-l-lg border border-r-0 border-white/10 bg-[#191a1e] text-white/45 hover:text-white ${rightDockOpen ? 'right-[340px]' : 'right-0'}`} title={rightDockOpen ? '收起右侧工作台' : '展开右侧工作台'}>{rightDockOpen ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}</button>

          <div className="absolute left-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur">
            <button onClick={() => setLibraryMenu('actors')} className="director-tool-btn" title="添加人物、动物或群众"><PersonStanding size={15} /><span>演员库</span></button>
            <button onClick={() => setLibraryMenu('props')} className="director-tool-btn" title="添加常用代理道具"><Box size={15} /><span>道具库</span></button>
            <div className="mx-1 h-5 w-px bg-white/10" />
            <button
              onClick={() => setTransformControlsVisible((value) => !value)}
              className={`director-tool-btn ${transformControlsVisible ? 'bg-white/10 text-white' : ''}`}
              title={transformControlsVisible ? '隐藏移动控制器' : '显示移动控制器'}
            >
              {transformControlsVisible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            {([['translate', Move3D, '移动'], ['rotate', Rotate3D, '旋转'], ['scale', Scaling, '缩放']] as const).map(([mode, Icon, label]) => (
              <button key={mode} onClick={() => useDirectorStore.getState().setTransformMode(mode as TransformMode)} className={`director-tool-btn ${transformMode === mode ? 'bg-white/10 text-white' : ''}`} title={label}><Icon size={15} /></button>
            ))}
          </div>

          <div className={`absolute top-4 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur ${rightDockOpen ? 'right-[356px]' : 'right-4'}`}>
            <button onClick={() => { setCameraEditPoint('start'); saveCameraStart(); }} className={`director-tool-btn ${cameraEditPoint === 'start' ? 'bg-white/10 text-white' : ''}`} title="把当前观察视角设为起点，并允许拖动白模摄影机"><Camera size={14} /><span>起始机位</span></button>
            <button onClick={() => { setCameraEditPoint('current'); setPhase('adjust'); setTransformControlsVisible(true); }} className={`director-tool-btn ${cameraEditPoint === 'current' ? 'bg-white/10 text-white' : ''}`} title="在当前播放头时间调整摄影机；拖动完成后自动写入 K 帧"><Plus size={14} /><span>当前 K 帧</span></button>
            <button onClick={() => { setCameraEditPoint('end'); saveCameraEnd(); }} className={`director-tool-btn ${cameraEditPoint === 'end' ? 'bg-white/10 text-white' : ''}`} title="把当前观察视角设为终点，并允许拖动白模摄影机"><Aperture size={14} /><span>结束机位</span></button>
            <button onClick={() => { useDirectorStore.getState().setSelected([]); setPropertyOpen(true); setRightDockOpen(true); setRightDockView('inspect'); }} className="director-tool-btn" title="选择电影运镜模板，调整景别、焦段和摄影机关键帧"><Scaling size={14} /><span>镜头与运镜</span></button>
          </div>

          {phase === 'adjust' && actionQuickBarOpen && isMotionActor(selected) && <div className="absolute top-16 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-[#18191c]/95 p-1.5 shadow-2xl backdrop-blur" style={{ left: rightDockOpen ? 'calc((100% - 340px) / 2)' : '50%' }}>
            <div className="flex h-9 min-w-[118px] items-center gap-2 px-2.5">
              <PersonStanding size={14} className="text-white/55" />
              <span className="min-w-0"><span className="block text-[8px] text-white/30">{motionActorLabel(selected)}动作</span><span className="block max-w-[110px] truncate text-[10px] font-medium text-white/80">{selected.name}</span></span>
            </div>
            <button onClick={startAiActionDirection} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[9px] text-white/60 hover:bg-white/[0.07] hover:text-white"><Sparkles size={12} />告诉 AI 怎么演</button>
            {selectedActions.length > 0 && <button onClick={editSelectedAction} className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[9px] font-medium text-black hover:bg-white/90"><MousePointer2 size={12} />修改现有动作</button>}
            <button onClick={() => { setActionMenu(true); setActionQuickBarOpen(false); }} className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[9px] ${selectedActions.length > 0 ? 'border border-white/10 text-white/55 hover:bg-white/[0.07]' : 'bg-white font-medium text-black hover:bg-white/90'}`}><Plus size={12} />添加新动作</button>
            <button onClick={() => setActionQuickBarOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/35 hover:bg-white/[0.07] hover:text-white" title="关闭动作快捷条"><X size={13} /></button>
          </div>}

          <div className="absolute bottom-[296px] z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-black/65 px-2 py-1.5 backdrop-blur" style={{ left: rightDockOpen ? 'calc((100% - 340px) / 2)' : '50%' }}>
            <button onClick={() => useDirectorStore.getState().setPlaying(!playing)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black" title={playing ? '暂停' : '播放'}>
              {playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
            </button>
            <button onClick={() => stepPlayhead(-1)} className="director-icon-btn h-7 w-7" title="上一帧"><ArrowLeft size={12} /></button>
            <span className="w-[86px] text-center font-mono text-[9px] text-white/75" title={`第 ${Math.round(currentTimeSec * DIRECTOR_FPS)} 帧`}>{fmtTimecode(currentTimeSec)}</span>
            <input type="range" min={0} max={Math.max(DIRECTOR_FRAME_SEC, duration - DIRECTOR_FRAME_SEC)} step={DIRECTOR_FRAME_SEC} value={Math.min(currentTimeSec, Math.max(0, duration - DIRECTOR_FRAME_SEC))} onChange={(event) => { useDirectorStore.getState().setPlaying(false); useDirectorStore.getState().setCurrentTime(snapDirectorFrame(Number(event.target.value))); }} className="w-[240px] accent-white" />
            <button onClick={() => stepPlayhead(1)} className="director-icon-btn h-7 w-7" title="下一帧"><ArrowRight size={12} /></button>
            <span className="w-[62px] text-center font-mono text-[8px] text-white/40">帧 {Math.round(currentTimeSec * DIRECTOR_FPS)}</span>
          </div>

          <Timeline plan={plan} elements={elements} selected={selected} shot={shot} selection={timelineSelection} exportInSec={exportInSec} exportOutSec={exportOutSec} onSetIn={() => updateExportIn(currentTimeSec)} onSetOut={() => updateExportOut(currentTimeSec)} onSelection={setTimelineSelection} onCameraSelection={() => setCameraEditPoint('current')} onOpenActions={() => setActionMenu(true)} onEdit={() => { setPropertyOpen(true); setRightDockOpen(true); setRightDockView('inspect'); }} />

          {issues.length > 0 && phase === 'adjust' && <HealthBadge issues={issues} dockOpen={rightDockOpen} />}
          {debugOpen && <DirectorDebugPanel diagnostics={engineDiagnostics} plan={plan} elements={elements} onRepair={repairWhiteModels} onClose={() => setDebugOpen(false)} />}
          <DirectorChatPanel onSendMessage={onSendMessage} onAbort={onAbort} />
        </main>

      </div>

      {actionMenu && <ActionPicker elements={elements} selectedId={isMotionActor(selected) ? selected.id : undefined} onPick={(personId, actionId) => addAction(actionId, personId)} onClose={() => setActionMenu(false)} />}
      {shortcutPanelOpen && <DirectorShortcutPanel onClose={() => setShortcutPanelOpen(false)} />}
      {libraryMenu && <DirectorObjectLibrary mode={libraryMenu} onActor={addActorPreset} onProp={addPropPreset} onClose={() => setLibraryMenu(null)} />}
      {proposals.length > 0 && (
        <PlanProposalDialog
          plans={proposals}
          onClose={() => setProposals([])}
          onConfirm={(selectedPlanId) => {
            const ordered = [...proposals].sort((left, right) => Number(right.id === selectedPlanId) - Number(left.id === selectedPlanId));
            useDirectorStore.getState().replacePlans(ordered);
            setProposals([]);
            setPhase('adjust');
          }}
        />
      )}
      {generationDialog && (
        <GenerationConfirmDialog
          mode={generationDialog}
          onClose={() => setGenerationDialog(null)}
          onImageConfirm={(options) => void renderFinalImages(options)}
          onVideoConfirm={(options) => void renderSeedance(options)}
          onStillConfirm={(options) => void exportWhiteReferences(options)}
          onPrevisConfirm={(options) => void exportPrevisReference(options)}
        />
      )}
      {(analyzingImage || imageAnalysis) && (
        <ImageAnalysisDialog
          loading={analyzingImage}
          analysis={imageAnalysis}
          onChange={setImageAnalysis}
          onClose={() => setImageAnalysis(null)}
          onConfirm={() => {
            if (!imageAnalysis) return;
            const store = useDirectorStore.getState();
            analysisToElements(imageAnalysis).forEach((element) => store.addElement(element));
            const targetShot = activeDirectorShot(store);
            if (targetShot) {
              const layout = analysisToShotLayout(imageAnalysis, useDirectorStore.getState().elements);
              store.updateShot(targetShot.id, {
                position: layout.camera.position, target: layout.camera.target, fov: layout.camera.fov,
                rollDeg: layout.camera.rollDeg, focalLengthMm: layout.camera.focalLengthMm,
                shotScale: imageAnalysis.shotScale, primaryElementId: layout.primaryElementId,
                recognition: { ...layout.recognition, sourcePath: origin.referenceImagePaths?.[0] },
                cameraEnd: { position: { ...layout.camera.position }, target: { ...layout.camera.target }, fov: layout.camera.fov, rollDeg: layout.camera.rollDeg },
                elementStates: layout.elementStates,
              });
            }
            setImageAnalysis(null);
            setPhase('adjust');
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function PlanRail({ plans, activePlanId }: { plans: DirectorPlan[]; activePlanId: string | null }) {
  const store = useDirectorStore;
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium">导演方案</span>
        <button onClick={() => store.getState().addPlan()} className="director-icon-btn h-7 w-7" title="新建方案"><Plus size={13} /></button>
      </div>
      <div className="space-y-1.5">
        {plans.map((plan) => (
          <button key={plan.id} onClick={() => store.getState().setActivePlan(plan.id)} className={`group w-full rounded-lg px-3 py-2.5 text-left transition-colors ${activePlanId === plan.id ? 'bg-white/10' : 'hover:bg-white/[0.04]'}`}>
            <div className="flex items-center gap-2">
              <Film size={12} className={activePlanId === plan.id ? 'text-white' : 'text-white/35'} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{plan.name}</span>
              <button onClick={(event) => { event.stopPropagation(); store.getState().duplicatePlan(plan.id); }} className="opacity-0 transition-opacity group-hover:opacity-100" title="复制方案"><Copy size={11} /></button>
            </div>
            <p className="mt-1 truncate text-[9px] text-white/35">{plan.summary}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShotList({ plan, activeShotId }: { plan: DirectorPlan; activeShotId: string | null }) {
  const [dragId, setDragId] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      {plan.shots.map((shot, index) => (
        <div
          key={shot.id}
          draggable
          onDragStart={() => setDragId(shot.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => { if (dragId) useDirectorStore.getState().reorderShot(dragId, index); setDragId(null); }}
          onClick={() => useDirectorStore.getState().setActiveShot(shot.id)}
          className={`group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition-colors ${activeShotId === shot.id ? 'border-white/18 bg-white/10' : 'border-transparent bg-white/[0.025] hover:bg-white/[0.05]'}`}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/30 text-[10px] text-white/55">{index + 1}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[10px] text-white/80">{shot.name}</div>
            <div className="mt-0.5 flex gap-1.5 text-[8px] text-white/35"><span>{shot.durationSec.toFixed(1)}s</span><span>{CAMERA_MOVES.find((item) => item.id === shot.cameraMove)?.label}</span><span>{shot.actions.length} 动作</span></div>
          </div>
          <button onClick={(event) => { event.stopPropagation(); useDirectorStore.getState().removeShot(shot.id); }} className="opacity-0 text-white/35 hover:text-red-300 group-hover:opacity-100" title="删除镜头"><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function Timeline({ plan, elements, selected, shot, selection, exportInSec, exportOutSec, onSetIn, onSetOut, onSelection, onCameraSelection, onOpenActions, onEdit }: {
  plan: DirectorPlan;
  elements: DirectorElement[];
  selected?: DirectorElement;
  shot?: DirectorSequenceShot;
  selection: TimelineKeyframeSelection;
  exportInSec: number;
  exportOutSec: number;
  onSetIn: () => void;
  onSetOut: () => void;
  onSelection: (selection: TimelineKeyframeSelection) => void;
  onCameraSelection: () => void;
  onOpenActions: () => void;
  onEdit: () => void;
}) {
  const duration = Math.max(0.1, planDuration(plan));
  const currentTime = useDirectorStore((state) => state.currentTimeSec);
  const trackElements = elements.filter((element) => element.kind === 'mannequin' || element.kind === 'crowd' || element.kind === 'box' || element.kind === 'wall' || element.kind === 'cylinder');
  const selectedAction = selection?.kind === 'action'
    ? plan.shots.find((item) => item.id === selection.shotId)?.actions.find((action) => action.id === selection.actionId)
    : undefined;
  const selectedFrame = selectedAction?.keyframes?.find((frame) => frame.id === (selection?.kind === 'action' ? selection.keyframeId : ''));
  const selectedCameraFrame = selection?.kind === 'camera'
    ? plan.shots.find((item) => item.id === selection.shotId)?.cameraKeyframes?.find((frame) => frame.id === selection.keyframeId)
    : undefined;
  const selectedInterpolation = selectedFrame?.interpolation ?? selectedCameraFrame?.interpolation;

  const addCameraKeyframe = () => {
    if (!shot) return;
    const store = useDirectorStore.getState();
    const frame = evaluateDirectorFrame(plan, elements, store.currentTimeSec);
    if (!frame) return;
    const timeSec = Math.max(0, Math.min(shot.durationSec, store.currentTimeSec - shot.startSec));
    const existing = shot.cameraKeyframes?.find((item) => Math.abs(item.timeSec - timeSec) < 0.04);
    const keyframe = {
      id: existing?.id ?? `ckf-${nanoid(7)}`,
      timeSec: Number(timeSec.toFixed(3)),
      position: { ...frame.camera.position }, target: { ...frame.camera.target }, fov: frame.camera.fov, rollDeg: frame.camera.rollDeg ?? 0,
      interpolation: existing?.interpolation ?? 'smooth' as const, locked: true, source: 'manual' as const, note: '时间轴摄影机 K 帧',
    };
    store.checkpoint();
    store.updateShot(shot.id, { cameraKeyframes: [...(shot.cameraKeyframes ?? []).filter((item) => item.id !== keyframe.id && Math.abs(item.timeSec - timeSec) >= 0.04), keyframe].sort((a, b) => a.timeSec - b.timeSec) });
    onSelection({ kind: 'camera', shotId: shot.id, keyframeId: keyframe.id });
    onCameraSelection();
  };

  const addActorKeyframe = () => {
    if (!shot || !isMotionActor(selected)) { onOpenActions(); return; }
    const localShotTime = currentTime - shot.startSec;
    const action = shot.actions.find((item) => item.elementId === selected.id && localShotTime >= item.startSec - 0.001 && localShotTime <= item.startSec + item.durationSec + 0.001);
    if (!action) { onOpenActions(); return; }
    const evaluated = evaluateDirectorFrame(plan, elements, currentTime)?.elements.find((item) => item.id === selected.id);
    if (!evaluated) return;
    const timeSec = Math.max(0, Math.min(action.durationSec, localShotTime - action.startSec));
    const existing = action.keyframes?.find((item) => Math.abs(item.timeSec - timeSec) < 0.04);
    const keyframe: DirectorMotionKeyframe = {
      id: existing?.id ?? `kf-${nanoid(7)}`, timeSec: Number(timeSec.toFixed(3)), position: { ...evaluated.position }, rotationDeg: { ...evaluated.rotationDeg },
      joints: evaluated.kind === 'mannequin' ? { ...evaluated.joints } : undefined, interpolation: existing?.interpolation ?? 'smooth', locked: true, source: 'manual', note: `时间轴${motionActorLabel(selected)} K 帧`,
    };
    const store = useDirectorStore.getState();
    store.checkpoint();
    store.updateAction(shot.id, action.id, { keyframes: [...(action.keyframes ?? []).filter((item) => item.id !== keyframe.id && Math.abs(item.timeSec - timeSec) >= 0.04), keyframe].sort((a, b) => a.timeSec - b.timeSec), source: 'manual', locked: true });
    onSelection({ kind: 'action', shotId: shot.id, actionId: action.id, keyframeId: keyframe.id });
  };

  const setPathMode = (mode: 'corner' | 'smooth') => {
    if (!selectedAction || selection?.kind !== 'action') return;
    const frames = mode === 'smooth' ? smoothPathFrame(selectedAction.keyframes ?? [], selection.keyframeId) : cornerPathFrame(selectedAction.keyframes ?? [], selection.keyframeId);
    const store = useDirectorStore.getState();
    store.checkpoint();
    store.updateAction(selection.shotId, selection.actionId, { keyframes: frames, source: 'manual', locked: true });
  };

  const removeSelectedKeyframe = () => {
    if (!selection) return;
    const store = useDirectorStore.getState();
    if (selection.kind === 'camera') {
      const owner = plan.shots.find((item) => item.id === selection.shotId);
      if (!owner || (owner.cameraKeyframes?.length ?? 0) <= 2) return;
      store.checkpoint();
      store.updateShot(owner.id, { cameraKeyframes: owner.cameraKeyframes?.filter((frame) => frame.id !== selection.keyframeId) });
    } else {
      const owner = plan.shots.find((item) => item.id === selection.shotId)?.actions.find((action) => action.id === selection.actionId);
      if (!owner || (owner.keyframes?.length ?? 0) <= 2) return;
      store.checkpoint();
      store.updateAction(selection.shotId, selection.actionId, { keyframes: owner.keyframes?.filter((frame) => frame.id !== selection.keyframeId), source: 'manual' });
    }
    onSelection(null);
  };

  const setSelectedInterpolation = (interpolation: DirectorMotionKeyframe['interpolation']) => {
    if (!selection) return;
    const store = useDirectorStore.getState();
    store.checkpoint();
    if (selection.kind === 'camera') {
      const owner = plan.shots.find((item) => item.id === selection.shotId);
      if (owner) store.updateShot(owner.id, { cameraKeyframes: owner.cameraKeyframes?.map((frame) => frame.id === selection.keyframeId ? { ...frame, interpolation, source: 'manual' as const, locked: true } : frame) });
    } else {
      const owner = plan.shots.find((item) => item.id === selection.shotId)?.actions.find((action) => action.id === selection.actionId);
      if (owner) store.updateAction(selection.shotId, selection.actionId, { keyframes: owner.keyframes?.map((frame) => frame.id === selection.keyframeId ? { ...frame, interpolation, source: 'manual' as const, locked: true } : frame), source: 'manual', locked: true });
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 h-[280px] border-t border-white/[0.08] bg-[#151619] shadow-[0_-12px_30px_rgba(0,0,0,.25)]">
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="text-[10px] font-semibold text-white/75">动画时间轴</span><span className="text-[8px] text-white/30">{plan.shots.length} 镜 · {duration.toFixed(1)} 秒</span>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <button onClick={addActorKeyframe} className="flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2 text-[9px] text-white/60 hover:bg-white/[0.06] hover:text-white"><PersonStanding size={11} /><Plus size={9} />动作 K</button>
        <button onClick={addCameraKeyframe} className="flex h-7 items-center gap-1.5 rounded-md border border-white/10 px-2 text-[9px] text-white/60 hover:bg-white/[0.06] hover:text-white"><Camera size={11} /><Plus size={9} />摄影机 K</button>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <button onClick={onSetIn} className="h-7 rounded-md border border-white/10 px-2 text-[8px] text-white/55 hover:bg-white/[0.06]" title="把播放头设为导出入点">I · 设入点</button>
        <button onClick={onSetOut} className="h-7 rounded-md border border-white/10 px-2 text-[8px] text-white/55 hover:bg-white/[0.06]" title="把播放头设为导出出点">O · 设出点</button>
        {selectedInterpolation && <select value={selectedInterpolation} onChange={(event) => setSelectedInterpolation(event.target.value as DirectorMotionKeyframe['interpolation'])} className="h-7 rounded-md border border-white/10 bg-[#1b1c20] px-2 text-[8px] text-white/60 outline-none" title="选中关键帧到下一个关键帧之间的变化方式"><option value="hold">保持</option><option value="linear">线性</option><option value="smooth">平滑</option><option value="ease-in">缓入</option><option value="ease-out">缓出</option></select>}
        {selection?.kind === 'action' && <><div className="mx-1 h-5 w-px bg-white/[0.08]" /><span className="text-[8px] text-white/30">运动路径</span><button onClick={() => setPathMode('corner')} className={`h-7 rounded-md px-2 text-[8px] ${selectedFrame?.pathMode !== 'smooth' ? 'bg-white/12 text-white' : 'text-white/40 hover:bg-white/[0.05]'}`}>直线</button><button onClick={() => setPathMode('smooth')} className={`h-7 rounded-md px-2 text-[8px] ${selectedFrame?.pathMode === 'smooth' ? 'bg-white text-black' : 'text-white/40 hover:bg-white/[0.05]'}`}>曲线路径</button></>}
        <div className="flex-1" />
        {selection && <button onClick={removeSelectedKeyframe} className="director-icon-btn h-7 w-7" title="删除选中的关键帧（每条轨道至少保留两个）"><Trash2 size={11} /></button>}
        <button onClick={onOpenActions} disabled={!shot} className="flex h-7 items-center gap-1.5 rounded-md bg-white px-2.5 text-[9px] font-medium text-black hover:bg-white/90 disabled:opacity-30"><Plus size={11} />添加动作片段</button>
      </div>
      <div className="grid h-[240px] grid-cols-[128px_1fr] overflow-y-auto">
        <div className="border-r border-white/[0.06] bg-black/10">
          <div className="flex h-14 items-center gap-2 border-b border-white/[0.05] px-3 text-[9px] text-white/55"><Camera size={12} />摄影机轨道</div>
          {trackElements.map((element) => <button key={element.id} onClick={() => { useDirectorStore.getState().setSelected([element.id]); onEdit(); }} className={`flex h-11 w-full items-center gap-2 border-b border-white/[0.04] px-3 text-left text-[9px] ${selected?.id === element.id ? 'bg-white/[0.07] text-white' : 'text-white/45 hover:text-white/75'}`}><span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: element.color }} />{element.kind === 'mannequin' || element.kind === 'crowd' ? <PersonStanding size={11} /> : <Box size={11} />}<span className="truncate">{element.name}</span></button>)}
        </div>
        <div data-timeline-track className="relative min-w-[760px] select-none">
          <div className="pointer-events-none absolute inset-y-0 z-[5] border-x border-white/30 bg-white/[0.025]" style={{ left: `${exportInSec / duration * 100}%`, width: `${Math.max(0, (exportOutSec - exportInSec) / duration * 100)}%` }}><span className="absolute left-0 top-0 rounded-br bg-white px-1 py-0.5 text-[7px] font-semibold text-black">I</span><span className="absolute right-0 top-0 rounded-bl bg-white px-1 py-0.5 text-[7px] font-semibold text-black">O</span></div>
          <div className="relative h-14 border-b border-white/[0.05]">
            <div className="absolute inset-0 flex">{plan.shots.map((item, index) => <div key={item.id} onPointerDown={(event) => beginTimelineScrub(event, duration)} className={`h-full cursor-col-resize border-r border-white/[0.08] px-2 pt-2 text-left ${shot?.id === item.id ? 'bg-white/[0.075]' : 'bg-white/[0.018] hover:bg-white/[0.04]'}`} style={{ width: `${(item.durationSec / duration) * 100}%` }}><span className="pointer-events-none block truncate text-[8px] text-white/55">{index + 1} · {item.name}</span><span className="pointer-events-none mt-1 block font-mono text-[7px] text-white/25">{fmtTime(item.startSec)}</span></div>)}</div>
            {plan.shots.flatMap((item) => (item.cameraKeyframes ?? []).map((keyframe) => ({ item, keyframe }))).map(({ item, keyframe }) => <TimelineKeyframeDot key={keyframe.id} active={selection?.kind === 'camera' && selection.keyframeId === keyframe.id} leftPercent={(item.startSec + keyframe.timeSec) / duration * 100} title={`摄影机 K · ${keyframe.timeSec.toFixed(2)}s`} onPointerDown={(event) => { useDirectorStore.getState().setPlaying(false); useDirectorStore.getState().setActiveShot(item.id); useDirectorStore.getState().setCurrentTime(item.startSec + keyframe.timeSec); onSelection({ kind: 'camera', shotId: item.id, keyframeId: keyframe.id }); onCameraSelection(); beginTimelineKeyframeDrag(event, duration, item.startSec, item.durationSec, keyframe.timeSec, (timeSec) => useDirectorStore.getState().updateShot(item.id, { cameraKeyframes: item.cameraKeyframes?.map((frame) => frame.id === keyframe.id ? { ...frame, timeSec } : frame).sort((a, b) => a.timeSec - b.timeSec) })); }} onClick={() => { onSelection({ kind: 'camera', shotId: item.id, keyframeId: keyframe.id }); onCameraSelection(); }} />)}
          </div>
          {trackElements.map((element) => <div key={element.id} onPointerDown={(event) => beginTimelineScrub(event, duration)} className="relative h-11 cursor-col-resize border-b border-white/[0.04]">{plan.shots.flatMap((item) => item.actions.map((action) => ({ action, shot: item }))).filter(({ action }) => action.elementId === element.id).map(({ action, shot: owner }) => <TimelineActionBlock key={action.id} action={action} shot={owner} elementId={element.id} color={element.color} planDurationSec={duration} selection={selection} onSelection={onSelection} onEdit={onEdit} />)}</div>)}
          <div className="pointer-events-none absolute inset-y-0 z-30 w-px bg-white/80 shadow-[0_0_6px_rgba(255,255,255,.45)]" style={{ left: `${Math.max(0, Math.min(100, currentTime / duration * 100))}%` }}><button type="button" onPointerDown={(event) => beginTimelineScrub(event, duration)} className="pointer-events-auto absolute -left-[7px] -top-0.5 h-4 w-4 cursor-col-resize border-0 bg-transparent p-0" title="拖动播放头，按帧定位"><span className="absolute left-[4px] top-0 h-2.5 w-2.5 rotate-45 bg-white" /></button></div>
        </div>
      </div>
    </div>
  );
}

function beginTimelineScrub(event: React.PointerEvent<HTMLElement>, duration: number) {
  event.stopPropagation();
  const track = event.currentTarget.closest('[data-timeline-track]');
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const seek = (clientX: number) => {
    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const maxFrame = Math.max(0, Math.floor(duration * DIRECTOR_FPS) - 1);
    const frame = Math.max(0, Math.min(maxFrame, Math.round(progress * duration * DIRECTOR_FPS)));
    useDirectorStore.getState().setPlaying(false);
    useDirectorStore.getState().setCurrentTime(frame / DIRECTOR_FPS);
  };
  seek(event.clientX);
  const onMove = (moveEvent: PointerEvent) => { moveEvent.preventDefault(); seek(moveEvent.clientX); };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function beginTimelineKeyframeDrag(event: React.PointerEvent<HTMLElement>, duration: number, ownerStart: number, ownerDuration: number, originalTime: number, onChange: (timeSec: number) => void) {
  event.stopPropagation();
  const track = event.currentTarget.closest('[data-timeline-track]');
  if (!track) return;
  const width = Math.max(1, track.getBoundingClientRect().width);
  const startX = event.clientX;
  let checkpointed = false;
  const onMove = (moveEvent: PointerEvent) => {
    const deltaPx = moveEvent.clientX - startX;
    if (!checkpointed && Math.abs(deltaPx) < 3) return;
    if (!checkpointed) { useDirectorStore.getState().checkpoint(); checkpointed = true; }
    const next = Math.max(0, Math.min(ownerDuration, snapDirectorFrame(originalTime + deltaPx / width * duration)));
    onChange(next);
    useDirectorStore.getState().setCurrentTime(ownerStart + next);
  };
  const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
}

function TimelineKeyframeDot({ active, leftPercent, title, onPointerDown, onClick }: { active: boolean; leftPercent: number; title: string; onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void; onClick: () => void }) {
  return <button type="button" onPointerDown={onPointerDown} onClick={(event) => { event.stopPropagation(); onClick(); }} className={`absolute bottom-2 z-20 h-3 w-3 -translate-x-1/2 rotate-45 border shadow-sm transition-transform hover:scale-125 ${active ? 'border-white bg-white' : 'border-white/55 bg-[#777b84]'}`} style={{ left: `${Math.max(0.4, Math.min(99.6, leftPercent))}%` }} title={title} />;
}

function TimelineActionBlock({ action, shot, elementId, color, planDurationSec, selection, onSelection, onEdit }: {
  action: DirectorSequenceShot['actions'][number];
  shot: DirectorSequenceShot;
  elementId: string;
  color: string;
  planDurationSec: number;
  selection: TimelineKeyframeSelection;
  onSelection: (selection: TimelineKeyframeSelection) => void;
  onEdit: () => void;
  }) {
  const beginDrag = (event: React.PointerEvent<HTMLElement>, mode: 'move' | 'start' | 'end') => {
    event.stopPropagation();
    const track = event.currentTarget.closest('[data-timeline-track]');
    if (!track) return;
    const trackWidth = Math.max(1, track.getBoundingClientRect().width);
    const pointerStart = event.clientX;
    const originalStart = action.startSec;
    const originalDuration = action.durationSec;
    const originalEnd = originalStart + originalDuration;
    let dragging = false;
    useDirectorStore.getState().setActiveShot(shot.id);
    useDirectorStore.getState().setSelected([elementId]);

    const onMove = (moveEvent: PointerEvent) => {
      const deltaPx = moveEvent.clientX - pointerStart;
      if (!dragging && Math.abs(deltaPx) < 4) return;
      if (!dragging) {
        dragging = true;
        useDirectorStore.getState().checkpoint();
      }
      moveEvent.preventDefault();
      const deltaSec = (deltaPx / trackWidth) * planDurationSec;
      if (mode === 'move') {
        const startSec = Math.max(0, Math.min(shot.durationSec - originalDuration, snapDirectorFrame(originalStart + deltaSec)));
        useDirectorStore.getState().updateAction(shot.id, action.id, { startSec });
      } else if (mode === 'start') {
        const startSec = Math.max(0, Math.min(originalEnd - DIRECTOR_FRAME_SEC, snapDirectorFrame(originalStart + deltaSec)));
        useDirectorStore.getState().updateAction(shot.id, action.id, {
          startSec,
          durationSec: snapDirectorFrame(originalEnd - startSec),
        });
      } else {
        const endSec = Math.max(originalStart + DIRECTOR_FRAME_SEC, Math.min(shot.durationSec, snapDirectorFrame(originalEnd + deltaSec)));
        useDirectorStore.getState().updateAction(shot.id, action.id, { durationSec: snapDirectorFrame(endSec - originalStart) });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div
      onPointerDown={(event) => beginDrag(event, 'move')}
      onClick={() => {
        const store = useDirectorStore.getState();
        const frames = [...(action.keyframes ?? [])].sort((left, right) => left.timeSec - right.timeSec);
        const focus = frames[Math.floor(frames.length / 2)];
        store.setPlaying(false);
        store.setActiveShot(shot.id);
        store.setSelected([elementId]);
        store.setCurrentTime(shot.startSec + action.startSec + (focus?.timeSec ?? action.durationSec / 2));
        onEdit();
      }}
      className="group/action absolute top-1.5 h-8 touch-none rounded-md border bg-white/[0.08] px-2 text-left text-[8px] text-white/75 hover:bg-white/15"
      style={{ left: `${((shot.startSec + action.startSec) / planDurationSec) * 100}%`, width: `${Math.max(2, (action.durationSec / planDurationSec) * 100)}%`, borderColor: `${color}88`, boxShadow: `inset 3px 0 0 ${color}` }}
      title={action.locked ? '已保护人工修改：AI 不会改写；你仍可继续手动调整' : '拖动调整时间，拖动两侧调整长度'}
    >
      <span onPointerDown={(event) => beginDrag(event, 'start')} className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize border-l border-white/25 bg-white/5 opacity-0 group-hover/action:opacity-100" />
      <span className="pointer-events-none block truncate pr-3">{ACTIONS.find((item) => item.id === action.action)?.label}</span>
      {action.locked && <Lock size={8} className="pointer-events-none absolute right-2 top-1.5 text-white/55" />}
      {(action.keyframes ?? []).map((keyframe) => <button type="button" key={keyframe.id} onPointerDown={(event) => { useDirectorStore.getState().setPlaying(false); useDirectorStore.getState().setActiveShot(shot.id); useDirectorStore.getState().setSelected([elementId]); useDirectorStore.getState().setCurrentTime(shot.startSec + action.startSec + keyframe.timeSec); onSelection({ kind: 'action', shotId: shot.id, actionId: action.id, keyframeId: keyframe.id }); beginTimelineKeyframeDrag(event, planDurationSec, shot.startSec + action.startSec, action.durationSec, keyframe.timeSec, (timeSec) => useDirectorStore.getState().updateAction(shot.id, action.id, { keyframes: action.keyframes?.map((frame) => frame.id === keyframe.id ? { ...frame, timeSec } : frame).sort((a, b) => a.timeSec - b.timeSec), source: 'manual' })); }} onClick={(event) => { event.stopPropagation(); onSelection({ kind: 'action', shotId: shot.id, actionId: action.id, keyframeId: keyframe.id }); onEdit(); }} className={`absolute bottom-[-2px] z-20 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border ${selection?.kind === 'action' && selection.keyframeId === keyframe.id ? 'border-white bg-white' : 'border-black/50 bg-white/70 hover:bg-white'}`} style={{ left: `${Math.max(0, Math.min(100, keyframe.timeSec / Math.max(0.01, action.durationSec) * 100))}%` }} title={`${keyframe.timeSec.toFixed(2)}s · 点击选中，拖动改时间`} />)}
      <span onPointerDown={(event) => beginDrag(event, 'end')} className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize border-r border-white/25 bg-white/5 opacity-0 group-hover/action:opacity-100" />
    </div>
  );
}

function DirectorDebugPanel({ diagnostics, plan, elements, onRepair, onClose }: {
  diagnostics: DirectorEngineDiagnostics | null;
  plan: DirectorPlan;
  elements: DirectorElement[];
  onRepair: () => void;
  onClose: () => void;
}) {
  const activeShot = activeDirectorShot(useDirectorStore.getState()) ?? plan.shots[0];
  const people = elements.filter((element) => element.kind === 'mannequin');
  const invalidActions = plan.shots.flatMap((shot) => shot.actions).filter((action) => !elements.some((element) => element.id === action.elementId));
  return (
    <div className="absolute left-4 top-16 z-40 flex max-h-[calc(100%_-_356px)] w-[min(380px,calc(100%_-_32px))] flex-col overflow-hidden rounded-lg border border-white/12 bg-[#17191d]/98 shadow-2xl backdrop-blur">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3"><Bug size={13} /><span className="text-[10px] font-medium">场景诊断</span><span className="ml-auto text-[8px] text-white/30">每 0.5 秒更新</span><button onClick={onClose} className="director-icon-btn h-7 w-7"><X size={11} /></button></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[8px] text-white/45">
        <div className="grid grid-cols-2 gap-1.5">
          <DebugValue label="数据人物" value={`${people.length}`} ok={people.length > 0} />
          <DebugValue label="渲染对象" value={`${diagnostics?.renderedElementCount ?? 0}`} ok={(diagnostics?.renderedElementCount ?? 0) > 0} />
          <DebugValue label="WebGL" value={diagnostics?.webglContextLost ? '上下文丢失' : '正常'} ok={!diagnostics?.webglContextLost} />
          <DebugValue label="舞台尺寸" value={diagnostics ? `${diagnostics.stageSize.width}×${diagnostics.stageSize.height}` : '等待'} ok={Boolean(diagnostics?.stageSize.width && diagnostics?.stageSize.height)} />
          <DebugValue label="最终监看" value={diagnostics?.monitorAttached ? '已连接' : '未连接'} ok={Boolean(diagnostics?.monitorAttached)} />
          <DebugValue label="失效动作" value={`${invalidActions.length}`} ok={invalidActions.length === 0} />
        </div>
        <div><div className="mb-1.5 text-[9px] font-medium text-white/60">当前镜头 · {activeShot?.name ?? '无'}</div><div className="rounded-md bg-black/20 p-2 leading-relaxed">机位 {activeShot ? `${activeShot.position.x.toFixed(1)}, ${activeShot.position.y.toFixed(1)}, ${activeShot.position.z.toFixed(1)}` : '无'}<br />目标 {activeShot ? `${activeShot.target.x.toFixed(1)}, ${activeShot.target.y.toFixed(1)}, ${activeShot.target.z.toFixed(1)}` : '无'} · FOV {activeShot?.fov.toFixed(1) ?? '无'}</div></div>
        <div><div className="mb-1.5 text-[9px] font-medium text-white/60">人物链路</div><div className="space-y-1">{people.map((person) => {
          const state = activeShot?.elementStates[person.id];
          const rendered = diagnostics?.elements.find((item) => item.id === person.id);
          const reason = !state ? '镜头缺少状态' : state.visible === false ? '镜头设为隐藏' : !rendered ? 'Three 场景未创建对象' : !rendered.rootVisible ? '渲染对象被隐藏' : rendered.visibleMeshCount === 0 ? '没有可见网格' : !rendered.insideShotFrustum ? '不在最终摄影机画面内' : '正常可见';
          const ok = reason === '正常可见';
          return <div key={person.id} className="rounded-md border border-white/[0.06] bg-white/[0.025] p-2"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-300'}`} /><span className="text-white/65">{person.name}</span><span className="ml-auto">{reason}</span></div>{rendered && <div className="mt-1 pl-3.5 text-white/25">距离 {rendered.distanceToShotCamera.toFixed(1)}m · 网格 {rendered.visibleMeshCount}</div>}</div>;
        })}{people.length === 0 && <div className="rounded-md border border-white/[0.06] p-3 text-center">工程数据里没有人物</div>}</div></div>
      </div>
      <div className="shrink-0 border-t border-white/[0.07] p-3"><button onClick={onRepair} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-white text-[9px] font-medium text-black"><RefreshCw size={11} />修复并显示全部白模</button></div>
    </div>
  );
}

function DebugValue({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return <div className="rounded-md bg-black/20 px-2 py-1.5"><div className="text-[7px] text-white/25">{label}</div><div className={`mt-0.5 ${ok ? 'text-white/60' : 'text-amber-200/70'}`}>{value}</div></div>;
}

export function DesignPanel({ messages, input, setInput, ready, consulting, loading, onSend, onConfirm, onReset, recognizing, onRecognize }: {
  messages: DirectorConsultMessage[];
  input: string;
  setInput: (value: string) => void;
  ready: boolean;
  consulting: boolean;
  loading: boolean;
  onSend: () => void;
  onConfirm: () => void;
  onReset: () => void;
  recognizing: boolean;
  onRecognize?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <Sparkles size={14} /><span className="text-[11px] font-medium">导演助手</span>
        <span className="flex-1" />
        <button type="button" onClick={onReset} disabled={consulting || loading} className="director-icon-btn h-7 w-7" title="重新沟通"><RefreshCw size={10} /></button>
        {onRecognize && <button type="button" onClick={onRecognize} disabled={recognizing} className="flex h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 text-[8px] text-white/40 hover:bg-white/[0.05] hover:text-white/65 disabled:cursor-wait disabled:opacity-40" title="手动重新读取分镜图的人物站位和摄影机角度">
          <RefreshCw size={9} className={recognizing ? 'animate-spin' : ''} />{recognizing ? '识别中' : '重新识别'}
        </button>}
      </div>
      <div className="min-h-[76px] flex-1 space-y-2 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/20 p-2.5">
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] break-words rounded-lg px-2.5 py-2 text-[9px] leading-relaxed ${message.role === 'user' ? 'bg-white text-black' : 'bg-white/[0.07] text-white/65'}`}>{message.content}</div></div>)}
        {consulting && <div className="flex items-center gap-1.5 px-1 py-1 text-[8px] text-white/30"><Loader2 size={10} className="animate-spin" />导演助手正在梳理你的想法</div>}
      </div>
      <div className="mt-2 flex shrink-0 items-end gap-1.5 rounded-lg border border-white/10 bg-black/25 p-1.5 focus-within:border-white/20">
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }} rows={2} placeholder="回复导演助手，Enter 发送" className="min-h-[44px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[9px] leading-relaxed text-white outline-none placeholder:text-white/25" />
        <button type="button" onClick={onSend} disabled={!input.trim() || consulting || loading} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-black disabled:opacity-25" title="发送"><Send size={12} /></button>
      </div>
      {ready && <button onClick={onConfirm} disabled={loading || consulting} className="mt-2 flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-white text-[10px] font-medium text-black disabled:opacity-50">{loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}确认需求，生成 3 套方案</button>}
    </div>
  );
}

function ExportPanel({ exporting, status, progress, issueCount, currentTime, duration, inSec, outSec, outputPath, lastExportPath, onChooseOutput, onRevealOutput, onResetOutput, onChangeIn, onChangeOut, onUseCurrentIn, onUseCurrentOut, onResetRange, onCancel, onStill, onTopView, onPathMap, onTransparent, onVideo, onFinalImage, onSeedance, onStillWriteback, onPrevisWriteback }: { exporting: boolean; status: string; progress: number; issueCount: number; currentTime: number; duration: number; inSec: number; outSec: number; outputPath: string; lastExportPath: string; onChooseOutput: () => void; onRevealOutput: () => void; onResetOutput: () => void; onChangeIn: (value: number) => void; onChangeOut: (value: number) => void; onUseCurrentIn: () => void; onUseCurrentOut: () => void; onResetRange: () => void; onCancel: () => void; onStill: () => void; onTopView: () => void; onPathMap: () => void; onTransparent: () => void; onVideo: () => void; onFinalImage: () => void; onSeedance: () => void; onStillWriteback: () => void; onPrevisWriteback: () => void }) {
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mb-3 flex items-center gap-2"><Download size={14} /><span className="text-[11px] font-medium">导出与回传</span></div>
      {issueCount > 0 && <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-2 text-[9px] text-white/55"><AlertTriangle size={12} /><span>有 {issueCount} 条可选优化建议，不影响导出</span></div>}
      <div className="mb-3 rounded-lg border border-white/[0.08] bg-black/15 p-2.5">
        <div className="mb-2 flex items-center justify-between"><span className="text-[9px] font-medium text-white/65">视频导出范围</span><button onClick={onResetRange} disabled={exporting} className="text-[8px] text-white/35 hover:text-white/65">全部时长</button></div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="mb-1 block text-[7px] text-white/30">入点 I · 秒</span><input type="number" min={0} max={Math.max(0, outSec - DIRECTOR_FRAME_SEC)} step={DIRECTOR_FRAME_SEC} value={Number(inSec.toFixed(3))} disabled={exporting} onChange={(event) => onChangeIn(Number(event.target.value))} className="director-input font-mono" /><button onClick={onUseCurrentIn} disabled={exporting || currentTime >= outSec} className="mt-1 h-6 w-full rounded border border-white/[0.07] text-[7px] text-white/40 hover:bg-white/[0.05]">取当前播放头</button></label>
          <label><span className="mb-1 block text-[7px] text-white/30">出点 O · 秒</span><input type="number" min={inSec + DIRECTOR_FRAME_SEC} max={duration} step={DIRECTOR_FRAME_SEC} value={Number(outSec.toFixed(3))} disabled={exporting} onChange={(event) => onChangeOut(Number(event.target.value))} className="director-input font-mono" /><button onClick={onUseCurrentOut} disabled={exporting || currentTime <= inSec} className="mt-1 h-6 w-full rounded border border-white/[0.07] text-[7px] text-white/40 hover:bg-white/[0.05]">取当前播放头</button></label>
        </div>
        <div className="mt-2 flex items-center justify-between rounded bg-white/[0.035] px-2 py-1.5 font-mono text-[7px] text-white/35"><span>{fmtTimecode(inSec)}</span><span>{Math.max(1, Math.round((outSec - inSec) * DIRECTOR_FPS))} 帧 · {(outSec - inSec).toFixed(2)}s</span><span>{fmtTimecode(outSec)}</span></div>
      </div>
      <div className="mb-3 rounded-lg border border-white/[0.18] bg-white/[0.055] p-3 shadow-[0_8px_22px_rgba(0,0,0,.16)]">
        <div className="mb-2 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-black"><Save size={13} /></span><span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold text-white/85">保存位置</span><span className="mt-0.5 block text-[7px] text-white/35">导出前可修改，完成后可在 Finder 中定位</span></span><span className="rounded border border-white/10 px-1.5 py-1 text-[7px] text-white/45">{outputPath ? '自定义' : '默认'}</span></div>
        <div className="mb-2 min-h-9 break-all rounded-md bg-black/25 px-2.5 py-2 font-mono text-[8px] leading-relaxed text-white/55">{lastExportPath || outputPath || '鲲鹏产物库 / 当日工作区 / videos'}</div>
        <div className="grid grid-cols-2 gap-2"><button onClick={onChooseOutput} disabled={exporting} className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white text-[8px] font-medium text-black disabled:opacity-40"><Save size={11} />选择导出位置</button><button onClick={onRevealOutput} disabled={exporting} className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/12 text-[8px] text-white/65 hover:bg-white/[0.06] disabled:opacity-40"><FolderOpen size={11} />在 Finder 中打开</button></div>
        {outputPath && <button onClick={onResetOutput} disabled={exporting} className="mt-2 w-full text-center text-[7px] text-white/30 hover:text-white/60">恢复到鲲鹏默认产物库</button>}
      </div>
      <button onClick={onStill} disabled={exporting} className="mb-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] text-white/70 hover:bg-white/[0.05]"><ImageIcon size={13} />导出播放头当前帧 · {fmtTimecode(currentTime)}</button>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <button onClick={onTopView} disabled={exporting} className="h-8 rounded-lg border border-white/10 text-[9px] text-white/55 hover:bg-white/[0.05]">俯视图</button>
        <button onClick={onPathMap} disabled={exporting} className="h-8 rounded-lg border border-white/10 text-[9px] text-white/55 hover:bg-white/[0.05]">路径图</button>
        <button onClick={onTransparent} disabled={exporting} className="h-8 rounded-lg border border-white/10 text-[9px] text-white/55 hover:bg-white/[0.05]">透明 PNG</button>
      </div>
      <div className="mb-2 rounded-lg border border-white/[0.08] bg-black/15 p-2.5"><div className="flex items-center justify-between text-[8px] text-white/40"><span>专业预演成片</span><span>MP4 · H.264 · 1080p · 24fps</span></div>{exporting && <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${Math.max(1, progress)}%` }} /></div><div className="mt-2 flex items-start gap-2"><Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-white/55" /><span className="min-w-0 flex-1 text-[8px] leading-relaxed text-white/45">{status || '准备导出'}</span><button onClick={onCancel} className="shrink-0 rounded border border-white/10 px-2 py-1 text-[8px] text-white/55 hover:bg-white/[0.06]">停止</button></div></>}</div>
      <button onClick={onVideo} disabled={exporting} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white text-[10px] font-medium text-black disabled:opacity-50">{exporting ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}导出预演 MP4</button>
      <div className="mt-2 grid grid-cols-2 gap-1.5"><button onClick={onStillWriteback} disabled={exporting} className="h-8 rounded-lg border border-white/10 text-[9px] text-white/55 hover:bg-white/[0.05]">回传白模图</button><button onClick={onPrevisWriteback} disabled={exporting} className="h-8 rounded-lg border border-white/10 text-[9px] text-white/55 hover:bg-white/[0.05]">回传白模视频</button></div>
      <div className="my-3 h-px bg-white/[0.07]" />
      <button onClick={onFinalImage} disabled={exporting} className="mb-2 flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] text-white/70 hover:bg-white/[0.05]"><Sparkles size={13} />渲染正式分镜</button>
      <button onClick={onSeedance} disabled={exporting} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-white/10 text-[10px] text-white/70 hover:bg-white/[0.05]"><Film size={13} />Seedance 成片</button>
      {!exporting && status && <p className="mt-2 text-center text-[9px] text-white/40">{status}</p>}
    </div>
  );
}

function HealthBadge({ issues, dockOpen }: { issues: ReturnType<typeof inspectDirectorPlan>; dockOpen: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`absolute bottom-[296px] z-20 ${dockOpen ? 'right-[356px]' : 'right-4'}`}>
      <button onClick={() => setOpen(!open)} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-black/60 px-2.5 text-[9px] text-white/60"><AlertTriangle size={12} />{issues.length} 项检查</button>
      {open && <div className="absolute bottom-10 right-0 w-[260px] rounded-lg border border-white/10 bg-[#191a1e] p-2 shadow-xl">{issues.map((issue) => <button key={issue.id} onClick={() => issue.shotId && useDirectorStore.getState().setActiveShot(issue.shotId)} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-[9px] text-white/55 hover:bg-white/[0.05]"><AlertTriangle size={10} className="mt-0.5 shrink-0" />{issue.message}</button>)}</div>}
    </div>
  );
}

function PropertyDrawer({ selected, shot, onBeginStageEdit, onClose }: { selected?: DirectorElement; shot?: DirectorSequenceShot; onBeginStageEdit: () => void; onClose: () => void }) {
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="mb-4 flex items-center justify-between"><span className="text-[11px] font-medium">{selected?.name ?? shot?.name ?? '属性'}</span><button onClick={onClose} className="director-icon-btn h-7 w-7"><X size={13} /></button></div>
      {isMotionActor(selected) && shot && <ActionProperties element={selected} shot={shot} onBeginStageEdit={onBeginStageEdit} />}
      {selected && (selected.kind === 'mannequin' ? <details className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.02]"><summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[9px] text-white/45"><SlidersHorizontal size={11} />人物位置与外形<span className="ml-auto text-[7px] text-white/20">高级调整</span></summary><div className="border-t border-white/[0.06] p-3"><ElementProperties element={selected} /></div></details> : <ElementProperties element={selected} />)}
      {shot && !selected && <ShotProperties shot={shot} />}
    </div>
  );
}

function ElementProperties({ element }: { element: DirectorElement }) {
  const update = (patch: Partial<DirectorElement>) => useDirectorStore.getState().updateElement(element.id, patch);
  const checkpoint = () => useDirectorStore.getState().checkpoint();
  return (
    <div className="space-y-4">
      <label className="block"><span className="director-label">名称</span><input value={element.name} onFocus={checkpoint} onChange={(event) => update({ name: event.target.value })} className="director-input" /></label>
      {(element.kind === 'mannequin' || element.kind === 'crowd') && <div><span className="director-label">角色识别色</span><div className="flex flex-wrap gap-1.5">{ACTOR_IDENTITY_COLORS.map((color) => <button key={color} onClick={() => { checkpoint(); update({ color }); }} className={`h-6 w-6 rounded-full border-2 ${element.color === color ? 'border-white' : 'border-transparent opacity-70 hover:opacity-100'}`} style={{ backgroundColor: color }} title={`设置识别色 ${color}`} />)}</div><p className="mt-1.5 text-[7px] leading-relaxed text-white/25">识别色和姓名只用于导演台辨认，不进入最终镜头与导出。</p></div>}
      {element.kind === 'mannequin' && <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5"><label className="block"><span className="director-label">人物表演模板</span><select value={element.performanceProfileId ?? 'neutral'} onFocus={checkpoint} onChange={(event) => { const profile = characterPerformanceTemplate(event.target.value); const pose = findPose(profile.defaultPoseId); update({ performanceProfileId: profile.id, motionScale: profile.motionScale, personalSpaceM: profile.personalSpaceM, poseId: pose?.id ?? element.poseId, joints: pose?.joints ?? element.joints } as Partial<DirectorElement>); }} className="director-input">{CHARACTER_PERFORMANCE_TEMPLATES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label><p className="mt-1.5 text-[8px] leading-relaxed text-white/30">{characterPerformanceTemplate(element.performanceProfileId).description}</p><div className="mt-2 grid grid-cols-2 gap-2"><label><span className="director-label">动作幅度</span><input type="number" min={0.4} max={1.8} step={0.05} value={element.motionScale ?? 1} onFocus={checkpoint} onChange={(event) => update({ motionScale: Number(event.target.value) } as Partial<DirectorElement>)} className="director-input" /></label><label><span className="director-label">惯用手</span><select value={element.dominantHand ?? 'right'} onFocus={checkpoint} onChange={(event) => update({ dominantHand: event.target.value as 'left' | 'right' } as Partial<DirectorElement>)} className="director-input"><option value="right">右手</option><option value="left">左手</option></select></label></div></div>}
      <RotationOrb label="自由旋转" value={element.rotationDeg} onStart={checkpoint} onChange={(rotationDeg) => update({ rotationDeg })} />
      <ScaleControl value={element.scale} onChange={(scale) => update({ scale })} />
      <VecEditor label="位置" value={element.position} onStart={checkpoint} onChange={(position) => update({ position })} />
      <VecEditor label="朝向" value={element.rotationDeg} step={5} onStart={checkpoint} onChange={(rotationDeg) => update({ rotationDeg })} />
      <VecEditor label="大小" value={element.scale} step={0.05} onStart={checkpoint} onChange={(scale) => update({ scale: { x: Math.max(0.05, scale.x), y: Math.max(0.05, scale.y), z: Math.max(0.05, scale.z) } })} />
      <button onClick={() => useDirectorStore.getState().removeElements([element.id])} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 text-[9px] text-white/45 hover:text-red-300"><Trash2 size={11} />删除对象</button>
    </div>
  );
}

function ShotProperties({ shot }: { shot: DirectorSequenceShot }) {
  const update = (patch: Partial<DirectorSequenceShot>, recordHistory = true) => {
    const store = useDirectorStore.getState();
    if (recordHistory) store.checkpoint();
    const touchesCamera = patch.cameraKeyframes === undefined && Boolean(patch.position || patch.target || patch.fov !== undefined || patch.rollDeg !== undefined);
    const nextShot = { ...shot, ...patch };
    if (!touchesCamera) { store.updateShot(shot.id, patch); return; }
    const generated = cameraPatchFromTemplate(nextShot, nextShot.cameraMove);
    const locked = shot.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? [];
    const cameraKeyframes = [
      ...(generated.cameraKeyframes ?? []).filter((candidate) => !locked.some((keyframe) => Math.abs(keyframe.timeSec - candidate.timeSec) < 0.04)),
      ...locked,
    ].sort((a, b) => a.timeSec - b.timeSec);
    store.updateShot(shot.id, { ...patch, ...generated, cameraKeyframes });
  };
  const mannequins = useDirectorStore.getState().elements.filter((element) => element.kind === 'mannequin');
  const scalePresets: Array<{ id: DirectorShotScale; label: string; distance: number; focal: number; targetY: number }> = [
    { id: 'extreme-wide', label: '大全景', distance: 12, focal: 24, targetY: 0.9 },
    { id: 'wide', label: '全景', distance: 7.5, focal: 35, targetY: 0.95 },
    { id: 'medium', label: '中景', distance: 4.8, focal: 50, targetY: 1.05 },
    { id: 'medium-close', label: '中近景', distance: 3.3, focal: 65, targetY: 1.2 },
    { id: 'close-up', label: '特写', distance: 2.05, focal: 85, targetY: 1.43 },
    { id: 'extreme-close-up', label: '大特写', distance: 1.25, focal: 105, targetY: 1.53 },
  ];
  const applyScale = (preset: typeof scalePresets[number]) => {
    const state = useDirectorStore.getState();
    const primary = state.elements.find((element) => element.id === shot.primaryElementId) ?? state.elements.find((element) => element.kind === 'mannequin');
    const primaryPosition = primary ? (shot.elementStates[primary.id]?.position ?? primary.position) : { x: 0, y: 0, z: 0 };
    const target = { x: primaryPosition.x, y: preset.targetY, z: primaryPosition.z };
    const dx = shot.position.x - shot.target.x;
    const dy = shot.position.y - shot.target.y;
    const dz = shot.position.z - shot.target.z;
    const length = Math.max(0.01, Math.hypot(dx, dy, dz));
    const direction = { x: dx / length, y: dy / length, z: dz / length };
    const position = { x: target.x + direction.x * preset.distance, y: Math.max(0.35, target.y + direction.y * preset.distance), z: target.z + direction.z * preset.distance };
    const fov = Math.max(12, Math.min(65, (2 * Math.atan(24 / (2 * preset.focal)) * 180) / Math.PI));
    update({ shotScale: preset.id, focalLengthMm: preset.focal, fov, position, target, cameraEnd: { ...shot.cameraEnd, position: { ...position }, target: { ...target }, fov } });
  };
  const applyYaw = (yawDeg: number) => {
    const distance = Math.max(0.5, Math.hypot(shot.position.x - shot.target.x, shot.position.z - shot.target.z));
    const yaw = yawDeg * Math.PI / 180;
    const position = { ...shot.position, x: shot.target.x + Math.sin(yaw) * distance, z: shot.target.z + Math.cos(yaw) * distance };
    update({ position, cameraEnd: { ...shot.cameraEnd, position: { ...position } }, recognition: { ...(shot.recognition ?? { version: 2, confidence: 1 }), cameraYawDeg: yawDeg } });
  };
  const applyPitch = (pitchDeg: number) => {
    const horizontal = Math.max(0.5, Math.hypot(shot.position.x - shot.target.x, shot.position.z - shot.target.z));
    const position = { ...shot.position, y: Math.max(0.3, shot.target.y + Math.tan(pitchDeg * Math.PI / 180) * horizontal) };
    update({ position, cameraEnd: { ...shot.cameraEnd, position: { ...position } }, recognition: { ...(shot.recognition ?? { version: 2, confidence: 1 }), cameraPitchDeg: pitchDeg } }, false);
  };
  const directorState = useDirectorStore.getState();
  const evaluatedCamera = activeDirectorPlan(directorState)
    ? evaluateDirectorFrame(activeDirectorPlan(directorState)!, directorState.elements, directorState.currentTimeSec)?.camera
    : undefined;
  const displayedCamera = evaluatedCamera ?? { position: shot.position, target: shot.target, fov: shot.fov, rollDeg: shot.rollDeg ?? 0 };
  const cameraVector = { x: displayedCamera.target.x - displayedCamera.position.x, y: displayedCamera.target.y - displayedCamera.position.y, z: displayedCamera.target.z - displayedCamera.position.z };
  const cameraHorizontal = Math.max(0.001, Math.hypot(cameraVector.x, cameraVector.z));
  const cameraRotation = {
    x: Math.atan2(cameraVector.y, cameraHorizontal) * 180 / Math.PI,
    y: Math.atan2(cameraVector.x, -cameraVector.z) * 180 / Math.PI,
    z: displayedCamera.rollDeg ?? 0,
  };
  const applyFreeCameraRotation = (rotation: Vec3) => {
    const store = useDirectorStore.getState();
    const currentShot = store.plans.flatMap((plan) => plan.shots).find((item) => item.id === shot.id) ?? shot;
    const currentPlan = activeDirectorPlan(store);
    const camera = currentPlan ? evaluateDirectorFrame(currentPlan, store.elements, store.currentTimeSec)?.camera ?? displayedCamera : displayedCamera;
    const distance = Math.max(0.5, Math.hypot(camera.target.x - camera.position.x, camera.target.y - camera.position.y, camera.target.z - camera.position.z));
    const pitch = rotation.x * Math.PI / 180;
    const yaw = rotation.y * Math.PI / 180;
    const cosPitch = Math.cos(pitch);
    const target = {
      x: camera.position.x + Math.sin(yaw) * cosPitch * distance,
      y: camera.position.y + Math.sin(pitch) * distance,
      z: camera.position.z - Math.cos(yaw) * cosPitch * distance,
    };
    const timeSec = Math.max(0, Math.min(currentShot.durationSec, store.currentTimeSec - currentShot.startSec));
    const existing = currentShot.cameraKeyframes?.find((frame) => Math.abs(frame.timeSec - timeSec) < 0.04);
    const keyframe = {
      id: existing?.id ?? `ckf-${nanoid(7)}`,
      timeSec: Number(timeSec.toFixed(3)),
      position: { ...camera.position },
      target: { ...target },
      fov: camera.fov,
      rollDeg: rotation.z,
      interpolation: existing?.interpolation ?? 'smooth' as const,
      locked: true,
      source: 'manual' as const,
      note: '球面旋转机位',
    };
    const cameraKeyframes = [...(currentShot.cameraKeyframes ?? []).filter((frame) => frame.id !== keyframe.id && Math.abs(frame.timeSec - timeSec) >= 0.04), keyframe].sort((a, b) => a.timeSec - b.timeSec);
    const endpointPatch = timeSec <= 0.04
      ? { position: { ...camera.position }, target: { ...target }, rollDeg: rotation.z }
      : Math.abs(timeSec - currentShot.durationSec) <= 0.04
        ? { cameraEnd: { ...currentShot.cameraEnd, position: { ...camera.position }, target: { ...target }, fov: camera.fov, rollDeg: rotation.z } }
        : {};
    store.updateShot(currentShot.id, {
      ...endpointPatch,
      cameraKeyframes,
      recognition: { ...(currentShot.recognition ?? { version: 2, confidence: 1 }), cameraYawDeg: rotation.y, cameraPitchDeg: rotation.x },
    });
  };
  const addCurrentCameraKeyframe = () => {
    const store = useDirectorStore.getState();
    const plan = activeDirectorPlan(store);
    if (!plan) return;
    const frame = evaluateDirectorFrame(plan, store.elements, store.currentTimeSec);
    if (!frame) return;
    const timeSec = Math.max(0, Math.min(shot.durationSec, store.currentTimeSec - shot.startSec));
    const next = { id: `ckf-${nanoid(7)}`, timeSec: Number(timeSec.toFixed(3)), position: { ...frame.camera.position }, target: { ...frame.camera.target }, fov: frame.camera.fov, rollDeg: frame.camera.rollDeg ?? 0, interpolation: 'smooth' as const, locked: true, source: 'manual' as const, note: '人工摄影机关键帧' };
    const frames = [...(shot.cameraKeyframes ?? []).filter((item) => Math.abs(item.timeSec - timeSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec);
    store.checkpoint();
    update({ cameraKeyframes: frames });
  };
  const applyCameraTemplateSafely = (move: DirectorCameraMove) => {
    const generated = cameraPatchFromTemplate(shot, move);
    const locked = shot.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? [];
    const cameraKeyframes = [...(generated.cameraKeyframes ?? []).filter((candidate) => !locked.some((keyframe) => Math.abs(keyframe.timeSec - candidate.timeSec) < 0.04)), ...locked].sort((a, b) => a.timeSec - b.timeSec);
    useDirectorStore.getState().checkpoint();
    useDirectorStore.getState().updateShot(shot.id, { ...generated, cameraKeyframes });
  };
  return (
    <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-4">
      <div className="text-[10px] font-medium text-white/65">当前镜头</div>
      {shot.recognition && <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-2 text-[8px] leading-relaxed text-white/40"><div className="mb-1 font-medium text-white/60">识别依据 · {Math.round(shot.recognition.confidence * 100)}%</div><div>头部占比 {Math.round((shot.recognition.evidence?.headHeightRatio ?? 0) * 100)}% · 身体占比 {Math.round((shot.recognition.evidence?.bodyHeightRatio ?? 0) * 100)}% · 水平 {Math.round(shot.recognition.cameraYawDeg ?? 0)}° · 俯仰 {Math.round(shot.recognition.cameraPitchDeg ?? 0)}°</div></div>}
      {mannequins.length > 0 && <label className="block"><span className="director-label">主要人物</span><select value={shot.primaryElementId ?? mannequins[0].id} onChange={(event) => { const element = mannequins.find((item) => item.id === event.target.value); if (!element) return; const position = shot.elementStates[element.id]?.position ?? element.position; update({ primaryElementId: element.id, target: { x: position.x, y: shot.shotScale === 'close-up' || shot.shotScale === 'extreme-close-up' ? 1.45 : 1, z: position.z } }); }} className="director-input">{mannequins.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}</select></label>}
      <div><span className="director-label">景别快捷档位</span><div className="grid grid-cols-3 gap-1">{scalePresets.map((preset) => <button key={preset.id} onClick={() => applyScale(preset)} className={`h-7 rounded-md border text-[8px] ${shot.shotScale === preset.id ? 'border-white/20 bg-white/10 text-white' : 'border-white/[0.07] text-white/40 hover:bg-white/[0.05]'}`}>{preset.label}</button>)}</div></div>
      <div><span className="director-label">水平角度</span><div className="grid grid-cols-4 gap-1">{[[-90, '左侧'], [-45, '左前'], [0, '正面'], [45, '右前'], [90, '右侧'], [135, '右后'], [180, '背面'], [-135, '左后']].map(([angle, label]) => <button key={angle} onClick={() => applyYaw(Number(angle))} className="h-7 rounded-md border border-white/[0.07] text-[8px] text-white/40 hover:bg-white/[0.05]">{label}</button>)}</div></div>
      <RotationOrb label="自由旋转镜头" value={cameraRotation} pitchRange={[-85, 85]} onStart={() => useDirectorStore.getState().checkpoint()} onChange={applyFreeCameraRotation} />
      <label className="block"><span className="director-label">俯仰角 {Math.round(shot.recognition?.cameraPitchDeg ?? 0)}°</span><input type="range" min={-35} max={70} step={1} value={shot.recognition?.cameraPitchDeg ?? 0} onPointerDown={() => useDirectorStore.getState().checkpoint()} onChange={(event) => applyPitch(Number(event.target.value))} className="w-full accent-white" /></label>
      <label className="block"><span className="director-label">画面倾斜</span><input type="number" min={-30} max={30} step={1} value={shot.rollDeg ?? 0} onFocus={() => useDirectorStore.getState().checkpoint()} onChange={(event) => update({ rollDeg: Number(event.target.value), cameraEnd: { ...shot.cameraEnd, rollDeg: Number(event.target.value) } }, false)} className="director-input" /></label>
      <div className="grid grid-cols-2 gap-2"><label><span className="director-label">焦段 mm</span><input type="number" min={18} max={135} value={Math.round(shot.focalLengthMm ?? 50)} onFocus={() => useDirectorStore.getState().checkpoint()} onChange={(event) => { const focal = Number(event.target.value); const fov = (2 * Math.atan(24 / (2 * focal)) * 180) / Math.PI; update({ focalLengthMm: focal, fov, cameraEnd: { ...shot.cameraEnd, fov } }, false); }} className="director-input" /></label><label><span className="director-label">FOV</span><input type="number" min={10} max={80} value={Number(shot.fov.toFixed(1))} onFocus={() => useDirectorStore.getState().checkpoint()} onChange={(event) => update({ fov: Number(event.target.value) }, false)} className="director-input" /></label></div>
      <label className="block"><span className="director-label">名称</span><input value={shot.name} onFocus={() => useDirectorStore.getState().checkpoint()} onChange={(event) => update({ name: event.target.value }, false)} className="director-input" /></label>
      <label className="block"><span className="director-label">时长</span><input type="number" min={0.25} step={0.25} value={shot.durationSec} onFocus={() => useDirectorStore.getState().checkpoint()} onChange={(event) => update({ durationSec: Number(event.target.value) }, false)} className="director-input" /></label>
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2.5">
        <label className="block"><span className="director-label">电影运镜模板</span><select value={shot.cameraMove} onChange={(event) => applyCameraTemplateSafely(event.target.value as DirectorCameraMove)} className="director-input">{[...new Set(CAMERA_TEMPLATES.map((item) => item.category))].map((category) => <optgroup key={category} label={category}>{CAMERA_TEMPLATES.filter((item) => item.category === category).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
        <div className="mt-2 flex items-start justify-between gap-2 text-[8px] leading-relaxed text-white/35"><span>{cameraTemplate(shot.cameraMove).description}</span><span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5">{shot.cameraKeyframes?.length ?? 0} K</span></div>
        <button onClick={addCurrentCameraKeyframe} className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-md border border-white/10 text-[8px] text-white/50 hover:text-white"><Plus size={10} />当前时间添加摄影机 K 帧</button>
        {(shot.cameraKeyframes?.length ?? 0) > 0 && <div className="mt-2 max-h-[130px] space-y-1 overflow-y-auto border-t border-white/[0.06] pt-2">{[...(shot.cameraKeyframes ?? [])].sort((a, b) => a.timeSec - b.timeSec).map((keyframe) => <div key={keyframe.id} className="grid grid-cols-[54px_1fr_22px_20px] items-center gap-1 rounded bg-black/15 px-1.5 py-1"><input type="number" min={0} max={shot.durationSec} step={1 / 24} value={Number(keyframe.timeSec.toFixed(3))} onChange={(event) => update({ cameraKeyframes: shot.cameraKeyframes?.map((item) => item.id === keyframe.id ? { ...item, timeSec: Number(event.target.value), source: 'manual', locked: true } : item) })} className="h-6 rounded bg-black/20 px-1 text-[8px] text-white/55 outline-none" /><select value={keyframe.interpolation} onChange={(event) => update({ cameraKeyframes: shot.cameraKeyframes?.map((item) => item.id === keyframe.id ? { ...item, interpolation: event.target.value as typeof item.interpolation, source: 'manual' } : item) })} className="h-6 min-w-0 rounded bg-black/20 px-1 text-[7px] text-white/45 outline-none"><option value="smooth">平滑</option><option value="linear">线性</option><option value="hold">保持</option><option value="ease-in">缓入</option><option value="ease-out">缓出</option></select><button onClick={() => update({ cameraKeyframes: shot.cameraKeyframes?.map((item) => item.id === keyframe.id ? { ...item, locked: !item.locked, source: 'manual' } : item) })} className={keyframe.locked ? 'text-white/65' : 'text-white/20'} title="锁定关键帧"><Lock size={9} /></button><button disabled={keyframe.locked} onClick={() => update({ cameraKeyframes: shot.cameraKeyframes?.filter((item) => item.id !== keyframe.id) })} className="text-white/20 hover:text-red-300 disabled:opacity-20"><X size={9} /></button></div>)}</div>}
      </div>
    </div>
  );
}

function actionStageLabel(keyframe: DirectorMotionKeyframe, index: number, total: number): string {
  if (keyframe.note === '自定义时刻') return '自定义';
  if (index === 0) return '动作开始';
  if (index === total - 1) return '动作结束';
  if (index === Math.floor(total / 2)) return '动作重点';
  return index < total / 2 ? '准备' : '缓冲';
}

function ActionProperties({ element, shot, onBeginStageEdit }: { element: DirectorElement; shot: DirectorSequenceShot; onBeginStageEdit: () => void }) {
  const actions = shot.actions.filter((action) => action.elementId === element.id);
  const label = element.kind === 'crowd' ? '群演' : '人物';
  if (!actions.length) return <div className="mt-5 rounded-lg border border-dashed border-white/10 p-3 text-center text-[8px] leading-relaxed text-white/30">这个{label}还没有动作。点击舞台上方或时间轴里的“编排动作”开始。</div>;
  return <div className="mt-5 space-y-3 border-t border-white/[0.07] pt-4"><div><div className="text-[10px] font-medium text-white/70">编辑{label}动作</div><p className="mt-1 text-[8px] leading-relaxed text-white/30">先选择动作中的一个时刻，再调整位置和朝向。单个人物还可以继续调整身体姿势。</p></div>{actions.map((action) => <ActionStageEditor key={action.id} element={element} shot={shot} action={action} onBeginStageEdit={onBeginStageEdit} />)}</div>;
}

const BODY_PARTS: Array<{ joint: JointName; label: string }> = [
  { joint: 'neck', label: '头颈' }, { joint: 'spine', label: '上身' },
  { joint: 'shoulderL', label: '左臂' }, { joint: 'shoulderR', label: '右臂' },
  { joint: 'elbowL', label: '左肘' }, { joint: 'elbowR', label: '右肘' },
  { joint: 'hipL', label: '左腿' }, { joint: 'hipR', label: '右腿' },
  { joint: 'kneeL', label: '左膝' }, { joint: 'kneeR', label: '右膝' },
];

function BodyPosePad({ keyframe, onChange, onStart }: { keyframe: DirectorMotionKeyframe; onChange: (patch: Partial<DirectorMotionKeyframe>) => void; onStart?: () => void }) {
  const [jointName, setJointName] = useState<JointName>('spine');
  const definition = JOINT_SLIDERS.find((item) => item.joint === jointName) ?? JOINT_SLIDERS[0];
  const joints = keyframe.joints ?? {};
  const joint = joints[jointName] ?? { x: 0, y: 0, z: 0 };
  return <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/10 p-2.5"><div className="mb-2 flex items-center gap-2"><PersonStanding size={11} className="text-white/45" /><span className="text-[8px] font-medium text-white/45">直接调整身体</span><span className="ml-auto text-[7px] text-white/20">先选部位，再拖动</span></div><div className="grid grid-cols-[104px_1fr] gap-3"><div className="grid grid-cols-2 gap-1">{BODY_PARTS.map((part) => <button key={part.joint} onClick={() => setJointName(part.joint)} className={`h-7 rounded-md border text-[7px] ${jointName === part.joint ? 'border-white/20 bg-white/10 text-white/75' : 'border-white/[0.06] text-white/30 hover:bg-white/[0.04]'}`}>{part.label}</button>)}</div><div className="space-y-2">{definition.axes.map((axis) => <label key={axis} className="block"><span className="mb-1 flex justify-between text-[7px] text-white/30"><span>{axis === 'x' ? '前后' : axis === 'y' ? '扭转' : '侧向'}</span><span>{Math.round(joint[axis])}°</span></span><input type="range" min={definition.min} max={definition.max} step={2} value={joint[axis]} onPointerDown={onStart} onChange={(event) => onChange({ joints: { ...joints, [jointName]: { ...joint, [axis]: Number(event.target.value) } } })} className="w-full accent-white" /></label>)}</div></div></div>;
}

type ActionEditMode = 'position' | 'rotation' | 'pose' | 'timing';

function ActionStageEditor({ element, shot, action, onBeginStageEdit }: { element: DirectorElement; shot: DirectorSequenceShot; action: DirectorActionClip; onBeginStageEdit: () => void }) {
  const sorted = [...(action.keyframes ?? [])].sort((a, b) => a.timeSec - b.timeSec);
  const frameSignature = sorted.map((frame) => frame.id).join('|');
  const [selectedFrameId, setSelectedFrameId] = useState(sorted[Math.floor(sorted.length / 2)]?.id ?? '');
  const [editMode, setEditMode] = useState<ActionEditMode>('position');
  const [feedback, setFeedback] = useState('');
  const keyframe = sorted.find((frame) => frame.id === selectedFrameId) ?? sorted[0];
  const frameIndex = keyframe ? sorted.findIndex((frame) => frame.id === keyframe.id) : -1;

  useEffect(() => {
    if (!sorted.length) { setSelectedFrameId(''); return; }
    if (!sorted.some((frame) => frame.id === selectedFrameId)) setSelectedFrameId(sorted[Math.floor(sorted.length / 2)].id);
  }, [action.id, frameSignature, selectedFrameId]);

  const updateAction = (patch: Partial<DirectorActionClip>, recordHistory = true) => {
    const store = useDirectorStore.getState();
    if (recordHistory) store.checkpoint();
    store.updateAction(shot.id, action.id, { ...patch, source: 'manual' });
  };
  const activateFrame = (frame: DirectorMotionKeyframe, mode: TransformMode = 'translate', message = '') => {
    const store = useDirectorStore.getState();
    store.setPlaying(false);
    store.setCurrentTime(shot.startSec + action.startSec + frame.timeSec);
    store.setSelected([element.id]);
    store.setTransformMode(mode);
    setSelectedFrameId(frame.id);
    onBeginStageEdit();
    if (message) setFeedback(message);
  };
  const updateFrame = (patch: Partial<DirectorMotionKeyframe>, message = '修改已应用到当前时刻', recordHistory = true) => {
    if (!keyframe) return;
    const store = useDirectorStore.getState();
    const currentAction = store.plans.flatMap((plan) => plan.shots).find((item) => item.id === shot.id)?.actions.find((item) => item.id === action.id);
    const currentFrame = currentAction?.keyframes?.find((frame) => frame.id === keyframe.id) ?? keyframe;
    if (recordHistory) store.checkpoint();
    activateFrame(currentFrame, editMode === 'rotation' ? 'rotate' : 'translate');
    const frames = currentAction?.keyframes ?? action.keyframes ?? [];
    store.updateAction(shot.id, action.id, {
      keyframes: frames.map((frame) => frame.id === currentFrame.id ? { ...frame, ...patch, source: 'manual', locked: true } : frame),
      source: 'manual',
    });
    if (patch.timeSec !== undefined) {
      store.setCurrentTime(shot.startSec + action.startSec + Math.max(0, Math.min(action.durationSec, patch.timeSec)));
    }
    setFeedback(message);
  };
  const changeTemplate = (nextId: DirectorActionId) => {
    const template = motionTemplate(nextId);
    const durationSec = Math.max(0.2, Math.min(Math.max(0.2, shot.durationSec - action.startSec), template.defaultDurationSec));
    const distance = template.moving ? template.suggestedDistance ?? 1.5 : 0;
    const to = template.moving ? { x: action.from.x + distance, y: action.from.y, z: action.from.z } : { ...action.from };
    const frames = createMotionKeyframes(nextId, durationSec, action.from, to, 'manual');
    useDirectorStore.getState().checkpoint();
    updateAction({ action: nextId, templateId: nextId, durationSec, to, keyframes: frames }, false);
    const focus = frames[Math.floor(frames.length / 2)];
    if (focus) activateFrame(focus, 'translate', `已切换为“${template.label}”，正在显示动作重点`);
  };
  const addStageAtCurrentTime = () => {
    const store = useDirectorStore.getState();
    const plan = activeDirectorPlan(store);
    if (!plan) return;
    const timeSec = Math.max(0, Math.min(action.durationSec, store.currentTimeSec - shot.startSec - action.startSec));
    const absoluteTime = shot.startSec + action.startSec + timeSec;
    const evaluated = evaluateDirectorFrame(plan, store.elements, absoluteTime)?.elements.find((item) => item.id === element.id);
    const next: DirectorMotionKeyframe = { id: `kf-${nanoid(7)}`, timeSec: Number(timeSec.toFixed(3)), position: { ...(evaluated?.position ?? element.position) }, rotationDeg: { ...(evaluated?.rotationDeg ?? element.rotationDeg) }, joints: evaluated?.kind === 'mannequin' ? evaluated.joints : undefined, interpolation: 'smooth', locked: true, source: 'manual', note: '自定义时刻' };
    store.checkpoint();
    updateAction({ keyframes: [...(action.keyframes ?? []).filter((frame) => Math.abs(frame.timeSec - timeSec) >= 0.04), next].sort((a, b) => a.timeSec - b.timeSec) }, false);
    activateFrame(next, 'translate', '已增加并定位到新的动作时刻');
  };

  const position = keyframe?.position ?? action.from;
  const rotation = keyframe?.rotationDeg ?? { x: 0, y: 0, z: 0 };
  const tabs: Array<{ id: ActionEditMode; label: string; icon: typeof Move3D }> = [
    { id: 'position', label: '位置', icon: Move3D },
    { id: 'rotation', label: '朝向', icon: Rotate3D },
    { id: 'pose', label: '姿势', icon: PersonStanding },
    { id: 'timing', label: '节奏', icon: SlidersHorizontal },
  ];

  return <div className="rounded-lg border border-white/[0.08] bg-black/15 p-3">
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: element.color }} />
      <select value={action.action} onChange={(event) => changeTemplate(event.target.value as DirectorActionId)} className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-black/20 px-2 text-[9px] text-white/70 outline-none">{[...new Set(MOTION_TEMPLATES.map((item) => item.category))].map((category) => <optgroup key={category} label={category}>{MOTION_TEMPLATES.filter((item) => item.category === category).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select>
      <button onClick={() => useDirectorStore.getState().removeAction(shot.id, action.id)} className="director-icon-btn h-8 w-8 text-white/25 hover:text-red-300" title="删除整个动作"><Trash2 size={11} /></button>
    </div>

    <button onClick={() => updateAction({ locked: !action.locked })} className={`mt-2 flex min-h-[42px] w-full items-center gap-2 rounded-lg border px-3 text-left ${action.locked ? 'border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-100' : 'border-white/10 bg-white/[0.025] text-white/60 hover:bg-white/[0.05]'}`}><Lock size={13} className="shrink-0" /><span className="min-w-0 flex-1"><span className="block text-[9px] font-medium">{action.locked ? '人工修改已锁定' : '锁定人工修改'}</span><span className="mt-0.5 block text-[7px] opacity-55">{action.locked ? 'AI 不再覆盖，你仍可继续手动调整' : '锁定后 AI 不会改动这个动作'}</span></span><span className="text-[8px]">{action.locked ? '解除' : '锁定'}</span></button>

    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between"><div><div className="text-[9px] font-medium text-white/65">1. 选择要修改的时刻</div><div className="mt-0.5 text-[7px] text-white/25">舞台会自动暂停并跳到这里</div></div><button onClick={addStageAtCurrentTime} className="flex items-center gap-1 rounded-md border border-white/[0.07] px-2 py-1.5 text-[7px] text-white/40 hover:bg-white/[0.05]"><Plus size={9} />增加时刻</button></div>
      {sorted.length ? <div className="grid grid-cols-5 gap-1">{sorted.map((frame, index) => <button key={frame.id} onClick={() => activateFrame(frame, 'translate', `已定位到“${actionStageLabel(frame, index, sorted.length)}”`)} className={`min-w-0 rounded-md border px-1 py-2 text-center transition-colors ${keyframe?.id === frame.id ? 'border-white/25 bg-white/10 text-white' : 'border-white/[0.06] text-white/35 hover:bg-white/[0.04]'}`}><span className="block truncate text-[7px] font-medium">{actionStageLabel(frame, index, sorted.length)}</span><span className="mt-1 block text-[6px] opacity-45">{frame.timeSec.toFixed(1)}s</span></button>)}</div> : <button onClick={addStageAtCurrentTime} className="h-10 w-full rounded-lg border border-dashed border-white/10 text-[8px] text-white/35">增加第一个动作时刻</button>}
    </section>

    {keyframe && <section className="mt-4">
      <div className="mb-2"><div className="text-[9px] font-medium text-white/65">2. 选择要调整的内容</div><div className="mt-0.5 text-[7px] text-white/25">正在编辑：{actionStageLabel(keyframe, frameIndex, sorted.length)} · {keyframe.timeSec.toFixed(2)} 秒</div></div>
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-black/20 p-1">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setEditMode(id); activateFrame(keyframe, id === 'rotation' ? 'rotate' : 'translate', `已进入${label}调整`); }} className={`flex h-8 items-center justify-center gap-1 rounded-md text-[8px] ${editMode === id ? 'bg-white text-black' : 'text-white/35 hover:bg-white/[0.05] hover:text-white/65'}`}><Icon size={10} />{label}</button>)}</div>

      <div className="mt-2 min-h-[34px] rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-[7px] leading-relaxed text-white/40">{feedback ? <span className="flex items-center gap-1.5 text-white/60"><Check size={9} />{feedback}</span> : '选择一个调整方式。点击或拖动后，结果会立即显示在舞台中。'}</div>

      {editMode === 'position' && <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
        <button onClick={() => activateFrame(keyframe, 'translate', '舞台移动工具已就绪，拖动人物即可记录')} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white text-[8px] font-medium text-black"><MousePointer2 size={11} />在舞台中直接拖动人物</button>
        <div className="mx-auto mt-3 w-[116px]"><div className="mb-1.5 text-center text-[7px] text-white/30">小步移动</div><div className="grid grid-cols-3 gap-1"><span /><button onClick={() => updateFrame({ position: { ...position, z: position.z - 0.2 } }, '人物已向前移动 0.2 米')} className="director-icon-btn h-8 w-full"><ArrowUp size={11} /></button><span /><button onClick={() => updateFrame({ position: { ...position, x: position.x - 0.2 } }, '人物已向左移动 0.2 米')} className="director-icon-btn h-8 w-full"><ArrowLeft size={11} /></button><span className="flex items-center justify-center text-[6px] text-white/20">0.2m</span><button onClick={() => updateFrame({ position: { ...position, x: position.x + 0.2 } }, '人物已向右移动 0.2 米')} className="director-icon-btn h-8 w-full"><ArrowRight size={11} /></button><span /><button onClick={() => updateFrame({ position: { ...position, z: position.z + 0.2 } }, '人物已向后移动 0.2 米')} className="director-icon-btn h-8 w-full"><ArrowDown size={11} /></button><span /></div></div>
        <details className="mt-3 rounded-md border border-white/[0.06] bg-black/10"><summary className="cursor-pointer list-none px-2.5 py-2 text-[7px] text-white/30">精确坐标（高级）</summary><div className="border-t border-white/[0.05] p-2.5"><VecEditor label="人物位置" value={position} onStart={() => useDirectorStore.getState().checkpoint()} onChange={(next) => updateFrame({ position: next }, '人物位置已更新', false)} /></div></details>
      </div>}

      {editMode === 'rotation' && <div className="mt-3 space-y-2"><RotationOrb label="拖动球面调整人物朝向" value={rotation} onStart={() => { useDirectorStore.getState().checkpoint(); activateFrame(keyframe, 'rotate'); }} onChange={(next) => updateFrame({ rotationDeg: next }, '人物朝向已更新', false)} /><div className="grid grid-cols-2 gap-2"><button onClick={() => updateFrame({ rotationDeg: { ...rotation, y: rotation.y - 15 } }, '人物已向左转 15°')} className="h-8 rounded-lg border border-white/[0.07] text-[8px] text-white/45 hover:bg-white/[0.05]">向左转 15°</button><button onClick={() => updateFrame({ rotationDeg: { ...rotation, y: rotation.y + 15 } }, '人物已向右转 15°')} className="h-8 rounded-lg border border-white/[0.07] text-[8px] text-white/45 hover:bg-white/[0.05]">向右转 15°</button></div></div>}

      {editMode === 'pose' && <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">{element.kind === 'mannequin' && element.bodyType !== 'animal' ? <><div className="mb-2 text-[7px] text-white/30">常用姿势</div><div className="grid grid-cols-4 gap-1">{POSE_PRESETS.slice(0, 8).map((pose) => <button key={pose.id} onClick={() => updateFrame({ joints: pose.joints, note: pose.label }, `已应用“${pose.label}”姿势`)} className="h-8 rounded-md border border-white/[0.07] text-[7px] text-white/40 hover:bg-white/[0.06] hover:text-white/70">{pose.label}</button>)}</div><BodyPosePad keyframe={keyframe} onStart={() => useDirectorStore.getState().checkpoint()} onChange={(patch) => updateFrame(patch, '身体姿势已更新', false)} /></> : <div className="py-4 text-center text-[8px] text-white/30">{element.kind === 'crowd' ? '群演阵列使用整体位置、朝向和路径控制' : '动物模型暂时使用整体位置和朝向控制'}</div>}</div>}

      {editMode === 'timing' && <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"><div className="grid grid-cols-2 gap-2"><label><span className="director-label">这个姿势出现于</span><input type="number" min={0} max={action.durationSec} step={1 / 24} value={Number(keyframe.timeSec.toFixed(3))} onChange={(event) => updateFrame({ timeSec: Number(event.target.value) }, '动作时刻已更新')} className="director-input" /></label><label><span className="director-label">过渡方式</span><select value={keyframe.interpolation} onChange={(event) => updateFrame({ interpolation: event.target.value as DirectorMotionKeyframe['interpolation'] }, '动作过渡已更新')} className="director-input"><option value="smooth">自然平滑</option><option value="linear">匀速移动</option><option value="hold">停住再动</option><option value="ease-in">慢慢启动</option><option value="ease-out">慢慢停下</option></select></label></div><div className="mt-3 grid grid-cols-2 gap-2"><label><span className="director-label">整个动作开始</span><input type="number" min={0} max={shot.durationSec} step={0.1} value={action.startSec} onChange={(event) => updateAction({ startSec: Number(event.target.value) })} className="director-input" /></label><label><span className="director-label">整个动作持续</span><input type="number" min={0.2} max={shot.durationSec} step={0.1} value={action.durationSec} onChange={(event) => updateAction({ durationSec: Number(event.target.value) })} className="director-input" /></label></div></div>}

      <button onClick={() => { updateAction({ keyframes: action.keyframes?.filter((frame) => frame.id !== keyframe.id) }); setFeedback('已删除当前动作时刻'); }} className="mt-3 flex h-7 w-full items-center justify-center gap-1 rounded-md border border-white/[0.06] text-[7px] text-white/25 hover:text-red-300"><Trash2 size={8} />删除当前动作时刻</button>
    </section>}
  </div>;
}

export function LegacyActionProperties({ element, shot }: { element: DirectorElement; shot: DirectorSequenceShot }) {
  const actions = shot.actions.filter((action) => action.elementId === element.id);
  if (!actions.length) return null;
  const upsertCurrentKeyframe = (action: typeof actions[number], poseId?: string) => {
    const store = useDirectorStore.getState();
    const plan = activeDirectorPlan(store);
    if (!plan) return;
    const relativeTime = Math.max(0, Math.min(action.durationSec, store.currentTimeSec - shot.startSec - action.startSec));
    const evaluated = evaluateDirectorFrame(plan, store.elements, store.currentTimeSec)?.elements.find((item) => item.id === element.id);
    const pose = poseId ? findPose(poseId) : undefined;
    const next = {
      id: `kf-${nanoid(7)}`,
      timeSec: Number(relativeTime.toFixed(3)),
      position: { ...(evaluated?.position ?? element.position) },
      rotationDeg: { ...(evaluated?.rotationDeg ?? element.rotationDeg) },
      joints: pose?.joints ?? (evaluated?.kind === 'mannequin' ? evaluated.joints : undefined),
      interpolation: 'smooth' as const,
      locked: true,
      source: 'manual' as const,
      note: pose ? pose.label : '人工关键帧',
    };
    const frames = [...(action.keyframes ?? [])];
    const existingIndex = frames.findIndex((frame) => Math.abs(frame.timeSec - relativeTime) < 0.04);
    if (existingIndex >= 0) frames[existingIndex] = { ...frames[existingIndex], ...next, id: frames[existingIndex].id };
    else frames.push(next);
    store.checkpoint();
    store.updateAction(shot.id, action.id, { keyframes: frames.sort((a, b) => a.timeSec - b.timeSec), source: 'manual' });
  };
  return (
    <div className="mt-5 space-y-2 border-t border-white/[0.07] pt-4">
      <div className="flex items-center justify-between"><div className="text-[10px] font-medium text-white/65">动作与关键帧</div><span className="text-[8px] text-white/25">人工 K 帧自动锁定</span></div>
      {actions.map((action) => (
        <div key={action.id} className="rounded-lg border border-white/[0.07] bg-black/15 p-2.5">
          <div className="mb-2 flex items-center gap-2"><select disabled={action.locked} value={action.action} onChange={(event) => { const nextId = event.target.value as DirectorActionId; const template = motionTemplate(nextId); const durationSec = Math.min(shot.durationSec - action.startSec, template.defaultDurationSec); const distance = template.moving ? template.suggestedDistance ?? 1.5 : 0; const to = template.moving ? { x: action.from.x + distance, y: action.from.y, z: action.from.z } : { ...action.from }; useDirectorStore.getState().checkpoint(); useDirectorStore.getState().updateAction(shot.id, action.id, { action: nextId, templateId: nextId, durationSec, to, keyframes: createMotionKeyframes(nextId, durationSec, action.from, to, 'manual'), source: 'manual' }); }} className="h-7 min-w-0 flex-1 rounded bg-black/20 px-1.5 text-[9px] text-white/65 outline-none disabled:opacity-40">{[...new Set(MOTION_TEMPLATES.map((item) => item.category))].map((category) => <optgroup key={category} label={category}>{MOTION_TEMPLATES.filter((item) => item.category === category).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select><span className="text-[8px] text-white/25">{action.keyframes?.length ?? 0} K</span><button onClick={() => useDirectorStore.getState().updateAction(shot.id, action.id, { locked: !action.locked, source: 'manual' })} className={`flex h-6 items-center gap-1 rounded px-1.5 text-[8px] ${action.locked ? 'bg-white/10 text-white/70' : 'text-white/25 hover:text-white/60'}`} title="锁定后 Agent 不得覆盖"><Lock size={9} />{action.locked ? '已锁' : '锁定'}</button><button onClick={() => useDirectorStore.getState().removeAction(shot.id, action.id)} className="text-white/25 hover:text-red-300"><Trash2 size={10} /></button></div>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="director-label">开始</span><input disabled={action.locked} type="number" min={0} max={shot.durationSec} step={0.1} value={action.startSec} onChange={(event) => useDirectorStore.getState().updateAction(shot.id, action.id, { startSec: Number(event.target.value), source: 'manual' })} className="director-input disabled:opacity-35" /></label>
            <label><span className="director-label">持续</span><input disabled={action.locked} type="number" min={0.2} max={shot.durationSec} step={0.1} value={action.durationSec} onChange={(event) => useDirectorStore.getState().updateAction(shot.id, action.id, { durationSec: Number(event.target.value), source: 'manual' })} className="director-input disabled:opacity-35" /></label>
          </div>
          {element.kind === 'mannequin' && <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5"><select defaultValue="" onChange={(event) => { if (event.target.value) upsertCurrentKeyframe(action, event.target.value); event.currentTarget.value = ''; }} className="director-input"><option value="">当前帧套用姿态...</option>{POSE_PRESETS.map((pose) => <option key={pose.id} value={pose.id}>{pose.label}</option>)}</select><button onClick={() => upsertCurrentKeyframe(action)} className="flex h-8 items-center gap-1 rounded-md border border-white/10 px-2 text-[8px] text-white/55 hover:text-white"><Plus size={10} />K 帧</button></div>}
          {(action.keyframes?.length ?? 0) > 0 && <div className="mt-2 max-h-[250px] space-y-1 overflow-y-auto border-t border-white/[0.06] pt-2">{[...(action.keyframes ?? [])].sort((a, b) => a.timeSec - b.timeSec).map((keyframe, index) => <LegacyActionKeyframeEditor key={keyframe.id} shotId={shot.id} action={action} keyframe={keyframe} index={index} mannequin={element.kind === 'mannequin'} />)}</div>}
          <button onClick={() => {
            const store = useDirectorStore.getState();
            store.updateAction(shot.id, action.id, { to: { ...element.position }, keyframes: createMotionKeyframes(action.action, action.durationSec, action.from, element.position, 'manual'), source: 'manual' });
            store.updateElement(element.id, { position: { ...action.from } });
          }} className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-md border border-white/10 text-[8px] text-white/45 hover:text-white"><Move3D size={10} />当前位置设为路径终点</button>
        </div>
      ))}
    </div>
  );
}

function LegacyActionKeyframeEditor({ shotId, action, keyframe, index, mannequin }: { shotId: string; action: DirectorActionClip; keyframe: DirectorMotionKeyframe; index: number; mannequin: boolean }) {
  const updateKeyframe = (patch: Partial<DirectorMotionKeyframe>) => useDirectorStore.getState().updateAction(shotId, action.id, { keyframes: action.keyframes?.map((item) => item.id === keyframe.id ? { ...item, ...patch, source: 'manual', locked: true } : item), source: 'manual' });
  const position = keyframe.position ?? action.from;
  const rotation = keyframe.rotationDeg ?? { x: 0, y: 0, z: 0 };
  return <details className="rounded bg-white/[0.025] px-1.5 py-1 open:bg-white/[0.04]">
    <summary className="grid cursor-pointer list-none grid-cols-[18px_58px_1fr_22px] items-center gap-1">
      <span className="text-[7px] text-white/25">{index + 1}</span>
      <input onClick={(event) => event.stopPropagation()} type="number" min={0} max={action.durationSec} step={1 / 24} value={Number(keyframe.timeSec.toFixed(3))} onChange={(event) => updateKeyframe({ timeSec: Number(event.target.value) })} className="h-6 rounded bg-black/20 px-1 text-[8px] text-white/55 outline-none" />
      <select onClick={(event) => event.stopPropagation()} value={keyframe.interpolation} onChange={(event) => updateKeyframe({ interpolation: event.target.value as DirectorMotionKeyframe['interpolation'] })} className="h-6 min-w-0 rounded bg-black/20 px-1 text-[7px] text-white/45 outline-none"><option value="smooth">平滑</option><option value="linear">线性</option><option value="hold">保持</option><option value="ease-in">缓入</option><option value="ease-out">缓出</option></select>
      <Lock size={9} className={keyframe.locked ? 'text-white/60' : 'text-white/20'} />
    </summary>
    <div className="mt-2 space-y-2 border-t border-white/[0.05] pt-2">
      <div className="grid grid-cols-3 gap-1"><label><span className="director-label">X</span><input type="number" step={0.1} value={Number(position.x.toFixed(2))} onChange={(event) => updateKeyframe({ position: { ...position, x: Number(event.target.value) } })} className="director-input" /></label><label><span className="director-label">Z</span><input type="number" step={0.1} value={Number(position.z.toFixed(2))} onChange={(event) => updateKeyframe({ position: { ...position, z: Number(event.target.value) } })} className="director-input" /></label><label><span className="director-label">朝向</span><input type="number" step={5} value={Number(rotation.y.toFixed(1))} onChange={(event) => updateKeyframe({ rotationDeg: { ...rotation, y: Number(event.target.value) } })} className="director-input" /></label></div>
      {mannequin && <div className="space-y-1.5">{JOINT_SLIDERS.map((slider) => <div key={slider.joint} className="grid grid-cols-[52px_1fr] items-center gap-2"><span className="text-[7px] text-white/35">{slider.label}</span><div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${slider.axes.length}, minmax(0, 1fr))` }}>{slider.axes.map((axis) => { const joints = keyframe.joints ?? {}; const joint = joints[slider.joint] ?? { x: 0, y: 0, z: 0 }; return <label key={axis} className="relative"><span className="absolute left-1.5 top-1.5 text-[6px] uppercase text-white/20">{axis}</span><input type="number" min={slider.min} max={slider.max} step={2} value={Math.round(joint[axis])} onChange={(event) => updateKeyframe({ joints: { ...joints, [slider.joint]: { ...joint, [axis]: Number(event.target.value) } } })} className="h-6 w-full rounded bg-black/20 pl-4 pr-1 text-[7px] text-white/50 outline-none" /></label>; })}</div></div>)}</div>}
      <button onClick={() => useDirectorStore.getState().updateAction(shotId, action.id, { keyframes: action.keyframes?.filter((item) => item.id !== keyframe.id), source: 'manual' })} className="flex h-6 w-full items-center justify-center gap-1 rounded border border-white/[0.07] text-[7px] text-white/30 hover:text-red-300"><Trash2 size={8} />删除此关键帧</button>
    </div>
  </details>;
}

function VecEditor({ label, value, onChange, onStart, step = 0.1 }: { label: string; value: Vec3; onChange: (value: Vec3) => void; onStart?: () => void; step?: number }) {
  return <div><span className="director-label">{label}</span><div className="grid grid-cols-3 gap-1.5">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis} className="relative"><span className="absolute left-2 top-2 text-[8px] uppercase text-white/25">{axis}</span><input type="number" step={step} value={Number(value[axis].toFixed(2))} onFocus={onStart} onChange={(event) => onChange({ ...value, [axis]: Number(event.target.value) })} className="director-input pl-5" /></label>)}</div></div>;
}

function RotationOrb({ label, value, onChange, onStart, pitchRange = [-180, 180] }: { label: string; value: Vec3; onChange: (value: Vec3) => void; onStart?: () => void; pitchRange?: [number, number] }) {
  const dragRef = useRef<{ pointerId: number; x: number; y: number; value: Vec3 } | null>(null);
  const wrap = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
  return <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
    <div className="mb-2 flex items-center justify-between"><span className="director-label mb-0">{label}</span><span className="text-[7px] text-white/25">拖动球面 · Shift 调倾斜</span></div>
    <div className="flex items-center gap-3">
      <div
        role="slider"
        aria-label={label}
        tabIndex={0}
        onPointerDown={(event) => {
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, value: { ...value } };
          event.currentTarget.setPointerCapture(event.pointerId);
          onStart?.();
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (event.shiftKey) onChange({ ...drag.value, z: wrap(drag.value.z + dx * 0.7) });
          else onChange({ ...drag.value, x: Math.max(pitchRange[0], Math.min(pitchRange[1], drag.value.x - dy * 0.7)), y: wrap(drag.value.y + dx * 0.7) });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current = null; }}
        className="relative h-[88px] w-[88px] shrink-0 cursor-grab touch-none rounded-full border border-white/20 bg-black/20 outline-none active:cursor-grabbing focus:border-white/40"
      >
        <span className="absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-white/10" />
        <span className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-white/10" />
        <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-white/15" />
        <span className="absolute left-1/2 top-1/2 h-px w-[34px] origin-left bg-white/45" style={{ transform: `rotate(${value.y - 90}deg)` }} />
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-[8px] text-white/40">
        <div className="flex justify-between"><span>俯仰</span><span>{Math.round(value.x)}°</span></div>
        <div className="flex justify-between"><span>水平</span><span>{Math.round(value.y)}°</span></div>
        <div className="flex justify-between"><span>倾斜</span><span>{Math.round(value.z)}°</span></div>
        <button onClick={() => { onStart?.(); onChange({ x: 0, y: 0, z: 0 }); }} className="mt-1 h-6 w-full rounded border border-white/[0.07] text-[7px] text-white/35 hover:bg-white/[0.05]">归正</button>
      </div>
    </div>
  </div>;
}

function ScaleControl({ value, onChange }: { value: Vec3; onChange: (value: Vec3) => void }) {
  const resize = (factor: number) => {
    useDirectorStore.getState().checkpoint();
    onChange({
      x: Math.max(0.05, Math.min(20, value.x * factor)),
      y: Math.max(0.05, Math.min(20, value.y * factor)),
      z: Math.max(0.05, Math.min(20, value.z * factor)),
    });
  };
  return <div><span className="director-label">整体大小</span><div className="grid grid-cols-3 gap-1.5"><button onClick={() => resize(0.9)} className="h-8 rounded-lg border border-white/[0.07] text-[8px] text-white/40 hover:bg-white/[0.05]">缩小 10%</button><button onClick={() => resize(1.1)} className="h-8 rounded-lg border border-white/[0.07] text-[8px] text-white/40 hover:bg-white/[0.05]">放大 10%</button><button onClick={() => useDirectorStore.getState().setTransformMode('scale')} className="flex h-8 items-center justify-center gap-1 rounded-lg border border-white/[0.07] text-[8px] text-white/40 hover:bg-white/[0.05]"><Scaling size={10} />舞台缩放</button></div></div>;
}

function DirectorShortcutPanel({ onClose }: { onClose: () => void }) {
  const groups = [
    {
      title: '编辑与恢复',
      items: [
        { keys: ['⌘', 'Z'], label: '撤销上一步修改' },
        { keys: ['⌘', '⇧', 'Z'], label: '恢复刚撤销的修改' },
        { keys: ['Delete'], label: '删除当前选中的对象' },
        { keys: ['Esc'], label: '取消选择；再次按下关闭导演台' },
      ],
    },
    {
      title: '舞台操作',
      items: [
        { keys: ['V'], label: '切换到移动工具' },
        { keys: ['R'], label: '切换到旋转工具' },
        { keys: ['S'], label: '切换到缩放工具' },
        { keys: ['双击人物'], label: '直接进入该人物的动作调整' },
      ],
    },
    {
      title: '预演播放',
      items: [
        { keys: ['Space'], label: '播放或暂停预演' },
        { keys: ['←', '→'], label: '上一帧或下一帧，精确到 24fps' },
        { keys: ['I'], label: '把当前播放头设为导出入点' },
        { keys: ['O'], label: '把当前播放头设为导出出点' },
        { keys: ['?'], label: '打开或关闭本面板' },
        { keys: ['拖动播放头'], label: '直接在轨道上逐帧定位' },
        { keys: ['点击动作块'], label: '定位并修改该动作' },
      ],
    },
  ];
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-6" onMouseDown={onClose}>
    <div className="flex max-h-[82vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1a1b1f] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.07]"><Keyboard size={16} /></span><div><div className="text-[12px] font-medium text-white/85">导演台快捷键</div><div className="mt-0.5 text-[8px] text-white/30">先记住空格、V / R / S 和撤销，其余随用随查</div></div></div>
        <button onClick={onClose} className="director-icon-btn" title="关闭快捷键"><X size={14} /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 overflow-y-auto p-5">
        {groups.map((group) => <section key={group.title} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-3 text-[9px] font-medium text-white/55">{group.title}</div>
          <div className="space-y-3">{group.items.map((item) => <div key={item.label} className="flex items-start justify-between gap-3"><span className="pt-1 text-[8px] leading-relaxed text-white/35">{item.label}</span><span className="flex shrink-0 gap-1">{item.keys.map((key) => <kbd key={key} className="min-w-6 rounded border border-white/10 bg-black/25 px-1.5 py-1 text-center text-[7px] text-white/65 shadow-sm">{key}</kbd>)}</span></div>)}</div>
        </section>)}
      </div>
      <footer className="shrink-0 border-t border-white/[0.07] px-5 py-3 text-[8px] text-white/30">拖动、旋转和滑杆调整从按下到松开只算一步，按一次 ⌘Z 会回到本次操作之前。</footer>
    </div>
  </div>;
}

function ActionPicker({ elements, selectedId, onPick, onClose }: { elements: DirectorElement[]; selectedId?: string; onPick: (personId: string, action: DirectorActionId) => void; onClose: () => void }) {
  const actors = elements.filter(isMotionActor);
  const [actorId, setActorId] = useState(selectedId ?? actors[0]?.id ?? '');
  const categories = [...new Set(MOTION_TEMPLATES.map((item) => item.category))];
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65" onMouseDown={onClose}><div className="flex max-h-[82vh] w-[820px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1a1b1f] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-white/[0.07] p-4"><div><div className="text-[12px] font-medium">手动编排演员动作</div><div className="mt-1 text-[9px] text-white/35">可选择人物、动物或群演。群演按整体阵列记录位置、朝向和路径。</div></div><button onClick={onClose} className="director-icon-btn"><X size={14} /></button></div><div className="border-b border-white/[0.07] p-3"><div className="mb-2 text-[8px] font-medium text-white/35">1. 选择演员</div>{actors.length ? <div className="flex gap-2 overflow-x-auto">{actors.map((actor) => <button key={actor.id} onClick={() => setActorId(actor.id)} className={`flex h-10 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-[9px] ${actorId === actor.id ? 'border-white/25 bg-white/[0.1] text-white' : 'border-white/[0.07] text-white/45 hover:bg-white/[0.05]'}`}><span className="h-3 w-3 rounded-full" style={{ backgroundColor: actor.color }} /><span>{actor.name}</span><span className="text-[7px] text-white/25">{motionActorLabel(actor)}</span>{actorId === actor.id && <Check size={10} />}</button>)}</div> : <div className="rounded-lg border border-dashed border-white/10 py-4 text-center text-[9px] text-white/35">当前没有演员，请先从演员库添加</div>}</div><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mb-3 text-[8px] font-medium text-white/35">2. 选择动作</div><div className="space-y-4">{categories.map((category) => <section key={category}><div className="mb-1.5 text-[9px] font-medium text-white/45">{category}</div><div className="grid grid-cols-4 gap-2">{MOTION_TEMPLATES.filter((item) => item.category === category).map((action) => <button key={action.id} disabled={!actorId} onClick={() => onPick(actorId, action.id)} className="min-h-[54px] rounded-lg border border-white/8 bg-white/[0.035] px-2.5 py-2 text-left hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-25"><span className="block text-[10px] text-white/70">{action.label}</span><span className="mt-1 block line-clamp-2 text-[8px] leading-relaxed text-white/30">{action.description} · {action.defaultDurationSec}s</span></button>)}</div></section>)}</div></div></div></div>;
}

function DirectorObjectLibrary({ mode, onActor, onProp, onClose }: { mode: 'actors' | 'props'; onActor: (id: typeof ACTOR_PRESETS[number]['id']) => void; onProp: (id: typeof PROP_PRESETS[number]['id']) => void; onClose: () => void }) {
  const items = mode === 'actors' ? ACTOR_PRESETS : PROP_PRESETS;
  return <div className="fixed inset-0 z-[112] flex items-center justify-center bg-black/65" onMouseDown={onClose}><div className="w-[620px] max-w-[90vw] rounded-xl border border-white/10 bg-[#1a1b1f] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="mb-4 flex items-center justify-between"><div><div className="text-[12px] font-medium">{mode === 'actors' ? '演员模型库' : '代理道具库'}</div><div className="mt-1 text-[9px] text-white/35">{mode === 'actors' ? '添加人物、动物或群众，并在舞台中直接调度。' : '先用简单体块确认空间和遮挡，正式渲染时再读取真实资产。'}</div></div><button onClick={onClose} className="director-icon-btn"><X size={14} /></button></div><div className="grid grid-cols-3 gap-2">{items.map((item) => <button key={item.id} onClick={() => mode === 'actors' ? onActor(item.id as typeof ACTOR_PRESETS[number]['id']) : onProp(item.id as typeof PROP_PRESETS[number]['id'])} className="flex min-h-[78px] items-start gap-3 rounded-lg border border-white/[0.08] bg-white/[0.025] p-3 text-left hover:border-white/15 hover:bg-white/[0.06]"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">{mode === 'actors' ? <PersonStanding size={16} /> : <Box size={16} />}</span><span><span className="block text-[10px] text-white/70">{item.label}</span><span className="mt-1 block text-[8px] leading-relaxed text-white/30">{'description' in item ? item.description : '常用场景代理模型'}</span></span></button>)}</div></div></div>;
}

function PlanProposalDialog({ plans, onClose, onConfirm }: { plans: DirectorPlan[]; onClose: () => void; onConfirm: (selectedPlanId: string) => void }) {
  const [previewId, setPreviewId] = useState(plans[0]?.id ?? '');
  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/70" onMouseDown={onClose}>
      <div className="w-[min(920px,90vw)] rounded-xl border border-white/10 bg-[#18191c] p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div><div className="text-[13px] font-semibold">确认导演方案</div><div className="mt-1 text-[9px] text-white/35">确认后才会写入舞台，原方案可通过撤销恢复</div></div>
          <button onClick={onClose} className="director-icon-btn"><X size={14} /></button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {plans.map((plan) => (
            <button key={plan.id} onClick={() => setPreviewId(plan.id)} className={`p-3 text-left transition-colors ${previewId === plan.id ? 'bg-white/10' : 'bg-white/[0.025] hover:bg-white/[0.05]'}`} style={{ borderRadius: 8, border: `1px solid ${previewId === plan.id ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}` }}>
              <div className="flex items-center gap-2"><Film size={13} /><span className="text-[11px] font-medium">{plan.name}</span></div>
              <p className="mt-1.5 min-h-[28px] text-[9px] leading-relaxed text-white/40">{plan.summary}</p>
              <div className="mt-3 flex h-14 gap-1">
                {plan.shots.map((shot, index) => <div key={shot.id} className="flex min-w-0 flex-1 flex-col justify-between rounded-md bg-black/25 p-1.5"><span className="truncate text-[8px] text-white/55">{index + 1} · {shot.name}</span><span className="text-[7px] text-white/25">{CAMERA_MOVES.find((item) => item.id === shot.cameraMove)?.label} · {shot.durationSec.toFixed(1)}s</span></div>)}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="h-9 rounded-lg border border-white/10 px-4 text-[10px] text-white/55">取消</button><button onClick={() => onConfirm(previewId)} className="flex h-9 items-center gap-1.5 rounded-lg bg-white px-4 text-[10px] font-medium text-black"><Check size={12} />确认所选方案</button></div>
      </div>
    </div>
  );
}

function GenerationConfirmDialog({ mode, onClose, onImageConfirm, onVideoConfirm, onStillConfirm, onPrevisConfirm }: {
  mode: 'still' | 'previs' | 'image' | 'video';
  onClose: () => void;
  onImageConfirm: (options: { engineId: 'gpt-image-2' | 'seedream-v5-pro'; resolution: '1k' | '2k' | '4k'; scope: 'current' | 'all'; writeBack: boolean; placeOnCanvas: boolean }) => void;
  onVideoConfirm: (options: { writeBack: boolean; placeOnCanvas: boolean }) => void;
  onStillConfirm: (options: { scope: 'current' | 'all'; writeBack: boolean; placeOnCanvas: boolean }) => void;
  onPrevisConfirm: (options: { writeBack: boolean; placeOnCanvas: boolean }) => void;
}) {
  const [engineId, setEngineId] = useState<'gpt-image-2' | 'seedream-v5-pro'>('gpt-image-2');
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('2k');
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [writeBack, setWriteBack] = useState(true);
  const [placeOnCanvas, setPlaceOnCanvas] = useState(false);
  return (
    <div className="fixed inset-0 z-[118] flex items-center justify-center bg-black/72" onMouseDown={onClose}>
      <div className="w-[420px] rounded-xl border border-white/10 bg-[#191a1e] p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between"><div><div className="text-[13px] font-semibold">{mode === 'image' ? '渲染正式分镜' : mode === 'video' ? '确认 Seedance 生成' : mode === 'still' ? '回传白模截图' : '回传白模视频'}</div><div className="mt-1 text-[9px] text-white/35">{mode === 'image' ? '白模只控制构图，正式资产在提交时临时读取' : mode === 'video' ? '将先导出白模 MP4，再作为参考视频付费生成' : '只有勾选后才会写入来源，不覆盖正式产物'}</div></div><button onClick={onClose} className="director-icon-btn"><X size={14} /></button></div>
        {mode === 'image' && <div className="space-y-3">
          <label className="block"><span className="director-label">模型</span><select value={engineId} onChange={(event) => setEngineId(event.target.value as typeof engineId)} className="director-input"><option value="gpt-image-2">GPT</option><option value="seedream-v5-pro">豆包</option></select></label>
          <div className="grid grid-cols-2 gap-3"><label><span className="director-label">范围</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="director-input"><option value="current">当前镜头</option><option value="all">全部镜头</option></select></label><label><span className="director-label">分辨率</span><select value={resolution} onChange={(event) => setResolution(event.target.value as typeof resolution)} className="director-input"><option value="1k">1K</option><option value="2k">2K</option>{engineId === 'gpt-image-2' && <option value="4k">4K</option>}</select></label></div>
        </div>}
        {mode === 'still' && <label className="block"><span className="director-label">范围</span><select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="director-input"><option value="current">当前镜头</option><option value="all">全部镜头</option></select></label>}
        <div className="mt-4 space-y-2 border-t border-white/[0.07] pt-4"><label className="flex items-center gap-2 text-[10px] text-white/60"><input type="checkbox" checked={writeBack} onChange={(event) => setWriteBack(event.target.checked)} className="accent-white" />写回来源位置</label><label className="flex items-center gap-2 text-[10px] text-white/60"><input type="checkbox" checked={placeOnCanvas} onChange={(event) => setPlaceOnCanvas(event.target.checked)} className="accent-white" />同时放到画布来源节点旁边</label><div className="flex items-center gap-2 text-[9px] text-white/30"><Check size={11} />产物始终保存到产物库</div></div>
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="h-9 rounded-lg border border-white/10 px-4 text-[10px] text-white/55">取消</button><button onClick={() => {
          if (mode === 'image') onImageConfirm({ engineId, resolution, scope, writeBack, placeOnCanvas });
          else if (mode === 'video') onVideoConfirm({ writeBack, placeOnCanvas });
          else if (mode === 'still') onStillConfirm({ scope, writeBack, placeOnCanvas });
          else onPrevisConfirm({ writeBack, placeOnCanvas });
        }} className="h-9 rounded-lg bg-white px-4 text-[10px] font-medium text-black">{mode === 'image' || mode === 'video' ? '确认生成' : '确认回传'}</button></div>
      </div>
    </div>
  );
}

function ImageAnalysisDialog({ loading, analysis, onChange, onClose, onConfirm }: { loading: boolean; analysis: DirectorImageAnalysis | null; onChange: (analysis: DirectorImageAnalysis) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72">
      <div className="w-[520px] rounded-xl border border-white/10 bg-[#191a1e] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between"><div><div className="text-[13px] font-semibold">确认图片站位</div><div className="mt-1 text-[9px] text-white/35">只建立人物白模和摄影机，不复制背景或图片资产</div></div>{!loading && <button onClick={onClose} className="director-icon-btn"><X size={14} /></button>}</div>
        {loading || !analysis ? <div className="flex h-36 flex-col items-center justify-center gap-3 text-[10px] text-white/40"><Loader2 size={18} className="animate-spin" />正在识别人物站位与镜头角度</div> : <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <label><span className="director-label">景别</span><select value={analysis.shotScale} onChange={(event) => { const shotScale = event.target.value as DirectorShotScale; onChange({ ...analysis, shotScale, shotType: shotScaleLabel(shotScale) }); }} className="director-input"><option value="extreme-wide">大全景</option><option value="wide">全景</option><option value="medium">中景</option><option value="medium-close">中近景</option><option value="close-up">特写</option><option value="extreme-close-up">大特写</option></select></label>
            <label><span className="director-label">水平角度</span><input type="number" min={-180} max={180} value={Math.round(analysis.cameraYawDeg)} onChange={(event) => onChange({ ...analysis, cameraYawDeg: Number(event.target.value) })} className="director-input" /></label>
            <label><span className="director-label">俯仰角度</span><input type="number" min={-75} max={85} value={Math.round(analysis.cameraPitchDeg)} onChange={(event) => onChange({ ...analysis, cameraPitchDeg: Number(event.target.value) })} className="director-input" /></label>
          </div>
          <div className="mb-3 flex gap-2 text-[8px] text-white/35"><span>识别可信度 {Math.round(analysis.confidence * 100)}%</span><span>焦段 {Math.round(analysis.focalLengthMm)}mm</span><span>构图 {analysis.composition}</span></div>
          <div className="mb-1 grid grid-cols-[24px_34px_1fr_72px_72px] gap-2 px-2 text-[8px] text-white/25"><span>启用</span><span>主角</span><span>人物</span><span>横向</span><span>纵深</span></div>
          <div className="max-h-[300px] space-y-1.5 overflow-y-auto">{analysis.people.map((person) => <div key={person.id} className={`grid grid-cols-[24px_34px_1fr_72px_72px] items-center gap-2 rounded-lg border px-2 py-2 ${person.isPrimary ? 'border-white/15 bg-white/[0.06]' : 'border-transparent bg-white/[0.03]'}`}><input type="checkbox" checked={person.enabled} onChange={(event) => { const enabled = event.target.checked; const remaining = analysis.people.filter((item) => item.id !== person.id && item.enabled); onChange({ ...analysis, people: analysis.people.map((item) => item.id === person.id ? { ...item, enabled, isPrimary: enabled ? item.isPrimary : false } : !enabled && person.isPrimary && item.id === remaining[0]?.id ? { ...item, isPrimary: true } : item) }); }} className="accent-white" /><input type="radio" name="director-primary-person" checked={person.isPrimary} onChange={() => onChange({ ...analysis, people: analysis.people.map((item) => ({ ...item, isPrimary: item.id === person.id, enabled: item.id === person.id ? true : item.enabled })) })} title="设为景别和机位匹配的主人物" className="accent-white" /><input value={person.name} onChange={(event) => onChange({ ...analysis, people: analysis.people.map((item) => item.id === person.id ? { ...item, name: event.target.value } : item) })} className="director-input" /><span className="text-[8px] text-white/35">{person.horizontal.toFixed(2)}</span><span className="text-[8px] text-white/35">{person.depth.toFixed(2)}</span></div>)}</div>
          {analysis.people.length === 0 && <div className="py-10 text-center text-[10px] text-white/35">没有识别到人物，可关闭后手动添加</div>}
          <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="h-9 rounded-lg border border-white/10 px-4 text-[10px] text-white/55">手动开始</button><button onClick={onConfirm} disabled={!analysis.people.some((person) => person.enabled)} className="h-9 rounded-lg bg-white px-4 text-[10px] font-medium text-black disabled:opacity-30">确认建立白模</button></div>
        </>}
      </div>
    </div>
  );
}
