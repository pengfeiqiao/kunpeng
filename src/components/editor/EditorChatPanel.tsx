/**
 * EditorChatPanel — 剪辑视图鲲鹏抽屉（AgentDrawer 壳的剪辑 wrapper）。
 * Prefix 引导 agent 先 timeline_get_state 再操作时间轴工具。
 */
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores';
import { useEditorStore } from '@/stores/editorStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { ensureProjectSession } from '@/lib/projectSessions';
import { useHelloGreeting } from '@/lib/greeting';
import { motionDesignGuide } from '@/lib/motion/motionPrompt';
import { omniMgAgentGuide } from '@/lib/omni/styles';
import AgentDrawer from '../chat/AgentDrawer';
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';

const STRIP_RE = /^\[用户正在剪辑视图操作[\s\S]*?\n\n/;

const FX_DESIGN_GUIDE = motionDesignGuide();
const OMNI_MG_GUIDE = omniMgAgentGuide();

function shouldInjectFxGuide(text: string): boolean {
  // 宁可多注入不可漏：漏注入 = agent 退化成"文字 PPT 模式"（无导演思维）。
  return /特效|花字|动效|动画|页面|网页|模板|组件|字幕|视觉|复刻|自由模式|场景|包装|圈选|Hyperframe|hyperframe|HTML|CSS|演示|讲解|介绍|科普|解释|概念|开场|片头|片尾|标题|金句|强调|突出|美化|设计|风格|好看|炫|酷|高级感|卡点|节奏|图表|数据|列表|对比|流程|架构/i.test(text);
}

function isOmniMgEntryRequest(text: string): boolean {
  return /MG动画|MG 动画|Omni版MG|Omni 版 MG|贵动画|图形动效|应用展示动画|视频生MG|文字生MG/i.test(text);
}

/** 外部（工作流模式切换等）请求打开剪辑抽屉 */
export const EDITOR_DRAWER_OPEN_EVENT = 'kunpeng-editor-drawer-open';
/** 外部注入预制 prompt（打开抽屉并自动发送），detail: { prompt } */
export const EDITOR_PROMPT_EVENT = 'kunpeng-editor-prompt';

/** 便捷派发：打开剪辑抽屉并发送预制 prompt */
export function dispatchEditorPrompt(prompt: string): void {
  window.dispatchEvent(new CustomEvent(EDITOR_PROMPT_EVENT, { detail: { prompt } }));
}

export default function EditorChatPanel({ onSendMessage, onAbort }: {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}) {
  const hello = useHelloGreeting();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const lastAutoPromptRef = useRef<{ prompt: string; at: number } | null>(null);
  const isStreaming = useChatStore((s) => s.streamingPhase) !== 'idle';

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EDITOR_DRAWER_OPEN_EVENT, h);
    return () => window.removeEventListener(EDITOR_DRAWER_OPEN_EVENT, h);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<SystemRepairPromptDetail>).detail?.prompt;
      if (!prompt) return;
      setOpen(true);
      if (useChatStore.getState().streamingPhase === 'idle') setTimeout(() => handleSend(prompt), 250);
      else setQueued(prompt);
    };
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听预制 prompt 事件（"AI 配特效"按钮等外部注入）
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt;
      if (!prompt) return;
      const now = Date.now();
      const last = lastAutoPromptRef.current;
      if (last && last.prompt === prompt && now - last.at < 5000) return;
      lastAutoPromptRef.current = { prompt, at: now };
      setOpen(true);
      if (useChatStore.getState().streamingPhase === 'idle') {
        setTimeout(() => handleSend(prompt), 250);
      } else {
        setQueued(prompt);
      }
    };
    window.addEventListener(EDITOR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(EDITOR_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 排队 prompt 在空闲后补发
  useEffect(() => {
    if (!queued || isStreaming) return;
    const p = queued;
    setQueued(null);
    setTimeout(() => handleSend(p), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, isStreaming]);

  const handleSend = (text: string, filePaths?: string[]) => {
    void (async () => {
      const unifiedId = useUnifiedProjectStore.getState().activeId;
      const proj = useWorkshopStore.getState().project;
      if (unifiedId && proj) await ensureProjectSession(unifiedId, proj.name);
      const s = useEditorStore.getState();
      const isMgEntry = isOmniMgEntryRequest(text);
      const fxGuide = !isMgEntry && shouldInjectFxGuide(text) ? FX_DESIGN_GUIDE : '';
      const omniGuide = isMgEntry || /Omni 贵动画|贵动画|视频生MG|文字生MG/i.test(text) ? OMNI_MG_GUIDE : '';
      const prefix = `[用户正在剪辑视图操作。时间轴现有 ${s.clips.length} 段主视频素材，总时长 ${s.totalDuration().toFixed(1)} 秒${s.bgm ? '，已挂 BGM' : ''}。请先调用 timeline_get_state 查看时间轴详情，再用 timeline_reorder / timeline_trim / timeline_set_transition / timeline_add_bgm / timeline_remove_clip 等工具执行用户的剪辑指令。剪映式操作优先用：timeline_split_at_playhead 播放头切开所有命中轨道，timeline_ripple_delete 删除并补位，timeline_set_track_state 锁定/隐藏轨道，timeline_proxy_prepare 给大视频做代理，timeline_render_cache_status 查看特效缓存。用户在剪辑窗口说“MG动画/图形动效/应用展示动画/Omni版MG”时，第一轮只能问一个问题：要“网页特效（便宜、可编辑、走 HTML/Scene）”还是“Omni 贵动画（花钱生成视频）”；第一轮不要问风格、不要调用 timeline_omni_mg_plan、不要调用 timeline_omni_mg_generate 或 batch。若用户选网页特效，才按普通网页/Scene 工作流继续询问风格并优先 timeline_add_scene / timeline_add_free_page。若用户确认 Omni 贵动画，第二轮再按 Omni MG skill 的精选风格询问风格，同时询问“花字类型/视频生MG”还是“纯MG动画/文字生”，并说明是否需要二次裁切到 4/6/10 秒；然后先 timeline_omni_mg_plan 汇报要生成几条、每条时长、放置位置和成本估算，等用户确认后必须优先 timeline_omni_mg_generate_batch 并发生成，不要逐条串行调用 timeline_omni_mg_generate。用户看过生成结果后如果说“不满意/文字还是错/有错字/乱码/字幕不对/字不对/文案不对/还是不行”，优先调用 timeline_mg_text_fallback 做二次兜底：GPT-Image-2 生成文字定版图，再用筷子 Seedance 2.0 Mini 图生视频，不要继续反复调 Omni。时间轴有视频时先转写/读取内容再切分需要特效的段落；生成结果必须放到原视频上方 overlay 轨覆盖。口播剪辑（剪重复/废话/口误/停顿/剪流畅）必须走「剪口播」引擎：① timeline_speech_audit 跑证据链审片（词级停顿+能量相似度+短窗 raw 重转写+AI 信息增量判定，候选自动进「剪口播」面板，只标记不自动剪）→ ② timeline_speech_findings(op:"list") 读取候选并向用户汇报，需要调整用 timeline_speech_findings(op:"set_enabled") 改勾选 → ③ 用户确认后 timeline_speech_apply 应用，自动做剪后边界验证。判断重复要按信息增量，不按文字相似；repeat 保留停顿少、语速均匀、句子完整的一遍，stutter 删除说错/卡壳保留纠正后，filler 只删不承载信息的口癖，rambling 宁缺勿滥，pause 受最短停顿阈值过滤。干净 ASR 的标点/段落只为阅读，可能合并重复或清洗口误，不能当删除证据。只读文稿用 timeline_transcript_read（免确认）；按行精删用 timeline_transcript 的 cut_rows/mark/apply。ASR 文本可能识别错，不能仅因文字和脚本不一致就臆删。用户说“删静音/空白”时，默认理解为删除无人声/无字幕内容段（timeline_transcript op=detect_silence/delete_silence），不按音量判断，除非用户明确说低音量。需要切分时优先给 timeline_split 传 source_sec 或 timeline_sec，避免手算 at_sec；需要按句裁剪时给 timeline_trim 传 row_id。导出/生成视频时必须先 timeline_export_analyze，再按需要 timeline_export_prepare，最后 timeline_export_video；期间可用 timeline_export_status 汇报进度，停止用 timeline_export_stop。导出失败后先读 timeline_export_status，再用 timeline_export_retry(strategy:"same"|"fast_h264"|"clear_cache") 重试或降级。用户询问新渲染引擎/native compositor/GPU/WebGPU/为什么没走新引擎时，先调用 timeline_render_graph 诊断渲染图和后端选择。没有主视频但有花字/特效/音频时也可以导出，系统会自动生成虚拟底片。${fxGuide ? '如果本轮涉及特效/花字/自由网页，再遵循后面的特效设计规则。' : ''}${omniGuide ? '如果本轮涉及 Omni 贵动画，再遵循后面的 Omni MG 专用规则。' : ''}]${fxGuide}${omniGuide}\n\n`;
      const omniCurrentPolicy = omniGuide
        ? '[当前付费 MG 规则覆盖上面的历史 Omni 专用说明：第一轮只问网页特效还是付费 MG；第二轮优先用 ask_user_question 对话内选项卡询问引擎，选项为 MiniMax H3（默认推荐，2K、5-15秒）、Omni（720p、固定10秒）、Seedance Mini（4-15秒），同时再问风格及视频生MG/文字生MG。用户未明确选择时默认 H3。调用 plan/generate/batch 必须传 engine，旧工具名不代表使用 Omni，严禁调用 Seedance 2.0 普通版。每条提示词必须按 MG 专属结构包含核心概念、主视觉、至少两组辅助元素、空间层级、元素互动关系、分阶段动作和主体保护，禁止写成普通电影镜头描述、单一元素循环或随机堆料。生成后不自动评分或重生，先交给用户判断，再根据反馈定向修复。]\n\n'
        : '';
      onSendMessage(prefix + omniCurrentPolicy + text, filePaths);
    })();
  };

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: hello, title: '说一句，我来动时间轴' }}
      suggestions={[
        '这是目标稿：[贴逐字稿]，对照它把口播剪流畅',
        '这是分镜脚本：[贴脚本]，分析素材后挑选组装成片',
        '把口播里的废话、重复和无人声空白段都剪掉',
        '根据内容风格给全片配花字特效',
        '做一版 Omni MG 动画包装',
        '从素材里剪出 3 段 15 秒高光切片计划',
        '自动配字幕并按 BGM 踩点对齐切点',
      ]}
      onSend={handleSend}
      onAbort={onAbort}
      modelScope="editor"
      placeholder="剪流畅、分镜组装、配特效、高光切片，直接说"
    />
  );
}
