/**
 * jianying — 导出为剪映专业版草稿（第三次重写，照 pyJianYingDraft 全量 schema）。
 *
 * 实测结论（对比真草稿 ~/Movies/.../com.lveditor.draft/6月4日 + pyJianYingDraft 源码）：
 * - Mac 新版剪映核心文件是 **draft_info.json**（root_meta_info.json 的 draft_json_file 指向它）；
 *   同内容再写一份 draft_content.json 兼容旧版（零成本）
 * - 真草稿 JSON 加密，但剪映**兼容读取未加密草稿**（pyJianYingDraft 社区验证）
 * - schema 必须全量默认字段（canvas_config/config/platform/keyframes/47 个 materials 数组等），
 *   缺字段解析失败即报"草稿损坏"——模板常量照抄 pyJianYingDraft assets/draft_content_template.json
 * - 素材用**绝对路径**（剪映"保留在原有位置"导入模式）；我们仍复制进草稿 materials/ 再以
 *   绝对路径引用拷贝件，草稿自包含不怕源文件移动
 * - 图片素材进 materials.videos（type:"photo"，duration=3h）；每个媒体片段必须配一个
 *   speed 素材并放进 extra_material_refs；文本素材的 content 是 JSON.stringify 后的字符串
 * - 时间单位一律微秒；meta.tm_duration 与 content.duration 必须一致
 */
import { writeTextFile, createDir, copyFile, BaseDirectory } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { homeDir } from '@tauri-apps/api/path';
import { detectFfmpeg, probeDuration } from '@/lib/canvas/videoCompose';
import { useEditorStore, EXPORT_RESOLUTIONS } from '@/stores/editorStore';
import {
  renderFxClipLayer,
  renderTextClipLayer,
} from '@/lib/editor/fxRender';
import { aspectOutputSize } from '@/lib/editor/aspect';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

const US = 1_000_000;
const us = (sec: number) => Math.round(sec * US);

/** 32 位小写 hex（素材/片段/轨道 id，pyJianYingDraft uuid4().hex 同款） */
function hex32(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += ((Math.random() * 16) | 0).toString(16);
  return s;
}

/** 大写带连字符 UUID（草稿 id，模板同款格式） */
function uuidUpper(): string {
  const h = hex32().toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function safeBasename(p: string, i: number): string {
  const base = p.split('/').pop() ?? `media_${i}`;
  return `${String(i).padStart(2, '0')}_${base.replace(/[^\w.一-龥-]+/g, '_')}`;
}

// ── 全量模板（照抄 pyJianYingDraft assets/draft_content_template.json，勿删字段） ──

function contentTemplate(): Record<string, unknown> {
  return {
    canvas_config: { height: 1080, ratio: 'original', width: 1920 },
    color_space: 0,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1,
      export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '',
      lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: true,
      material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none',
      original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true,
      subtitle_taskinfo: [], system_font_list: [], video_mute: false, zoom_info_params: null,
    },
    cover: null,
    create_time: 0,
    duration: 0,
    extra_info: null,
    fps: 30.0,
    free_render_index_mode_on: false,
    group_container: null,
    id: uuidUpper(),
    keyframe_graph_list: [],
    keyframes: {
      adjusts: [], audios: [], effects: [], filters: [],
      handwrites: [], stickers: [], texts: [], videos: [],
    },
    last_modified_platform: { app_id: 3704, app_source: 'lv', app_version: '5.9.0', os: 'mac' },
    platform: { app_id: 3704, app_source: 'lv', app_version: '5.9.0', os: 'mac' },
    materials: {
      ai_translates: [], audio_balances: [], audio_effects: [], audio_fades: [],
      audio_track_indexes: [], audios: [], beats: [], canvases: [], chromas: [],
      color_curves: [], digital_humans: [], drafts: [], effects: [], flowers: [],
      green_screens: [], handwrites: [], hsl: [], images: [], log_color_wheels: [],
      loudnesses: [], manual_deformations: [], masks: [], material_animations: [],
      material_colors: [], multi_language_refs: [], placeholders: [], plugin_effects: [],
      primary_color_wheels: [], realtime_denoises: [], shapes: [], smart_crops: [],
      smart_relights: [], sound_channel_mappings: [], speeds: [], stickers: [],
      tail_leaders: [], text_templates: [], texts: [], time_marks: [], transitions: [],
      video_effects: [], video_trackings: [], videos: [], vocal_beautifys: [],
      vocal_separations: [],
    },
    mutable_config: null,
    name: '',
    new_version: '110.0.0',
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: 'default',
    static_cover_image_path: '',
    time_marks: null,
    tracks: [],
    update_time: 0,
    version: 360000,
  };
}

