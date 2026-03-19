import { Request, Response } from "express";
import fetch from "node-fetch";
import { getIO } from "../libs/socket";

import CreateTicketService from "../services/TicketServices/CreateTicketService";
import DeleteTicketService from "../services/TicketServices/DeleteTicketService";
import ListTicketsService from "../services/TicketServices/ListTicketsService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import formatBody from "../helpers/Mustache";
import { botDeleteConversationRule, botSetConversationMode } from "../services/BotServices/botApi";
import AgentFeedback from "../models/AgentFeedback";
import Message from "../models/Message";
import Contact from "../models/Contact";
import User from "../models/User";
import Ticket from "../models/Ticket";
import AppError from "../errors/AppError";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  status: string;
  date: string;
  showAll: string;
  withUnreadMessages: string;
  queueIds: string;
  whatsappIds: string;
};

interface TicketData {
  contactId: number;
  status: string;
  queueId: number;
  userId: number;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const {
    pageNumber,
    status,
    date,
    searchParam,
    showAll,
    queueIds: queueIdsStringified,
    whatsappIds: whatsappIdsStringified,
    withUnreadMessages
  } = req.query as IndexQuery;

  const userId = req.user.id;

  let queueIds: number[] = [];
  let whatsappIds: number[] = [];

  if (queueIdsStringified) {
    try {
      // Frontend sends queueIds as a JSON string, e.g. "[]" or "[1,2]".
      // Be defensive: never let a malformed query blow up the endpoint.
      queueIds = JSON.parse(queueIdsStringified);
      if (!Array.isArray(queueIds)) queueIds = [];
    } catch {
      queueIds = [];
    }
  }

  if (whatsappIdsStringified) {
    try {
      whatsappIds = JSON.parse(whatsappIdsStringified);
      if (!Array.isArray(whatsappIds)) whatsappIds = [];
    } catch {
      whatsappIds = [];
    }
  }

  const { tickets, count, hasMore } = await ListTicketsService({
    searchParam,
    pageNumber,
    status,
    date,
    showAll,
    userId,
    queueIds,
    whatsappIds,
    withUnreadMessages
  });

  return res.status(200).json({ tickets, count, hasMore });
};

export const counts = async (req: Request, res: Response): Promise<Response> => {
  const {
    showAll,
    queueIds: queueIdsStringified,
    whatsappIds: whatsappIdsStringified
  } = req.query as any;

  const userId = req.user.id;

  let queueIds: number[] = [];
  let whatsappIds: number[] = [];

  if (queueIdsStringified) {
    try {
      queueIds = JSON.parse(queueIdsStringified);
      if (!Array.isArray(queueIds)) queueIds = [];
    } catch {
      queueIds = [];
    }
  }

  if (whatsappIdsStringified) {
    try {
      whatsappIds = JSON.parse(whatsappIdsStringified);
      if (!Array.isArray(whatsappIds)) whatsappIds = [];
    } catch {
      whatsappIds = [];
    }
  }

  const CountTicketsService = (await import("../services/TicketServices/CountTicketsService")).default;
  const data = await CountTicketsService({ userId, queueIds, whatsappIds, showAll });
  return res.status(200).json(data);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { contactId, status, userId }: TicketData = req.body;

  const ticket = await CreateTicketService({ contactId, status, userId });

  const io = getIO();
  io.to(ticket.status).emit("ticket", {
    action: "update",
    ticket
  });

  return res.status(200).json(ticket);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;

  const contact = await ShowTicketService(ticketId);

  return res.status(200).json(contact);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const ticketData: TicketData = req.body;

  const { ticket, oldUserId } = await UpdateTicketService({
    ticketData,
    ticketId
  });

  // ✅ Bot handoff rule:
  // - when a ticket gets assigned to a user, stop the bot (conversation HUMAN_ONLY)
  // - when it becomes unassigned again, allow the bot back (delete conversation rule)
  try {
    const instance = String(ticket.whatsapp?.name || "");
    const number = String(ticket.contact?.number || "");
    if (instance && number) {
      const remoteJid = `${number}@s.whatsapp.net`;
      const wasAssigned = !!oldUserId;
      const isAssigned = !!ticket.userId;

      if (!wasAssigned && isAssigned) {
        void botSetConversationMode({
          instance,
          remoteJid,
          botMode: "HUMAN_ONLY",
          notes: "ticket_assigned"
        });

        // Persist last selected bot mode in the panel.
        void ticket.update({ botMode: "HUMAN_ONLY" });
      }

      if (wasAssigned && !isAssigned) {
        void botDeleteConversationRule({ instance, remoteJid });
        void ticket.update({ botMode: "ON" });
      }
    }
  } catch {
    // best-effort
  }

  if (ticket.status === "closed") {
    const whatsapp = await ShowWhatsAppService(ticket.whatsappId);

    const { farewellMessage } = whatsapp;

    if (farewellMessage) {
      await SendWhatsAppMessage({
        body: formatBody(farewellMessage, ticket.contact),
        ticket
      });
    }
  }

  return res.status(200).json(ticket);
};

