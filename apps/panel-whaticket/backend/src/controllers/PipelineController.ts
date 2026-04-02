import { Request, Response } from "express";
import { Op } from "sequelize";
import sequelize from "../database";
import PipelineStage from "../models/PipelineStage";
import Ticket from "../models/Ticket";
import Contact from "../models/Contact";
import AppError from "../errors/AppError";
import GetDefaultPipelineStage from "../helpers/GetDefaultPipelineStage";
import UpdateTicketPipelineStageService from "../services/TicketServices/UpdateTicketPipelineStageService";
import UpdateTicketDealValueService from "../services/TicketServices/UpdateTicketDealValueService";

function parseDays(v: any, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), 1), 3650);
}

export const listStages = async (req: Request, res: Response) => {
  const stages = await PipelineStage.findAll({ order: [["order", "ASC"], ["id", "ASC"]] });
  return res.json({ stages });
};

export const createStage = async (req: Request, res: Response) => {
  const { name, category, order, isDefault } = req.body || {};
  if (!String(name || "").trim()) throw new AppError("name is required", 400);
  const cat = String(category || "OPEN").toUpperCase();
  if (!["OPEN", "WON", "LOST"].includes(cat)) throw new AppError("invalid category", 400);

  const stage = await PipelineStage.create({
    name: String(name).trim(),
    category: cat as any,
    order: Number.isFinite(Number(order)) ? Number(order) : 0,
    isDefault: !!isDefault
  } as any);

  if (stage.isDefault) {
    await PipelineStage.update({ isDefault: false }, { where: { id: { [Op.ne]: stage.id } } });
  }

  return res.status(201).json({ stage });
};

export const updateStage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const stage = await PipelineStage.findByPk(id);
  if (!stage) throw new AppError("Stage not found", 404);

  const patch: any = {};
  if (req.body?.name !== undefined) patch.name = String(req.body.name || "").trim();
  if (req.body?.category !== undefined) {
    const cat = String(req.body.category || "OPEN").toUpperCase();
    if (!["OPEN", "WON", "LOST"].includes(cat)) throw new AppError("invalid category", 400);
    patch.category = cat;
  }
  if (req.body?.order !== undefined && Number.isFinite(Number(req.body.order))) patch.order = Number(req.body.order);
  if (req.body?.isDefault !== undefined) patch.isDefault = !!req.body.isDefault;

  await stage.update(patch);

  if (patch.isDefault === true) {
    await PipelineStage.update({ isDefault: false }, { where: { id: { [Op.ne]: stage.id } } });
  }

  return res.json({ stage });
};

export const deleteStage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const stage = await PipelineStage.findByPk(id);
  if (!stage) throw new AppError("Stage not found", 404);

  // Prevent deleting the last stage
  const count = await PipelineStage.count();
  if (count <= 1) throw new AppError("Cannot delete last stage", 400);

  // Resolve fallback stage BEFORE any mutation.
  // If the stage being deleted is the default one, GetDefaultPipelineStage()
  // would return this same stage — so we must pick a different one first.
  let fallbackStage = await GetDefaultPipelineStage();
  if (!fallbackStage || String(fallbackStage.id) === String(stage.id)) {
    // Pick any other stage as fallback.
    fallbackStage = await PipelineStage.findOne({
      where: { id: { [Op.ne]: stage.id } },
      order: [["order", "ASC"], ["id", "ASC"]]
    });
  }
  if (!fallbackStage) throw new AppError("No fallback stage available", 500);

  // Wrap all mutations in a transaction to prevent partial state:
  // - two stages marked as default
  // - tickets with a destroyed stageId (orphaned)
  await sequelize.transaction(async t => {
    // If we are deleting the default stage, promote the fallback to default first.
    if (stage.isDefault) {
      await fallbackStage!.update({ isDefault: true }, { transaction: t });
    }

    // Reassign tickets to fallback stage before destroying.
    await Ticket.update(
      { pipelineStageId: fallbackStage!.id, stageChangedAt: new Date() },
      { where: { pipelineStageId: stage.id }, transaction: t }
    );

    await stage.destroy({ transaction: t });
  });

  return res.json({ ok: true });
};

export const board = async (req: Request, res: Response) => {
  const lookbackDays = parseDays(req.query.lookbackDays, 120);
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const stages = await PipelineStage.findAll({ order: [["order", "ASC"], ["id", "ASC"]] });
  const tickets = await Ticket.findAll({
    where: {
      [Op.or]: [
        { pipelineStageId: { [Op.ne]: null } } as any,
        { updatedAt: { [Op.gte]: cutoff } }
      ]
    },
    include: [{ model: Contact, as: "contact" }, { model: PipelineStage, as: "pipelineStage" }],
    order: [["updatedAt", "DESC"]]
  });

  // group
  const byStage: Record<string, any[]> = {};
  for (const st of stages) byStage[String(st.id)] = [];

  // Fallback bucket: tickets with no stage go to the first stage (by order)
  const firstStageId = stages.length > 0 ? String(stages[0].id) : null;

  for (const t of tickets) {
    const sid = String((t as any).pipelineStageId || "");
    if (sid && byStage[sid]) {
      byStage[sid].push(t);
    } else if (firstStageId) {
      // Ticket has null/unknown stage — show in first column so it's not invisible
      byStage[firstStageId].push(t);
    }
  }

  const stagesWithTickets = stages.map(stage => ({
    ...stage.toJSON(),
    tickets: byStage[String(stage.id)] || []
  }));

  return res.json({
    stages: stagesWithTickets,
    ticketsByStage: byStage,
    lookbackDays
  });
};

export const updateTicketStage = async (req: Request, res: Response) => {
  const { ticketId } = req.params;
  const { toStageId } = req.body || {};
  if (!toStageId) throw new AppError("toStageId is required", 400);
  // In some setups `req.user.id` can be a string. Normalize to number to satisfy service types.
  // @ts-ignore
  const rawUserId = req.user?.id;
  const userId = rawUserId !== undefined && rawUserId !== null && String(rawUserId).trim() !== ""
    ? Number(rawUserId)
    : undefined;
  const ticket = await UpdateTicketPipelineStageService({
    ticketId,
    toStageId: Number(toStageId),
    userId: Number.isFinite(userId as any) ? (userId as number) : undefined
  });
  return res.json({ ticket });
};

export const updateTicketValue = async (req: Request, res: Response) => {
  const { ticketId } = req.params;
  const { dealValue, dealCurrency } = req.body || {};

  // Normalize dealValue coming from JSON (it can be a string from inputs)
  let normalizedValue: number | null | undefined;
  if (dealValue === undefined) {
    normalizedValue = undefined;
  } else if (dealValue === null || dealValue === "") {
    normalizedValue = null;
  } else {
    const n = Number(dealValue);
    if (!Number.isFinite(n)) throw new AppError("Invalid dealValue", 400);
    normalizedValue = n;
  }

  const ticket = await UpdateTicketDealValueService({
    ticketId,
    dealValue: normalizedValue,
    dealCurrency
  });
  return res.json({ ticket });
};
