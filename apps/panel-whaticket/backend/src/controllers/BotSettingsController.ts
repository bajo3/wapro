import { Request, Response } from "express";
import Setting from "../models/Setting";

const KEY = "BOT_ENABLED";

export const show = async (req: Request, res: Response): Promise<Response> => {
  const setting = await Setting.findOne({ where: { key: KEY } });
  const enabled = setting ? setting.value === "true" : true; // default ON
  return res.json({ enabled });
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  // Normalize: accept boolean true/false OR string "true"/"false".
  // Boolean("false") === true, so we must handle the string case explicitly.
  const raw = req.body?.enabled;
  const enabled = raw === "false" || raw === false ? false : Boolean(raw);

  const [setting] = await Setting.findOrCreate({
    where: { key: KEY },
    defaults: { key: KEY, value: String(enabled) }
  });

  if (setting.value !== String(enabled)) {
    await setting.update({ value: String(enabled) });
  }

  return res.json({ enabled });
};
