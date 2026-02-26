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

const toNumber = (v: any, def = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
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
  lines.push(`Cotización #${q.number}`);
  lines.push(`Vehículo: ${q.vehicleLabel}`);
  lines.push(`Total: ${currency} ${fmtMoney(total)}`);

  // Breakdown (optional)
  if (base || discount || add) {
    lines.push(`Base: ${currency} ${fmtMoney(base)}`);
    if (discount) lines.push(`Descuento: ${currency} ${fmtMoney(discount)}`);
    if (add) lines.push(`Extras: ${currency} ${fmtMoney(add)}`);
  }

  const fin = (q as any).financing;
  if (fin && typeof fin === "object") {
    const down = toNumber(fin.downPayment);
    const months = toNumber(fin.months);
    const rate = toNumber(fin.interestRate);
    const monthly = toNumber(fin.monthlyPayment);
    const totalAmount = toNumber(fin.totalAmount);

    lines.push("\nFinanciación:");
    if (down) lines.push(`- Entrada: ${currency} ${fmtMoney(down)}`);
    if (months) lines.push(`- Plazo: ${months} meses`);
    if (rate) lines.push(`- Tasa: ${rate}% anual`);
    if (monthly) lines.push(`- Cuota estimada: ${currency} ${fmtMoney(monthly)}/mes`);
    if (totalAmount) lines.push(`- Total financiado: ${currency} ${fmtMoney(totalAmount)}`);
  }

  const tradeIn = (q as any).tradeIn;
  if (tradeIn && typeof tradeIn === "object") {
    const v = toNumber(tradeIn.value);
    lines.push("\nParte de pago:");
    lines.push(`- ${tradeIn.brand || ""} ${tradeIn.model || ""} ${tradeIn.year || ""}`.trim());
    if (v) lines.push(`- Valor estimado: ${currency} ${fmtMoney(v)}`);
  }

  if ((q as any).validUntil) {
    try {
      const d = new Date((q as any).validUntil);
      lines.push(`\nVálida hasta: ${d.toLocaleDateString("es-AR")}`);
    } catch {
      // ignore
    }
  }

  lines.push("\nSi querés, te paso opciones similares o coordinamos para verla 👇");
  return lines.join("\n");
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const status = String(req.query.status || "all");
  const q = String(req.query.q || "").trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));

  const where: any = {};
  if (status && status !== "all") where.status = status;

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
  const quotation = await Quotation.findByPk(id);
  if (!quotation) throw new AppError("ERR_QUOTATION_NOT_FOUND", 404);
  return res.json({ quotation });
};

export const create = async (req: Request, res: Response): Promise<Response> => {
  const body = req.body || {};

  const clientName = String(body.clientName || "").trim();
  const vehicleLabel = String(body.vehicleLabel || body.vehicle || "").trim();

  if (!clientName) throw new AppError("ERR_QUOTATION_CLIENT_REQUIRED", 400);
  if (!vehicleLabel) throw new AppError("ERR_QUOTATION_VEHICLE_REQUIRED", 400);

  const year = new Date().getFullYear();

  // Best-effort sequential number per year.
  let seq = (await Quotation.count({ where: { number: { [Op.like]: `${year}-%` } } })) + 1;
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
    clientPhone: String(body.clientPhone || "").trim() || null,
    contactId: body.contactId ?? null,
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
    validUntil: body.validUntil ? new Date(body.validUntil) : null,
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

  const patch: any = {
    status: body.status ?? quotation.status,
    clientRefId: body.clientRefId ?? body.clientId ?? quotation.clientRefId,
    clientName: body.clientName ?? quotation.clientName,
    clientPhone: body.clientPhone ?? quotation.clientPhone,
    contactId: body.contactId ?? quotation.contactId,
    vehicleRefId: body.vehicleRefId ?? body.vehicleId ?? quotation.vehicleRefId,
    vehicleLabel: body.vehicleLabel ?? body.vehicle ?? quotation.vehicleLabel,
    vehicleData: body.vehicleData ?? quotation.vehicleData,
    currency: body.currency ? String(body.currency).toUpperCase() : quotation.currency,
    basePrice: body.basePrice ?? quotation.basePrice,
    discount: body.discount ?? quotation.discount,
    additionalCosts: body.additionalCosts ?? quotation.additionalCosts,
    totalPrice: body.totalPrice ?? quotation.totalPrice,
    financing: body.financing ?? quotation.financing,
    tradeIn: body.tradeIn ?? quotation.tradeIn,
    notes: body.notes ?? quotation.notes,
    validUntil: body.validUntil ? new Date(body.validUntil) : quotation.validUntil,
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

    // persist the link
    try {
      await quotation.update({ contactId: contact.id });
    } catch {
      // ignore
    }
  }

  // Find or create ticket and send message.
  const ticket = await FindOrCreateTicketService(contact, whatsapp.id, 0);

  const message = buildQuotationMessage(quotation);
  await SendWhatsAppMessage({ body: message, ticket } as any);

  const nextStatus = String(quotation.status || "draft") === "draft" ? "sent" : quotation.status;
  await quotation.update({ status: nextStatus, sentAt: new Date() } as any);

  return res.json({ ok: true, quotation });
};
