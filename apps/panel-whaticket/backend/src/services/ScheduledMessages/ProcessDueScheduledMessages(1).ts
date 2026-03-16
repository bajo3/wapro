import { Op } from "sequelize";
import ScheduledMessage from "../../models/ScheduledMessage";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Whatsapp from "../../models/Whatsapp";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";

export async function ProcessDueScheduledMessages() {
  const now = new Date();
  const due = await ScheduledMessage.findAll({
    where: { status: "PENDING", sendAt: { [Op.lte]: now } },
    limit: 25,
    order: [["sendAt", "ASC"]]
  });

  if (due.length === 0) return { processed: 0 };

  for (const sm of due) {
    try {
      if (!sm.ticketId) throw new Error("Missing ticketId");
      const ticket = await Ticket.findByPk(sm.ticketId, { include: ["contact", "whatsapp"] });
      if (!ticket) throw new Error("Ticket not found");

      // Ensure associations for SendWhatsAppMessage
      if (!ticket.contact) {
        const c = await Contact.findByPk(ticket.contactId);
        (ticket as any).contact = c;
      }
      if (!ticket.whatsapp) {
        const w = await Whatsapp.findByPk(ticket.whatsappId);
        (ticket as any).whatsapp = w;
      }

      await SendWhatsAppMessage({ body: sm.body, ticket } as any);
      await sm.update({ status: "SENT", lastError: null });
    } catch (err: any) {
      await sm.update({ status: "FAILED", lastError: String(err?.message ?? err) });
    }
  }

  return { processed: due.length };
}
