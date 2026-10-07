/**
 * 航空加油复核领域模型。
 *
 * 根因约定：看板视图、记录列表、详情页、复核历史、机坪安全台账
 * 全部只允许通过 useFuelingReviewStore 读取加油记录，
 * 任何地方都不缓存自己的一份「加油量」，避免列表渲染成上一航班的值。
 */

/** 加油记录主档：加油量（申报加油量）是受保护字段，复核不会改写它。 */
export type FuelingRecord = {
  id: number
  fuelingNo: string
  flightNo: string
  fuelType: string
  /** 申报加油量（升），来自加油车计量，复核只做比对，永不覆盖。 */
  reportedLiters: number
  truckNo: string
  startedAt: string
  endedAt: string
  status: FuelingStatus
}

export const FUELING_STATUSES = ['待加油', '加油中', '已完成', '已复核'] as const
export type FuelingStatus = (typeof FUELING_STATUSES)[number]

/** 复核动作流转目标：只有「已完成」的记录允许进入「已复核」。 */
export const REVIEWABLE_STATUS: FuelingStatus = '已完成'
export const REVIEWED_STATUS: FuelingStatus = '已复核'

/**
 * 复核留痕：历史差异保留原记录。
 * 每次成功复核只追加一条快照，主档申报加油量保持不变。
 */
export type ReviewSnapshot = {
  id: number
  recordId: number
  fuelingNo: string
  flightNo: string
  truckNo: string
  reportedLiters: number
  confirmedLiters: number
  consistent: boolean
  reviewer: string
  reviewedAt: string
  /** 同步到机坪安全台账后的台账编号，用于幂等对齐。 */
  ledgerCode: string
}

export type ReviewInput = {
  confirmedLiters: number
  reviewer: string
}

export type ReviewOutcome = {
  ok: boolean
  message: string
  /** 重复复核（或状态不允许复核）时为 true，调用方按提示处理，不重复落账。 */
  idempotent?: boolean
}
