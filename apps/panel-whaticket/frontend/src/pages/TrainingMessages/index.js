import React, { useEffect, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Grid,
  TextField,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  MenuItem
} from "@material-ui/core";

import api from "../../services/api";

export default function TrainingMessages() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState("whatsapp");
  const [approved, setApproved] = useState("all");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const limit = 25;

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (channel) params.channel = channel;
      if (approved !== "all") params.approved = approved;
      params.page = page;
      params.limit = limit;
      const { data } = await api.get("/training-messages", { params });
      setRows(data?.rows || []);
      setCount(Number(data?.count || 0));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const patchRow = async (rowId, patch) => {
    const { data } = await api.put(`/training-messages/${rowId}`, patch);
    setRows((prev) => prev.map((r) => (r.id === rowId ? data.row : r)));
  };

  const totalPages = Math.max(1, Math.ceil((count || 0) / limit));

  return (
    <Box p={3}>
      <Paper style={{ padding: 20 }}>
        <Typography variant="h5" gutterBottom>
          Training Messages
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Todo lo que entra y sale (WhatsApp/Instagram) queda registrado para entrenar y ajustar la inteligencia.
        </Typography>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              variant="outlined"
              size="small"
              fullWidth
              label="Channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="whatsapp / instagram"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              variant="outlined"
              size="small"
              fullWidth
              label="Approved"
              value={approved}
              onChange={(e) => setApproved(e.target.value)}
              select
            >
              <MenuItem value="all">Todos</MenuItem>
              <MenuItem value="false">Pendientes</MenuItem>
              <MenuItem value="true">Aprobados</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={3}>
            <Button
              variant="contained"
              onClick={() => {
                setPage(1);
                load();
              }}
              disabled={loading}
            >
              {loading ? "Cargando..." : "Refrescar"}
            </Button>
          </Grid>
          <Grid item xs={12} md={3}>
            <Box display="flex" justifyContent="flex-end" gridGap={8}>
              <Button
                size="small"
                variant="outlined"
                disabled={loading || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ◀ Prev
              </Button>
              <Button
                size="small"
                variant="outlined"
                disabled={loading || page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next ▶
              </Button>
              <Typography
                variant="caption"
                color="textSecondary"
                style={{ alignSelf: "center" }}
              >
                {page}/{totalPages}
              </Typography>
            </Box>
          </Grid>
        </Grid>

        <Box mt={2}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Channel</TableCell>
                <TableCell>Dir</TableCell>
                <TableCell>Body</TableCell>
                <TableCell>Intent</TableCell>
                <TableCell>Sugerencia</TableCell>
                <TableCell>Approved</TableCell>
                <TableCell>Acciones</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell><Chip size="small" label={r.channel} /></TableCell>
                  <TableCell>{r.direction}</TableCell>
                  <TableCell style={{ maxWidth: 520, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.body}
                  </TableCell>
                  <TableCell style={{ minWidth: 160 }}>
                    <TextField
                      size="small"
                      variant="outlined"
                      value={r.intent || ""}
                      placeholder="ej: demand_intake"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, intent: v } : x)));
                      }}
                      onBlur={() => patchRow(r.id, { intent: r.intent || "" })}
                    />
                  </TableCell>
                  <TableCell style={{ minWidth: 220 }}>
                    <TextField
                      size="small"
                      variant="outlined"
                      value={r.suggestion || ""}
                      placeholder="nota corta"
                      onChange={(e) => {
                        const v = e.target.value;
                        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, suggestion: v } : x)));
                      }}
                      onBlur={() => patchRow(r.id, { suggestion: r.suggestion || "" })}
                    />
                  </TableCell>
                  <TableCell>{r.approved ? "✅" : "—"}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      variant={r.approved ? "outlined" : "contained"}
                      color={r.approved ? "default" : "primary"}
                      onClick={() => patchRow(r.id, { approved: !r.approved })}
                    >
                      {r.approved ? "Desaprobar" : "Aprobar"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Box>
  );
}
