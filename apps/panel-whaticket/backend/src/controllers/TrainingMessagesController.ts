import { Request, Response } from "express";
import TrainingMessage from "../models/TrainingMessage";

export const index = async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit ?? 25)));
  const channel = req.query.channel ? String(req.query.channel) : undefined;
  const approved = req.query.approved !== undefined ? String(req.query.approved) : undefined;

  const where: any = {};
  if (channel) where.channel = channel;
  if (approved !== undefined) where.approved = approved === "true" || approved === "1";

  const { rows, count } = await TrainingMessage.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit,
    offset: (page - 1) * limit
  });

  return res.json({ count, page, limit, rows });
};

export const update = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { intent, approved, suggestion } = req.body ?? {};
  const row = await TrainingMessage.findByPk(id);
  if (!row) return res.status(404).json({ error: "Not found" });

  await row.update({
    intent: intent !== undefined ? String(intent) : row.intent,
    approved: approved !== undefined ? !!approved : row.approved,
    suggestion: suggestion !== undefined ? String(suggestion) : row.suggestion
  });

  return res.json({ ok: true, row });
};

export const remove = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await TrainingMessage.findByPk(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  await row.destroy();
  return res.json({ ok: true });
};
