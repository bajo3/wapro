import { Request, Response } from "express";
import sequelize from "../database";

// Best-effort catalog endpoint.
// Reads from public.vehicles (same Postgres DB as the panel backend).
// If the table does not exist, returns an empty list.

type Query = {
  q?: string;
  limit?: string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { q = "", limit = "200" } = req.query as Query;
  const lim = Math.min(Math.max(parseInt(String(limit), 10) || 200, 1), 1000);
  const term = String(q || "").trim();

  // IMPORTANT:
  // We keep this query defensive because not every DB will have the catalog.
  // It must never crash the panel.

  const where = term
    ? `WHERE (title ILIKE :term OR brand ILIKE :term OR model ILIKE :term OR version ILIKE :term)`
    : "";

  const sql = `
    SELECT
      id,
      COALESCE(brand, marca, '') as brand,
      COALESCE(model, modelo, '') as model,
      COALESCE(version, trim, title, '') as title,
      COALESCE(price, precio, 0) as price,
      COALESCE(currency, moneda, 'USD') as currency,
      year
    FROM public.vehicles
    ${where}
    ORDER BY year DESC NULLS LAST, id DESC
    LIMIT :lim
  `;

  try {
    const [rows] = await sequelize.query(sql, {
      replacements: {
        term: `%${term}%`,
        lim
      }
    });

    const vehicles = (Array.isArray(rows) ? rows : []).map((v: any) => ({
      id: v.id,
      marca: v.brand,
      modelo: v.model,
      version: v.title,
      precio: Number(v.price) || 0,
      currency: String(v.currency || "USD").toUpperCase(),
      year: v.year ?? null
    }));

    return res.json({ vehicles });
  } catch {
    return res.json({ vehicles: [] });
  }
};
