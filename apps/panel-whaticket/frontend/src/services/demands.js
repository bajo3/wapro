import api from "./api";

export async function listDemands({ status = "open", limit = 100 } = {}) {
  const { data } = await api.get("/bot/demands", { params: { status, limit } });
  return data;
}

export async function createDemand(payload) {
  const { data } = await api.post("/bot/demands", payload);
  return data;
}

export async function updateDemand(id, payload) {
  const { data } = await api.put(`/bot/demands/${id}`, payload);
  return data;
}

export async function closeDemand(id) {
  const { data } = await api.post(`/bot/demands/${id}/close`);
  return data;
}

export async function listDemandMatches(id, { limit = 20 } = {}) {
  const { data } = await api.get(`/bot/demands/${id}/matches`, { params: { limit } });
  return data;
}

export async function listDemandRecontacts(id, { limit = 50 } = {}) {
  const { data } = await api.get(`/bot/demands/${id}/recontacts`, { params: { limit } });
  return data;
}

export async function runDemandScan(payload = {}) {
  const { data } = await api.post("/bot/demands/scan", payload);
  return data;
}

export async function runRecontact(payload = {}) {
  const { data } = await api.post("/bot/demands/recontact/run", payload);
  return data;
}
