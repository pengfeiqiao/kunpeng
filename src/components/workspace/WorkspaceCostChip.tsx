/**
 * WorkspaceCostChip — 工作台顶栏的项目累计花费 chip。
 * 实账与预估分列在 tooltip；预估按单价表折算，不代表渠道最终结算。
 */
import { useCostLedgerStore } from '@/stores/costLedgerStore';
import { formatCny } from '@/lib/pricing/rates';

export default function WorkspaceCostChip({ projectId }: { projectId?: string }) {
  const records = useCostLedgerStore((state) => state.records);
  if (!projectId) return null;
  let actual = 0;
  let estimate = 0;
  let count = 0;
  for (const record of records) {
    if (record.projectId !== projectId) continue;
    count += 1;
    if (record.costType === 'actual') actual += record.amountCny;
    else estimate += record.amountCny;
  }
  if (count === 0) return null;
  return (
    <span
      className="workspace-cost-chip"
      title={`实账 ¥${formatCny(actual)} + 预估 ¥${formatCny(estimate)}（预估按单价表折算，以渠道结算为准）`}
    >
      累计 ¥{formatCny(actual + estimate)}
    </span>
  );
}
