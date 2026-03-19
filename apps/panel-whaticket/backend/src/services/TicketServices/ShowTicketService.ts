import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import sequelize from "../../database";
import { QueryTypes } from "sequelize";

const ShowTicketService = async (id: string | number): Promise<Ticket> => {
  const ticket = await Ticket.findByPk(id, {
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "name", "number", "profilePicUrl", "leadSource"],
        include: ["extraInfo"]
      },
      {
        model: User,
        as: "user",
        attributes: ["id", "name"]
      },
      {
        model: Queue,
        as: "queue",
        attributes: ["id", "name", "color"]
      },
      {
        model: Whatsapp,
        as: "whatsapp",
        attributes: ["name"]
      }
    ]
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  try {
    const instance = String((ticket as any)?.whatsapp?.name || "");
    const number = String((ticket as any)?.contact?.number || "");
    const remoteJid = instance && number ? `${number}@s.whatsapp.net` : "";

    if (instance && remoteJid) {
      const rows = await sequelize.query(
        `select state
           from bot_conversations
          where instance = $1 and remote_jid = $2
          limit 1`,
        { bind: [instance, remoteJid], type: QueryTypes.SELECT }
      );

      const state = (rows as any[])?.[0]?.state || null;
      if (state) {
        const leadScore = Number(state?.leadScore ?? 0) || 0;
        (ticket as any).setDataValue("leadScore", leadScore);
        (ticket as any).setDataValue("agentData", {
          intent: state?.agent?.intent || state?.last_intent || null,
          confidence: state?.agent?.confidence ?? null,
          action: state?.agent?.action ?? null,
          urgency: state?.agent?.urgency ?? null,
          handoffRecommended: Boolean(state?.agent?.handoffRecommended),
          suggestedReply: state?.agent?.suggestedReply || null,
          missingFields: Array.isArray(state?.agent?.missingFields) ? state.agent.missingFields : [],
          internalReason: state?.agent?.internalReason || null,
          updatedAt: state?.agent?.updatedAt || state?.updated_at || null,
          extracted: state?.extracted || null
        });
      }
    }
  } catch {
    // best effort
  }

  return ticket;
};

export default ShowTicketService;
