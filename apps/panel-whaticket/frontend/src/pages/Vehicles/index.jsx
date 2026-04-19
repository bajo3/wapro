import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from "@material-ui/core";
import AddIcon from "@material-ui/icons/Add";
import CheckCircleOutlineIcon from "@material-ui/icons/CheckCircleOutline";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import EditOutlinedIcon from "@material-ui/icons/EditOutlined";
import FileCopyOutlinedIcon from "@material-ui/icons/FileCopyOutlined";
import OpenInNewIcon from "@material-ui/icons/OpenInNew";
import PauseCircleOutlineIcon from "@material-ui/icons/PauseCircleOutline";
import WarningOutlinedIcon from "@material-ui/icons/WarningOutlined";
import { toast } from "react-toastify";

import {
  createVehicle,
  deleteVehicle,
  dryRunVehicleMl,
  getVehicleMlCategoryRequirements,
  getVehicleMlHealth,
  listVehicles,
  pauseVehicleMl,
  predictVehicleMlCategory,
  publishVehicleMl,
  reactivateVehicleMl,
  syncVehicleMl,
  updateVehicle,
  updateVehicleStatus,
  validateVehicleMl
} from "../../services/vehicles";

const emptyForm = {
  brand: "",
  model: "",
  version: "",
  year: "",
  km: "",
  condition: "used",
  price: "",
  currency: "ARS",
  internalStatus: "draft",
  color: "",
  fuel: "",
  transmission: "",
  doors: "",
  engine: "",
  traction: "",
  bodyType: "",
  vehicleType: "",
  title: "",
  description: "",
  locationCity: "",
  locationState: "",
  domain: "",
  patent: "",
  plate: "",
  vin: "",
  picturesInput: "",
  publishToMeli: false,
  meliCategoryId: "",
  meliDomainId: "",
  meliListingTypeId: "",
  meliAttributesInput: "[]"
};

const statusOptions = [
  ["available", "Disponible"],
  ["reserved", "Reservado"],
  ["sold", "Vendido"],
  ["paused", "Pausado"],
  ["draft", "Borrador"]
];

const mlFieldHints = {
  TRIM: { label: "Versión", example: "2.0 TSI" },
  VEHICLE_TYPE: { label: "Tipo de vehículo", example: "Sedán" },
  FUEL_TYPE: { label: "Combustible", example: "Nafta" },
  DOORS: { label: "Puertas", example: "4" },
  BRAND: { label: "Marca", example: "Volkswagen" },
  MODEL: { label: "Modelo", example: "Vento" },
  VEHICLE_YEAR: { label: "Año", example: "2015" },
  KILOMETERS: { label: "KM", example: "120000" }
};

const getMlFieldHint = (fieldId) => mlFieldHints[fieldId] || null;

const parseAttributesInput = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getAttributesError = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? "" : "Attributes JSON debe ser un array.";
  } catch {
    return "Attributes JSON inválido.";
  }
};

const buildPictures = (input) =>
  String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url, index) => ({ url, source: "manual", order: index, alt: "", isCover: index === 0 }));

const formatExpiresAt = (value) => {
  if (value === null || value === undefined || value === "") return "-";

  const normalized =
    typeof value === "number"
      ? value
      : /^\d+$/.test(String(value).trim())
        ? Number(String(value).trim())
        : Date.parse(String(value));

  if (!Number.isFinite(normalized)) return "-";

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("es-AR");
};

const vehicleToForm = (vehicle) => ({
  brand: vehicle.brand || "",
  model: vehicle.model || "",
  version: vehicle.version || "",
  year: vehicle.year ?? "",
  km: vehicle.km ?? "",
  condition: vehicle.condition || "used",
  price: vehicle.price ?? "",
  currency: vehicle.currency || "ARS",
  internalStatus: vehicle.internalStatus || "draft",
  color: vehicle.color || "",
  fuel: vehicle.fuel || "",
  transmission: vehicle.transmission || "",
  doors: vehicle.doors ?? "",
  engine: vehicle.engine || "",
  traction: vehicle.traction || "",
  bodyType: vehicle.bodyType || "",
  vehicleType: vehicle.vehicleType || "",
  title: vehicle.title || "",
  description: vehicle.description || "",
  locationCity: vehicle.locationCity || "",
  locationState: vehicle.locationState || "",
  domain: vehicle.domain || "",
  patent: vehicle.patent || "",
  plate: vehicle.plate || "",
  vin: vehicle.vin || "",
  picturesInput: Array.isArray(vehicle.pictures) ? vehicle.pictures.map((picture) => picture.url).filter(Boolean).join("\n") : "",
  publishToMeli: Boolean(vehicle.publishToMeli),
  meliCategoryId: vehicle.meliCategoryId || "",
  meliDomainId: vehicle.meliDomainId || "",
  meliListingTypeId: vehicle.meliListingTypeId || "",
  meliAttributesInput: JSON.stringify(vehicle.meliAttributes || [], null, 2)
});

