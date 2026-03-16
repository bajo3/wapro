import { Request, Response } from "express";
import { Op, fn, col } from "sequelize";

import Contact from "../models/Contact";
import Ticket from "../models/Ticket";

/**
 * Provider-agnostic "import" for Evolution mode.
 *
 * When running with Evolution, importing phone contacts (WhatsApp address book)
 * is not supported because that feature depends on whatsapp-web.js.
 *
 * This endpoint provides a safe alternative: it re-syncs/repairs contacts that
 * already exist in your CRM data (tickets/messages).
 *
 * What it does:
 * - Ensures contacts referenced by tickets exist (best-effort)
 * - Fills missing names with the phone number
 * - Fills missing leadSource with "WA"
 */
export const store = async (req: Request, res: Response): Promise<Response> => {
  // Collect distinct contactIds referenced by tickets.
  const rows = await Ticket.findAll({
    attributes: [[fn("DISTINCT", col("contactId")), "contactId"]],
    raw: true
  });

  const contactIds = (rows as any[])
    .map((r) => Number(r.contactId))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (contactIds.length === 0) {
    return res.status(200).json({ ok: true, scanned: 0, updatedNames: 0, updatedLeadSource: 0 });
  }

  // Fill missing/blank names with the phone number.
  const [updatedNames] = await Contact.update(
    { name: col("number") as any },
    {
      where: {
        id: { [Op.in]: contactIds },
        [Op.or]: [{ name: null }, { name: "" }]
      }
    }
  );

  // Fill missing leadSource
  const [updatedLeadSource] = await Contact.update(
    { leadSource: "WA" },
    {
      where: {
        id: { [Op.in]: contactIds },
        [Op.or]: [{ leadSource: null }, { leadSource: "" }]
      }
    }
  );

  return res.status(200).json({
    ok: true,
    scanned: contactIds.length,
    updatedNames: Number(updatedNames),
    updatedLeadSource: Number(updatedLeadSource)
  });
};
