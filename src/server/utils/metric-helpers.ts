import { EntityMetric_EntityType_Type, EntityMetric_MetricType_Type } from '@prisma/client';
import { clickhouse } from '~/server/clickhouse/client';
import { Context } from '~/server/createContext';
import { dbWrite } from '~/server/db/client';
import { logToAxiom } from '~/server/logging/client';

export const updateEntityMetric = async ({
  ctx,
  entityType = 'Image',
  entityId,
  metricType,
  amount = 1,
}: {
  ctx: DeepNonNullable<Context>;
  entityType?: EntityMetric_EntityType_Type;
  entityId: number;
  metricType: EntityMetric_MetricType_Type;
  amount?: number;
}) => {
  try {
    // Inc postgres EntityMetric
    const dbData = await dbWrite.$queryRaw<{ entityId: number }[]>`
      UPDATE "EntityMetric"
      SET "metricValue" = "metricValue" + ${amount}
      WHERE "entityType" = ${entityType}::"EntityMetric_EntityType_Type" AND "entityId" = ${entityId} AND "metricType" = ${metricType}::"EntityMetric_MetricType_Type"
      RETURNING "entityId"
    `;
    if (!dbData.length) {
      const cData = await clickhouse?.$query<{ total: number }>(`
        SELECT sum(metricValue) as total
        FROM entityMetricEvents
        WHERE entityType = '${entityType}' AND entityId = ${entityId} AND metricType = '${metricType}'
      `);
      const existingVal = cData?.[0]?.total ?? 0;
      const newVal = existingVal + amount;

      await dbWrite.$queryRaw<{ entityId: number }[]>`
        INSERT INTO "EntityMetric" ("entityType", "entityId", "metricType", "metricValue")
        VALUES (${entityType}::"EntityMetric_EntityType_Type", ${entityId}, ${metricType}::"EntityMetric_MetricType_Type", ${newVal})
      `;
    }

    // Queue with clickhouse tracker
    await ctx.track.entityMetric({ entityType, entityId, metricType, metricValue: amount });
  } catch (e) {
    const error = e as Error;
    // putting this into the clickhouse dataset for now
    logToAxiom(
      {
        type: 'error',
        name: 'Failed to increment metric',
        details: {
          data: JSON.stringify({ entityType, entityId, metricType, metricValue: amount }),
        },
        message: error.message,
        stack: error.stack,
        cause: error.cause,
      },
      'clickhouse'
    ).catch();
  }
};

export const incrementEntityMetric = async ({
  ctx,
  entityType = 'Image',
  entityId,
  metricType,
}: {
  ctx: DeepNonNullable<Context>;
  entityType?: EntityMetric_EntityType_Type;
  entityId: number;
  metricType: EntityMetric_MetricType_Type;
}) => {
  await updateEntityMetric({ ctx, entityType, entityId, metricType, amount: 1 });
};

export const decrementEntityMetric = async ({
  ctx,
  entityType = 'Image',
  entityId,
  metricType,
}: {
  ctx: DeepNonNullable<Context>;
  entityType?: EntityMetric_EntityType_Type;
  entityId: number;
  metricType: EntityMetric_MetricType_Type;
}) => {
  await updateEntityMetric({ ctx, entityType, entityId, metricType, amount: -1 });
};
