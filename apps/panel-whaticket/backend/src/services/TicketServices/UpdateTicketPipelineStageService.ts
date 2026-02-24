import Ticket from "../../models/Ticket";
import PipelineStage from "../../models/PipelineStage";
import TicketStageHistory from "../../models/TicketStageHistory";
import AppError from "../../errors/AppError";

type Req = {
  ticketId: string | number;
  toStageId: number;
  userId?: number;
};

export default async function UpdateTicketPipelineStageService({
  ticketId,
  toStageId,
  userId
}: Req) {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new AppError("Ticket not found", 404);

  const toStage = await PipelineStage.findByPk(toStageId);
  if (!toStage) throw new AppError("Stage not found", 404);

  const fromStageId = ticket.pipelineStageId || null;

  // Policy: WON/LOST => close ticket; OPEN => reopen
  let nextStatus = ticket.status;
  if (toStage.category === "WON" || toStage.category === "LOST") nextStatus = "closed";
  if (toStage.category === "OPEN" && ticket.status === "closed") nextStatus = "open";

  await ticket.update({
    pipelineStageId: toStage.id,
    stageChangedAt: new Date(),
    status: nextStatus
  });

  await TicketStageHistory.create({
    ticketId: ticket.id,
    fromStageId,
    toStageId: toStage.id,
    changedByUserId: userId || null
  } as any);

  return ticket;
}
