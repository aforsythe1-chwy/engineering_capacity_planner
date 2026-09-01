import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/database.js';
import * as holidays from '../db/holiday.js';

export function registerHolidayRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { teamId: string }; Querystring: { start?: string; end?: string } }>('/api/teams/:teamId/holidays', async (req) => ({ holidays: holidays.listHolidays(db, req.params.teamId, req.query) }));
  app.post<{ Params: { teamId: string }; Body: unknown }>('/api/teams/:teamId/holidays', async (req) => holidays.createHoliday(db, req.params.teamId, req.body));
  app.put<{ Params: { teamId: string; holidayId: string }; Body: unknown }>('/api/teams/:teamId/holidays/:holidayId', async (req) => holidays.updateHoliday(db, req.params.teamId, req.params.holidayId, req.body));
  app.delete<{ Params: { teamId: string; holidayId: string } }>('/api/teams/:teamId/holidays/:holidayId', async (req, reply) => { holidays.deleteHoliday(db, req.params.teamId, req.params.holidayId); reply.code(204); });
}
