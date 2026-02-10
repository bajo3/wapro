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
  Chip
} from "@material-ui/core";

import api from "../../services/api";

export default function TrainingMessages() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState("whatsapp");
  const [approved, setApproved] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (channel) params.channel = channel;
      if (approved) params.approved = approved;
      const { data } = await api.get("/training-messages", { params });
      setRows(data?.rows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleApproved = async (row) => {
    const { data } = await api.put(`/training-messages/${row.id}`, { approved: !row.approved });
    setRows(rows.map((r) => (r.id === row.id ? data.row : r)));
  };

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
              placeholder="true / false"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <Button variant="contained" onClick={load} disabled={loading}>
              {loading ? "Cargando..." : "Refrescar"}
            </Button>
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
                  <TableCell>{r.approved ? "✅" : "—"}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => toggleApproved(r)}>
                      Toggle
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
