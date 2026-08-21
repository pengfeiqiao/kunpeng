/**
 * StepBreakdown — ②拆解：梗概 / 分集分场 / 角色档案，全部可编辑。
 * 编辑即写 store（梗概/分集触发 invalidateDownstream）。
 */
import { useEffect } from 'react';
import { Plus, Sparkles, Trash2, User } from 'lucide-react';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useShallow } from 'zustand/react/shallow';
import { useWorkshopStore } from '@/stores/workshopStore';
import type { WsCharacter } from '@/lib/workshop/types';
import { buildBreakdownPrompt } from '@/lib/workshop/workshopPrompts';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import { buildStyleSection } from '../StyleSelector';
import SmartTextarea from '../SmartTextarea';
import VideoPromptVersionSwitch from '../VideoPromptVersionSwitch';

const inputCls = 'bg-transparent text-[12px] text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)] w-full rounded transition-colors hover:bg-[rgba(255,255,255,0.04)] focus:bg-[rgba(255,255,255,0.04)] focus:shadow-[inset_0_-1px_0_0_var(--canvas-accent)]';
const cardCls = 'rounded-xl border border-[var(--canvas-node-border)] p-3.5';

export default function StepBreakdown() {
  // 浅比较对象选择器：只在本页用到的字段变化时才重渲染（logChange/shots 等写入不波及本页）
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    synopsis: s.data.synopsis,
    episodes: s.data.episodes,
    characters: s.data.characters,
    videoPromptTemplate: s.data.videoPromptTemplate,
    breakdownStatus: s.data.steps.breakdown.status,
  })));
  const setSynopsis = useWorkshopStore((s) => s.setSynopsis);
  const setEpisodes = useWorkshopStore((s) => s.setEpisodes);
  const upsertCharacters = useWorkshopStore((s) => s.upsertCharacters);
  const removeCharacter = useWorkshopStore((s) => s.removeCharacter);
  const getAssetRefInfo = useWorkshopStore((s) => s.getAssetRefInfo);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const setVideoPromptTemplate = useWorkshopStore((s) => s.setVideoPromptTemplate);

  // 已有梗概或角色即视为完成拆解，自动标记；条件不再满足时把 done 降回 in-progress（不动 stale 等其他状态）
  const breakdownReady = !!data && (!!data.synopsis || data.characters.length > 0);
  const breakdownStatus = data?.breakdownStatus;
  useEffect(() => {
    if (breakdownReady && breakdownStatus !== 'done') markStepStatus('breakdown', 'done');
    else if (!breakdownReady && breakdownStatus === 'done') markStepStatus('breakdown', 'in-progress');
  }, [breakdownReady, breakdownStatus, markStepStatus]);

  if (!data) return null;
  const empty = !data.synopsis && data.characters.length === 0;

  const patchChar = (id: string, patch: Partial<WsCharacter>) => {
    const c = data.characters.find((x) => x.id === id);
    if (c) upsertCharacters([{ ...c, ...patch }]);
  };

  // 角色删除是全局级联删除：先确认影响范围，store 会同步清理分镜引用
  const handleRemoveCharacter = async (id: string) => {
    const info = getAssetRefInfo('character', id);
    const impact = info.shots > 0
      ? `将同步从 ${info.shots} 个分镜中移除引用，并标记这些分镜提示词需刷新。`
      : '没有分镜引用它。';
    if (!(await tauriConfirm(`删除「${info.name}」？${impact}`))) return;
    removeCharacter(id);
  };

  return (
    <div className="max-w-[860px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">② 剧本拆解</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">梗概 · 分集分场 · 角色档案 — 可手动修改，也可让右侧助手重做</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildBreakdownPrompt(sec)))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Sparkles size={12} /> {empty ? 'AI 拆解' : '重新拆解'}
          </button>
        </div>
      </div>

      <VideoPromptVersionSwitch
        prominent
        value={data.videoPromptTemplate ?? 'legacy'}
        onChange={setVideoPromptTemplate}
      />

      {/* 梗概 */}
      <section className="mt-6">
        <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)] mb-2">故事梗概</h3>
        <SmartTextarea
          value={data.synopsis}
          onChange={setSynopsis}
          placeholder="点击「AI 拆解」自动生成，或手动填写…"
          rows={4}
          editorTitle="故事梗概"
          className={`${cardCls} w-full resize-y bg-[rgba(255,255,255,0.03)] text-[12px] leading-relaxed text-[var(--canvas-text-1)] focus:outline-none focus:border-[var(--canvas-node-border-selected)] placeholder:text-[var(--canvas-text-3)]`}
        />
      </section>

      {/* 分集分场 */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">分集分场</h3>
          <button
            onClick={() => setEpisodes([...data.episodes, { no: String(data.episodes.length + 1), title: '', sceneList: '' }])}
            className="flex items-center gap-1 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Plus size={11} /> 加一集
          </button>
        </div>
        {data.episodes.length === 0 ? (
          <p className="text-[11px] text-[var(--canvas-text-3)] py-3">（暂无，AI 拆解后自动填充）</p>
        ) : (
          <div className="rounded-xl border border-[var(--canvas-node-border)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[var(--canvas-text-3)]" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <th className="px-3 py-2 w-14 font-normal">集</th>
                  <th className="px-3 py-2 w-44 font-normal">标题</th>
                  <th className="px-3 py-2 font-normal">场次</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {data.episodes.map((ep, i) => (
                  <tr key={i} className="border-t border-[var(--canvas-node-border)]">
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.no} onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, no: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.title} placeholder="标题" onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, title: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={inputCls} value={ep.sceneList} placeholder="场次概览，分号分隔" onChange={(e) => {
                        const next = [...data.episodes]; next[i] = { ...ep, sceneList: e.target.value }; setEpisodes(next);
                      }} />
                    </td>
                    <td className="px-2">
                      <button
                        onClick={() => setEpisodes(data.episodes.filter((_, j) => j !== i))}
                        className="p-1.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors"
                        title="删除本集"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 角色档案 */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-medium text-[var(--canvas-text-1)]">角色档案</h3>
          <button
            onClick={() => upsertCharacters([{ id: `char-${Date.now().toString(36)}`, name: '新角色', personality: '', appearance: '' }])}
            className="flex items-center gap-1 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Plus size={11} /> 加角色
          </button>
        </div>
        {data.characters.length === 0 ? (
          <p className="text-[11px] text-[var(--canvas-text-3)] py-3">（暂无，AI 拆解后自动填充）</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {data.characters.map((c) => (
              <div key={c.id} className={`${cardCls} group relative`} style={{ background: 'var(--canvas-node-bg)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <User size={13} className="text-[var(--canvas-text-2)] shrink-0" />
                  <input
                    className="bg-transparent text-[13px] font-medium text-[var(--canvas-text-1)] focus:outline-none flex-1 rounded transition-colors hover:bg-[rgba(255,255,255,0.04)] focus:bg-[rgba(255,255,255,0.04)] focus:shadow-[inset_0_-1px_0_0_var(--canvas-accent)]"
                    value={c.name}
                    onChange={(e) => patchChar(c.id, { name: e.target.value })}
                  />
                  <button
                    onClick={() => void handleRemoveCharacter(c.id)}
                    className="p-1.5 rounded opacity-0 group-hover:opacity-100 text-[var(--canvas-text-3)] hover:text-red-400 transition-all"
                    title="删除角色"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <label className="block text-[10px] text-[var(--canvas-text-3)] mb-0.5">性格</label>
                <SmartTextarea
                  rows={2}
                  value={c.personality}
                  onChange={(v) => patchChar(c.id, { personality: v })}
                  editorTitle={`性格 · ${c.name}`}
                />
                <label className="block text-[10px] text-[var(--canvas-text-3)] mt-2 mb-0.5">外形（生图用的具体描述）</label>
                <SmartTextarea
                  rows={3}
                  value={c.appearance}
                  onChange={(v) => patchChar(c.id, { appearance: v })}
                  editorTitle={`外形 · ${c.name}`}
                />
                {(c.lifecycleStages?.length ?? 0) > 0 && (
                  <div className="mt-2">
                    <label className="block text-[10px] text-[var(--canvas-text-3)] mb-1">生命周期形象</label>
                    {c.lifecycleStages!.map((st, i) => (
                      <p key={i} className="text-[10px] text-[var(--canvas-text-2)] leading-relaxed">
                        <span className="text-[var(--canvas-accent)]">{st.stage}</span>：{st.appearance}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
