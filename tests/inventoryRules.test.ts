import { describe, expect, it } from 'vitest'
import {
  applyReservation,
  applyShipment,
  availableToPromise,
  isLowStock,
  planReservation,
} from '../src/shared/inventoryRules'

const balance = {
  skuId: 'sku-pack-green',
  warehouseId: 'wh-west',
  onHand: 42,
  reserved: 20,
  reorderPoint: 50,
  safetyStock: 28,
}

describe('inventory domain rules', () => {
  it('calculates available-to-promise from on-hand minus reserved', () => {
    expect(availableToPromise(balance)).toBe(22)
  })

  it('allows a reservation when requested quantity is available', () => {
    expect(planReservation([{ skuId: 'sku-pack-green', quantity: 18 }], [balance])).toEqual({
      ok: true,
      failures: [],
    })
  })

  it('rejects a reservation that exceeds available inventory', () => {
    const decision = planReservation([{ skuId: 'sku-pack-green', quantity: 30 }], [balance])

    expect(decision.ok).toBe(false)
    expect(decision.failures[0]?.available).toBe(22)
  })

  it('increments reserved inventory when stock is reserved', () => {
    expect(applyReservation(balance, 5).reserved).toBe(25)
  })

  it('decrements both on-hand and reserved inventory when reserved stock ships', () => {
    expect(applyShipment(balance, 12)).toMatchObject({ onHand: 30, reserved: 8 })
  })

  it('flags low stock when available quantity is below reorder point', () => {
    expect(isLowStock(balance)).toBe(true)
  })
})
