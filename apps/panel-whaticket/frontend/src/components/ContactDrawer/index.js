import React, { useEffect, useMemo, useState } from "react";

import { makeStyles } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import IconButton from "@material-ui/core/IconButton";
import CloseIcon from "@material-ui/icons/Close";
import Drawer from "@material-ui/core/Drawer";
import Link from "@material-ui/core/Link";
import InputLabel from "@material-ui/core/InputLabel";
import Avatar from "@material-ui/core/Avatar";
import Button from "@material-ui/core/Button";
import Paper from "@material-ui/core/Paper";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import Divider from "@material-ui/core/Divider";
import Chip from "@material-ui/core/Chip";
import TextField from "@material-ui/core/TextField";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";

import { i18n } from "../../translate/i18n";

import ContactModal from "../ContactModal";
import ContactDrawerSkeleton from "../ContactDrawerSkeleton";
import MarkdownWrapper from "../MarkdownWrapper";
import api from "../../services/api";
import toastError from "../../errors/toastError";

const drawerWidth = 420;

const parseKvpTag = (tags, key) => {
  const prefix = `${key}:`;
  const found = (tags || []).find((t) => String(t).toLowerCase().startsWith(prefix));
  if (!found) return "";
  return String(found).slice(prefix.length).trim();
};

const upsertKvpTag = (tags, key, value) => {
  const prefix = `${key}:`;
  const cleaned = (tags || []).filter((t) => !String(t).toLowerCase().startsWith(prefix));
  if (!value) return cleaned;
  return Array.from(new Set([...cleaned, `${key}:${value}`]));
};

const useStyles = makeStyles(theme => ({
	drawer: {
		flexShrink: 0,
	},
	drawerPaper: {
		width: drawerWidth,
		maxWidth: "100vw",
		display: "flex",
		backgroundColor: "#ffffff",
		color: "#0f172a",
		borderTop: "1px solid #d8deeb",
		borderRight: "1px solid #d8deeb",
		borderBottom: "1px solid #d8deeb",
		borderTopRightRadius: 4,
		borderBottomRightRadius: 4,
	},
	header: {
		display: "flex",
		borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
		backgroundColor: "#ffffff",
		alignItems: "center",
		padding: theme.spacing(0, 1),
		minHeight: 56,
		justifyContent: "flex-start",
	},
	content: {
		display: "flex",
		backgroundColor: "#ffffff",
		flexDirection: "column",
		padding: "8px",
		height: "100%",
		overflowY: "scroll",
		...theme.scrollbarStyles,
	},

	contactAvatar: {
		margin: 10,
		width: 96,
		height: 96,
	},

	contactHeader: {
		display: "flex",
		padding: 10,
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		"& > *": {
			margin: 4,
		},
	},

	contactDetails: {
		marginTop: 8,
		padding: 10,
		display: "flex",
		flexDirection: "column",
	},
	contactExtraInfo: {
		marginTop: 4,
		padding: 6,
	},
	sectionTitle: {
		fontSize: 12,
		fontWeight: 700,
		textTransform: "uppercase",
		letterSpacing: 0.6,
		color: "#64748b",
	},
	muted: {
		color: "#64748b",
	},
}));

