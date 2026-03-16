import api from "./api";

export async function listQuotations({ status = "all", q = "", limit = 100 } = {}) {
  const { data } = await api.get("/quotations", { params: { status, q, limit } });
  return data;
}

export async function createQuotation(payload) {
  const { data } = await api.post("/quotations", payload);
  return data;
}

export async function updateQuotation(id, payload) {
  const { data } = await api.put(`/quotations/${id}`, payload);
  return data;
}

export async function deleteQuotation(id) {
  const { data } = await api.delete(`/quotations/${id}`);
  return data;
}

export async function sendQuotation(id) {
  const { data } = await api.post(`/quotations/${id}/send`);
  return data;
}
