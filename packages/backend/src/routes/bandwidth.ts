import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as bandwidth from '../db/bandwidth.js';

export function registerBandwidthRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { teamId?: string; from?: string; to?: string } }>('/api/bandwidth-check-ins', async (req) =>
    ({ checkIns: bandwidth.listBandwidthCheckIns(db, req.query) }),
  );
  app.get<{ Params: { teamId: string; date: string } }>('/api/teams/:teamId/bandwidth-check-ins/:date', async (req) =>
    bandwidth.getBandwidthDay(db, req.params.teamId, req.params.date),
  );
  app.patch<{ Params: { teamId: string; date: string }; Body: unknown }>('/api/teams/:teamId/bandwidth-check-ins/:date', async (req) =>
    bandwidth.patchBandwidthDay(db, req.params.teamId, req.params.date, req.body),
  );
  app.put<{ Params: { memberId: string; date: string } }>('/api/bandwidth-check-ins/:memberId/:date', async (req) =>
    bandwidth.upsertBandwidthCheckIn(db, req.params.memberId, req.params.date, (req.body ?? {}) as never),
  );
  app.delete<{ Params: { memberId: string; date: string } }>('/api/bandwidth-check-ins/:memberId/:date', async (req, reply) => {
    bandwidth.deleteBandwidthCheckIn(db, req.params.memberId, req.params.date);
    reply.code(204);
  });
}
