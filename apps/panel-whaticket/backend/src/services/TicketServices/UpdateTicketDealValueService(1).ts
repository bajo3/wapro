import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";

type Req = {
  ticketId: string | number;
  dealValue?: number | null;
  dealCurrency?: string;
};

export default async function UpdateTicketDealValueService({
  ticketId,
  dealValue,
  dealCurrency
}: Req) {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) throw new AppError("Ticket not found", 404);

  const currency = (dealCurrency || ticket.dealCurrency || "ARS").toUpperCase();
  if (currency !== "ARS" && currency !== "USD") {
    throw new AppError("Invalid currency", 400);
  }

  const value = dealValue === null || dealValue === undefined ? null : Number(dealValue);
  if (value !== null && !Number.isFinite(value)) {
    throw new AppError("Invalid dealValue", 400);
  }

  await ticket.update({
    dealValue: value,
    dealCurrency: currency
  });

  return ticket;
}
