import { Request, Response } from "express";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Message from "../models/Message";
import Whatsapp from "../models/Whatsapp";
import TrainingMessage from "../models/TrainingMessage";
import { getIO } from "../libs/socket";
import { Op } from "sequelize";

async function getOrCreateInstagramWhatsapp(): Promise<Whatsapp> {
  const existing = await Whatsapp.findOne({ where: { name: "instagram" } });
  if (existing) return existing;
  return await Whatsapp.create({
    name: "instagram",
    session: "instagram",
    status: "CONNECTED",
    isDefault: false
  } as any);
}

export const metaWebhook = async (req: Request, res: Response) => {
  const expected = process.env.META_WEBHOOK_SECRET || "";
  const got = String(req.headers["x-meta-secret"] ?? "");
  if (expected && got !== expected) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  // ACK immediately
  res.status(200).json({ ok: true });

  const payload = req.body ?? {};
  const type = String(payload.type ?? "");
  const events = Array.isArray(payload.events) ? payload.events : [];

  const whatsapp = await getOrCreateInstagramWhatsapp();
  const io = getIO();

  for (const ev of events) {
    try {
      const platform = String(ev.platform || type || "IG").toUpperCase();
      const senderId = String(ev.senderId ?? ev.fromId ?? "");
      const text = String(ev.text ?? ev.message ?? "");
      if (!senderId || !text) continue;

      // Use a synthetic identifier in Contact.number to distinguish channel
      const number = `ig:${senderId}`;

      const [contact] = await Contact.findOrCreate({
        where: { number },
        defaults: {
          name: `Instagram ${senderId}`,
          number,
          profilePicUrl: "",
          leadSource: platform
        } as any
      });

      // Ensure leadSource stays updated if the contact already existed.
      if (contact.leadSource !== platform) {
        await contact.update({ leadSource: platform });
      }

      // One open ticket per contact per channel
      let ticket = await Ticket.findOne({
        where: { contactId: contact.id, whatsappId: whatsapp.id, status: { [Op.in]: ["pending", "open"] } },
        order: [["updatedAt", "DESC"]]
      });

      if (!ticket) {
        ticket = await Ticket.create({
          contactId: contact.id,
          whatsappId: whatsapp.id,
          status: "pending",
          unreadMessages: 1,
          lastMessage: text,
          isGroup: false
        } as any);
      } else {
        await ticket.update({
          lastMessage: text,
          unreadMessages: (ticket.unreadMessages ?? 0) + 1
        });
      }

      const msgId = String(ev.messageId ?? `ig-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      await Message.upsert({
        id: msgId,
        ticketId: ticket.id,
        body: text,
        fromMe: false,
        read: false,
        ack: 0
      } as any);

      await TrainingMessage.create({
        channel: "instagram",
        direction: "IN",
        body: text,
        externalMessageId: String(ev.messageId ?? ""),
        contactId: contact.id,
        ticketId: ticket.id,
        messageId: msgId,
        meta: { raw: ev }
      } as any);

      // Emit to frontend like regular inbound message
      io.to(ticket.id.toString())
        .to(ticket.status)
        .to("notification")
        .emit("appMessage", {
          action: "create",
          message: { id: msgId, ticketId: ticket.id, body: text, fromMe: false },
          ticket,
          contact
        });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("metaWebhook handler error", err);
    }
  }
};
