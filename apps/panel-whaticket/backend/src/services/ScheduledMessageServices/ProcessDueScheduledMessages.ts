import { Op } from "sequelize";
import ScheduledMessage from "../../models/ScheduledMessage";
import ShowTicketService from "../TicketServices/ShowTicketService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { logger } from "../../utils/logger";

let running = false;

/**
 * Processes due scheduled messages.
 * Best-effort and idempotent: only messages in PENDING state are sent.
 */
const ProcessDueScheduledMessages = async () => {
  if (running) return;
  running = true;

  try {
    const now = new Date();
    const due = await ScheduledMessage.findAll({
      where: {
        status: "PENDING",
        sendAt: { [Op.lte]: now }
      },
      limit: 50,
      order: [["sendAt", "ASC"]]
    });

    for (const job of due) {
      try {
        const ticket = await ShowTicketService(String(job.ticketId));

        // send text only for now; media can be added in next iteration
        await SendWhatsAppMessage({ body: job.body, ticket });

        await job.update({ status: "SENT", lastError: null });
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        logger.error({ err: msg, scheduledMessageId: job.id }, "Scheduled message failed");
        await job.update({ status: "FAILED", lastError: msg });
      }
    }
  } finally {
    running = false;
  }
};

export default ProcessDueScheduledMessages;
