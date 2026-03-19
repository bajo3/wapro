import React, { useContext, useEffect, useMemo, useState } from "react";
import { useHistory, useLocation } from "react-router-dom";

import {
  Box,
  Button,
  Divider,
  makeStyles,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
} from "@material-ui/core";

import MainContainer from "../../components/MainContainer";
import MainHeader from "../../components/MainHeader";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import Title from "../../components/Title";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { toast } from "react-toastify";
import { AuthContext } from "../../context/Auth/AuthContext";

// Import the global bot toggle component. This button allows admins
// to turn the bot on or off for all tickets directly from the Bot page.
import BotGeneralToggle from "./BotGeneralToggle";

// Training is now part of the Bot section (tab).
import TrainingMessages from "../TrainingMessages";

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(2),
    overflowY: "auto",
    ...theme.scrollbarStyles,
  },
  tabPanel: {
    paddingTop: theme.spacing(2),
  },
  rowActions: {
    display: "flex",
    gap: theme.spacing(1),
  },
  formRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: theme.spacing(2),
    alignItems: "start",
  },
  full: {
    gridColumn: "1 / -1",
  },
}));

function TabPanel({ value, index, children }) {
  if (value !== index) return null;
  return <Box>{children}</Box>;
}

function parseCsvTriggers(s) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

