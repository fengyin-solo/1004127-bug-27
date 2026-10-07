// 临时验证脚本：复核领域的共享数据源、看板归列、幂等复核、台账同步、空态重试。
import { setActivePinia, createPinia } from 'pinia'
import { useFuelingReviewStore } from './src/views/fueling/review-store'
import { FUEL_LEDGER_PREFIX } from './src/views/fueling/review-ledger'
import { listRows, saveRows } from './src/data/local-store'

const memory = new Map<string, string>()
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
}
;(globalThis as any).localStorage = (globalThis as any).window.localStorage

let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`PASS ${name}`)
  } else {
    failures++
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`)
  }
}

setActivePinia(createPinia())
const store = useFuelingReviewStore()

// 清空通用台账，保证断言干净
saveRows('apron_safety', [])
store.load()

// 1) 初始种子：看板按状态严格归列
check('待加油列数量', store.byStatus['待加油'].length, 1)
check('加油中列数量', store.byStatus['加油中'].length, 1)
check('已完成列数量', store.byStatus['已完成'].length, 3)
check('已复核列数量', store.byStatus['已复核'].length, 2)

// 2) 根因二：按加油车号 FY-312 定位时，同车的未复核记录仍留在原状态列
const byTruck = store.filteredRecords({ flightNo: '', truckNo: 'FY-312', fuelingNo: '' })
check('FY-312 命中两条', byTruck.length, 2)
check(
  'FY-312 记录状态集合',
  [...byTruck.map((r) => r.status)].sort((a, b) => a.localeCompare(b, 'zh')),
  ['加油中', '已完成'].sort((a, b) => a.localeCompare(b, 'zh')),
)

// 3) 根因一：视图/列表/详情同源——getById 与 filtered 中同一对象油量一致
const listRow = store.filteredRecords({ flightNo: '', truckNo: '', fuelingNo: '' }).find((r) => r.id === 1003)!
const detailRow = store.getById(1003)!
check('列表与详情油量一致', listRow.reportedLiters, detailRow.reportedLiters)
check('1003 油量', detailRow.reportedLiters, 7350)

// 4) 复核一致场景 + 台账同步
const r1 = store.reviewRecord(1003, { confirmedLiters: 7350, reviewer: '测试员' })
check('一致复核成功', r1.ok, true)
check('1003 变为已复核', store.getById(1003)!.status, '已复核')
// 历史差异保留原记录：申报油量未被改写
check('申报油量保留', store.getById(1003)!.reportedLiters, 7350)

// 5) 重复复核只生效一次
const r2 = store.reviewRecord(1003, { confirmedLiters: 9000, reviewer: '测试员' })
check('重复复核被拦截', r2.ok, false)
check('重复复核标记幂等', r2.idempotent, true)
check('重复后油量不变', store.getById(1003)!.reportedLiters, 7350)
check('1003 快照只有一条', store.snapshotsOf(1003).length, 1)

// 6) 差异场景：确认值不同 -> 快照留痕 + 台账待整改
const r3 = store.reviewRecord(1004, { confirmedLiters: 9900, reviewer: '测试员' })
check('差异复核成功', r3.ok, true)
const snap = store.snapshotsOf(1004)[0]
check('差异快照被追加', snap.consistent, false)
check('差异数值', snap.confirmedLiters - snap.reportedLiters, -80)

// 7) 非法状态不能复核（加油中）
const r4 = store.reviewRecord(1006, { confirmedLiters: 6480, reviewer: '测试员' })
check('加油中不可复核', r4.ok, false)
check('1006 仍为加油中', store.getById(1006)!.status, '加油中')

// 8) 无效油量
const r5 = store.reviewRecord(1005, { confirmedLiters: NaN, reviewer: '测试员' })
check('无效油量被拦截', r5.ok, false)

// 9) 台账同步：每条复核一条 FCHK 台账，重复对齐幂等
const ledger = listRows('apron_safety')
const fuelLedger = ledger.filter((row) => String(row['巡查编号']).startsWith(`${FUEL_LEDGER_PREFIX}-`))
check('台账条数=快照条数', fuelLedger.length, store.snapshots.length)
check('1003 台账闭环', fuelLedger.find((r) => r['巡查编号'] === 'FCHK-1003')!.status, '已闭环')
check('1004 台账待整改', fuelLedger.find((r) => r['巡查编号'] === 'FCHK-1004')!.status, '待整改')
check('1004 台账异常标记', fuelLedger.find((r) => r['巡查编号'] === 'FCHK-1004')!.abnormal, true)

// 10) 重新 load 后再次对齐不产生重复
store.load()
const ledgerAfter = listRows('apron_safety').filter((row) =>
  String(row['巡查编号']).startsWith(`${FUEL_LEDGER_PREFIX}-`),
)
check('重复对齐不产生新台账', ledgerAfter.length, fuelLedger.length)

// 11) 取不到记录
const r6 = store.reviewRecord(99999, { confirmedLiters: 100, reviewer: '测试员' })
check('不存在记录返回失败', r6.ok, false)
check('不存在 id 详情为空', store.getById(99999), undefined)

// 12) 持久化：新 pinia 实例模拟刷新后，状态从 localStorage 恢复
setActivePinia(createPinia())
const store2 = useFuelingReviewStore()
store2.load()
check('持久化-1003 已复核', store2.getById(1003)!.status, '已复核')
check('持久化-快照数', store2.snapshots.length, 4)

// 13) 空态/错误重试：模拟存储损坏
memory.set('airport-ground-handling:fueling-review:v1', '{坏的json')
store.load()
check('损坏数据进入错误空态', store.errorMessage.length > 0, true)
check('错误时记录清空', store.records.length, 0)
memory.delete('airport-ground-handling:fueling-review:v1')
store.load()
check('重试后恢复', store.records.length, 7)

if (failures > 0) {
  console.error(`\n${failures} 项验证失败`)
  process.exit(1)
}
console.log('\n全部验证通过')
