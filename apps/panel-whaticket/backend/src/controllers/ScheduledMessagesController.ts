import { Request, Response } from "express";
import ScheduledMessage from "../models/ScheduledMessage";

export const index = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 25)));
  const status = req.query.status ? String(req.query.status) : undefined;
  const where: any = {};
  if (status) where.status = status;

  const { rows, count } = await ScheduledMessage.findAndCountAll({
    where,
    order: [["sendAt", "ASC"]],
    limit,
    offset: (page - 1) * limit
  });

  return res.json({ count, page, limit, rows });
};

export const store = async (req: Request, res: Response) => {
  const { ticketId, contactId, body, mediaUrl, sendAt } = req.body ?? {};
  if (!ticketId || !contactId || !body || !sendAt) {
    return res.status(400).json({ error: "ticketId, contactId, body, sendAt are required" });
  }

  const userId = (req as any)?.user?.id ?? undefined;

  const row = await ScheduledMessage.create({
    ticketId: Number(ticketId),
    contactId: Number(contactId),
    userId,
    body: String(body),
    mediaUrl: mediaUrl ? String(mediaUrl) : null,
    sendAt: new Date(sendAt),
    status: "PENDING"
  } as any);

  return res.status(201).json({ ok: true, row });
};

export const cancel = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await ScheduledMessage.findByPk(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  await row.update({ status: "CANCELED" });
  return res.json({ ok: true, row });
};

export const remove = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await ScheduledMessage.findByPk(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  await row.destroy();
  return res.json({ ok: true });
};