export const updateBotMode = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const raw = String(req.body?.botMode || "").toUpperCase();

  const ticket = await ShowTicketService(ticketId);

  const instance = String(ticket.whatsapp?.name || "");
  const number = String(ticket.contact?.number || "");
  const remoteJid = instance && number ? `${number}@s.whatsapp.net` : "";

  // Default behavior:
  // - ON  => bot can reply (delete any override rule)
  // - HUMAN_ONLY => bot muted (rule)
  // - OFF => bot disabled (rule)
  let next: "ON" | "OFF" | "HUMAN_ONLY" = "ON";
  if (raw === "OFF" || raw === "HUMAN_ONLY" || raw === "ON") next = raw as any;

  try {
    if (instance && remoteJid) {
      if (next === "ON") {
        void botDeleteConversationRule({ instance, remoteJid });
      } else {
        void botSetConversationMode({
          instance,
          remoteJid,
          botMode: next,
          notes: "panel_toggle"
        });
      }
    }
  } catch {
    // best-effort
  }

  await ticket.update({ botMode: next });

  const io = getIO();
  io.to(ticket.status).to(ticket.id.toString()).emit("ticket", {
    action: "update",
    ticket
  });

  return res.status(200).json(ticket);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;

  const ticket = await DeleteTicketService(ticketId);

  const io = getIO();
  io.to(ticket.status).to(ticketId).to("notification").emit("ticket", {
    action: "delete",
    ticketId: +ticketId
  });

  return res.status(200).json({ message: "ticket deleted" });
};


export const createAgentFeedback = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { ticketId } = req.params;
  const { verdict, note, finalReply } = req.body || {};

  const allowed = new Set(["approved", "rejected", "edited", "handoff"]);
  const cleanVerdict = String(verdict || "").toLowerCase();
  if (!allowed.has(cleanVerdict)) {
    return res.status(400).json({ error: "Invalid verdict" });
  }

  const ticket = await ShowTicketService(ticketId);
  const agentData = (ticket as any).agentData || {};

  const row = await AgentFeedback.create({
    source: "ticket_agent_panel",
    verdict: cleanVerdict,
    note: note ? String(note) : null,
    finalReply: finalReply ? String(finalReply) : null,
    suggestedReply: agentData?.suggestedReply || null,
    intent: agentData?.intent || null,
    action: agentData?.action || null,
    confidence:
      agentData?.confidence !== undefined && agentData?.confidence !== null
        ? Number(agentData.confidence)
        : null,
    meta: {
      handoffRecommended: Boolean(agentData?.handoffRecommended),
      urgency: agentData?.urgency || null,
      missingFields: Array.isArray(agentData?.missingFields) ? agentData.missingFields : [],
      internalReason: agentData?.internalReason || null,
      extracted: agentData?.extracted || null
    },
    ticketId: Number(ticketId),
    contactId: (ticket as any)?.contact?.id || null,
    userId: Number(req.user?.id) || null
  });

  return res.status(201).json({ ok: true, row });
};


export const listAgentFeedback = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const limit = Math.min(Number(req.query.limit || 100), 300);
  const verdict = req.query.verdict ? String(req.query.verdict) : null;
  const exported = req.query.exported !== undefined ? String(req.query.exported) === "true" : null;

  const where: any = {};
  if (verdict) where.verdict = verdict;
  if (exported !== null) where.exportedToExample = exported;

  const rows = await AgentFeedback.findAll({
    where,
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name", "number"] },
      { model: User, as: "user", attributes: ["id", "name", "email"] },
      { model: Ticket, as: "ticket", attributes: ["id", "status", "updatedAt", "lastMessage"] }
    ],
    order: [["createdAt", "DESC"]],
    limit
  });

  return res.status(200).json({ rows });
};

export const getAgentFeedbackDetail = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { feedbackId } = req.params;

  const row = await AgentFeedback.findByPk(feedbackId, {
    include: [
      { model: Contact, as: "contact", attributes: ["id", "name", "number", "email"] },
      { model: User, as: "user", attributes: ["id", "name", "email"] },
      { model: Ticket, as: "ticket", attributes: ["id", "status", "updatedAt", "lastMessage", "queueId", "userId"] }
    ]
  });

  if (!row) {
    throw new AppError("ERR_AGENT_FEEDBACK_NOT_FOUND", 404);
  }

  const messages = row.ticketId
    ? await Message.findAll({
        where: { ticketId: row.ticketId },
        order: [["createdAt", "DESC"]],
        limit: 20
      })
    : [];

  return res.status(200).json({
    row,
    messages: messages.reverse()
  });
};

