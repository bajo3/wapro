import type { Request, Response } from 'express';
import { env } from '../lib/env.js';
import { upsertMapping, listMappings, getMappedVehicleId } from '../services/publicationMap.js';
import { sendDirectMessage } from '../services/metaGraph.js';

function assertAdmin(req: Request) {
  const token = (req.headers['x-admin-token'] as string | undefined) ?? '';
  if (token !== env.adminToken) {
    const e: any = new Error('Unauthorized');
    e.status = 401;
    throw e;
  }
}

export async function adminUpsertMapping(req: Request, res: Response) {
  assertAdmin(req);
  const { platform, mediaId, vehicleId } = req.body ?? {};
  if (!platform || !mediaId || !vehicleId) {
    return res.status(400).json({ error: 'platform, mediaId, vehicleId are required' });
  }
  await upsertMapping(platform, String(mediaId), String(vehicleId));
  res.json({ ok: true });
}

export async function adminGetMapping(req: Request, res: Response) {
  assertAdmin(req);
  const platform = String(req.query.platform ?? 'IG');
  const mediaId = String(req.query.mediaId ?? '');
  if (!mediaId) return res.status(400).json({ error: 'mediaId is required' });
  const vehicleId = await getMappedVehicleId(platform as any, mediaId);
  res.json({ platform, mediaId, vehicleId });
}

export async function adminListMappings(req: Request, res: Response) {
  assertAdmin(req);
  const platform = String(req.query.platform ?? 'IG');
  const limit = Number(req.query.limit ?? '200');
  const rows = await listMappings(platform as any, Number.isFinite(limit) ? limit : 200);
  res.json({ platform, count: rows.length, rows });
}

export async function adminSendMessage(req: Request, res: Response) {
  assertAdmin(req);
  const { recipientId, message } = req.body ?? {};
  if (!recipientId || !message) {
    return res.status(400).json({ error: 'recipientId and message are required' });
  }
  const result = await sendDirectMessage(String(recipientId), String(message));
  res.json({ ok: true, result });
}

export async function adminCampaignSend(req: Request, res: Response) {
  assertAdmin(req);
  const { recipients, message, delayMs } = req.body ?? {};
  if (!Array.isArray(recipients) || recipients.length === 0 || !message) {
    return res.status(400).json({ error: 'recipients (array) and message are required' });
  }

  const delay = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 300;
  const results: any[] = [];
  for (const rid of recipients) {
    try {
      const r = await sendDirectMessage(String(rid), String(message));
      results.push({ recipientId: String(rid), ok: true, result: r });
    } catch (e: any) {
      results.push({ recipientId: String(rid), ok: false, error: e?.message ?? 'error' });
    }
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const okCount = results.filter((x) => x.ok).length;
  res.json({ ok: true, sent: okCount, failed: results.length - okCount, results });
}
