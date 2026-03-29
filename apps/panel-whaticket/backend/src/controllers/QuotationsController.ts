import { Request, Response } from "express";
import { Op } from "sequelize";

import AppError from "../errors/AppError";
import Quotation from "../models/Quotation";
import Contact from "../models/Contact";
import Whatsapp from "../models/Whatsapp";

import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";

const normalizePhone = (phone: any): string => {
  return String(phone || "").replace(/\D/g, "").trim();
};

const normalizeVehicleToken = (value: any): string => String(value ?? "").trim();

const normalizeVehicleCompare = (value: any): string =>
  normalizeVehicleToken(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const uniqueVehicleParts = (parts: any[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = normalizeVehicleToken(part);
    const key = normalizeVehicleCompare(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

const buildVehicleLabelFromData = (data: any): string => {
  if (!data || typeof data !== "object") return "";
  const brand = normalizeVehicleToken(data.marca || data.brand);
  const model = normalizeVehicleToken(data.modelo || data.model);
  const year = normalizeVehicleToken(data.year);
  const version = normalizeVehicleToken(data.version);
  const title = normalizeVehicleToken(data.title || data.name);

  const base = uniqueVehicleParts([brand, model, year]);
  const baseNorm = normalizeVehicleCompare(base.join(" "));
  const versionNorm = normalizeVehicleCompare(version);
  const titleNorm = normalizeVehicleCompare(title);
  const extras: string[] = [];
  if (version && versionNorm && !baseNorm.includes(versionNorm)) extras.push(version);
  if (title && titleNorm && !baseNorm.includes(titleNorm) && !extras.some(x => normalizeVehicleCompare(x) === titleNorm)) extras.push(title);

  const label = uniqueVehicleParts([...base, ...extras]).join(" ").trim();
  return label || normalizeVehicleToken(data.label) || title || uniqueVehicleParts([brand, model, version, year]).join(" ").trim();
};

const toNumber = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const toValidDate = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const fmtMoney = (n: number): string => {
  try {
    return Math.round(n).toLocaleString("es-AR");
  } catch {
    return String(n);
  }
};

const buildQuotationMessage = (q: Quotation): string => {
  const currency = String((q as any).currency || "USD").toUpperCase();
  const total = toNumber((q as any).totalPrice);
  const base = toNumber((q as any).basePrice);
  const discount = toNumber((q as any).discount);
  const add = toNumber((q as any).additionalCosts);

  const lines: string[] = [];

  // Header
  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🚗 *COTIZACIÓN #${q.number}*`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`📋 Vehículo: *${q.vehicleLabel}*`);
  lines.push(`👤 Cliente: ${q.clientName}`);
  lines.push(``);

  // Price breakdown
  lines.push(`💰 *Precio*`);
  if (base && (discount || add)) {
    lines.push(`  Base:       ${currency} ${fmtMoney(base)}`);
    if (discount) lines.push(`  Descuento: -${currency} ${fmtMoney(discount)}`);
    if (add)      lines.push(`  Extras:    +${currency} ${fmtMoney(add)}`);
    lines.push(`  ─────────────────`);
  }
  lines.push(`  *Total: ${currency} ${fmtMoney(total)}*`);
  lines.push(``);

  // Financing
  const fin = (q as any).financing;
  if (fin && typeof fin === "object") {
    const down = toNumber(fin.downPayment);
    const months = toNumber(fin.months);
    const rate = toNumber(fin.interestRate);
    const monthly = toNumber(fin.monthlyPayment);
    const totalFin = toNumber(fin.totalAmount);

    lines.push(`🏦 *Financiación*`);
    if (down)     lines.push(`  Entrada:       ${currency} ${fmtMoney(down)}`);
    if (months)   lines.push(`  Plazo:         ${months} meses`);
    if (rate)     lines.push(`  Tasa:          ${rate}% anual`);
    if (monthly)  lines.push(`  Cuota estimada: ${currency} ${fmtMoney(monthly)}/mes`);
    if (totalFin) lines.push(`  Total financ.: ${currency} ${fmtMoney(totalFin)}`);
    lines.push(``);
  }

  // Trade-in
  const tradeIn = (q as any).tradeIn;
  if (tradeIn && typeof tradeIn === "object") {
    const v = toNumber(tradeIn.value);
    const label = [tradeIn.brand, tradeIn.model, tradeIn.year].filter(Boolean).join(" ").trim();
    lines.push(`🔄 *Parte de pago*`);
    if (label) lines.push(`  Vehículo: ${label}`);
    if (v)     lines.push(`  Valor est.: ${currency} ${fmtMoney(v)}`);
    lines.push(``);
  }

  // Notes
  if ((q as any).notes) {
    lines.push(`📝 *Notas:* ${(q as any).notes}`);
    lines.push(``);
  }

  // Validity
  if ((q as any).validUntil) {
    try {
      const d = new Date((q as any).validUntil);
      lines.push(`⏳ Válida hasta: ${d.toLocaleDateString("es-AR")}`);
      lines.push(``);
    } catch { /* ignore */ }
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`¿Querés avanzar? Respondé este mensaje o consultá con nuestro asesor. 👇`);

  return lines.join("\n");
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const status = String(req.query.status || "all");
  const q = String(req.query.q || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const ticketIdParam = req.query.ticketId;

  const where: any = {};
  if (status && status !== "all") where.status = status;

  if (ticketIdParam !== undefined) {
    const tid = Number(ticketIdParam);
    where.ticketId = Number.isFinite(tid) ? tid : null;
  }

  if (q) {
    where[Op.or] = [
      { number: { [Op.iLike]: `%${q}%` } },
      { clientName: { [Op.iLike]: `%${q}%` } },
      { clientPhone: { [Op.iLike]: `%${q}%` } },
      { vehicleLabel: { [Op.iLike]: `%${q}%` } }
    ];
  }

  const quotations = await Quotation.findAll({
    where,
    order: [["createdAt", "DESC"]],
    limit
  });

  return res.json({ quotations });
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const id = Number(req.params.id);
  const quotation = await Quotation.findByPk(id, {
    include: [
      { association: "ticket", required: false },
      { association: "contact", required: false },
      { association: "createdBy", required: false }
    ]
  });
  if (!quotation) throw new AppError("ERR_QUOTATION_NOT_FOUND", 404);
  return res.json({ quotation });
};

export const create = async (req: Request, res: Response): Promise<Response> => {
  const body = req.body || {};

  let clientName = String(body.clientName || body.contactName || "").trim();
  let clientPhone = String(body.clientPhone || body.contactPhone || "").trim();
  let vehicleLabel = String(body.vehicleLabel || body.vehicle || "").trim();
  const derivedVehicleLabel = buildVehicleLabelFromData(body.vehicleData);

  if (!clientName && body.contactId) {
    const c = await Contact.findByPk(body.contactId as any);
    if (c) {
      clientName = String(c.name || "").trim();
      clientPhone = clientPhone || String(c.number || "").trim();
    }
  }

  if (!vehicleLabel || vehicleLabel.split(/\s+/).length <= 2 || !/[a-z]/i.test(vehicleLabel)) {
    vehicleLabel = derivedVehicleLabel || vehicleLabel;
  }

  if (!clientName) throw new AppError("ERR_QUOTATION_CLIENT_REQUIRED", 400);
  if (!vehicleLabel) throw new AppError("ERR_QUOTATION_VEHICLE_REQUIRED", 400);

  const year = new Date().getFullYear();

  // Best-effort sequential number per year.
  // Counting all existing quotations with the same prefix and adding 1 can lead to
  // race conditions when multiple quotations are created concurrently. Instead,
  // fetch the latest quotation for the current year ordered by number
  // descending, parse its sequence and increment it. If none exists, start
  // from 1. This still may collide under heavy concurrency, but combined with
  // the retry loop below it reduces the likelihood of duplicate numbers.
  const lastQuotation = await Quotation.findOne({
    where: { number: { [Op.like]: `${year}-%` } },
    order: [["number", "DESC"]]
  });
  let seq = 1;
  if (lastQuotation?.number) {
    const parts = String(lastQuotation.number).split("-");
    const s = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
    if (Number.isFinite(s)) seq = s + 1;
  }
  let number = `${year}-${String(seq).padStart(3, "0")}`;

  const basePrice = toNumber(body.basePrice);
  const discount = toNumber(body.discount);
  const additionalCosts = toNumber(body.additionalCosts);
  const totalPrice = toNumber(body.totalPrice);

  const payload: any = {
    number,
    status: String(body.status || "draft"),
    clientRefId: body.clientRefId ?? body.clientId ?? null,
    clientName,
    clientPhone: clientPhone || null,
    contactId: body.contactId ?? null,
    ticketId: body.ticketId ? Number(body.ticketId) : null,
    vehicleRefId: body.vehicleRefId ?? body.vehicleId ?? null,
    vehicleLabel,
    vehicleData: body.vehicleData ?? null,
    currency: String(body.currency || "USD").toUpperCase(),
    basePrice,
    discount,
    additionalCosts,
    totalPrice,
    financing: body.financing ?? null,
    tradeIn: body.tradeIn ?? null,
    notes: String(body.notes || "").trim() || null,
    validUntil: toValidDate(body.validUntil),
    createdByUserId: (req as any).user?.id ?? null,
    meta: body.meta ?? null
  };

  // Retry if unique constraint hits (rare).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const quotation = await Quotation.create(payload);
      return res.status(201).json({ quotation });
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("unique") || msg.includes("Unique") || msg.includes("duplicate")) {
        seq += 1;
        number = `${year}-${String(seq).padStart(3, "0")}`;
        payload.number = number;
        continue;
      }
      throw err;
    }
  }

  throw new AppError("ERR_QUOTATION_CREATE_FAILED", 500);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const id = Number(req.params.id);
  const quotation = await Quotation.findByPk(id);
  if (!quotation) throw new AppError("ERR_QUOTATION_NOT_FOUND", 404);

  const body = req.body || {};

  let nextClientName = body.clientName ?? body.contactName ?? quotation.clientName;
  let nextClientPhone = body.clientPhone ?? body.contactPhone ?? quotation.clientPhone;
  let nextVehicleLabel = body.vehicleLabel ?? body.vehicle ?? quotation.vehicleLabel;
  const nextDerivedVehicleLabel = buildVehicleLabelFromData(body.vehicleData ?? quotation.vehicleData);

  if ((!nextClientName || !String(nextClientName).trim()) && (body.contactId ?? quotation.contactId)) {
    const c = await Contact.findByPk((body.contactId ?? quotation.contactId) as any);
    if (c) {
      nextClientName = c.name;
      nextClientPhone = nextClientPhone || c.number;
    }
  }

  if (!nextVehicleLabel || !String(nextVehicleLabel).trim() || String(nextVehicleLabel).trim().split(/\s+/).length <= 2) {
    nextVehicleLabel = nextDerivedVehicleLabel || nextVehicleLabel;
  }

  const patch: any = {
    status: body.status ?? quotation.status,
    clientRefId: body.clientRefId ?? body.clientId ?? quotation.clientRefId,
    clientName: nextClientName,
    clientPhone: nextClientPhone,
    contactId: body.contactId ?? quotation.contactId,
    ticketId: body.ticketId !== undefined
      ? (body.ticketId ? Number(body.ticketId) : null)
      : quotation.ticketId,
    vehicleRefId: body.vehicleRefId ?? body.vehicleId ?? quotation.vehicleRefId,
    vehicleLabel: nextVehicleLabel,
    vehicleData: body.vehicleData ?? quotation.vehicleData,
    currency: body.currency ? String(body.currency).toUpperCase() : quotation.currency,
    basePrice: body.basePrice ?? quotation.basePrice,
    discount: body.discount ?? quotation.discount,
    additionalCosts: body.additionalCosts ?? quotation.additionalCosts,
    totalPrice: body.totalPrice ?? quotation.totalPrice,
    financing: body.financing ?? quotation.financing,
    tradeIn: body.tradeIn ?? quotation.tradeIn,
    notes: body.notes ?? quotation.notes,
    validUntil: body.validUntil !== undefined ? toValidDate(body.validUntil) : quotation.validUntil,
    meta: body.meta ?? quotation.meta
  };

  await quotation.update(patch);

  return res.json({ quotation });
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const id = Number(req.params.id);
  const quotation = await Quotation.findByPk(id);
  if (!quotation) throw new AppError("ERR_QUOTATION_NOT_FOUND", 404);

  await quotation.destroy();
  return res.json({ ok: true });
};

export const send = async (req: Request, res: Response): Promise<Response> => {
  const id = Number(req.params.id);
  const quotation = await Quotation.findByPk(id);
  if (!quotation) throw new AppError("ERR_QUOTATION_NOT_FOUND", 404);

  // Prevent accidental re-sends of already-accepted/rejected quotations
  if (["accepted", "rejected"].includes(quotation.status)) {
    throw new AppError("ERR_QUOTATION_ALREADY_CLOSED", 400);
  }

  // Ensure we have a WhatsApp connection to send from.
  const whatsapp =
    (await Whatsapp.findOne({ where: { isDefault: true } })) ||
    (await Whatsapp.findOne({ order: [["id", "ASC"]] }));

  if (!whatsapp?.id) throw new AppError("ERR_WAPP_NOT_INITIALIZED", 400);

  // Resolve (or create) Contact.
  let contact: Contact | null = null;

  if (quotation.contactId) {
    contact = await Contact.findByPk(quotation.contactId);
  }

  if (!contact) {
    const normalized = normalizePhone((quotation as any).clientPhone);
    if (!normalized) throw new AppError("ERR_QUOTATION_PHONE_REQUIRED", 400);

    contact = await Contact.findOne({ where: { number: normalized } });
    if (!contact) {
      contact = await Contact.create({
        name: quotation.clientName,
        number: normalized
      } as any);
    }

    try { await quotation.update({ contactId: contact!.id }); } catch { /* ignore */ }
  }

  if (!contact) throw new AppError("ERR_QUOTATION_CONTACT_RESOLVE_FAILED", 500);

  // Find or create ticket and send message.
  const ticket = await FindOrCreateTicketService(contact, whatsapp.id, 0);
  const message = buildQuotationMessage(quotation);
  await SendWhatsAppMessage({ body: message, ticket } as any);

  // Status progression: draft/viewed → sent, sent stays sent. Do not change
  // status if already in a terminal state (accepted/rejected) – those cases
  // are handled at the start of the handler. The previous implementation
  // always set "sent" regardless of the current status, which was redundant.
  const currentStatus = String(quotation.status || "draft");
  // When sending a quotation we transition to the "sent" status unless it is already "sent".
  const nextStatus = "sent";
  if (currentStatus !== nextStatus) {
    await quotation.update({ status: nextStatus, sentAt: new Date() } as any);
  } else {
    // If it's already sent, just refresh the timestamp
    await quotation.update({ sentAt: new Date() } as any);
  }

  return res.json({ ok: true, quotation, ticketId: ticket.id });
};

/**
 * expireStale — Marca como "expired" todas las cotizaciones cuyo validUntil
 * ya pasó y siguen en estado "sent" o "viewed".
 * Puede llamarse manualmente desde el panel o en un cron job.
 */
export const expireStale = async (req: Request, res: Response): Promise<Response> => {
  const now = new Date();
  const [count] = await Quotation.update(
    { status: "expired" } as any,
    {
      where: {
        status: { [Op.in]: ["sent", "viewed", "draft"] },
        validUntil: { [Op.lt]: now, [Op.not]: null }
      }
    }
  );
  return res.json({ ok: true, expired: count, checkedAt: now.toISOString() });
};

/**
 * stats — Resumen de cotizaciones por estado + conversión.
 */
export const stats = async (req: Request, res: Response): Promise<Response> => {
  const Sequelize = (Quotation as any).sequelize;
  if (!Sequelize) throw new AppError("ERR_DB_NOT_INITIALIZED", 500);

  const rows = await Quotation.findAll({
    attributes: [
      "status",
      [Sequelize.fn("COUNT", Sequelize.col("id")), "total"],
      [Sequelize.fn("SUM", Sequelize.col("totalPrice")), "totalAmount"]
    ],
    group: ["status"],
    raw: true
  });

  const byStatus: Record<string, { total: number; totalAmount: number }> = {};
  for (const row of rows as any[]) {
    byStatus[row.status] = {
      total: Number(row.total),
      totalAmount: Number(row.totalAmount ?? 0)
    };
  }

  const total = Object.values(byStatus).reduce((s, r) => s + r.total, 0);
  const accepted = byStatus.accepted?.total ?? 0;
  const conversionRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

  return res.json({ ok: true, byStatus, total, conversionRate });
};
