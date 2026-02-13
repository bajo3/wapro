import { Op } from "sequelize";
import Ticket from "../../models/Ticket";

interface Request {
  userId: string;
  queueIds: number[];
  whatsappIds?: number[];
  showAll?: string;
}

/**
 * Returns ticket counters by status, using the same visibility rules as ListTicketsService:
 * - default: user can see their own tickets + the global pending queue
 * - showAll=true: ignores assignment (used by admins)
 *
 * Notes:
 * - We keep this endpoint intentionally small and fast.
 * - Filters supported: queueIds, whatsappIds.
 */
const CountTicketsService = async ({
  userId,
  queueIds,
  whatsappIds,
  showAll
}: Request) => {
  const buildQueueWhere = (ids: number[] | undefined) => {
    if (!ids || ids.length === 0) return undefined;
    return { [Op.or]: [{ [Op.in]: ids }, null] };
  };

  const queueWhere = buildQueueWhere(queueIds);
  const whatsappWhere = whatsappIds && whatsappIds.length > 0 ? { [Op.in]: whatsappIds } : undefined;

  const baseWhere: any =
    showAll === "true"
      ? {
          ...(queueWhere ? { queueId: queueWhere } : {}),
          ...(whatsappWhere ? { whatsappId: whatsappWhere } : {})
        }
      : {
          [Op.or]: [{ userId }, { status: "pending" }],
          ...(queueWhere ? { queueId: queueWhere } : {}),
          ...(whatsappWhere ? { whatsappId: whatsappWhere } : {})
        };

  const [pending, open, closed] = await Promise.all([
    Ticket.count({ where: { ...baseWhere, status: "pending" } }),
    Ticket.count({ where: { ...baseWhere, status: "open" } }),
    Ticket.count({ where: { ...baseWhere, status: "closed" } })
  ]);

  return {
    pending,
    open,
    closed,
    total: pending + open + closed
  };
};

export default CountTicketsService;
