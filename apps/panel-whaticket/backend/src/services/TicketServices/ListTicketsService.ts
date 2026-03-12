import { Op, fn, where, col, Filterable, Includeable, QueryTypes } from "sequelize";
import { startOfDay, endOfDay, parseISO } from "date-fns";

import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Queue from "../../models/Queue";
import ShowUserService from "../UserServices/ShowUserService";
import Whatsapp from "../../models/Whatsapp";
import sequelize from "../../database";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  status?: string;
  date?: string;
  showAll?: string;
  userId: string;
  withUnreadMessages?: string;
  queueIds: number[];
  whatsappIds?: number[];
}

interface Response {
  tickets: Ticket[];
  count: number;
  hasMore: boolean;
}

const ListTicketsService = async ({
  searchParam = "",
  pageNumber = "1",
  queueIds,
  whatsappIds,
  status,
  date,
  showAll,
  userId,
  withUnreadMessages
}: Request): Promise<Response> => {
  // When the frontend sends queueIds=[] (e.g. "all queues"), the previous
  // condition `queueId: { [Op.or]: [queueIds, null] }` could produce invalid SQL
  // (or Sequelize errors) depending on dialect/version.
  //
  // We only apply the queue filter when the list is non-empty.
  const buildQueueWhere = (ids: number[] | undefined) => {
    if (!ids || ids.length === 0) return undefined;
    return { [Op.or]: [{ [Op.in]: ids }, null] };
  };

  const queueWhere = buildQueueWhere(queueIds);
  const whatsappWhere = whatsappIds && whatsappIds.length > 0 ? { [Op.in]: whatsappIds } : undefined;

  let whereCondition: Filterable["where"] = {
    [Op.or]: [{ userId }, { status: "pending" }],
    ...(queueWhere ? { queueId: queueWhere } : {})
  };
  let includeCondition: Includeable[];

  includeCondition = [
    {
      model: Contact,
      as: "contact",
      attributes: ["id", "name", "number", "profilePicUrl", "leadSource"]
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
  ];

  if (showAll === "true") {
    whereCondition = {
      ...(queueWhere ? { queueId: queueWhere } : {}),
      ...(whatsappWhere ? { whatsappId: whatsappWhere } : {})
    };
  }

  if (status) {
    whereCondition = {
      ...whereCondition,
      status
    };
  }

  if (whatsappWhere && showAll !== "true") {
    whereCondition = {
      ...whereCondition,
      whatsappId: whatsappWhere
    };
  }

  if (searchParam) {
    const sanitizedSearchParam = searchParam.toLocaleLowerCase().trim();

    includeCondition = [
      ...includeCondition,
      {
        model: Message,
        as: "messages",
        attributes: ["id", "body"],
        where: {
          body: where(
            fn("LOWER", col("body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        required: false,
        duplicating: false
      }
    ];

    whereCondition = {
      ...whereCondition,
      [Op.or]: [
        {
          "$contact.name$": where(
            fn("LOWER", col("contact.name")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        },
        { "$contact.number$": { [Op.like]: `%${sanitizedSearchParam}%` } },
        // Match by message body (joined as alias: "messages")
        {
          "$messages.body$": where(
            fn("LOWER", col("messages.body")),
            "LIKE",
            `%${sanitizedSearchParam}%`
          )
        }
      ]
    };
  }

  if (date) {
    // Guard against invalid dates (would crash with 500).
    try {
      const parsed = parseISO(date);
      const start = startOfDay(parsed);
      const end = endOfDay(parsed);
      if (!Number.isNaN(+start) && !Number.isNaN(+end)) {
        whereCondition = {
          ...whereCondition,
          createdAt: {
            [Op.between]: [+start, +end]
          }
        };
      }
    } catch {
      // ignore invalid date filter
    }
  }

  if (withUnreadMessages === "true") {
    const user = await ShowUserService(userId);
    const userQueueIds = user.queues.map(queue => queue.id);

    const userQueueWhere = buildQueueWhere(userQueueIds);

    whereCondition = {
      [Op.or]: [{ userId }, { status: "pending" }],
      ...(userQueueWhere ? { queueId: userQueueWhere } : {}),
      unreadMessages: { [Op.gt]: 0 }
    };
  }

  const limit = 40;
  const offset = limit * (+pageNumber - 1);

  const { count, rows: tickets } = await Ticket.findAndCountAll({
    where: whereCondition,
    include: includeCondition,
    distinct: true,
    limit,
    offset,
    order: [["updatedAt", "DESC"]]
  });

  const hasMore = count > offset + tickets.length;

  // Enrich tickets with bot leadScore (best-effort).
  // We read from bot_conversations.state JSONB which is written by apps/bot.
  try {
    const keys = tickets
      .map(t => {
        const instance = (t as any)?.whatsapp?.name;
        const number = (t as any)?.contact?.number;
        const remoteJid = instance && number ? `${number}@s.whatsapp.net` : null;
        return instance && remoteJid ? { instance, remoteJid } : null;
      })
      .filter(Boolean) as Array<{ instance: string; remoteJid: string }>;

    if (keys.length > 0) {
      const valuesSql = keys.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(",");
      const params = keys.reduce<string[]>((acc, k: { instance: string; remoteJid: string }) => {
        acc.push(k.instance, k.remoteJid);
        return acc;
      }, []);

      const sql = `
        select bc.instance, bc.remote_jid,
               nullif(bc.state->>'leadScore','')::int as lead_score
        from bot_conversations bc
        join (values ${valuesSql}) as v(instance, remote_jid)
          on v.instance = bc.instance and v.remote_jid = bc.remote_jid
      `;

      const rows = await sequelize.query(sql, { bind: params, type: QueryTypes.SELECT });
      const map = new Map<string, number>();
      for (const r of rows as any[]) {
        map.set(`${r.instance}::${r.remote_jid}`, Number(r.lead_score) || 0);
      }

      for (const t of tickets as any[]) {
        const instance = t?.whatsapp?.name;
        const number = t?.contact?.number;
        const remoteJid = instance && number ? `${number}@s.whatsapp.net` : null;
        if (!instance || !remoteJid) continue;
        const score = map.get(`${instance}::${remoteJid}`);
        if (score !== undefined) t.setDataValue("leadScore", score);
      }
    }
  } catch {
    // ignore
  }

  return {
    tickets,
    count,
    hasMore
  };
};

export default ListTicketsService;