const ContactDrawer = ({ open, handleDrawerClose, contact, ticket, loading, onTicketPatched = () => {} }) => {
	const classes = useStyles();

	const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState(ticket?.id ? 1 : 0);
  const [botMode, setBotMode] = useState(String(ticket?.botMode || "ON").toUpperCase());
  const [recontactAt, setRecontactAt] = useState("");

  // Ticket tools state
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteInput, setNoteInput] = useState("");
  const [historyTickets, setHistoryTickets] = useState([]);

  // Recontacto por conversación (scheduled messages)
  const [scheduledRows, setScheduledRows] = useState([]);
  const [recontactDays, setRecontactDays] = useState(3);
  const [recontactBody, setRecontactBody] = useState(
    "Hola! ¿Cómo venimos? Si querés, decime presupuesto y qué estás buscando y te paso opciones disponibles 😊"
  );

  const ticketId = ticket?.id;
  const contactId = contact?.id;

  const stage = useMemo(() => parseKvpTag(tags, "stage"), [tags]);
  const interest = useMemo(() => parseKvpTag(tags, "interest"), [tags]);

  const phone = contact?.number ? String(contact.number) : "";
  const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "";

  const botModeLabel = useMemo(() => {
    const mode = String(botMode || ticket?.botMode || "ON").toUpperCase();
    if (mode === "HUMAN_ONLY") return i18n.t("contactDrawer.ticket.botMode.human");
    if (mode === "OFF") return i18n.t("contactDrawer.ticket.botMode.off");
    return i18n.t("contactDrawer.ticket.botMode.on");
  }, [botMode, ticket?.botMode]);

  useEffect(() => {
    // Keep state in sync when switching tickets
    setTags([]);
    setNotes([]);
    setHistoryTickets([]);
    setTagInput("");
    setNoteInput("");
    setScheduledRows([]);
    setBotMode(String(ticket?.botMode || "ON").toUpperCase());
    setTab(ticket?.id ? 1 : 0);
  }, [ticketId, contactId, ticket?.botMode, ticket?.id]);

  useEffect(() => {
    const loadTicketTools = async () => {
      try {
        if (ticketId) {
          const [tagsRes, notesRes] = await Promise.all([
            api.get(`/tickets/${ticketId}/tags`),
            api.get(`/tickets/${ticketId}/notes`)
          ]);
          setTags(tagsRes.data?.tags || []);
          setNotes(notesRes.data?.notes || []);

          // Recontactos agendados para este ticket
          const smRes = await api.get(`/scheduled-messages`, { params: { ticketId, limit: 25 } });
          setScheduledRows(smRes.data?.rows || []);
        }
      } catch (err) {
        toastError(err);
      }
    };
    if (open && tab === 1) loadTicketTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, ticketId]);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        if (!contactId) return;
        const { data } = await api.get(`/contacts/${contactId}/tickets`, {
          params: { limit: 20 }
        });
        setHistoryTickets(data?.tickets || []);
      } catch (err) {
        toastError(err);
      }
    };
    if (open && tab === 2) loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, contactId]);

  const saveTags = async (nextTags) => {
    if (!ticketId) return;
    try {
      const { data } = await api.put(`/tickets/${ticketId}/tags`, { tags: nextTags });
      setTags(data?.tags || nextTags);
    } catch (err) {
      toastError(err);
    }
  };

  const handleAddTag = async () => {
    const next = [...tags, tagInput].map(t => String(t || "").trim()).filter(Boolean);
    const uniq = Array.from(new Set(next));
    setTagInput("");
    await saveTags(uniq);
  };

  const handleRemoveTag = async (t) => {
    await saveTags(tags.filter(x => x !== t));
  };

  const setStage = async (value) => {
    const next = upsertKvpTag(tags, "stage", value);
    await saveTags(next);
  };

  const setInterest = async (value) => {
    const next = upsertKvpTag(tags, "interest", value);
    await saveTags(next);
  };

  const handleAddNote = async () => {
    if (!ticketId) return;
    const body = String(noteInput || "").trim();
    if (!body) return;
    setNoteInput("");
    try {
      const { data } = await api.post(`/tickets/${ticketId}/notes`, { body });
      setNotes((prev) => [data, ...prev]);
    } catch (err) {
      toastError(err);
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!ticketId) return;
    try {
      await api.delete(`/tickets/${ticketId}/notes/${noteId}`);
      setNotes((prev) => prev.filter(n => n.id !== noteId));
    } catch (err) {
      toastError(err);
    }
  };

  const handleBotMode = async (mode) => {
    if (!ticketId) return;
    try {
      const { data } = await api.put(`/tickets/${ticketId}/bot-mode`, { botMode: mode });
      const next = String(data?.botMode || mode).toUpperCase();
      setBotMode(next);
      onTicketPatched(data);
    } catch (err) {
      toastError(err);
    }
  };

  const refreshScheduled = async () => {
    if (!ticketId) return;
    try {
      const smRes = await api.get(`/scheduled-messages`, { params: { ticketId, limit: 25 } });
      setScheduledRows(smRes.data?.rows || []);
    } catch (err) {
      toastError(err);
    }
  };

  const createRecontact = async () => {
    if (!ticketId || !contactId) return;
    const days = Math.max(0, Number(recontactDays) || 0);
    const body = String(recontactBody || "").trim();
    if (!body) return;

    let sendAt = recontactAt ? new Date(recontactAt).toISOString() : null;
    if (!sendAt) {
      sendAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      await api.post(`/scheduled-messages`, { ticketId, contactId, body, sendAt });
      setRecontactAt("");
      await refreshScheduled();
    } catch (err) {
      toastError(err);
    }
  };

  const cancelScheduled = async (id) => {
    try {
      await api.post(`/scheduled-messages/${id}/cancel`);
      await refreshScheduled();
    } catch (err) {
      toastError(err);
    }
  };

	return (
		<Drawer
			className={classes.drawer}
			variant="temporary"
			anchor="right"
			open={open}
			onClose={handleDrawerClose}
			PaperProps={{ style: { position: "absolute" } }}
			BackdropProps={{ style: { position: "absolute" } }}
			ModalProps={{
				container: document.getElementById("drawer-container"),
				keepMounted: true,
				style: { position: "absolute" },
			}}
			classes={{
				paper: classes.drawerPaper,
			}}
		>
			<div className={classes.header}>
				<IconButton onClick={handleDrawerClose}>
					<CloseIcon />
				</IconButton>
				<Typography style={{ justifySelf: "center", color: "#0f172a", fontWeight: 600 }}>
					{i18n.t("contactDrawer.header")}
				</Typography>
			</div>
			{loading ? (
				<ContactDrawerSkeleton classes={classes} />
			) : (
				<div className={classes.content}>
					<Paper square variant="outlined" className={classes.contactHeader} style={{ background: "#ffffff", borderColor: "#d8deeb", borderRadius: 12 }}>
						<Avatar
							alt={contact.name}
							src={contact.profilePicUrl}
							className={classes.contactAvatar}
						></Avatar>

						<Typography style={{ fontWeight: 700, color: "#0f172a" }}>{contact.name}</Typography>
						<Typography className={classes.muted}>
							<Link style={{ color: "#2563eb" }} href={`tel:${contact.number}`}>{contact.number}</Link>
						</Typography>
						{ticketId ? (
							<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
								<Chip size="small" label={`Ticket #${ticketId}`} style={{ background: "#f8fafc", color: "#0f172a" }} />
								<Chip size="small" label={`Bot: ${botModeLabel}`} style={{ background: "#f8fafc", color: "#0f172a" }} />
							</div>
						) : null}
						<Button
							variant="outlined"
							color="primary"
							onClick={() => setModalOpen(true)}
						>
							{i18n.t("contactDrawer.buttons.edit")}
						</Button>
					</Paper>

					<Paper square variant="outlined" style={{ marginRight: 0, background: "#ffffff", borderColor: "#d8deeb", borderRadius: 12 }}>
						<Tabs
							value={tab}
							onChange={(_, v) => setTab(v)}
							indicatorColor="primary"
							textColor="primary"
							variant="fullWidth"
						>
							<Tab label={i18n.t("contactDrawer.tabs.contact")} />
							<Tab label={i18n.t("contactDrawer.tabs.ticket")} disabled={!ticketId} />
							<Tab label={i18n.t("contactDrawer.tabs.history")} disabled={!contactId} />
						</Tabs>
					</Paper>

					{tab === 0 && (
						<Paper square variant="outlined" className={classes.contactDetails} style={{ background: "#ffffff", borderColor: "#d8deeb", borderRadius: 12 }}>
						<ContactModal
							open={modalOpen}
							onClose={() => setModalOpen(false)}
							contactId={contact.id}
						></ContactModal>
						<Typography className={classes.sectionTitle}>
							{i18n.t("contactDrawer.extraInfo")}
						</Typography>
						{contact?.extraInfo?.map(info => (
							<Paper
								key={info.id}
								square
								variant="outlined"
								className={classes.contactExtraInfo}
								style={{ background: "#ffffff", borderColor: "#d8deeb" }}
							>
								<InputLabel>{info.name}</InputLabel>
								<Typography component="div" noWrap style={{ paddingTop: 2 }}>
									<MarkdownWrapper>{info.value}</MarkdownWrapper>
								</Typography>
							</Paper>
						))}
						</Paper>
					)}

					{tab === 1 && (
						<Paper square variant="outlined" className={classes.contactDetails} style={{ background: "#ffffff", borderColor: "#d8deeb", borderRadius: 12 }}>
							<Typography className={classes.sectionTitle}>
								{i18n.t("contactDrawer.ticket.title")}
							</Typography>

							{/* Ficha (compact) */}
							<Divider style={{ margin: "10px 0", borderColor: "#e2e8f0" }} />
							<Typography className={classes.sectionTitle}>Ficha</Typography>
							<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
									<div>
										<Typography variant="caption" className={classes.muted}>Etapa</Typography>
										<TextField
											select
											SelectProps={{ native: true }}
											variant="outlined"
											size="small"
										InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
											value={stage}
											onChange={(e) => setStage(e.target.value)}
											fullWidth
										>
											<option value="">Sin definir</option>
											<option value="new">Nuevo</option>
											<option value="qualified">Calificado</option>
											<option value="quote">Presupuesto</option>
											<option value="negotiation">Negociación</option>
											<option value="won">Cerrado (Ganado)</option>
											<option value="lost">Cerrado (Perdido)</option>
										</TextField>
									</div>
									<div>
										<Typography variant="caption" className={classes.muted}>Interés</Typography>
										<TextField
											select
											SelectProps={{ native: true }}
											variant="outlined"
											size="small"
										InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
											value={interest}
											onChange={(e) => setInterest(e.target.value)}
											fullWidth
										>
											<option value="">Sin definir</option>
											<option value="low">Bajo</option>
											<option value="medium">Medio</option>
											<option value="high">Alto</option>
										</TextField>
									</div>
								</div>

								<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
									{waLink ? (
										<Button size="small" variant="outlined" color="primary" component="a" href={waLink} target="_blank" rel="noreferrer">
											Abrir WhatsApp
										</Button>
									) : null}
									<Button
										size="small"
										variant="outlined"
										onClick={() => {
											if (!phone) return;
											navigator.clipboard?.writeText(phone);
										}}
									>
										Copiar número
									</Button>
									{contact?.leadSource ? (
										<Chip size="small" label={String(contact.leadSource)} />
									) : null}
								</div>
							</div>

							<Divider style={{ margin: "14px 0", borderColor: "#e2e8f0" }} />

							<Typography variant="subtitle2">
								{i18n.t("contactDrawer.ticket.botMode.label")}: {botModeLabel}
							</Typography>
							<Typography variant="body2" className={classes.muted} style={{ marginTop: 4 }}>
								Usá estos botones para pasar la conversación a humano, devolverla al bot o apagarlo por completo.
							</Typography>
							<div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
								<Button size="small" variant="outlined" onClick={() => handleBotMode("ON")}>
									{i18n.t("contactDrawer.ticket.botMode.actions.on")}
								</Button>
								<Button size="small" variant="contained" color="primary" onClick={() => handleBotMode("HUMAN_ONLY")}>
									{i18n.t("contactDrawer.ticket.botMode.actions.human")}
								</Button>
								<Button size="small" variant="outlined" onClick={() => handleBotMode("OFF")}>
									{i18n.t("contactDrawer.ticket.botMode.actions.off")}
								</Button>
							</div>

							<Divider style={{ margin: "16px 0", borderColor: "#e2e8f0" }} />

							<Typography variant="subtitle2">Recontacto</Typography>
							<Typography variant="body2" className={classes.muted} style={{ marginTop: 4 }}>
								Agendá un mensaje automático para esta conversación.
							</Typography>
							<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
								<div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, alignItems: "center" }}>
									<TextField
										label="Días"
										variant="outlined"
										size="small"
										type="number"
										value={recontactDays}
										onChange={(e) => setRecontactDays(e.target.value)}
										InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
									/>
									<Button size="small" variant="contained" color="primary" onClick={createRecontact}>
										Agendar
									</Button>
								</div>
								<TextField
									label="Fecha y hora (opcional)"
									variant="outlined"
									size="small"
									type="datetime-local"
									value={recontactAt}
									onChange={(e) => setRecontactAt(e.target.value)}
									InputLabelProps={{ shrink: true }}
									InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
									fullWidth
								/>
								<TextField
									label="Mensaje"
									variant="outlined"
									multiline
									minRows={3}
									value={recontactBody}
									onChange={(e) => setRecontactBody(e.target.value)}
									InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
									fullWidth
								/>
							</div>

							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
								<Typography variant="caption" className={classes.muted}>
									Próximos envíos (este ticket)
								</Typography>
								<Button size="small" variant="outlined" onClick={refreshScheduled}>
									Refrescar
								</Button>
							</div>

							<List dense>
								{(scheduledRows || []).map((r) => (
									<ListItem key={r.id} divider>
										<ListItemText
											primary={`#${r.id} • ${r.status}`}
											secondary={`Enviar: ${new Date(r.sendAt).toLocaleString()} • ${String(r.body || "").slice(0, 80)}${String(r.body || "").length > 80 ? "…" : ""}`}
										/>
										{r.status === "PENDING" ? (
											<Button size="small" variant="outlined" onClick={() => cancelScheduled(r.id)}>
												Cancelar
											</Button>
										) : null}
									</ListItem>
								))}
								{!(scheduledRows || []).length && (
									<Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
										No hay recontactos agendados.
									</Typography>
								)}
							</List>

							<Divider style={{ margin: "16px 0", borderColor: "#e2e8f0" }} />

							<Typography variant="subtitle2">{i18n.t("contactDrawer.ticket.tags")}</Typography>
							<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
								<TextField
									size="small"
									variant="outlined"
									placeholder={i18n.t("contactDrawer.ticket.tagsPlaceholder")}
									value={tagInput}
									onChange={(e) => setTagInput(e.target.value)}
									InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
									onKeyDown={(e) => {
										if (e.key === "Enter") handleAddTag();
									}}
									fullWidth
								/>
								<Button size="small" variant="contained" color="primary" onClick={handleAddTag}>
									{i18n.t("contactDrawer.ticket.add")}
								</Button>
							</div>
							<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
								{tags.map((t) => (
									<Chip key={t} label={t} onDelete={() => handleRemoveTag(t)} />
								))}
								{!tags.length && (
									<Typography variant="body2" color="textSecondary">
										{i18n.t("contactDrawer.ticket.tagsEmpty")}
									</Typography>
								)}
							</div>

							<Divider style={{ margin: "16px 0", borderColor: "#e2e8f0" }} />

							<Typography variant="subtitle2">{i18n.t("contactDrawer.ticket.notes")}</Typography>
							<TextField
								multiline
								minRows={3}
								variant="outlined"
								placeholder={i18n.t("contactDrawer.ticket.notesPlaceholder")}
								value={noteInput}
								onChange={(e) => setNoteInput(e.target.value)}
								InputProps={{ style: { color: "#0f172a", background: "#fff" } }}
								style={{ marginTop: 8 }}
								fullWidth
							/>
							<div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
								<Button size="small" variant="contained" color="primary" onClick={handleAddNote}>
									{i18n.t("contactDrawer.ticket.add")}
								</Button>
							</div>
							<List dense>
								{notes.map((n) => (
									<ListItem key={n.id} divider>
										<ListItemText
											primary={<MarkdownWrapper>{n.body}</MarkdownWrapper>}
											secondary={new Date(n.createdAt).toLocaleString()}
										/>
										<IconButton size="small" onClick={() => handleDeleteNote(n.id)}>
											<DeleteOutlineIcon />
										</IconButton>
									</ListItem>
								))}
								{!notes.length && (
									<Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
										{i18n.t("contactDrawer.ticket.notesEmpty")}
									</Typography>
								)}
							</List>
						</Paper>
					)}

					{tab === 2 && (
						<Paper square variant="outlined" className={classes.contactDetails}>
							<Typography variant="subtitle1">
								{i18n.t("contactDrawer.history.title")}
							</Typography>
							<Divider style={{ margin: "8px 0" }} />
							<List dense>
								{historyTickets.map((t) => (
									<ListItem key={t.id} divider>
										<ListItemText
											primary={`#${t.id} • ${t.status}`}
											secondary={`${t.lastMessage || ""} • ${new Date(t.updatedAt).toLocaleString()}`}
										/>
									</ListItem>
								))}
								{!historyTickets.length && (
									<Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
										{i18n.t("contactDrawer.history.empty")}
									</Typography>
								)}
							</List>
						</Paper>
					)}
				</div>
			)}
		</Drawer>
	);
};

export default ContactDrawer;
