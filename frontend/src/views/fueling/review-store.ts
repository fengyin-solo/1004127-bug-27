import { defineStore } from 'pinia'

import {
  FUELING_STATUSES,
  REVIEWABLE_STATUS,
  REVIEWED_STATUS,
} from './review-types'
import type {
  FuelingRecord,
  FuelingStatus,
  ReviewInput,
  ReviewOutcome,
  ReviewSnapshot,
} from './review-types'
import { SEED_FUELING_RECORDS } from './review-seed'
import { ledgerCodeOf, reconcileFuelLedger } from './review-ledger'

// 独立且带版本的持久化键：不与通用表格的旧种子混用。
const STORAGE_KEY = 'airport-ground-handling:fueling-review:v1'

type PersistShape = {
  records: FuelingRecord[]
  snapshots: ReviewSnapshot[]
}

type StoreState = {
  records: FuelingRecord[]
  snapshots: ReviewSnapshot[]
  loading: boolean
  loaded: boolean
  errorMessage: string
  /** 测试 / 演示用：置为 true 后下一次读取会失败，空态可点「重试」恢复。 */
  failNextRead: boolean
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** 随种子数据给出的历史复核：差异记录（1002）已在台账待整改，重复对齐不会再插一条。 */
function seedSnapshots(): ReviewSnapshot[] {
  const at = '2026-10-07 08:30'
  return [
    {
      id: 1,
      recordId: 1001,
      fuelingNo: 'FUEL-1001',
      flightNo: 'CA1858',
      truckNo: 'FY-207',
      reportedLiters: 8600,
      confirmedLiters: 8600,
      consistent: true,
      reviewer: '值班管理员',
      reviewedAt: at,
      ledgerCode: ledgerCodeOf(1001),
    },
    {
      id: 2,
      recordId: 1002,
      fuelingNo: 'FUEL-1002',
      flightNo: 'MU5103',
      truckNo: 'FY-155',
      reportedLiters: 12400,
      confirmedLiters: 12380,
      consistent: false,
      reviewer: '值班管理员',
      reviewedAt: at,
      ledgerCode: ledgerCodeOf(1002),
    },
  ]
}

function readPersisted(): PersistShape {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { records: clone(SEED_FUELING_RECORDS), snapshots: seedSnapshots() }
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = { records: clone(SEED_FUELING_RECORDS), snapshots: seedSnapshots() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  const parsed = JSON.parse(raw) as PersistShape
  if (!Array.isArray(parsed.records) || !Array.isArray(parsed.snapshots)) {
    throw new Error('加油复核数据已损坏')
  }
  return parsed
}

function persist(state: PersistShape): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export type FuelingFilters = {
  flightNo: string
  truckNo: string
  fuelingNo: string
}

export const useFuelingReviewStore = defineStore('fueling-review', {
  state: (): StoreState => ({
    records: [],
    snapshots: [],
    loading: false,
    loaded: false,
    errorMessage: '',
    failNextRead: false,
  }),

  getters: {
    // 看板分组、列表、详情全部从这一份 records 派生，不允许各自拷贝。
    byStatus(state): Record<FuelingStatus, FuelingRecord[]> {
      const grouped = Object.fromEntries(
        FUELING_STATUSES.map((status) => [status, [] as FuelingRecord[]]),
      ) as Record<FuelingStatus, FuelingRecord[]>
      for (const record of state.records) {
        grouped[record.status].push(record)
      }
      return grouped
    },

    reviewHistory(state): ReviewSnapshot[] {
      // 最新复核在前
      return [...state.snapshots].sort((a, b) => b.id - a.id)
    },

    getById(state): (id: number) => FuelingRecord | undefined {
      return (id: number) => state.records.find((record) => record.id === id)
    },

    snapshotsOf(state): (recordId: number) => ReviewSnapshot[] {
      return (recordId: number) =>
        state.snapshots
          .filter((snapshot) => snapshot.recordId === recordId)
          .sort((a, b) => b.id - a.id)
    },

    /** 已复核但油量不一致、仍待整改的数量。 */
    pendingDiscrepancyCount(state): number {
      return state.snapshots.filter((snapshot) => !snapshot.consistent).length
    },
  },

  actions: {
    /** 初次进入 / 手动重试时统一走这里；失败展示空态并允许重试。 */
    load(): void {
      if (this.loading) {
        return
      }
      this.loading = true
      this.errorMessage = ''
      try {
        if (this.failNextRead) {
          this.failNextRead = false
          throw new Error('复核数据读取失败')
        }
        const data = readPersisted()
        this.records = data.records
        this.snapshots = data.snapshots
        this.loaded = true
        // 链路其余环节：把历史复核的油量确认补齐到机坪安全台账（幂等）。
        try {
          reconcileFuelLedger(this.snapshots)
        } catch {
          // 台账写入失败不阻断复核视图，下次加载会再次对齐
        }
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : '复核数据读取失败'
        this.records = []
        this.snapshots = []
        this.loaded = false
      } finally {
        this.loading = false
      }
    },

    ensureLoaded(): void {
      if (!this.loaded && !this.loading) {
        this.load()
      }
    },

    filteredRecords(filters: FuelingFilters): FuelingRecord[] {
      const flight = filters.flightNo.trim().toUpperCase()
      const truck = filters.truckNo.trim().toUpperCase()
      const fuelingNo = filters.fuelingNo.trim().toUpperCase()
      if (!flight && !truck && !fuelingNo) {
        return this.records
      }
      // 严格按记录自身字段过滤，绝不复用上一行（上一航班）的值
      return this.records.filter((record) => {
        if (flight && !record.flightNo.toUpperCase().includes(flight)) {
          return false
        }
        if (truck && !record.truckNo.toUpperCase().includes(truck)) {
          return false
        }
        if (fuelingNo && !record.fuelingNo.toUpperCase().includes(fuelingNo)) {
          return false
        }
        return true
      })
    },

    /**
     * 执行复核：重复复核只生效一次。
     * 成功后在同一事务内：改状态、追加差异快照、同步机坪安全台账。
     */
    reviewRecord(id: number, input: ReviewInput): ReviewOutcome {
      const index = this.records.findIndex((record) => record.id === id)
      if (index < 0) {
        return { ok: false, message: `没有找到编号为 ${id} 的加油记录，请刷新后重试` }
      }
      const record = this.records[index]
      if (record.status === REVIEWED_STATUS) {
        return { ok: false, message: '该记录已复核，重复复核只生效一次', idempotent: true }
      }
      if (record.status !== REVIEWABLE_STATUS) {
        return {
          ok: false,
          idempotent: true,
          message: `记录当前为「${record.status}」，仅「已完成」的加油记录可以复核`,
        }
      }
      const confirmed = Number(input.confirmedLiters)
      const reviewer = input.reviewer.trim() || '值班管理员'
      if (!Number.isFinite(confirmed) || confirmed <= 0) {
        return { ok: false, message: '请输入有效的复核加油量（大于 0 的升数）' }
      }

      const snapshot: ReviewSnapshot = {
        id: this.snapshots.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        recordId: record.id,
        fuelingNo: record.fuelingNo,
        flightNo: record.flightNo,
        truckNo: record.truckNo,
        reportedLiters: record.reportedLiters,
        confirmedLiters: confirmed,
        consistent: confirmed === record.reportedLiters,
        reviewer,
        reviewedAt: nowText(),
        ledgerCode: ledgerCodeOf(record.id),
      }

      const nextRecords = [...this.records]
      nextRecords[index] = { ...record, status: REVIEWED_STATUS }
      const nextSnapshots = [...this.snapshots, snapshot]

      try {
        persist({ records: nextRecords, snapshots: nextSnapshots })
        // 状态与快照先落盘成功，再同步台账；台账按编号幂等，失败可在下次加载时补齐
        reconcileFuelLedger([snapshot])
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : '复核结果保存失败，请重试',
        }
      }

      this.records = nextRecords
      this.snapshots = nextSnapshots
      return snapshot.consistent
        ? { ok: true, message: `复核完成：油量确认一致（${confirmed} 升），已同步机坪安全台账` }
        : {
            ok: true,
            message: `复核完成：油量存在差异 ${confirmed - record.reportedLiters > 0 ? '+' : ''}${
              confirmed - record.reportedLiters
            } 升，已同步机坪安全台账待整改`,
          }
    },

    resetSamples(): void {
      const seeded = { records: clone(SEED_FUELING_RECORDS), snapshots: seedSnapshots() }
      persist(seeded)
      this.records = seeded.records
      this.snapshots = seeded.snapshots
      this.errorMessage = ''
      this.loaded = true
      reconcileFuelLedger(this.snapshots)
    },
  },
})
