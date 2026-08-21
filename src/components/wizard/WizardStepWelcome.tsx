import { primaryBtnCls } from './wizardUi';

interface Props {
  onNext: () => void;
  onSkipAll: () => void;
}

const CAPABILITIES = [
  { title: '对话编程', desc: '与 Agent 对话，完成代码、工具调用与任务规划。' },
  { title: '画布工坊', desc: '生图、生视频与素材编排的可视化工作台。' },
  { title: '剪辑', desc: '时间轴剪辑与成片导出的完整链路。' },
];

export default function WizardStepWelcome({ onNext, onSkipAll }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-medium text-zinc-900">欢迎使用鲲鹏</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
          一个本地优先的 AI 创作工作台。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CAPABILITIES.map((cap) => (
          <div key={cap.title} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-[13px] font-medium text-zinc-900">{cap.title}</div>
            <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">{cap.desc}</p>
          </div>
        ))}
      </div>

      <p className="text-[13px] leading-relaxed text-zinc-600">
        鲲鹏的聊天、生图、生视频能力分别由不同的模型服务驱动，接下来 4 步会逐一配置，
        <span className="font-medium text-zinc-900">每一步都可以跳过，之后在设置里随时补配</span>。
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="button" onClick={onNext} className={primaryBtnCls}>
          开始配置
        </button>
        <button
          type="button"
          onClick={onSkipAll}
          className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
        >
          跳过全部，先进去看看
        </button>
      </div>
    </div>
  );
}
