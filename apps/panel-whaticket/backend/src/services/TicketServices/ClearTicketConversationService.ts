import sequelize from "../../database";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import TrainingMessage from "../../models/TrainingMessage";

const ClearTicketConversationService = async (ticketId: string) => {
  return sequelize.transaction(async transaction => {
    const ticket = await Ticket.findByPk(ticketId, { transaction });

    if (!ticket) {
      throw new AppError("ERR_NO_TICKET_FOUND", 404);
    }

    const rows = await Message.findAll({
      where: { ticketId: Number(ticketId) },
      attributes: ["id"],
      transaction,
      raw: true
    });

    const messageIds = rows.map((row: any) => row.id).filter(Boolean);

    if (messageIds.length > 0) {
      await Message.update(
        { quotedMsgId: null },
        {
          where: { quotedMsgId: messageIds as any },
          transaction
        }
      );

      await TrainingMessage.update(
        { messageId: null },
        {
          where: { messageId: messageIds as any },
          transaction
        }
      );
    }

    const deletedCount = await Message.destroy({
      where: { ticketId: Number(ticketId) },
      transaction
    });

    await ticket.update(
      {
        lastMessage: "",
        unreadMessages: 0
      },
      { transaction }
    );

    return { ticket, deletedCount };
  });
};

export default ClearTicketConversationService;
