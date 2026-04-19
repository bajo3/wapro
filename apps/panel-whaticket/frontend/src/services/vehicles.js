import api from "./api";

export async function listVehicles(filters = {}) {
  const { data } = await api.get("/vehicles", { params: filters });
  return data;
}

export async function getVehicle(id) {
  const { data } = await api.get(`/vehicles/${id}`);
  return data;
}

export async function createVehicle(payload) {
  const { data } = await api.post("/vehicles", payload);
  return data;
}

export async function updateVehicle(id, payload) {
  const { data } = await api.put(`/vehicles/${id}`, payload);
  return data;
}

export async function updateVehicleStatus(id, status) {
  const { data } = await api.patch(`/vehicles/${id}/status`, { internalStatus: status });
  return data;
}

export async function deleteVehicle(id) {
  const { data } = await api.delete(`/vehicles/${id}`);
  return data;
}

export async function validateMeliPayload(id) {
  const { data } = await api.post(`/vehicles/${id}/validate-meli-payload`);
  return data;
}

export async function validateVehicleMl(id) {
  const { data } = await api.post(`/vehicles/${id}/ml/validate`);
  return data;
}

export async function dryRunVehicleMl(id) {
  const { data } = await api.post(`/vehicles/${id}/ml/dry-run`);
  return data;
}

export async function predictVehicleMlCategory(id, payload = {}) {
  const { data } = await api.post(`/vehicles/${id}/ml/predict-category`, payload);
  return data;
}

export async function getVehicleMlCategoryRequirements(id) {
  const { data } = await api.get(`/vehicles/${id}/ml/category-requirements`);
  return data;
}

export async function publishVehicleMl(id) {
  const { data } = await api.post(`/vehicles/${id}/ml/publish`);
  return data;
}

export async function syncVehicleMl(id) {
  const { data } = await api.put(`/vehicles/${id}/ml/sync`);
  return data;
}

export async function pauseVehicleMl(id) {
  const { data } = await api.post(`/vehicles/${id}/ml/pause`);
  return data;
}

export async function reactivateVehicleMl(id) {
  const { data } = await api.post(`/vehicles/${id}/ml/reactivate`);
  return data;
}

export async function getVehicleMlHealth() {
  const { data } = await api.get("/vehicles/ml/health");
  return data;
}
