/**
 * costLedgerStore — 生成成本账本（按项目聚合）。
 *
 * 纪律（与 estimate.ts 一致）：
 * - 供应商实报（costType 'actual'：筷子 tokens / RunningHub consumeMoney）才记实账；
 *   其余一律 costType 'estimate'，展示层必须带"预估"字样。
 * - 幂等：同一 canvas 任务（taskId）只记一次——midjourney 幂等复用、
 *   恢复回填等路径不会重复入账。
 * - 拿不到 projectId 的调用方不入账（纯画布节点任务没有项目归属）。
 *
 * 持久化参照 canvasTaskStore 的 persist 模式（safeLocalStorage 防配额爆掉）。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import type { CostProvider } from '@/lib/pricing/rates';

export interface CostRecord {
  id: string;
  projectId: string;
  /** 生成任务 id（canvasTaskStore 任务）；幂等去重键。 */
  taskId?: string;
  /** 工作台对象标签（shot/objectId），便于对账。 */
  objectLabel?: string;
  kind: 'image' | 'video' | 'audio';
  engineId: string;
  engineLabel: string;
  provider: CostProvider;
  /** actual = 供应商实报；estimate = 按单价表折算的预估。 */
  costType: 'actual' | 'estimate';
  /** 人民币元（预估已含汇率/折扣折算，见 lib/pricing/rates.ts）。 */
  amountCny: number;
  /** 行内展示文案（含"预估"标注或实账说明）。 */
  displayText: string;
  /** 折算依据（tokens 数、单价、汇率等）。 */
  detail?: string;
  createdAt: number;
}

interface CostLedgerState {
  records: CostRecord[];
  /** 同一 taskId 已入账则跳过（幂等）；返回是否真正写入。 */
  addRecord: (record: Omit<CostRecord, 'id' | 'createdAt'>) => boolean;
  hasRecordForTask: (taskId: string) => boolean;
  /** 项目累计：实账与预估分开返回，展示层自行合计与标注。 */
  totalForProject: (projectId: string) => { actual: number; estimate: number };
  /** 项目记录，倒序（最新在前）。 */
  recordsForProject: (projectId: string) => CostRecord[];
}

let counter = 0;
const genId = () => `cost-${Date.now()}-${++counter}`;

// 账本只进不出，限制条数防 localStorage 配额被无限膨胀的历史挤爆
const MAX_RECORDS = 500;

export const useCostLedgerStore = create<CostLedgerState>()(
  persist<CostLedgerState, [], [], Pick<CostLedgerState, 'records'>>(
    (set, get) => ({
      records: [],

      addRecord: (record) => {
        if (!record.projectId) return false;
        if (record.taskId && get().records.some((item) => item.taskId === record.taskId)) return false;
        const entry: CostRecord = { ...record, id: genId(), createdAt: Date.now() };
        set((state) => ({ records: [...state.records, entry].slice(-MAX_RECORDS) }));
        return true;
      },

      hasRecordForTask: (taskId) => get().records.some((item) => item.taskId === taskId),

      totalForProject: (projectId) => {
        let actual = 0;
        let estimate = 0;
        for (const record of get().records) {
          if (record.projectId !== projectId) continue;
          if (record.costType === 'actual') actual += record.amountCny;
          else estimate += record.amountCny;
        }
        return { actual, estimate };
      },

      recordsForProject: (projectId) =>
        get().records.filter((record) => record.projectId === projectId).reverse(),
    }),
    {
      name: 'kunpeng-cost-ledger',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
      partialize: (state) => ({ records: state.records }),
    },
  ),
);
