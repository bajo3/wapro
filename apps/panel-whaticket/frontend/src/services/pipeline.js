import api from "./api";

export async function getPipelineBoard(params = {}) {
  const { data } = await api.get("/pipeline/board", { params });
  return data;
}

export async function listPipelineStages() {
  const { data } = await api.get("/pipeline/stages");
  return data;
}

export async function createPipelineStage(payload) {
  const { data } = await api.post("/pipeline/stages", payload);
  return data;
}

export async function updatePipelineStage(id, payload) {
  const { data } = await api.put(`/pipeline/stages/${id}`, payload);
  return data;
}

export async function deletePipelineStage(id) {
  const { data } = await api.delete(`/pipeline/stages/${id}`);
  return data;
}

export async function updateTicketStage(ticketId, toStageId) {
  const { data } = await api.patch(`/pipeline/tickets/${ticketId}/stage`, { toStageId });
  return data;
}

export async function updateTicketValue(ticketId, payload) {
  const { data } = await api.patch(`/pipeline/tickets/${ticketId}/value`, payload);
  return data;
}
