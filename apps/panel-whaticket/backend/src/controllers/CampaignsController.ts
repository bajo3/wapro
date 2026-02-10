import { Request, Response } from "express";
import sequelize from "../database";
import axios from "axios";
import { QueryTypes } from "sequelize";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/**
 * Run a 1:1 campaign to Instagram recipients filtered by Ticket tags and/or Queue ids.
 * This uses gateway-meta /admin/campaign endpoint.
 */
export const sendInstagramCampaign = async (req: Request, res: Response) => {
  const { tags, queueIds, message, dryRun, delayMs } = req.body ?? {};
  if (!message) return res.status(400).json({ error: "message is required" });

  const tagList: string[] = Array.isArray(tags) ? tags.map(String).filter(Boolean) : [];
  const qList: number[] = Array.isArray(queueIds) ? queueIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];

  // Build dynamic WHERE
  const where: string[] = [];
  const repl: any = {};
  if (qList.length > 0) {
    where.push(`t."queueId" IN (:queueIds)`);
    repl.queueIds = qList;
  }
  if (tagList.length > 0) {
    where.push(`tt."tag" IN (:tags)`);
    repl.tags = tagList;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `
    SELECT DISTINCT c."id" as "contactId", c."number" as "number"
    FROM "Tickets" t
    JOIN "Contacts" c ON c."id" = t."contactId"
    LEFT JOIN "TicketTags" tt ON tt."ticketId" = t."id"
    ${whereSql}
  `;

  const rows = (await sequelize.query(sql, {
    type: QueryTypes.SELECT,
    replacements: repl
  })) as any[];

  const recipients = rows
    .map((r) => String(r.number ?? ""))
    .filter((n) => n.startsWith("ig:"))
    .map((n) => n.replace(/^ig:/, ""));

  if (dryRun) {
    return res.json({ ok: true, dryRun: true, recipientsCount: recipients.length, sample: recipients.slice(0, 10) });
  }

  const gatewayUrl = mustGetEnv("GATEWAY_META_URL");
  const adminToken = mustGetEnv("META_ADMIN_TOKEN");

  const resp = await axios.post(
    `${gatewayUrl.replace(/\/$/, "")}/admin/campaign`,
    { recipients, message: String(message), delayMs: Number(delayMs ?? 300) },
    { headers: { "x-admin-token": adminToken } }
  );

  return res.json({ ok: true, recipientsCount: recipients.length, gateway: resp.data });
};
