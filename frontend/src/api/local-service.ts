import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 复核联动：「模块:动作」复核通过后，往目标台账同步一笔确认记录。
const REVIEW_LEDGER_SYNC: Record<string, string> = {
  'fueling:复核记录': 'apron_safety',
}

// 页面拿到的永远是副本：列表、看板、详情各自编辑不到仓库里的行对象，刷新前不会出现脏数据。
function cloneRow(row: EntryRow): EntryRow {
  return { ...row }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters).map(cloneRow)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 详情与列表同源：按编号回仓库取最新一行，取不到就返回 null，交给页面空态。
export function getEntry(key: string, id: number): EntryRow | null {
  const found = listRows(key).find((row) => Number(row.id) === id)
  return found ? cloneRow(found) : null
}

// 加油复核通过后，机坪安全台账追加一笔「油量确认」。只追加不改写：
// 同油量已入账就跳过（重复复核只生效一次）；油量对不上就保留原记录、追加一条带序号的新记录。
function syncFuelingReviewLedger(ledgerKey: string, row: EntryRow): boolean {
  const ledger = listRows(ledgerKey)
  const syncCode = `FUEL-SYNC-${row['加油编号'] ?? row.id}`
  const amount = String(row['加油量'] ?? '')
  const history = ledger.filter((entry) => String(entry['巡查编号'] ?? '').startsWith(syncCode))
  if (history.some((entry) => String(entry['发现问题'] ?? '').includes(`加油量 ${amount}`))) {
    return false
  }
  const seq = history.length + 1
  const nextId = ledger.reduce((max, entry) => Math.max(max, Number(entry.id)), 0) + 1
  const entry: EntryRow = {
    id: nextId,
    status: '已闭环',
    pending: false,
    abnormal: false,
    巡查编号: seq > 1 ? `${syncCode}-R${seq}` : syncCode,
    巡查区域: '航空加油区',
    巡查人员: '加油复核联动',
    巡查日期: new Date().toISOString().slice(0, 10),
    发现问题: `油量确认：航班 ${row['关联航班'] ?? '—'} 加油量 ${amount}`,
    整改措施: `加油车号 ${row['加油车号'] ?? '—'}，无需整改`,
    复查结果: '油量已确认',
    安全状态: '已闭环',
  }
  saveRows(ledgerKey, [...ledger, entry])
  return true
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  const ledgerKey = REVIEW_LEDGER_SYNC[`${key}:${action}`]
  if (ledgerKey) {
    const synced = syncFuelingReviewLedger(ledgerKey, updated)
    const ledgerNote = synced ? '，机坪安全台账已同步油量确认' : '，机坪安全台账已有相同油量确认，未重复入账'
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${ledgerNote}` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
