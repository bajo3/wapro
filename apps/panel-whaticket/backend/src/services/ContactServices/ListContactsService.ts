import { Sequelize, Op } from "sequelize";
import Contact from "../../models/Contact";

interface Request {
  searchParam?: string;
  pageNumber?: string;
  pageSize?: string;
}

interface Response {
  contacts: Contact[];
  count: number;
  hasMore: boolean;
  pageNumber: number;
  pageSize: number;
  totalPages: number;
}

const ListContactsService = async ({
  searchParam = "",
  pageNumber = "1",
  pageSize = "20"
}: Request): Promise<Response> => {
  const normalizedSearch = String(searchParam || "").toLowerCase().trim();
  const digitsSearch = normalizedSearch.replace(/\D/g, "");
  const parsedPageNumber = Number(pageNumber);
  const parsedPageSize = Number(pageSize);
  const currentPage =
    Number.isFinite(parsedPageNumber) && parsedPageNumber > 0
      ? Math.floor(parsedPageNumber)
      : 1;
  const limit =
    Number.isFinite(parsedPageSize) && parsedPageSize > 0
      ? Math.min(Math.floor(parsedPageSize), 100)
      : 20;

  const whereCondition = normalizedSearch
    ? {
        [Op.or]: [
          {
            name: Sequelize.where(
              Sequelize.fn("LOWER", Sequelize.col("name")),
              "LIKE",
              `%${normalizedSearch}%`
            )
          },
          { number: { [Op.like]: `%${normalizedSearch}%` } },
          ...(digitsSearch
            ? [
                Sequelize.where(
                  Sequelize.fn(
                    "regexp_replace",
                    Sequelize.col("number"),
                    "[^0-9]",
                    "",
                    "g"
                  ),
                  "LIKE",
                  `%${digitsSearch}%`
                )
              ]
            : [])
        ]
      }
    : {};

  const offset = limit * (currentPage - 1);

  const { count, rows: contacts } = await Contact.findAndCountAll({
    where: whereCondition,
    limit,
    offset,
    order: [["name", "ASC"]]
  });

  const hasMore = count > offset + contacts.length;

  return {
    contacts,
    count,
    hasMore,
    pageNumber: currentPage,
    pageSize: limit,
    totalPages: Math.max(Math.ceil(count / limit), 1)
  };
};

export default ListContactsService;
