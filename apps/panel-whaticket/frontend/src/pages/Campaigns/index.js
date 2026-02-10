import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Grid,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip
} from "@material-ui/core";

import api from "../../services/api";

export default function Campaigns() {
  const [queues, setQueues] = useState([]);
  const [queueId, setQueueId] = useState("");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/queues").then(({ data }) => setQueues(data || [])).catch(() => setQueues([]));
  }, []);

  const canSend = useMemo(() => {
    return message.trim().length > 0;
  }, [message]);

  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    if (tags.includes(t)) return;
    setTags([...tags, t]);
    setTag("");
  };

  const removeTag = (t) => {
    setTags(tags.filter((x) => x !== t));
  };

  const handleSend = async (dryRun) => {
    if (!canSend) return;
    setSending(true);
    setResult(null);
    try {
      const payload = {
        message,
        tags,
        queueIds: queueId ? [Number(queueId)] : [],
        dryRun: !!dryRun
      };
      const { data } = await api.post("/campaigns/instagram", payload);
      setResult(data);
    } catch (err) {
      setResult({ ok: false, error: err?.response?.data?.error || err?.message || "Error" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Box p={3}>
      <Paper style={{ padding: 20 }}>
        <Typography variant="h5" gutterBottom>
          Campañas (Instagram)
        </Typography>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          Envía un mensaje 1:1 a contactos de Instagram filtrando por cola y/o tags del ticket.
        </Typography>

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>Cola</InputLabel>
              <Select value={queueId} onChange={(e) => setQueueId(e.target.value)} label="Cola">
                <MenuItem value="">Todas</MenuItem>
                {queues.map((q) => (
                  <MenuItem key={q.id} value={q.id}>{q.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={8}>
            <Grid container spacing={1}>
              <Grid item xs={9}>
                <TextField
                  variant="outlined"
                  size="small"
                  fullWidth
                  label="Tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
              </Grid>
              <Grid item xs={3}>
                <Button fullWidth variant="contained" onClick={addTag} disabled={!tag.trim()}>
                  Agregar
                </Button>
              </Grid>
              <Grid item xs={12}>
                {tags.map((t) => (
                  <Chip key={t} label={t} onDelete={() => removeTag(t)} style={{ marginRight: 6, marginBottom: 6 }} />
                ))}
              </Grid>
            </Grid>
          </Grid>

          <Grid item xs={12}>
            <TextField
              variant="outlined"
              fullWidth
              label="Mensaje"
              multiline
              minRows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Grid>

          <Grid item xs={12}>
            <Grid container spacing={1}>
              <Grid item>
                <Button
                  variant="outlined"
                  onClick={() => handleSend(true)}
                  disabled={sending || !canSend}
                >
                  Preview (dry-run)
                </Button>
              </Grid>
              <Grid item>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => handleSend(false)}
                  disabled={sending || !canSend}
                >
                  Enviar campaña
                </Button>
              </Grid>
            </Grid>
          </Grid>
        </Grid>

        {result && (
          <Box mt={2}>
            <Typography variant="subtitle2">Resultado</Typography>
            <pre style={{ background: "#111", color: "#fff", padding: 12, borderRadius: 8, overflow: "auto" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
