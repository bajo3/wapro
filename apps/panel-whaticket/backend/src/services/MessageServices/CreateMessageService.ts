import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { botIngestEpisode } from "../BotServices/botApi";

interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  ack?: number;
  mediaType?: string;
  mediaUrl?: string;
}
interface Request {
  messageData: MessageData;
}

const CreateMessageService = async ({
  messageData
}: Request): Promise<Message> => {
  await Message.upsert(messageData);

  const message = await Message.findByPk(messageData.id, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          "contact",
          "queue",
          {
            model: Whatsapp,
            as: "whatsapp",
            attributes: ["name"]
          }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  const io = getIO();
  io.to(message.ticketId.toString())
    .to(message.ticket.status)
    .to("notification")
    .emit("appMessage", {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });



  // Best-effort: push human replies into Bot Training (episodes) so you can tune later
  try {
    if (message.fromMe) {
      const lastInbound = await Message.findOne({
        where: { ticketId: message.ticketId, fromMe: false },
        order: [["createdAt", "DESC"]]
      });

      if (lastInbound?.body && message.body) {
        await botIngestEpisode({
          channel: "WHATSAPP",
          contact_id: (message.ticket as any)?.contactId ?? null,
          user_text: lastInbound.body,
          reply_text: message.body,
          meta: {
            source: "panel-human",
            ticketId: message.ticketId,
            whatsappId: message.ticket.whatsappId,
            companyId: message.ticket.companyId
          }
        });
      }
    }
  } catch {
    // ignore
  }

  return message;
};

export default CreateMessageService;