function metaTemplate(): Record<string, unknown> {
  return {
    cloud_package_completed_time: '',
    draft_cloud_capcut_purchase_info: '',
    draft_cloud_last_action_download: false,
    draft_cloud_materials: [],
    draft_cloud_purchase_info: '',
    draft_cloud_template_id: '',
    draft_cloud_tutorial_info: '',
    draft_cloud_videocut_purchase_info: '',
    draft_cover: 'draft_cover.jpg',
    draft_deeplink_url: '',
    draft_enterprise_info: {
      draft_enterprise_extra: '', draft_enterprise_id: '',
      draft_enterprise_name: '', enterprise_material: [],
    },
    draft_fold_path: '',
    draft_id: uuidUpper(),
    draft_is_ai_packaging_used: false,
    draft_is_ai_shorts: false,
    draft_is_ai_translate: false,
    draft_is_article_video_draft: false,
    draft_is_from_deeplink: 'false',
    draft_is_invisible: false,
    draft_materials: [
      { type: 0, value: [] }, { type: 1, value: [] }, { type: 2, value: [] },
      { type: 3, value: [] }, { type: 6, value: [] }, { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_materials_copied_info: [],
    draft_name: '',
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_root_path: '',
    draft_segment_extra_info: [],
    draft_type: '',
    tm_draft_cloud_completed: '',
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
    tm_duration: 0,
  };
}

// ── 素材/片段构建器（字段照抄 pyJianYingDraft export_json） ──────────────────

const NO_CROP = {
  upper_left_x: 0.0, upper_left_y: 0.0, upper_right_x: 1.0, upper_right_y: 0.0,
  lower_left_x: 0.0, lower_left_y: 1.0, lower_right_x: 1.0, lower_right_y: 1.0,
};

function videoMaterial(id: string, absPath: string, durUs: number, w: number, h: number, type: 'video' | 'photo'): Record<string, unknown> {
  return {
    audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487,
    crop: NO_CROP, crop_ratio: 'free', crop_scale: 1.0,
    duration: durUs, height: h, id, local_material_id: '',
    material_id: id, material_name: absPath.split('/').pop() ?? id,
    media_path: '', path: absPath, type, width: w,
  };
}

function audioMaterial(id: string, absPath: string, durUs: number): Record<string, unknown> {
  return {
    app_id: 0, category_id: '', category_name: 'local', check_flag: 3,
    copyright_limit_type: 'none', duration: durUs, effect_id: '', formula_id: '',
    id, local_material_id: id, music_id: id,
    name: absPath.split('/').pop() ?? id, path: absPath,
    source_platform: 0, type: 'extract_music', wave_points: [],
  };
}

function speedMaterial(id: string, speed: number): Record<string, unknown> {
  return { curve_speed: null, id, mode: 0, speed, type: 'speed' };
}

function textMaterial(id: string, text: string): Record<string, unknown> {
  const content = {
    styles: [{
      fill: { alpha: 1.0, content: { render_type: 'solid', solid: { alpha: 1.0, color: [1.0, 1.0, 1.0] } } },
      range: [0, text.length],
      size: 8.0, bold: false, italic: false, underline: false, strokes: [],
    }],
    text,
  };
  return {
    id,
    content: JSON.stringify(content),
    typesetting: 0, alignment: 1,
    letter_spacing: 0, line_spacing: 0.02,
    line_feed: 1, line_max_width: 0.82, force_apply_line_max_width: false,
    check_flag: 7, type: 'subtitle', global_alpha: 1.0,
  };
}

interface ClipXf { x: number; y: number; scale: number; opacity: number; rotation: number }

function segmentBase(
  materialId: string,
  target: { start: number; duration: number },
  source: { start: number; duration: number } | null,
  speedId: string,
  speed: number,
  volume: number,
): Record<string, unknown> {
  return {
    enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true,
    enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true,
    enable_smart_color_adjust: false, last_nonzero_volume: 1.0, reverse: false,
    track_attribute: 0, track_render_index: 0, visible: true,
    id: hex32(), material_id: materialId,
    target_timerange: target,
    common_keyframes: [], keyframe_refs: [],
    source_timerange: source,
    speed, volume,
    extra_material_refs: [speedId],
    is_tone_modify: false,
  };
}

/** 视觉片段（视频/图片）：base + clip + uniform_scale + hdr */
function videoSegment(
  materialId: string, target: { start: number; duration: number },
  source: { start: number; duration: number }, speedId: string, speed: number,
  volume: number, xf?: ClipXf,
): Record<string, unknown> {
  return {
    ...segmentBase(materialId, target, source, speedId, speed, volume),
    clip: {
      alpha: xf?.opacity ?? 1.0,
      flip: { horizontal: false, vertical: false },
      rotation: xf?.rotation ?? 0.0,
      scale: { x: xf?.scale ?? 1.0, y: xf?.scale ?? 1.0 },
      // 本地归一化（±0.5=半幅）→ 剪映 transform（±1=半幅）
      transform: { x: (xf?.x ?? 0) * 2, y: -(xf?.y ?? 0) * 2 },
    },
    uniform_scale: { on: true, value: 1.0 },
    hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
  };
}

/** 文本片段：base + clip（字幕默认 y=-0.8，剪映惯例）+ uniform_scale */
function textSegment(
  materialId: string, target: { start: number; duration: number }, speedId: string,
): Record<string, unknown> {
  return {
    ...segmentBase(materialId, target, null, speedId, 1.0, 1.0),
    clip: {
      alpha: 1.0, flip: { horizontal: false, vertical: false }, rotation: 0.0,
      scale: { x: 1.0, y: 1.0 }, transform: { x: 0.0, y: -0.8 },
    },
    uniform_scale: { on: true, value: 1.0 },
  };
}

function track(type: 'video' | 'audio' | 'text', segments: Record<string, unknown>[], renderIndex: number): Record<string, unknown> {
  for (const seg of segments) seg.render_index = renderIndex;
  return {
    attribute: 0, flag: 0, id: hex32(),
    is_default_name: true, name: '',
    segments, type,
  };
}

// ── 导出负载（editor 全量 / canvas 纯片段两个入口共用） ──────────────────────

interface JyClip { path: string; inSec: number; outSec: number; speed: number; volume?: number }
interface JyOverlay {
  path: string; kind: 'video' | 'image'; trackIndex: number;
  startSec: number; inSec: number; outSec: number;
  transform: ClipXf;
}
interface JyAudio { path: string; startSec: number; inSec: number; outSec: number; volume: number }
interface JyText { content: string; startSec: number; endSec: number }

interface JyPayload {
  name: string; width: number; height: number; fps: number;
  clips: JyClip[]; overlays: JyOverlay[]; audios: JyAudio[]; texts: JyText[];
}

const PHOTO_DUR_US = 10_800_000_000; // 图片素材时长 = 3h（剪映约定）

async function buildDraft(payload: JyPayload): Promise<string> {
  const home = await homeDir();
  const draftsRootRel = 'Movies/JianyingPro/User Data/Projects/com.lveditor.draft';
  const draftsRootAbs = `${home}${draftsRootRel}`;

  try {
    const r = await invoke<CommandResult>('execute_command', {
      command: `test -d "${draftsRootAbs}" && echo OK`,
      timeoutMs: 5000,
    });
    if (!r.stdout.includes('OK')) throw new Error('not found');
  } catch {
    throw new Error('未找到剪映专业版草稿目录（~/Movies/JianyingPro）。请先安装并打开过一次剪映专业版。');
  }

  // 草稿文件夹名 = 草稿名（真草稿如「6月4日」同款），加时间防重名
  const folderName = payload.name.replace(/[^\w一-龥·-]+/g, '_');
  const draftRelDir = `${draftsRootRel}/${folderName}`;
  const draftAbsDir = `${draftsRootAbs}/${folderName}`;
  for (const sub of ['videos', 'audios']) {
    await createDir(`${draftRelDir}/materials/${sub}`, { dir: BaseDirectory.Home, recursive: true });
  }

  const materials = {
    videos: [] as Record<string, unknown>[],
    audios: [] as Record<string, unknown>[],
    texts: [] as Record<string, unknown>[],
    speeds: [] as Record<string, unknown>[],
  };
  const newSpeed = (speed: number): string => {
    const id = hex32();
    materials.speeds.push(speedMaterial(id, speed));
    return id;
  };

  // 同一源文件只复制一次，但每个时间轴片段注册独立 material。
  // 剪映会把相邻且同 material_id 的片段识别得过于“整体”，导致用户看到切点像丢了。
  // 因此这里复用同一个拷贝文件路径，但给每个 segment 一个新的素材 id。
  let mi = 0;
  const visualCopyCache = new Map<string, { destAbs: string; durUs: number }>();
  const ensureVisual = async (abs: string, kind: 'video' | 'image'): Promise<{ id: string; durUs: number }> => {
    const cacheKey = `${kind}:${abs}`;
    let copied = visualCopyCache.get(cacheKey);
    if (!copied) {
      const name = safeBasename(abs, mi++);
      const destRel = `${draftRelDir}/materials/videos/${name}`;
      await copyFile(abs, destRel, { dir: BaseDirectory.Home });
      copied = {
        destAbs: `${home}${destRel}`,
        durUs: kind === 'image' ? PHOTO_DUR_US : us((await probeDuration(abs)) || 5),
      };
      visualCopyCache.set(cacheKey, copied);
    }
    const id = hex32();
    materials.videos.push(videoMaterial(id, copied.destAbs, copied.durUs, payload.width, payload.height, kind === 'image' ? 'photo' : 'video'));
    return { id, durUs: copied.durUs };
  };

  const tracks: Record<string, unknown>[] = [];

  // 主视频轨（render_index 0，最底层）
  let cursorUs = 0;
  const mainSegs: Record<string, unknown>[] = [];
  for (const c of payload.clips) {
    const mat = await ensureVisual(c.path, 'video');
    const srcDurUs = us(c.outSec - c.inSec);
    const targetDurUs = Math.round(srcDurUs / (c.speed || 1));
    mainSegs.push(videoSegment(
      mat.id,
      { start: cursorUs, duration: targetDurUs },
      { start: us(c.inSec), duration: srcDurUs },
      newSpeed(c.speed || 1), c.speed || 1, c.volume ?? 1,
    ));
    cursorUs += targetDurUs;
  }
  if (mainSegs.length > 0) tracks.push(track('video', mainSegs, 0));

  // 画中画/预渲染特效轨（render_index 越大越靠上）
  const overlayTrackIndexes = [...new Set(payload.overlays.map((o) => o.trackIndex))].sort((a, b) => b - a);
  for (const trackIndex of overlayTrackIndexes) {
    const items = payload.overlays.filter((o) => o.trackIndex === trackIndex);
    if (items.length === 0) continue;
    const segs: Record<string, unknown>[] = [];
    for (const o of items) {
      const mat = await ensureVisual(o.path, o.kind);
      const durUs = us(Math.max(0.1, o.outSec - o.inSec));
      segs.push(videoSegment(
        mat.id,
        { start: us(o.startSec), duration: durUs },
        { start: us(o.inSec), duration: durUs },
        newSpeed(1), 1, 1, o.transform,
      ));
    }
    tracks.push(track('video', segs, 1 + trackIndex));
  }

  // 音频轨（render_index 0）
  if (payload.audios.length > 0) {
    const segs: Record<string, unknown>[] = [];
    for (const a of payload.audios) {
      const name = safeBasename(a.path, mi++);
      const destRel = `${draftRelDir}/materials/audios/${name}`;
      await copyFile(a.path, destRel, { dir: BaseDirectory.Home });
      const durUs = us(Math.max(0.1, a.outSec - a.inSec));
      const matId = hex32();
      materials.audios.push(audioMaterial(matId, `${home}${destRel}`, durUs));
      segs.push(segmentBase(
        matId,
        { start: us(a.startSec), duration: durUs },
        { start: us(a.inSec), duration: durUs },
        newSpeed(1), 1, a.volume,
      ));
    }
    tracks.push(track('audio', segs, 0));
  }

  // 字幕/文本轨（render_index 15000，最上层）
  if (payload.texts.length > 0) {
    const segs = payload.texts.map((t) => {
      const matId = hex32();
      materials.texts.push(textMaterial(matId, t.content));
      return textSegment(
        matId,
        { start: us(t.startSec), duration: us(Math.max(0.2, t.endSec - t.startSec)) },
        newSpeed(1),
      );
    });
    tracks.push(track('text', segs, 15000));
  }

  // 总时长 = 各轨最大结束点
  let totalUs = 0;
  for (const tr of tracks) {
    for (const seg of tr.segments as { target_timerange: { start: number; duration: number } }[]) {
      totalUs = Math.max(totalUs, seg.target_timerange.start + seg.target_timerange.duration);
    }
  }

  // ── 组装 content（全量模板填充） ──
  const nowUs = Date.now() * 1000;
  const content = contentTemplate();
  content.duration = totalUs;
  content.fps = payload.fps;
  content.canvas_config = { width: payload.width, height: payload.height, ratio: 'original' };
  content.create_time = Math.floor(Date.now() / 1000);
  content.update_time = Math.floor(Date.now() / 1000);
  content.name = payload.name;
  const m = content.materials as Record<string, unknown>;
  m.videos = materials.videos;
  m.audios = materials.audios;
  m.texts = materials.texts;
  m.speeds = materials.speeds;
  content.tracks = tracks;

  // ── meta ──
  const meta = metaTemplate();
  meta.draft_name = folderName;
  meta.draft_fold_path = draftAbsDir;
  meta.draft_root_path = draftsRootAbs;
  meta.tm_duration = totalUs;
  meta.tm_draft_cloud_modified = nowUs;

  // ── 封面（非致命） ──
  const firstVideo = payload.clips[0]?.path ?? payload.overlays.find((o) => o.kind === 'video')?.path;
  if (firstVideo) {
    try {
      const ffmpeg = await detectFfmpeg();
      if (ffmpeg) {
        await invoke<CommandResult>('execute_command', {
          command: `${ffmpeg} -ss 0.1 -i "${firstVideo}" -frames:v 1 -vf "scale=480:-2" -q:v 5 "${draftAbsDir}/draft_cover.jpg" -y`,
          timeoutMs: 20000,
        });
      }
    } catch { /* 封面缺省不影响草稿可用 */ }
  }

  // ── 落盘：draft_info.json（新版核心）+ draft_content.json（旧版兼容）+ meta ──
  const contentStr = JSON.stringify(content);
  await writeTextFile(`${draftRelDir}/draft_info.json`, contentStr, { dir: BaseDirectory.Home });
  await writeTextFile(`${draftRelDir}/draft_content.json`, contentStr, { dir: BaseDirectory.Home });
  await writeTextFile(`${draftRelDir}/draft_meta_info.json`, JSON.stringify(meta), { dir: BaseDirectory.Home });
  return draftAbsDir;
}

// ── 公开入口 ──────────────────────────────────────────────────────────────────

export interface JianyingExportProgress {
  stage: string;
  detail?: string;
}

/** 剪辑视图全量导出：裁剪/变速/画中画/字幕/花字文案/多音轨全部带入 */
export async function exportEditorToJianying(onProgress?: (p: JianyingExportProgress) => void): Promise<string> {
  const s = useEditorStore.getState();
  if (s.totalDuration() <= 0.05 && s.clips.length === 0 && s.overlayClips.length === 0 && s.textClips.length === 0 && s.fxClips.length === 0 && s.audioClips.length === 0 && s.subtitles.length === 0) {
    throw new Error('时间轴上没有可导出的内容');
  }
  const { width, height } = aspectOutputSize(s.aspect, EXPORT_RESOLUTIONS[s.exportSettings.resolution]);
  const fps = s.exportSettings.fps;
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg && (s.textClips.some((x) => !x.disabled) || s.fxClips.some((x) => !x.disabled))) {
    throw new Error('导出剪映特效层需要 ffmpeg。请先安装：brew install ffmpeg');
  }

  const renderedFxOverlays: JyOverlay[] = [];
  const fxW = Math.min(width, 1920);
  const fxItems = [
    ...s.textClips.filter((t) => !t.disabled).map((t) => ({
      id: t.id,
      kind: 'text' as const,
      startSec: t.startSec,
      durationSec: Math.max(0.2, t.endSec - t.startSec),
      render: () => renderTextClipLayer(t, fxW, fps),
      markCache: (framesDir: string) => s.updateTextClip(t.id, { renderCachePath: framesDir }),
    })),
    ...s.fxClips.filter((f) => !f.disabled).map((f) => ({
      id: f.id,
      kind: 'fx' as const,
      startSec: f.startSec,
      durationSec: Math.max(0.2, f.duration),
      render: () => renderFxClipLayer(f, fxW, fps),
      markCache: (framesDir: string) => s.updateFxClip(f.id, { renderCachePath: framesDir }),
    })),
  ];
  if (fxItems.length > 0) {
    const lanes: number[] = [];
    let fxIndex = 0;
    for (const item of fxItems.sort((a, b) => a.startSec - b.startSec)) {
      onProgress?.({ stage: '预渲染剪映特效层', detail: `${fxIndex + 1}/${fxItems.length}` });
      const layer = await item.render();
      item.markCache(layer.framesDir);
      const start = item.startSec;
      const end = item.startSec + item.durationSec;
      let lane = lanes.findIndex((laneEnd) => laneEnd <= start + 0.02);
      if (lane < 0) {
        lane = lanes.length;
        lanes.push(end);
      } else {
        lanes[lane] = end;
      }
      renderedFxOverlays.push({
        path: layer.alphaMovPath,
        kind: 'video',
        // 自动收纳到最少轨道：不重叠的特效复用同一条剪映视频轨，重叠才新开轨。
        trackIndex: 20 + lane,
        startSec: item.startSec,
        inSec: 0,
        outSec: item.durationSec,
        transform: { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 },
      });
      fxIndex += 1;
    }
  }

  const totalSec = Math.max(0.1, s.totalDuration());
  const exportAudios: JyAudio[] = [];
  for (const a of s.audioClips.filter((x) => !x.disabled)) {
    const sourceLen = Math.max(0.1, a.outSec - a.inSec || a.duration || 0);
    if (!a.loop) {
      exportAudios.push({ path: a.path, startSec: a.startSec, inSec: a.inSec, outSec: a.outSec > a.inSec ? a.outSec : a.inSec + sourceLen, volume: a.volume });
      continue;
    }
    let cursor = Math.max(0, a.startSec);
    const end = totalSec;
    let guard = 0;
    while (cursor < end - 0.03 && guard < 500) {
      const dur = Math.min(sourceLen, end - cursor);
      exportAudios.push({ path: a.path, startSec: cursor, inSec: a.inSec, outSec: a.inSec + dur, volume: a.volume });
      cursor += dur;
      guard += 1;
    }
  }

  onProgress?.({ stage: '生成剪映草稿', detail: '复制素材和写入时间线' });
  return buildDraft({
    name: `鲲鹏${new Date().getMonth() + 1}月${new Date().getDate()}日_${new Date().getHours()}${String(new Date().getMinutes()).padStart(2, '0')}`,
    width,
    height,
    fps,
    clips: s.clips.map((c) => ({ path: c.path, inSec: c.inSec, outSec: c.outSec, speed: c.speed ?? 1, volume: c.volume ?? 1 })),
    overlays: [
      ...s.overlayClips.filter((o) => !o.disabled).map((o) => ({
      path: o.path, kind: o.kind, trackIndex: o.trackIndex,
      startSec: o.startSec, inSec: o.inSec, outSec: o.outSec, transform: o.transform,
      })),
      ...renderedFxOverlays,
    ],
    audios: exportAudios,
    // 字幕保留剪映文本轨；花字/自由特效已作为透明 MOV 视频层进入剪映。
    texts: s.subtitles.filter((c) => !c.disabled).map((c) => ({ content: c.text, startSec: c.startSec, endSec: c.endSec })),
  });
}

/** 画布时间轴面板的简单导出（整段、无裁剪） */
export async function exportToJianying(clipPaths: string[]): Promise<string> {
  if (clipPaths.length === 0) throw new Error('没有可导出的视频');
  const clips: JyClip[] = [];
  for (const p of clipPaths) {
    const dur = (await probeDuration(p)) || 5;
    clips.push({ path: p, inSec: 0, outSec: dur, speed: 1 });
  }
  return buildDraft({
    name: `鲲鹏${new Date().getMonth() + 1}月${new Date().getDate()}日_${new Date().getHours()}${String(new Date().getMinutes()).padStart(2, '0')}`,
    width: 1920, height: 1080, fps: 30,
    clips, overlays: [], audios: [], texts: [],
  });
}