export const agentFeedbackStats = async (
  _req: Request,
  res: Response
): Promise<Response> => {
  const rows = await AgentFeedback.findAll({
    attributes: ["id", "verdict", "intent", "action", "confidence", "exportedToExample", "exportedToTestCase", "createdAt"],
    order: [["createdAt", "DESC"]],
    limit: 1000
  });

  const stats = {
    total: rows.length,
    approved: 0,
    rejected: 0,
    edited: 0,
    handoff: 0,
    exportedToExample: 0,
    exportedToTestCase: 0,
    avgConfidence: 0,
    failureByIntent: {} as Record<string, number>,
    approvedByIntent: {} as Record<string, number>
  };

  let confidenceCount = 0;
  let confidenceSum = 0;

  for (const row of rows as any[]) {
    const verdict = String(row.verdict || "").toLowerCase();
    if (verdict === "approved") stats.approved += 1;
    if (verdict === "rejected") stats.rejected += 1;
    if (verdict === "edited") stats.edited += 1;
    if (verdict === "handoff") stats.handoff += 1;
    if (row.exportedToExample) stats.exportedToExample += 1;
    if (row.exportedToTestCase) stats.exportedToTestCase += 1;

    const conf = row.confidence;
    if (typeof conf === "number" && !Number.isNaN(conf)) {
      confidenceSum += conf;
      confidenceCount += 1;
    }

    const intent = row.intent || "unknown";
    if (verdict === "approved") {
      stats.approvedByIntent[intent] = (stats.approvedByIntent[intent] || 0) + 1;
    } else if (verdict === "rejected" || verdict === "edited" || verdict === "handoff") {
      stats.failureByIntent[intent] = (stats.failureByIntent[intent] || 0) + 1;
    }
  }

  stats.avgConfidence = confidenceCount ? Number((confidenceSum / confidenceCount).toFixed(3)) : 0;

  return res.status(200).json({ stats });
};

export const exportAgentFeedbackToExample = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { feedbackId } = req.params;
  const row = await AgentFeedback.findByPk(feedbackId);

  if (!row) {
    throw new AppError("ERR_AGENT_FEEDBACK_NOT_FOUND", 404);
  }

  if (row.exportedToExample) {
    return res.status(200).json({ ok: true, alreadyExported: true, row });
  }

  const BOT_URL = String(process.env.BOT_URL || "").replace(/\/$/, "");
  const BOT_ADMIN_TOKEN = String(process.env.BOT_ADMIN_TOKEN || "");
  if (!BOT_URL || !BOT_ADMIN_TOKEN) {
    throw new AppError("ERR_BOT_NOT_CONFIGURED", 503);
  }

  const body = {
    intent: row.intent || "agent_feedback",
    user_text: row.note || row.meta?.userText || row.meta?.lastUserText || row.suggestedReply || "feedback sin user_text",
    ideal_answer: row.finalReply || row.suggestedReply || "",
    notes: `feedback:${row.id} verdict:${row.verdict} source:${row.source || "ticket_agent_panel"}`
  };

  const r = await fetch(`${BOT_URL}/admin/intelligence/examples`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": BOT_ADMIN_TOKEN
    } as any,
    body: JSON.stringify(body)
  });

  const raw = await r.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!r.ok) {
    return res.status(r.status).json(data);
  }

  await row.update({
    exportedToExample: true,
    exportedAt: new Date()
  });

  return res.status(200).json({ ok: true, row, example: data });
};


export const exportAgentFeedbackToTestCase = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { feedbackId } = req.params;
  const row = await AgentFeedback.findByPk(feedbackId);

  if (!row) {
    throw new AppError("ERR_AGENT_FEEDBACK_NOT_FOUND", 404);
  }

  if ((row as any).exportedToTestCase) {
    return res.status(200).json({ ok: true, alreadyExported: true, row });
  }

  const BOT_URL = String(process.env.BOT_URL || "").replace(/\/$/, "");
  const BOT_ADMIN_TOKEN = String(process.env.BOT_ADMIN_TOKEN || "");
  if (!BOT_URL || !BOT_ADMIN_TOKEN) {
    throw new AppError("ERR_BOT_NOT_CONFIGURED", 503);
  }

  const userText = row.note || row.meta?.userText || row.meta?.lastUserText || row.suggestedReply || `feedback_${row.id}`;
  const expectedContains = [row.finalReply || row.suggestedReply].filter(Boolean).map((x: any) => String(x).slice(0, 140));
  const body = {
    name: `agent_feedback_${row.id}_${row.intent || "generic"}`,
    user_text: userText,
    expected_intent: row.intent || null,
    expected_source_type: null,
    expected_source_id: null,
    expected_contains: expectedContains,
    enabled: true
  };

  const r = await fetch(`${BOT_URL}/admin/tests/cases`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": BOT_ADMIN_TOKEN
    } as any,
    body: JSON.stringify(body)
  });

  const raw = await r.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!r.ok) {
    return res.status(r.status).json(data);
  }

  await row.update({
    exportedToTestCase: true,
    exportedToTestCaseAt: new Date()
  } as any);

  return res.status(200).json({ ok: true, row, testCase: data });
};
