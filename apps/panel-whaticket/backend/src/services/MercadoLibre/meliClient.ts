import fetch from "node-fetch";

import { getValidMeliAccessToken, readMeliTokenRow } from "./meliTokenService";

const MELI_API_URL = process.env.MELI_API_URL || "https://api.mercadolibre.com";

export const sanitizeMeliLogPayload = (value: any): any => {
  if (Array.isArray(value)) return value.map(sanitizeMeliLogPayload);
  if (!value || typeof value !== "object") return value;

  return Object.entries(value).reduce<Record<string, any>>((acc, [key, entryValue]) => {
    if (/access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization/i.test(key)) {
      acc[key] = "[REDACTED]";
      return acc;
    }

    acc[key] = sanitizeMeliLogPayload(entryValue);
    return acc;
  }, {});
};

export const meliApiRequest = async (
  path: string,
  options: any = {}
): Promise<{ ok: boolean; status: number; body: any }> => {
  let token = await getValidMeliAccessToken();
  let response = await fetch(`${MELI_API_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    const current = await readMeliTokenRow();
    if (!current?.access_token) {
      throw new Error("401 from MercadoLibre and no usable access_token is available.");
    }
    token = await getValidMeliAccessToken();
    response = await fetch(`${MELI_API_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  }

  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
};