const Bot = () => {
  const classes = useStyles();
  const history = useHistory();
  const location = useLocation();
  const { user } = useContext(AuthContext);

  useEffect(() => {
    if (user && user.profile && user.profile !== "admin") {
      history.push("/");
    }
  }, [user, history]);

  // Tabs: keep stable indices.
  // 0=general, 1=policies, 2=faqs, 3=playbooks, 4=training, 5=playground, 6=tests, 7=decisions, 8=feedback
  const TAB_KEYS = ["general", "policies", "faqs", "playbooks", "training", "playground", "tests", "decisions", "feedback"];

  const parseTabFromUrl = () => {
    try {
      const params = new URLSearchParams(location.search || "");
      const key = String(params.get("tab") || "").toLowerCase();
      const idx = TAB_KEYS.indexOf(key);
      return idx >= 0 ? idx : 0;
    } catch {
      return 0;
    }
  };

  const [tab, setTab] = useState(parseTabFromUrl);
  const [loading, setLoading] = useState(false);

  // Settings
  const [settingsRaw, setSettingsRaw] = useState("{}");

  // Lists
  const [faqs, setFaqs] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [playbooks, setPlaybooks] = useState([]);
  const [examples, setExamples] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [agentFeedbackRows, setAgentFeedbackRows] = useState([]);
  const [agentFeedbackStats, setAgentFeedbackStats] = useState(null);
  const [feedbackDetail, setFeedbackDetail] = useState(null);
  const [feedbackDetailOpen, setFeedbackDetailOpen] = useState(false);
  const [feedbackVerdictFilter, setFeedbackVerdictFilter] = useState("all");
  const [feedbackExportFilter, setFeedbackExportFilter] = useState("all");

  // Playground
  const [playgroundText, setPlaygroundText] = useState("");
  const [playgroundResult, setPlaygroundResult] = useState(null);

  // Tests
  const [testCases, setTestCases] = useState([]);
  const [testReport, setTestReport] = useState(null);

  // Create forms
  const [faqForm, setFaqForm] = useState({ title: "", triggers: "", answer: "" });
  const [policyForm, setPolicyForm] = useState({ title: "", triggers: "", body: "" });
  const [pbForm, setPbForm] = useState({ intent: "", triggers: "", template: "" });
  const [exForm, setExForm] = useState({ intent: "", user_text: "", ideal_answer: "", notes: "" });

  const [tcForm, setTcForm] = useState({
    name: "",
    user_text: "",
    expected_intent: "",
    expected_source_type: "",
    expected_source_id: "",
    expected_contains: "",
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const feedbackParams = { limit: 200 };
      if (feedbackVerdictFilter !== "all") feedbackParams.verdict = feedbackVerdictFilter;
      if (feedbackExportFilter !== "all") feedbackParams.exported = feedbackExportFilter === "exported";

      const [s, pol, f, p, e, d, tcs, afr, afs] = await Promise.all([
        api.get("/bot/intelligence/settings"),
        api.get("/bot/intelligence/policies"),
        api.get("/bot/intelligence/faqs"),
        api.get("/bot/intelligence/playbooks"),
        api.get("/bot/intelligence/examples"),
        api.get("/bot/intelligence/decisions", { params: { limit: 200 } }),
        api.get("/bot/tests/cases"),
        api.get("/agent-feedbacks", { params: feedbackParams }),
        api.get("/agent-feedbacks/stats"),
      ]);

      setSettingsRaw(JSON.stringify(s.data?.settings ?? {}, null, 2));
      setPolicies(pol.data?.policies ?? []);
      setFaqs(f.data?.faqs ?? []);
      setPlaybooks(p.data?.playbooks ?? []);
      setExamples(e.data?.examples ?? []);
      setDecisions(d.data?.decisions ?? []);
      setTestCases(tcs.data?.cases ?? []);
      setAgentFeedbackRows(afr.data?.rows ?? []);
      setAgentFeedbackStats(afs.data?.stats ?? null);
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  };

  const createPolicyRow = async () => {
    try {
      await api.post("/bot/intelligence/policies", {
        title: policyForm.title || null,
        triggers: parseCsvTriggers(policyForm.triggers),
        body: policyForm.body,
        enabled: true,
      });
      toast.success("Política creada");
      setPolicyForm({ title: "", triggers: "", body: "" });
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const deletePolicyRow = async (id) => {
    try {
      await api.delete(`/bot/intelligence/policies/${id}`);
      toast.success("Política eliminada");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const runPlayground = async () => {
    try {
      const r = await api.post("/bot/playground/run", { text: playgroundText });
      setPlaygroundResult(r.data?.result ?? null);
    } catch (err) {
      toastError(err);
    }
  };

  const createTestCaseRow = async () => {
    try {
      await api.post("/bot/tests/cases", {
        name: tcForm.name,
        user_text: tcForm.user_text,
        expected_intent: tcForm.expected_intent || null,
        expected_source_type: tcForm.expected_source_type || null,
        expected_source_id: tcForm.expected_source_id ? Number(tcForm.expected_source_id) : null,
        expected_contains: parseCsvTriggers(tcForm.expected_contains),
        enabled: true,
      });
      toast.success("Test case creado");
      setTcForm({ name: "", user_text: "", expected_intent: "", expected_source_type: "", expected_source_id: "", expected_contains: "" });
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const deleteTestCaseRow = async (id) => {
    try {
      await api.delete(`/bot/tests/cases/${id}`);
      toast.success("Test case eliminado");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const runTests = async () => {
    try {
      const r = await api.post("/bot/tests/run", { limit: 200 });
      setTestReport(r.data?.report ?? null);
      toast.success("Suite ejecutada");
    } catch (err) {
      toastError(err);
    }
  };

  useEffect(() => {
    if (user?.profile === "admin") loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.profile, feedbackVerdictFilter, feedbackExportFilter]);

  // Keep URL in sync with selected tab for deep-links and /training redirect.
  useEffect(() => {
    const key = TAB_KEYS[tab] || "intelligence";
    const params = new URLSearchParams(location.search || "");
    if (params.get("tab") !== key) {
      params.set("tab", key);
      history.replace({ pathname: "/bot", search: params.toString() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // If user manually changes the URL (?tab=training), update the UI.
  useEffect(() => {
    const idx = parseTabFromUrl();
    if (idx !== tab) setTab(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const saveSettings = async () => {
    try {
      const parsed = JSON.parse(settingsRaw || "{}");
      await api.put("/bot/intelligence/settings", parsed);
      toast.success("Settings guardados");
      await loadAll();
    } catch (err) {
      if (err?.message?.includes("JSON")) {
        toast.error("JSON inválido en Settings");
        return;
      }
      toastError(err);
    }
  };

  const createFaqRow = async () => {
    try {
      await api.post("/bot/intelligence/faqs", {
        title: faqForm.title || null,
        triggers: parseCsvTriggers(faqForm.triggers),
        answer: faqForm.answer,
        enabled: true,
      });
      toast.success("FAQ creada");
      setFaqForm({ title: "", triggers: "", answer: "" });
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const deleteFaqRow = async (id) => {
    try {
      await api.delete(`/bot/intelligence/faqs/${id}`);
      toast.success("FAQ eliminada");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const createPlaybookRow = async () => {
    try {
      await api.post("/bot/intelligence/playbooks", {
        intent: pbForm.intent,
        triggers: parseCsvTriggers(pbForm.triggers),
        template: pbForm.template,
        enabled: true,
      });
      toast.success("Playbook creado");
      setPbForm({ intent: "", triggers: "", template: "" });
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const deletePlaybookRow = async (id) => {
    try {
      await api.delete(`/bot/intelligence/playbooks/${id}`);
      toast.success("Playbook eliminado");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const createExampleRow = async () => {
    try {
      await api.post("/bot/intelligence/examples", {
        intent: exForm.intent,
        user_text: exForm.user_text,
        ideal_answer: exForm.ideal_answer,
        notes: exForm.notes || null,
      });
      toast.success("Ejemplo guardado");
      setExForm({ intent: "", user_text: "", ideal_answer: "", notes: "" });
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const deleteExampleRow = async (id) => {
    try {
      await api.delete(`/bot/intelligence/examples/${id}`);
      toast.success("Ejemplo eliminado");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };


  const exportFeedbackToExample = async (row) => {
    try {
      await api.post(`/agent-feedbacks/${row.id}/export-example`);
      toast.success("Feedback exportado como ejemplo");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const exportFeedbackToTestCase = async (row) => {
    try {
      await api.post(`/agent-feedbacks/${row.id}/export-test-case`);
      toast.success("Feedback exportado como test case");
      await loadAll();
    } catch (err) {
      toastError(err);
    }
  };

  const openFeedbackDetail = async (row) => {
    try {
      const { data } = await api.get(`/agent-feedbacks/${row.id}`);
      setFeedbackDetail(data || null);
      setFeedbackDetailOpen(true);
    } catch (err) {
      toastError(err);
    }
  };

  const failureRanking = useMemo(() => {
    const map = agentFeedbackStats?.failureByIntent || {};
    return Object.entries(map).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8);
  }, [agentFeedbackStats]);

  const approvalRanking = useMemo(() => {
    const map = agentFeedbackStats?.approvedByIntent || {};
    return Object.entries(map).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 8);
  }, [agentFeedbackStats]);

  const decisionRows = useMemo(() => decisions ?? [], [decisions]);

  return (
    <MainContainer>
      <MainHeader>
        <Title>Bot</Title>
        <MainHeaderButtonsWrapper>
          <Button variant="outlined" onClick={loadAll} disabled={loading}>
            Refrescar
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>

      <Paper className={classes.mainPaper}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label="General" />
          <Tab label="Políticas" />
          <Tab label="FAQs" />
          <Tab label="Playbooks" />
          <Tab label="Training" />
          <Tab label="Playground" />
          <Tab label="Tests" />
          <Tab label="Decisions" />
          <Tab label="Feedback" />
        </Tabs>
        <Divider />

        <Box className={classes.tabPanel}>
          <TabPanel value={tab} index={0}>
            {/* Global Bot toggle: allow admin to turn the bot on/off for all tickets */}
            <BotGeneralToggle />
            <Typography variant="body2" gutterBottom>
              Settings en JSON. Se usan para templates: {'{settings.algo}'}
            </Typography>
            <TextField
              value={settingsRaw}
              onChange={(e) => setSettingsRaw(e.target.value)}
              variant="outlined"
              fullWidth
              multiline
              rows={14}
            />
            <Box mt={2}>
              <Button
                color="primary"
                variant="contained"
                onClick={saveSettings}
                disabled={loading}
              >
                Guardar settings
              </Button>
            </Box>

            <Divider style={{ margin: "20px 0" }} />

            <Typography variant="subtitle1" gutterBottom>
              Ejemplos
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Documentá respuestas ideales por intent (útil para ajustar la inteligencia y futuras mejoras).
            </Typography>

            <Box className={classes.formRow}>
              <TextField
                label="Intent"
                variant="outlined"
                value={exForm.intent}
                onChange={(e) => setExForm({ ...exForm, intent: e.target.value })}
              />
              <TextField
                label="Notas"
                variant="outlined"
                value={exForm.notes}
                onChange={(e) => setExForm({ ...exForm, notes: e.target.value })}
              />
              <TextField
                className={classes.full}
                label="User text"
                variant="outlined"
                multiline
                rows={3}
                value={exForm.user_text}
                onChange={(e) => setExForm({ ...exForm, user_text: e.target.value })}
              />
              <TextField
                className={classes.full}
                label="Ideal answer"
                variant="outlined"
                multiline
                rows={4}
                value={exForm.ideal_answer}
                onChange={(e) => setExForm({ ...exForm, ideal_answer: e.target.value })}
              />
              <Box className={classes.full}>
                <Button color="primary" variant="contained" onClick={createExampleRow}>
                  Guardar ejemplo
                </Button>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Intent</TableCell>
                    <TableCell>User</TableCell>
                    <TableCell>Ideal</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {examples.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell>{x.id}</TableCell>
                      <TableCell>{x.intent}</TableCell>
                      <TableCell style={{ maxWidth: 280, whiteSpace: "pre-wrap" }}>{x.user_text}</TableCell>
                      <TableCell style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>{x.ideal_answer}</TableCell>
                      <TableCell align="right">
                        <Button size="small" variant="outlined" color="secondary" onClick={() => deleteExampleRow(x.id)}>
                          Borrar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </TabPanel>

          <TabPanel value={tab} index={1}>
            <Box className={classes.formRow}>
              <TextField
                label="Título"
                variant="outlined"
                value={policyForm.title}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, title: e.target.value })
                }
              />
              <TextField
                label="Triggers (comma)"
                variant="outlined"
                value={policyForm.triggers}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, triggers: e.target.value })
                }
              />
              <TextField
                className={classes.full}
                label="Body"
                variant="outlined"
                multiline
                rows={4}
                value={policyForm.body}
                onChange={(e) =>
                  setPolicyForm({ ...policyForm, body: e.target.value })
                }
              />
              <Box className={classes.full}>
                <Button color="primary" variant="contained" onClick={createPolicyRow}>
                  Crear Política
                </Button>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Título</TableCell>
                    <TableCell>Triggers</TableCell>
                    <TableCell>Body</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {policies.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.id}</TableCell>
                      <TableCell>{p.title || ""}</TableCell>
                      <TableCell>{(p.triggers || []).join(", ")}</TableCell>
                      <TableCell
                        style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}
                      >
                        {p.body}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => deletePolicyRow(p.id)}
                        >
                          Eliminar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </TabPanel>

          <TabPanel value={tab} index={2}>
            <Box className={classes.formRow}>
              <TextField
                label="Título"
                variant="outlined"
                value={faqForm.title}
                onChange={(e) => setFaqForm({ ...faqForm, title: e.target.value })}
              />
              <TextField
                label="Triggers (comma)"
                variant="outlined"
                value={faqForm.triggers}
                onChange={(e) => setFaqForm({ ...faqForm, triggers: e.target.value })}
              />
              <TextField
                className={classes.full}
                label="Respuesta"
                variant="outlined"
                multiline
                rows={4}
                value={faqForm.answer}
                onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
              />
              <Box className={classes.full}>
                <Button color="primary" variant="contained" onClick={createFaqRow}>
                  Crear FAQ
                </Button>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Título</TableCell>
                    <TableCell>Triggers</TableCell>
                    <TableCell>Respuesta</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {faqs.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.id}</TableCell>
                      <TableCell>{f.title || ""}</TableCell>
                      <TableCell>{(f.triggers || []).join(", ")}</TableCell>
                      <TableCell
                        style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}
                      >
                        {f.answer}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => deleteFaqRow(f.id)}
                        >
                          Eliminar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </TabPanel>

          <TabPanel value={tab} index={3}>
            <Box className={classes.formRow}>
              <TextField
                label="Intent"
                variant="outlined"
                value={pbForm.intent}
                onChange={(e) => setPbForm({ ...pbForm, intent: e.target.value })}
              />
              <TextField
                label="Triggers (comma)"
                variant="outlined"
                value={pbForm.triggers}
                onChange={(e) => setPbForm({ ...pbForm, triggers: e.target.value })}
              />
              <TextField
                className={classes.full}
                label="Template"
                variant="outlined"
                multiline
                rows={5}
                value={pbForm.template}
                onChange={(e) => setPbForm({ ...pbForm, template: e.target.value })}
              />
              <Box className={classes.full}>
                <Button color="primary" variant="contained" onClick={createPlaybookRow}>
                  Crear Playbook
                </Button>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Intent</TableCell>
                    <TableCell>Triggers</TableCell>
                    <TableCell>Template</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {playbooks.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.id}</TableCell>
                      <TableCell>{p.intent}</TableCell>
                      <TableCell>{(p.triggers || []).join(", ")}</TableCell>
                      <TableCell
                        style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}
                      >
                        {p.template}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => deletePlaybookRow(p.id)}
                        >
                          Eliminar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </TabPanel>

          <TabPanel value={tab} index={4}>
            <TrainingMessages />
          </TabPanel>

          <TabPanel value={tab} index={7}>
            <Typography variant="body2" gutterBottom>
              Últimas decisiones. Útil para auditar por qué respondió FAQ/Playbook.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>At</TableCell>
                  <TableCell>Remote</TableCell>
                  <TableCell>Intent</TableCell>
                  <TableCell>Data</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {decisionRows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      {String(d.created_at || "").replace("T", " ").slice(0, 19)}
                    </TableCell>
                    <TableCell>{d.remote_jid}</TableCell>
                    <TableCell>{d.intent || ""}</TableCell>
                    <TableCell
                      style={{ maxWidth: 520, whiteSpace: "pre-wrap" }}
                    >
                      {JSON.stringify(d.data ?? {}, null, 0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabPanel>

          <TabPanel value={tab} index={8}>
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gridGap={12}>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Total feedback</Typography>
                <Typography variant="h6">{agentFeedbackStats?.total || 0}</Typography>
              </Paper>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Aprobados</Typography>
                <Typography variant="h6">{agentFeedbackStats?.approved || 0}</Typography>
              </Paper>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Fallos</Typography>
                <Typography variant="h6">{(agentFeedbackStats?.rejected || 0) + (agentFeedbackStats?.edited || 0) + (agentFeedbackStats?.handoff || 0)}</Typography>
              </Paper>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Confianza promedio</Typography>
                <Typography variant="h6">{agentFeedbackStats?.avgConfidence ?? 0}</Typography>
              </Paper>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Exportados a examples</Typography>
                <Typography variant="h6">{agentFeedbackStats?.exportedToExample || 0}</Typography>
              </Paper>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="caption" color="textSecondary">Exportados a tests</Typography>
                <Typography variant="h6">{agentFeedbackStats?.exportedToTestCase || 0}</Typography>
              </Paper>
            </Box>

            <Box mt={2} display="grid" gridTemplateColumns="1fr 1fr" gridGap={16}>
              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="subtitle2" gutterBottom>Intent con más fallos</Typography>
                {failureRanking.length ? failureRanking.map(([intent, qty]) => (
                  <Box key={intent} display="flex" justifyContent="space-between" mb={1}>
                    <Typography variant="body2">{intent}</Typography>
                    <Chip size="small" label={qty} />
                  </Box>
                )) : <Typography variant="body2" color="textSecondary">Sin datos todavía.</Typography>}
              </Paper>

              <Paper variant="outlined" style={{ padding: 12 }}>
                <Typography variant="subtitle2" gutterBottom>Intent mejor resueltos</Typography>
                {approvalRanking.length ? approvalRanking.map(([intent, qty]) => (
                  <Box key={intent} display="flex" justifyContent="space-between" mb={1}>
                    <Typography variant="body2">{intent}</Typography>
                    <Chip size="small" label={qty} />
                  </Box>
                )) : <Typography variant="body2" color="textSecondary">Sin datos todavía.</Typography>}
              </Paper>
            </Box>

            <Box mt={3} display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gridGap={16}>
              <Typography variant="subtitle1">Feedback real del agente</Typography>
              <Box display="flex" gridGap={12} flexWrap="wrap">
                <FormControl variant="outlined" size="small">
                  <InputLabel>Veredicto</InputLabel>
                  <Select
                    value={feedbackVerdictFilter}
                    onChange={(e) => setFeedbackVerdictFilter(e.target.value)}
                    label="Veredicto"
                    style={{ minWidth: 160 }}
                  >
                    <MenuItem value="all">Todos</MenuItem>
                    <MenuItem value="approved">Aprobados</MenuItem>
                    <MenuItem value="rejected">Rechazados</MenuItem>
                    <MenuItem value="edited">Editados</MenuItem>
                    <MenuItem value="handoff">Handoff</MenuItem>
                  </Select>
                </FormControl>

                <FormControl variant="outlined" size="small">
                  <InputLabel>Exportación</InputLabel>
                  <Select
                    value={feedbackExportFilter}
                    onChange={(e) => setFeedbackExportFilter(e.target.value)}
                    label="Exportación"
                    style={{ minWidth: 170 }}
                  >
                    <MenuItem value="all">Todos</MenuItem>
                    <MenuItem value="pending">Pendientes</MenuItem>
                    <MenuItem value="exported">Exportados</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Fecha</TableCell>
                    <TableCell>Veredicto</TableCell>
                    <TableCell>Intent</TableCell>
                    <TableCell>Acción</TableCell>
                    <TableCell>Contacto</TableCell>
                    <TableCell>Sugerida</TableCell>
                    <TableCell>Final</TableCell>
                    <TableCell>Exports</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {agentFeedbackRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.id}</TableCell>
                      <TableCell>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}</TableCell>
                      <TableCell>{row.verdict}</TableCell>
                      <TableCell>{row.intent || "-"}</TableCell>
                      <TableCell>{row.action || "-"}</TableCell>
                      <TableCell>{row.contact?.name || row.contact?.number || "-"}</TableCell>
                      <TableCell style={{ maxWidth: 220, whiteSpace: "pre-wrap" }}>{row.suggestedReply || "-"}</TableCell>
                      <TableCell style={{ maxWidth: 220, whiteSpace: "pre-wrap" }}>{row.finalReply || "-"}</TableCell>
                      <TableCell>
                        <Box display="flex" flexDirection="column" gridGap={6}>
                          <Chip size="small" label={row.exportedToExample ? "Example ✓" : "Example -"} />
                          <Chip size="small" label={row.exportedToTestCase ? "Test ✓" : "Test -"} />
                        </Box>
                      </TableCell>
                      <TableCell align="right">
                        <Box display="flex" justifyContent="flex-end" gridGap={8} flexWrap="wrap">
                          <Button size="small" variant="outlined" onClick={() => openFeedbackDetail(row)}>Ver detalle</Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={Boolean(row.exportedToExample)}
                            onClick={() => exportFeedbackToExample(row)}
                          >
                            {row.exportedToExample ? "Example ✓" : "Exportar example"}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="primary"
                            disabled={Boolean(row.exportedToTestCase)}
                            onClick={() => exportFeedbackToTestCase(row)}
                          >
                            {row.exportedToTestCase ? "Test ✓" : "Exportar test"}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            <Dialog open={feedbackDetailOpen} onClose={() => setFeedbackDetailOpen(false)} fullWidth maxWidth="md">
              <DialogTitle>Detalle de feedback #{feedbackDetail?.row?.id || ""}</DialogTitle>
              <DialogContent dividers>
                <Box display="grid" gridTemplateColumns="1fr 1fr" gridGap={16}>
                  <Paper variant="outlined" style={{ padding: 12 }}>
                    <Typography variant="subtitle2" gutterBottom>Resumen</Typography>
                    <Typography variant="body2"><strong>Veredicto:</strong> {feedbackDetail?.row?.verdict || "-"}</Typography>
                    <Typography variant="body2"><strong>Intent:</strong> {feedbackDetail?.row?.intent || "-"}</Typography>
                    <Typography variant="body2"><strong>Acción:</strong> {feedbackDetail?.row?.action || "-"}</Typography>
                    <Typography variant="body2"><strong>Confianza:</strong> {feedbackDetail?.row?.confidence ?? "-"}</Typography>
                    <Typography variant="body2"><strong>Contacto:</strong> {feedbackDetail?.row?.contact?.name || feedbackDetail?.row?.contact?.number || "-"}</Typography>
                    <Typography variant="body2"><strong>Ticket:</strong> #{feedbackDetail?.row?.ticket?.id || "-"} · {feedbackDetail?.row?.ticket?.status || "-"}</Typography>
                    <Typography variant="body2"><strong>Usuario:</strong> {feedbackDetail?.row?.user?.name || "-"}</Typography>
                  </Paper>

                  <Paper variant="outlined" style={{ padding: 12 }}>
                    <Typography variant="subtitle2" gutterBottom>Contexto agente</Typography>
                    <Typography variant="body2" style={{ whiteSpace: "pre-wrap" }}><strong>Sugerida:</strong> {feedbackDetail?.row?.suggestedReply || "-"}</Typography>
                    <Box mt={1} />
                    <Typography variant="body2" style={{ whiteSpace: "pre-wrap" }}><strong>Final:</strong> {feedbackDetail?.row?.finalReply || "-"}</Typography>
                    <Box mt={1} />
                    <Typography variant="body2" style={{ whiteSpace: "pre-wrap" }}><strong>Nota:</strong> {feedbackDetail?.row?.note || "-"}</Typography>
                    <Box mt={1} />
                    <Typography variant="body2" style={{ whiteSpace: "pre-wrap" }}><strong>Meta:</strong> {JSON.stringify(feedbackDetail?.row?.meta || {}, null, 2)}</Typography>
                  </Paper>
                </Box>

                <Box mt={2}>
                  <Typography variant="subtitle2" gutterBottom>Últimos mensajes del ticket</Typography>
                  <Paper variant="outlined" style={{ padding: 12, maxHeight: 320, overflowY: "auto" }}>
                    {(feedbackDetail?.messages || []).map((msg) => (
                      <Box key={msg.id} mb={1.5}>
                        <Typography variant="caption" color="textSecondary">
                          {msg.fromMe ? "Asesor/Bot" : "Cliente"} · {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : "-"}
                        </Typography>
                        <Typography variant="body2" style={{ whiteSpace: "pre-wrap" }}>
                          {msg.body || "[sin texto]"}
                        </Typography>
                      </Box>
                    ))}
                    {!(feedbackDetail?.messages || []).length && (
                      <Typography variant="body2" color="textSecondary">Sin mensajes disponibles para este feedback.</Typography>
                    )}
                  </Paper>
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setFeedbackDetailOpen(false)} color="primary">Cerrar</Button>
              </DialogActions>
            </Dialog>
          </TabPanel>

          <TabPanel value={tab} index={5}>
            <Typography variant="body2" gutterBottom>
              Probá una frase y mirá qué responde y qué fuentes usó (policy/faq/playbook).
            </Typography>
            <TextField
              value={playgroundText}
              onChange={(e) => setPlaygroundText(e.target.value)}
              variant="outlined"
              fullWidth
              multiline
              rows={4}
              placeholder="Ej: ¿dónde están? / ¿hacen envíos? / quiero financiación"
            />
            <Box mt={2}>
              <Button color="primary" variant="contained" onClick={runPlayground}>
                Ejecutar
              </Button>
            </Box>
            {playgroundResult && (
              <Box mt={2}>
                <Typography variant="subtitle2">
                  Intent: {playgroundResult.intent}
                </Typography>
                <Typography variant="subtitle2">Fuentes:</Typography>
                <Typography
                  variant="body2"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {JSON.stringify(playgroundResult.sources || [], null, 2)}
                </Typography>
                <Divider style={{ margin: "12px 0" }} />
                <Typography variant="subtitle2">Respuesta</Typography>
                <Typography
                  variant="body1"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {playgroundResult.reply}
                </Typography>
              </Box>
            )}
          </TabPanel>

          <TabPanel value={tab} index={6}>
            <Typography variant="body2" gutterBottom>
              Suite básica: casos tipo "si el usuario escribe X, esperamos intent Y / fuente Z".
            </Typography>
            <Box className={classes.formRow}>
              <TextField
                label="Nombre"
                variant="outlined"
                value={tcForm.name}
                onChange={(e) => setTcForm({ ...tcForm, name: e.target.value })}
              />
              <TextField
                label="Expected intent"
                variant="outlined"
                value={tcForm.expected_intent}
                onChange={(e) => setTcForm({ ...tcForm, expected_intent: e.target.value })}
                placeholder="faq / policy / stock / none"
              />
              <TextField
                className={classes.full}
                label="User text"
                variant="outlined"
                multiline
                rows={2}
                value={tcForm.user_text}
                onChange={(e) => setTcForm({ ...tcForm, user_text: e.target.value })}
              />
              <TextField
                label="Expected source type"
                variant="outlined"
                value={tcForm.expected_source_type}
                onChange={(e) => setTcForm({ ...tcForm, expected_source_type: e.target.value })}
                placeholder="policy / faq / playbook"
              />
              <TextField
                label="Expected source id"
                variant="outlined"
                value={tcForm.expected_source_id}
                onChange={(e) => setTcForm({ ...tcForm, expected_source_id: e.target.value })}
              />
              <TextField
                className={classes.full}
                label="Expected contains (comma)"
                variant="outlined"
                value={tcForm.expected_contains}
                onChange={(e) => setTcForm({ ...tcForm, expected_contains: e.target.value })}
              />
              <Box className={classes.full}>
                <Button color="primary" variant="contained" onClick={createTestCaseRow}>
                  Crear test case
                </Button>
                <Button
                  style={{ marginLeft: 8 }}
                  variant="outlined"
                  onClick={runTests}
                >
                  Run suite
                </Button>
              </Box>
            </Box>

            <Box mt={2}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Nombre</TableCell>
                    <TableCell>User text</TableCell>
                    <TableCell>Esperado</TableCell>
                    <TableCell align="right">Acciones</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {testCases.map((tc) => (
                    <TableRow key={tc.id}>
                      <TableCell>{tc.id}</TableCell>
                      <TableCell>{tc.name}</TableCell>
                      <TableCell
                        style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}
                      >
                        {tc.user_text}
                      </TableCell>
                      <TableCell
                        style={{ maxWidth: 340, whiteSpace: "pre-wrap" }}
                      >
                        {JSON.stringify(
                          {
                            intent: tc.expected_intent,
                            source: {
                              type: tc.expected_source_type,
                              id: tc.expected_source_id,
                            },
                            contains: tc.expected_contains,
                          },
                          null,
                          0
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          color="secondary"
                          onClick={() => deleteTestCaseRow(tc.id)}
                        >
                          Eliminar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            {testReport && (
              <Box mt={2}>
                <Typography variant="subtitle2">
                  Resultado: {testReport.passed}/{testReport.total} OK (fails: {testReport.failed})
                </Typography>
                <Box mt={1}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Pass</TableCell>
                        <TableCell>Caso</TableCell>
                        <TableCell>Actual</TableCell>
                        <TableCell>Reasons</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(testReport.results || []).map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.pass ? "✅" : "❌"}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell
                            style={{ maxWidth: 380, whiteSpace: "pre-wrap" }}
                          >
                            {JSON.stringify(
                              { intent: r.actual_intent, sources: r.actual_sources },
                              null,
                              0
                            )}
                          </TableCell>
                          <TableCell
                            style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}
                          >
                            {(r.reasons || []).join("\n")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}
          </TabPanel>
        </Box>
      </Paper>
    </MainContainer>
  );
};

export default Bot;