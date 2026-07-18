import type { Prisma, PrismaClient } from '@prisma/client'
import type { ReservationResultDto, SalesOrderDto } from '../../../shared/apiContracts'
import { planReservation } from '../../../shared/inventoryRules'
import { defaultTenantId, systemUserId } from '../../db'

type Db = PrismaClient | Prisma.TransactionClient

export async function listSalesOrders(db: Db): Promise<SalesOrderDto[]> {
  const orders = await db.salesOrder.findMany({
    include: {
      warehouse: true,
      lines: { include: { sku: true } },
    },
    orderBy: [{ promisedShipBy: 'asc' }],
  })

  return orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    channel: order.channel,
    status: order.status,
    paymentStatus: order.paymentStatus,
    priority: order.priority,
    warehouseCode: order.warehouse.code,
    promisedShipBy: order.promisedShipBy.toISOString(),
    lines: order.lines.map((line) => ({
      skuCode: line.sku.skuCode,
      skuName: line.sku.name,
      quantity: line.quantity,
    })),
  }))
}

export async function reserveSalesOrder(db: PrismaClient, orderId: string): Promise<ReservationResultDto> {
  return db.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      include: { lines: true },
    })

    if (!order) {
      return { ok: false, orderId, status: 'not_found', failures: [] }
    }

    if (order.status !== 'pending_reservation') {
      return { ok: true, orderId, status: order.status, failures: [] }
    }

    const balances = await tx.inventoryItem.findMany({
      where: {
        warehouseId: order.warehouseId,
        skuId: { in: order.lines.map((line) => line.skuId) },
      },
    })
    const decision = planReservation(order.lines, balances)

    if (!decision.ok) {
      await tx.auditLog.create({
        data: {
          id: `audit-reservation-failed-${Date.now()}`,
          tenantId: defaultTenantId,
          actorId: systemUserId,
          action: 'order.reservation_failed',
          entityType: 'sales_order',
          entityId: order.id,
          metadata: JSON.stringify({ failures: decision.failures }),
        },
      })

      return { ok: false, orderId, status: order.status, failures: decision.failures }
    }

    for (const line of order.lines) {
      const balance = balances.find((item) => item.skuId === line.skuId)

      if (!balance) {
        continue
      }

      await tx.inventoryItem.update({
        where: { id: balance.id },
        data: { reserved: { increment: line.quantity } },
      })
      await tx.stockReservation.create({
        data: {
          id: `res-${order.id}-${line.skuId}-${Date.now()}`,
          salesOrderId: order.id,
          skuId: line.skuId,
          warehouseId: order.warehouseId,
          quantity: line.quantity,
          status: 'active',
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        },
      })
    }

    await tx.salesOrder.update({
      where: { id: order.id },
      data: { status: 'allocated' },
    })
    const event = await tx.domainEvent.create({
      data: {
        id: `evt-order-reserved-${Date.now()}`,
        tenantId: defaultTenantId,
        eventType: 'order.reserved',
        aggregateType: 'sales_order',
        aggregateId: order.id,
        payload: JSON.stringify({ orderId: order.id, warehouseId: order.warehouseId }),
      },
    })
    await tx.outboxMessage.create({
      data: {
        id: `outbox-order-reserved-${Date.now()}`,
        eventId: event.id,
        destination: 'notifications.order_updates',
        status: 'pending',
        availableAt: new Date(),
      },
    })
    await tx.auditLog.create({
      data: {
        id: `audit-order-reserved-${Date.now()}`,
        tenantId: defaultTenantId,
        actorId: systemUserId,
        action: 'order.reserved',
        entityType: 'sales_order',
        entityId: order.id,
        metadata: JSON.stringify({ lineCount: order.lines.length }),
      },
    })

    return { ok: true, orderId, status: 'allocated', failures: [] }
  })
}