const formToPayload = (form) => ({
  brand: form.brand,
  model: form.model,
  version: form.version || null,
  year: form.year === "" ? null : Number(form.year),
  km: form.km === "" ? null : Number(form.km),
  condition: form.condition,
  price: form.price === "" ? null : Number(form.price),
  currency: form.currency,
  internalStatus: form.internalStatus,
  color: form.color || null,
  fuel: form.fuel || null,
  transmission: form.transmission || null,
  doors: form.doors === "" ? null : Number(form.doors),
  engine: form.engine || null,
  traction: form.traction || null,
  bodyType: form.bodyType || null,
  vehicleType: form.vehicleType || null,
  title: form.title || null,
  description: form.description || null,
  locationCity: form.locationCity || null,
  locationState: form.locationState || null,
  domain: form.domain || null,
  patent: form.patent || null,
  plate: form.plate || null,
  vin: form.vin || null,
  pictures: buildPictures(form.picturesInput),
  publishToMeli: Boolean(form.publishToMeli),
  meliCategoryId: form.meliCategoryId || null,
  meliDomainId: form.meliDomainId || null,
  meliListingTypeId: form.meliListingTypeId || null,
  meliAttributes: parseAttributesInput(form.meliAttributesInput)
});

const canPublishVehicle = (vehicle, mlHealth) =>
  Boolean(vehicle?.meliCategoryId) &&
  mlHealth?.publishEnabled !== false &&
  !(Array.isArray(vehicle?.meliValidationErrors) && vehicle.meliValidationErrors.length > 0);

function VehiclesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [filters, setFilters] = useState({ q: "", internalStatus: "", meliStatus: "", currency: "" });
  const [mlHealth, setMlHealth] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [validationState, setValidationState] = useState(null);
  const [validatingId, setValidatingId] = useState(null);
  const [categorySuggestions, setCategorySuggestions] = useState([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryRequirements, setCategoryRequirements] = useState(null);
  const attributesError = getAttributesError(form.meliAttributesInput);

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVehicles({
        q: filters.q || undefined,
        internalStatus: filters.internalStatus || undefined,
        meliStatus: filters.meliStatus || undefined,
        currency: filters.currency || undefined,
        limit: 200
      });
      setVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []);
    } catch (error) {
      toast.error(error?.response?.data?.error || "No se pudieron cargar los vehículos");
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadMlHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const data = await getVehicleMlHealth();
      setMlHealth(data);
    } catch (error) {
      setMlHealth(null);
      toast.error(error?.response?.data?.error || "No se pudo cargar el diagnÃ³stico de MercadoLibre");
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    loadMlHealth();
  }, [loadMlHealth]);

  const summary = useMemo(() => ({
    total: vehicles.length,
    available: vehicles.filter((vehicle) => vehicle.internalStatus === "available").length,
    published: vehicles.filter((vehicle) => Boolean(vehicle.meliItemId)).length,
    errors: vehicles.filter((vehicle) => Array.isArray(vehicle.meliValidationErrors) && vehicle.meliValidationErrors.length > 0).length
  }), [vehicles]);

  const openNewDialog = () => {
    setEditingVehicle(null);
    setForm(emptyForm);
    setValidationState(null);
    setCategorySuggestions([]);
    setCategoryRequirements(null);
    setDialogOpen(true);
  };

  const openEditDialog = (vehicle, duplicate = false) => {
    setEditingVehicle(duplicate ? null : vehicle);
    setForm(vehicleToForm(vehicle));
    setValidationState(null);
    setCategorySuggestions([]);
    setCategoryRequirements(null);
    setDialogOpen(true);
  };

  const saveVehicle = async () => {
    if (attributesError) {
      toast.error(attributesError);
      return;
    }
    setSaving(true);
    try {
      const payload = formToPayload(form);
      if (editingVehicle?.id) {
        await updateVehicle(editingVehicle.id, payload);
        toast.success("Vehículo actualizado");
      } else {
        await createVehicle(payload);
        toast.success("Vehículo creado");
      }
      setDialogOpen(false);
      loadVehicles();
    } catch (error) {
      const missing = error?.response?.data?.missingFields;
      toast.error(Array.isArray(missing) && missing.length ? `Faltan: ${missing.join(", ")}` : error?.response?.data?.error || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const onPause = async (vehicle) => {
    try {
      await updateVehicleStatus(vehicle.id, "paused");
      toast.success("Vehículo pausado");
      loadVehicles();
    } catch (error) {
      toast.error(error?.response?.data?.error || "No se pudo pausar");
    }
  };

  const onDelete = async (vehicle) => {
    try {
      const data = await deleteVehicle(vehicle.id);
      toast[data?.action === "paused_instead_of_delete" ? "info" : "success"](data?.message || "Vehículo eliminado");
      loadVehicles();
    } catch (error) {
      toast.error(error?.response?.data?.message || error?.response?.data?.error || "No se pudo eliminar");
    }
  };

  const onValidate = async (vehicle) => {
    setValidatingId(vehicle.id);
    try {
      const data = await validateVehicleMl(vehicle.id);
      setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      toast[data.ok ? "success" : "warn"](data.ok ? "Payload listo para ML" : "Hay datos faltantes para ML");
      loadVehicles();
    } catch (error) {
      const data = error?.response?.data;
      if (data?.payloadPreview || data?.missingFields || data?.warnings) {
        setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      }
      toast.error(data?.error || "No se pudo validar");
    } finally {
      setValidatingId(null);
    }
  };

  const runMlAction = async (vehicle, action, successMessage) => {
    setValidatingId(vehicle.id);
    try {
      const data = await action(vehicle.id);
      setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      toast[data.ok ? "success" : "warn"](data.ok ? successMessage : data.error || "Hay datos faltantes para ML");
      loadVehicles();
      loadMlHealth();
    } catch (error) {
      const data = error?.response?.data;
      if (data?.payloadPreview || data?.missingFields || data?.warnings) {
        setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      }
      const missing = Array.isArray(data?.missingFields) && data.missingFields.length ? `Faltan: ${data.missingFields.join(", ")}` : null;
      toast.error(missing || data?.error || "No se pudo ejecutar la acción ML");
    } finally {
      setValidatingId(null);
    }
  };

  const onDryRun = async (vehicle) => {
    setValidatingId(vehicle.id);
    try {
      const data = await dryRunVehicleMl(vehicle.id);
      setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      toast[data.ok ? "success" : "warn"](data.ok ? "Dry-run listo para revisar" : "Dry-run con faltantes");
      loadVehicles();
    } catch (error) {
      const data = error?.response?.data;
      if (data?.payloadPreview || data?.missingFields || data?.warnings) {
        setValidationState({ ...data, vehicleTitle: vehicle.title || vehicle.label || `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() });
      }
      toast.error(data?.error || "No se pudo ejecutar el dry-run");
    } finally {
      setValidatingId(null);
    }
  };

  const onPredictCategory = async (vehicle, apply = false) => {
    if (!vehicle?.id) {
      toast.info("Guardá el vehículo antes de consultar categorías de MercadoLibre.");
      return;
    }

    setValidatingId(vehicle.id);
    try {
      const data = await predictVehicleMlCategory(vehicle.id, apply ? { apply: true } : {});
      setCategorySuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      setCategoryDialogOpen(true);

      if (apply && data?.suggestions?.[0]) {
        const selected = data.suggestions[0];
        setForm((current) => ({
          ...current,
          meliCategoryId: selected.category_id || current.meliCategoryId,
          meliDomainId: selected.domain_id || current.meliDomainId
        }));
        setEditingVehicle((current) =>
          current
            ? {
                ...current,
                meliCategoryId: selected.category_id || current.meliCategoryId,
                meliDomainId: selected.domain_id || current.meliDomainId
              }
            : current
        );
        toast.success("Categoría ML aplicada al vehículo");
        loadVehicles();
      } else if (!data?.suggestions?.length) {
        toast.warn("MercadoLibre no devolvió categorías sugeridas para este título.");
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || "No se pudo sugerir categoría ML");
    } finally {
      setValidatingId(null);
    }
  };

  const onLoadCategoryRequirements = async (vehicle) => {
    if (!vehicle?.id) {
      toast.info("Guardá el vehículo antes de consultar requisitos de categoría.");
      return;
    }

    setValidatingId(vehicle.id);
    try {
      const data = await getVehicleMlCategoryRequirements(vehicle.id);
      setCategoryRequirements(data);
      toast.success("Requisitos de categoría actualizados");
    } catch (error) {
      setCategoryRequirements(null);
      toast.error(error?.response?.data?.error || "No se pudieron consultar los requisitos de categoría");
    } finally {
      setValidatingId(null);
    }
  };

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gridGap={16}>
        <Box>
          <Typography variant="h5" style={{ fontWeight: 700 }}>Vehículos</Typography>
          <Typography variant="body2" color="textSecondary">
            Inventario propio de WaPro para preparar publicación futura en MercadoLibre.
          </Typography>
        </Box>
        <Button color="primary" variant="contained" startIcon={<AddIcon />} onClick={openNewDialog}>
          Nuevo vehículo
        </Button>
      </Box>

      <Grid container spacing={2} style={{ marginBottom: 16 }}>
        {[
          ["Total", summary.total],
          ["Disponibles", summary.available],
          ["Publicados ML", summary.published],
          ["Con errores ML", summary.errors]
        ].map(([label, value]) => (
          <Grid item xs={12} sm={6} md={3} key={label}>
            <Card>
              <CardContent>
                <Typography color="textSecondary" variant="body2">{label}</Typography>
                <Typography variant="h4" style={{ fontWeight: 700 }}>{value}</Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper style={{ padding: 16, marginBottom: 16, border: mlHealth?.publishEnabled ? "1px solid #bbf7d0" : "1px solid #fecaca" }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gridGap={12}>
          <Box>
            <Typography variant="subtitle1" style={{ fontWeight: 600 }}>ML Health</Typography>
            <Typography variant="body2" color="textSecondary">
              DiagnÃ³stico seguro del token y del permiso de publicaciÃ³n real.
            </Typography>
          </Box>
          <Button size="small" variant="outlined" onClick={loadMlHealth} disabled={loadingHealth}>
            {loadingHealth ? "Actualizando..." : "Actualizar ML Health"}
          </Button>
        </Box>
        <Box display="flex" flexWrap="wrap" gridGap={8} mt={2}>
          <Chip size="small" label={`Publish ${mlHealth?.publishEnabled ? "habilitado" : "deshabilitado"}`} style={{ background: mlHealth?.publishEnabled ? "#dcfce7" : "#fee2e2", color: mlHealth?.publishEnabled ? "#166534" : "#b91c1c" }} />
          <Chip size="small" label={`Token row ${mlHealth?.hasTokenRow ? "OK" : "faltante"}`} />
          <Chip size="small" label={`Access token ${mlHealth?.hasAccessToken ? "presente" : "ausente"}`} />
          <Chip size="small" label={`Refresh token ${mlHealth?.hasRefreshToken ? "presente" : "ausente"}`} />
          <Chip size="small" label={`Refresh ${mlHealth?.canAttemptRefresh ? "posible" : "no disponible"}`} />
          <Chip size="small" label={`Expirado ${mlHealth?.isExpired ? "sÃ­" : "no"}`} />
        </Box>
        <Box mt={1}>
          <Typography variant="body2">
            Expira: {formatExpiresAt(mlHealth?.expiresAt)}
          </Typography>
          {!mlHealth?.publishEnabled ? (
            <Typography variant="body2" color="error">
              MercadoLibre publishing is disabled. Set MELI_PUBLISH_ENABLED=true to allow real publishing.
            </Typography>
          ) : null}
          {mlHealth?.error ? <Typography variant="body2" color="error">{mlHealth.error}</Typography> : null}
        </Box>
      </Paper>

      <Paper style={{ padding: 16, marginBottom: 16 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <TextField label="Buscar texto" variant="outlined" size="small" fullWidth value={filters.q} onChange={(e) => setFilters((c) => ({ ...c, q: e.target.value }))} />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl variant="outlined" size="small" fullWidth>
              <InputLabel>Estado interno</InputLabel>
              <Select label="Estado interno" value={filters.internalStatus} onChange={(e) => setFilters((c) => ({ ...c, internalStatus: e.target.value }))}>
                <MenuItem value="">Todos</MenuItem>
                {statusOptions.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField label="Estado MercadoLibre" variant="outlined" size="small" fullWidth value={filters.meliStatus} onChange={(e) => setFilters((c) => ({ ...c, meliStatus: e.target.value }))} />
          </Grid>
          <Grid item xs={12} md={2}>
            <FormControl variant="outlined" size="small" fullWidth>
              <InputLabel>Moneda</InputLabel>
              <Select label="Moneda" value={filters.currency} onChange={(e) => setFilters((c) => ({ ...c, currency: e.target.value }))}>
                <MenuItem value="">Todas</MenuItem>
                <MenuItem value="ARS">ARS</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      <Paper>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" p={4}><CircularProgress size={28} /></Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Foto cover</TableCell>
                  <TableCell>Título</TableCell>
                  <TableCell>Marca / Modelo / Año</TableCell>
                  <TableCell>KM</TableCell>
                  <TableCell>Precio</TableCell>
                  <TableCell>Estado interno</TableCell>
                  <TableCell>Estado ML</TableCell>
                  <TableCell>Última sync ML</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow key={vehicle.id} hover>
                    <TableCell>
                      {vehicle.imageUrl ? (
                        <img src={vehicle.imageUrl} alt={vehicle.title || vehicle.label || "Vehículo"} style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 8 }} />
                      ) : (
                        <Box display="flex" alignItems="center" justifyContent="center" style={{ width: 64, height: 48, background: "#f3f4f6", color: "#6b7280", borderRadius: 8 }}>-</Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" style={{ fontWeight: 600 }}>{vehicle.title || vehicle.label || "Sin título"}</Typography>
                      {vehicle.meliLastError ? <Typography variant="caption" color="error">Último error: {vehicle.meliLastError}</Typography> : null}
                    </TableCell>
                    <TableCell>{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" / ") || "-"}</TableCell>
                    <TableCell>{vehicle.km ?? "-"}</TableCell>
                    <TableCell>{vehicle.price ? `${vehicle.currency || ""} ${Number(vehicle.price).toLocaleString("es-AR")}` : "-"}</TableCell>
                    <TableCell><Chip size="small" label={statusOptions.find(([value]) => value === vehicle.internalStatus)?.[1] || vehicle.internalStatus || "-"} /></TableCell>
                    <TableCell>
                      <Box display="flex" flexDirection="column">
                        <Chip size="small" label={vehicle.meliStatus || "-"} />
                        {vehicle.meliItemId ? <Typography variant="caption" color="textSecondary">{vehicle.meliItemId}</Typography> : null}
                      </Box>
                    </TableCell>
                    <TableCell>{vehicle.meliLastSyncAt ? new Date(vehicle.meliLastSyncAt).toLocaleString("es-AR") : "-"}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Ver / editar"><IconButton size="small" onClick={() => openEditDialog(vehicle)}><EditOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Validar MercadoLibre"><IconButton size="small" onClick={() => onValidate(vehicle)}>{validatingId === vehicle.id ? <CircularProgress size={16} /> : <CheckCircleOutlineIcon fontSize="small" />}</IconButton></Tooltip>
                      <Tooltip title="Dry-run ML"><span><IconButton size="small" onClick={() => onDryRun(vehicle)} disabled={validatingId === vehicle.id}><WarningOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Publicar en ML"><span><IconButton size="small" onClick={() => runMlAction(vehicle, publishVehicleMl, "Publicación creada en MercadoLibre")} disabled={validatingId === vehicle.id || !canPublishVehicle(vehicle, mlHealth)}><AddIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Actualizar ML"><span><IconButton size="small" onClick={() => runMlAction(vehicle, syncVehicleMl, vehicle.meliItemId ? "Publicación sincronizada" : "Publicación creada en MercadoLibre")} disabled={validatingId === vehicle.id || !canPublishVehicle(vehicle, mlHealth)}><OpenInNewIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Pausar ML"><span><IconButton size="small" onClick={() => runMlAction(vehicle, pauseVehicleMl, "Publicación pausada en MercadoLibre")} disabled={validatingId === vehicle.id || mlHealth?.publishEnabled === false || !vehicle.meliItemId}><PauseCircleOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Reactivar ML"><span><IconButton size="small" onClick={() => runMlAction(vehicle, reactivateVehicleMl, "Publicación reactivada en MercadoLibre")} disabled={validatingId === vehicle.id || mlHealth?.publishEnabled === false || !vehicle.meliItemId}><CheckCircleOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Ver publicación"><span><IconButton size="small" component="a" href={vehicle.permalink || vehicle.meliPermalink || undefined} target="_blank" rel="noreferrer" disabled={!(vehicle.permalink || vehicle.meliPermalink)}><OpenInNewIcon fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Duplicar vehículo"><IconButton size="small" onClick={() => openEditDialog(vehicle, true)}><FileCopyOutlinedIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Pausar local"><IconButton size="small" onClick={() => onPause(vehicle)}><PauseCircleOutlineIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Eliminar"><IconButton size="small" onClick={() => onDelete(vehicle)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!vehicles.length ? (
                  <TableRow><TableCell colSpan={9}><Box p={3} textAlign="center" color="text.secondary">No hay vehículos cargados todavía.</Box></TableCell></TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Collapse in={Boolean(validationState)} style={{ marginTop: 16 }}>
        <Paper style={{ padding: 16 }}>
          <Box display="flex" alignItems="center" gridGap={8} mb={1}>
            {validationState?.ok ? <CheckCircleOutlineIcon style={{ color: "#16a34a" }} /> : <WarningOutlinedIcon style={{ color: "#dc2626" }} />}
            <Typography variant="h6">Validación ML · {validationState?.vehicleTitle || "-"}</Typography>
          </Box>
          <Typography variant="subtitle2" color="error">Faltantes</Typography>
          <Box mt={1} mb={2}>
            {validationState?.missingFields?.length ? validationState.missingFields.map((field) => {
              const hint = getMlFieldHint(field);
              return (
                <Paper key={field} variant="outlined" style={{ padding: 12, marginBottom: 8, borderColor: "#fecaca", background: "#fff7f7" }}>
                  <Typography variant="body2" style={{ fontWeight: 600, color: "#b91c1c" }}>
                    {field}{hint ? ` — ${hint.label}` : ""}
                  </Typography>
                  {hint ? (
                    <Typography variant="caption" display="block" color="textSecondary">
                      Campo WaPro sugerido: {hint.label} · Ej: {hint.example}
                    </Typography>
                  ) : null}
                </Paper>
              );
            }) : <Typography variant="body2">Sin faltantes.</Typography>}
          </Box>
          <Typography variant="subtitle2" style={{ color: "#ca8a04" }}>Warnings</Typography>
          <Box mt={1} mb={2}>
            {validationState?.warnings?.length ? validationState.warnings.map((field) => (
              <Chip key={field} label={field} size="small" style={{ marginRight: 8, marginBottom: 8, background: "#fef3c7", color: "#a16207" }} />
            )) : <Typography variant="body2">Sin warnings.</Typography>}
          </Box>
          <Typography variant="subtitle2">Payload preview</Typography>
          <Paper variant="outlined" style={{ marginTop: 8, padding: 12, background: "#111827", color: "#e5e7eb", overflow: "auto" }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(validationState?.payloadPreview || {}, null, 2)}</pre>
          </Paper>
        </Paper>
      </Collapse>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editingVehicle ? "Editar vehículo" : "Nuevo vehículo"}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}><Typography variant="subtitle1">1. Datos principales</Typography></Grid>
            {[
              ["brand", "Marca"], ["model", "Modelo"], ["version", "Versión / TRIM"], ["year", "Año"], ["km", "KM"], ["price", "Precio"]
            ].map(([key, label]) => (
              <Grid item xs={12} md={key === "price" ? 2 : 4} key={key}>
                <TextField label={label} variant="outlined" size="small" fullWidth type={["year", "km", "price"].includes(key) ? "number" : "text"} value={form[key]} onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value }))} />
              </Grid>
            ))}
            <Grid item xs={12} md={2}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel>Condición</InputLabel>
                <Select label="Condición" value={form.condition} onChange={(e) => setForm((c) => ({ ...c, condition: e.target.value }))}>
                  <MenuItem value="new">Nuevo</MenuItem>
                  <MenuItem value="used">Usado</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={2}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel>Moneda</InputLabel>
                <Select label="Moneda" value={form.currency} onChange={(e) => setForm((c) => ({ ...c, currency: e.target.value }))}>
                  <MenuItem value="ARS">ARS</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} md={3}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel>Estado interno</InputLabel>
                <Select label="Estado interno" value={form.internalStatus} onChange={(e) => setForm((c) => ({ ...c, internalStatus: e.target.value }))}>
                  {statusOptions.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}><Typography variant="subtitle1">2. Características</Typography></Grid>
            {[
              ["color", "Color"], ["fuel", "Combustible"], ["transmission", "Transmisión"], ["doors", "Puertas"],
              ["engine", "Motor"], ["traction", "Tracción"], ["bodyType", "Carrocería"], ["vehicleType", "Tipo de vehículo"]
            ].map(([key, label]) => (
              <Grid item xs={12} md={3} key={key}>
                <TextField label={label} variant="outlined" size="small" fullWidth value={form[key]} onChange={(e) => setForm((c) => ({ ...c, [key]: e.target.value }))} />
              </Grid>
            ))}

            <Grid item xs={12}><Typography variant="subtitle1">3. Descripción</Typography></Grid>
            <Grid item xs={12} md={6}><TextField label="Título" variant="outlined" size="small" fullWidth value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} /></Grid>
            <Grid item xs={12} md={3}><TextField label="Ubicación ciudad" variant="outlined" size="small" fullWidth value={form.locationCity} onChange={(e) => setForm((c) => ({ ...c, locationCity: e.target.value }))} /></Grid>
            <Grid item xs={12} md={3}><TextField label="Ubicación provincia" variant="outlined" size="small" fullWidth value={form.locationState} onChange={(e) => setForm((c) => ({ ...c, locationState: e.target.value }))} /></Grid>
            <Grid item xs={12}><TextField label="Descripción larga" variant="outlined" multiline rows={4} fullWidth value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} /></Grid>

            <Grid item xs={12}><Typography variant="subtitle1">4. Imágenes</Typography></Grid>
            <Grid item xs={12}><TextField label="URLs de imágenes (una por línea)" variant="outlined" multiline rows={4} fullWidth value={form.picturesInput} onChange={(e) => setForm((c) => ({ ...c, picturesInput: e.target.value }))} /></Grid>

            <Grid item xs={12}><Typography variant="subtitle1">5. MercadoLibre</Typography></Grid>
            <Grid item xs={12}><FormControlLabel control={<Checkbox checked={form.publishToMeli} onChange={(e) => setForm((c) => ({ ...c, publishToMeli: e.target.checked }))} color="primary" />} label="Publicar en ML" /></Grid>
            <Grid item xs={12} md={4}><TextField label="category_id" variant="outlined" size="small" fullWidth value={form.meliCategoryId} onChange={(e) => setForm((c) => ({ ...c, meliCategoryId: e.target.value }))} /></Grid>
            <Grid item xs={12} md={4}><TextField label="domain_id" variant="outlined" size="small" fullWidth value={form.meliDomainId} onChange={(e) => setForm((c) => ({ ...c, meliDomainId: e.target.value }))} /></Grid>
            <Grid item xs={12} md={4}><TextField label="listing_type_id" variant="outlined" size="small" fullWidth value={form.meliListingTypeId} onChange={(e) => setForm((c) => ({ ...c, meliListingTypeId: e.target.value }))} /></Grid>
            <Grid item xs={12}>
              <Box display="flex" flexWrap="wrap" gridGap={8}>
                <Button variant="outlined" size="small" onClick={() => onPredictCategory(editingVehicle, false)} disabled={!editingVehicle?.id || validatingId === editingVehicle?.id}>
                  Sugerir categoría ML
                </Button>
                <Button variant="outlined" size="small" onClick={() => onPredictCategory(editingVehicle, true)} disabled={!editingVehicle?.id || validatingId === editingVehicle?.id}>
                  Aplicar categoría
                </Button>
                <Button variant="outlined" size="small" onClick={() => onLoadCategoryRequirements(editingVehicle)} disabled={!editingVehicle?.id || !form.meliCategoryId || validatingId === editingVehicle?.id}>
                  Ver requisitos categoría
                </Button>
              </Box>
              {!editingVehicle?.id ? (
                <Typography variant="caption" color="textSecondary">
                  Guardá el vehículo para consultar categorías y requisitos de MercadoLibre.
                </Typography>
              ) : null}
            </Grid>
            <Grid item xs={12}>
              <Box display="flex" flexWrap="wrap" gridGap={8}>
                <Chip size="small" label={`category_id: ${form.meliCategoryId || "-"}`} />
                <Chip size="small" label={`domain_id: ${form.meliDomainId || "-"}`} />
                {!form.meliCategoryId ? <Chip size="small" label="Falta category_id para validar/publicar" style={{ background: "#fee2e2", color: "#b91c1c" }} /> : null}
              </Box>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Attributes JSON"
                variant="outlined"
                multiline
                rows={5}
                fullWidth
                value={form.meliAttributesInput}
                error={Boolean(attributesError)}
                helperText={attributesError || "Debe ser un array JSON. Ejemplo: []"}
                onChange={(e) => setForm((c) => ({ ...c, meliAttributesInput: e.target.value }))}
              />
            </Grid>
            {categoryRequirements ? (
              <Grid item xs={12}>
                <Paper variant="outlined" style={{ padding: 12 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Requisitos ML de {categoryRequirements.categoryName || categoryRequirements.categoryId}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    Listing permitido: {categoryRequirements.listingAllowed === null ? "sin dato" : categoryRequirements.listingAllowed ? "sí" : "no"}
                  </Typography>
                  <Box mt={1}>
                    <Typography variant="caption" color="error">Obligatorios</Typography>
                    <Box mt={1}>
                      {categoryRequirements.requiredAttributes?.length ? categoryRequirements.requiredAttributes.map((attribute) => (
                        <Paper key={attribute.id} variant="outlined" style={{ padding: 10, marginRight: 8, marginBottom: 8, borderColor: attribute.missing ? "#fecaca" : "#bbf7d0", background: attribute.missing ? "#fff7f7" : "#f0fdf4" }}>
                          <Typography variant="body2" style={{ fontWeight: 600, color: attribute.missing ? "#b91c1c" : "#166534" }}>
                            {attribute.id} — {attribute.name}{attribute.missing ? " (faltante)" : ""}
                          </Typography>
                          {getMlFieldHint(attribute.id) ? (
                            <Typography variant="caption" display="block" color="textSecondary">
                              Campo WaPro: {getMlFieldHint(attribute.id).label} · Ej: {getMlFieldHint(attribute.id).example}
                            </Typography>
                          ) : null}
                        </Paper>
                      )) : <Typography variant="body2">Sin atributos obligatorios informados.</Typography>}
                    </Box>
                  </Box>
                  <Box mt={1}>
                    <Typography variant="caption" style={{ color: "#a16207" }}>Recomendados</Typography>
                    <Box mt={1}>
                      {categoryRequirements.recommendedAttributes?.length ? categoryRequirements.recommendedAttributes.map((attribute) => (
                        <Paper key={attribute.id} variant="outlined" style={{ padding: 10, marginRight: 8, marginBottom: 8, borderColor: attribute.missing ? "#fde68a" : "#e5e7eb", background: attribute.missing ? "#fffbeb" : "#f9fafb" }}>
                          <Typography variant="body2" style={{ fontWeight: 600, color: attribute.missing ? "#a16207" : "#374151" }}>
                            {attribute.id} — {attribute.name}{attribute.missing ? " (faltante)" : ""}
                          </Typography>
                          {getMlFieldHint(attribute.id) ? (
                            <Typography variant="caption" display="block" color="textSecondary">
                              Campo WaPro: {getMlFieldHint(attribute.id).label} · Ej: {getMlFieldHint(attribute.id).example}
                            </Typography>
                          ) : null}
                        </Paper>
                      )) : <Typography variant="body2">Sin atributos recomendados informados.</Typography>}
                    </Box>
                  </Box>
                </Paper>
              </Grid>
            ) : null}
            {editingVehicle ? (
              <Grid item xs={12}>
                <Typography variant="body2">Estado ML: {editingVehicle.meliStatus || "-"} · meliItemId: {editingVehicle.meliItemId || "-"} · permalink: {editingVehicle.permalink || "-"} · último error: {editingVehicle.meliLastError || "-"}</Typography>
              </Grid>
            ) : null}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
          <Button color="primary" variant="contained" onClick={saveVehicle} disabled={saving}>{saving ? "Guardando..." : editingVehicle ? "Guardar cambios" : "Crear vehículo"}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={categoryDialogOpen} onClose={() => setCategoryDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Sugerencias de categorÃ­a MercadoLibre</DialogTitle>
        <DialogContent dividers>
          {categorySuggestions.length ? categorySuggestions.map((suggestion, index) => (
            <Paper key={`${suggestion.category_id || "category"}-${index}`} variant="outlined" style={{ padding: 12, marginBottom: 12 }}>
              <Typography variant="subtitle2">{suggestion.category_name || suggestion.category_id || "Sin categorÃ­a"}</Typography>
              <Typography variant="body2" color="textSecondary">
                category_id: {suggestion.category_id || "-"} Â· domain_id: {suggestion.domain_id || "-"}
              </Typography>
              {suggestion.path ? <Typography variant="body2" color="textSecondary">Path: {suggestion.path}</Typography> : null}
              {suggestion.probability !== null || suggestion.confidence !== null ? (
                <Typography variant="body2" color="textSecondary">
                  Probabilidad: {suggestion.probability ?? "-"} Â· Confianza: {suggestion.confidence ?? "-"}
                </Typography>
              ) : null}
            </Paper>
          )) : (
            <Typography variant="body2">No hay sugerencias para mostrar.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoryDialogOpen(false)}>Cerrar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default VehiclesPage;
