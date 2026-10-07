import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type { ReviewSnapshot } from './review-types'

/**
 * 加油复核 → 机坪安全台账 的同步链路。
 * 台账编号由加油记录号生成（FCHK-1003），重复复核 / 重复对齐都只保留一条。
 */
export const FUEL_LEDGER_PREFIX = 'FCHK'

export function ledgerCodeOf(recordId: number): string {
  return `${FUEL_LEDGER_PREFIX}-${String(recordId).padStart(4, '0')}`
}

function datePart(value: string): string {
  return value.split(' ')[0] ?? value
}

/** 一条复核快照对应一条机坪安全台账：一致直接闭环，差异进待整改。 */
export function buildLedgerRow(snapshot: ReviewSnapshot): EntryRow {
  const consistent = snapshot.consistent
  const delta = snapshot.confirmedLiters - snapshot.reportedLiters
  const deltaText = `${delta > 0 ? '+' : ''}${delta} 升`
  return {
    id: -1,
    status: consistent ? '已闭环' : '待整改',
    pending: !consistent,
    abnormal: !consistent,
    巡查编号: snapshot.ledgerCode,
    巡查区域: `加油车 ${snapshot.truckNo} / 航班 ${snapshot.flightNo}`,
    巡查人员: snapshot.reviewer,
    巡查日期: datePart(snapshot.reviewedAt),
    发现问题: consistent
      ? `油量确认一致：申报 ${snapshot.reportedLiters} 升，复核确认 ${snapshot.confirmedLiters} 升（${snapshot.fuelingNo}）`
      : `油量差异：申报 ${snapshot.reportedLiters} 升，复核确认 ${snapshot.confirmedLiters} 升，差异 ${deltaText}（${snapshot.fuelingNo} / ${snapshot.flightNo}）`,
    整改措施: consistent
      ? '无需整改，留档备查'
      : '通知加油车班组核对流量计，重新提交油量确认单',
    复查结果: consistent ? '加油量复核一致，已闭环' : '待重新核对加油量',
    安全状态: consistent ? '油量确认一致' : '油量存在差异',
  }
}

/**
 * 按台账编号幂等对齐：已存在的不重复写入，缺失的补齐。
 * 返回新增条数，供调用方判断链路是否发生过实际同步。
 */
export function reconcileFuelLedger(snapshots: ReviewSnapshot[]): number {
  if (snapshots.length === 0) {
    return 0
  }
  const rows = listRows('apron_safety')
  const existing = new Set(rows.map((row) => String(row['巡查编号'] ?? '')))
  const additions = snapshots
    .filter((snapshot) => !existing.has(snapshot.ledgerCode))
    .map((snapshot, index) => {
      const row = buildLedgerRow(snapshot)
      // 通用台账的 id 只取正数；在现有最大 id 之后顺延。
      const maxId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0)
      return { ...row, id: maxId + index + 1 }
    })
  if (additions.length > 0) {
    saveRows('apron_safety', [...rows, ...additions])
  }
  return additions.length
}
