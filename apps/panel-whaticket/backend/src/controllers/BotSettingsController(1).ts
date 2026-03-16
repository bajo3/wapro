import { Request, Response } from "express";
import Setting from "../models/Setting";

const KEY = "BOT_ENABLED";

export const show = async (req: Request, res: Response): Promise<Response> => {
  const setting = await Setting.findOne({ where: { key: KEY } });
  const enabled = setting ? setting.value === "true" : true; // default ON
  return res.json({ enabled });
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const enabled = Boolean(req.body?.enabled);

  const [setting] = await Setting.findOrCreate({
    where: { key: KEY },
    defaults: { key: KEY, value: String(enabled) }
  });

  if (setting.value !== String(enabled)) {
    await setting.update({ value: String(enabled) });
  }

  return res.json({ enabled });
};
