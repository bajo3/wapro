import React, { useState, useEffect, useReducer, useContext } from "react";
import openSocket from "../../services/socket-io";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";

import { makeStyles } from "@material-ui/core/styles";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import Avatar from "@material-ui/core/Avatar";
import WhatsAppIcon from "@material-ui/icons/WhatsApp";
import SearchIcon from "@material-ui/icons/Search";
import TextField from "@material-ui/core/TextField";
import InputAdornment from "@material-ui/core/InputAdornment";

import IconButton from "@material-ui/core/IconButton";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import EditIcon from "@material-ui/icons/Edit";

import api from "../../services/api";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import ContactModal from "../../components/ContactModal";
import ConfirmationModal from "../../components/ConfirmationModal/";

import { i18n } from "../../translate/i18n";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import MainContainer from "../../components/MainContainer";
import toastError from "../../errors/toastError";
import { AuthContext } from "../../context/Auth/AuthContext";
import { Can } from "../../components/Can";

const parseCsv = (text) => {
  const lines = String(text || "").replace(/\r/g, "").split("\n").filter(Boolean);
  if (!lines.length) return [];

  const split = (line) => {
    // Basic CSV split supporting quotes.
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (!inQ && (ch === "," || ch === ";" || ch === "\t")) {
        out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idxName = header.findIndex((h) => ["name", "nombre", "nombre y apellido"].includes(h));
  const idxNumber = header.findIndex((h) => ["number", "telefono", "tel", "celular", "whatsapp"].includes(h));
  const idxEmail = header.findIndex((h) => ["email", "correo"].includes(h));

  const start = idxName !== -1 || idxNumber !== -1 || idxEmail !== -1 ? 1 : 0;

  const rows = [];
  for (const line of lines.slice(start)) {
    const cols = split(line);
    const name = cols[idxName] ?? cols[0] ?? "";
    const number = cols[idxNumber] ?? cols[1] ?? "";
    const email = idxEmail !== -1 ? cols[idxEmail] : "";
    rows.push({ name, number, email });
  }
  return rows;
};

const reducer = (state, action) => {
  if (action.type === "LOAD_CONTACTS") {
    const contacts = action.payload;
    const newContacts = [];

    contacts.forEach((contact) => {
      const contactIndex = state.findIndex((c) => c.id === contact.id);
      if (contactIndex !== -1) {
        state[contactIndex] = contact;
      } else {
        newContacts.push(contact);
      }
    });

    return [...state, ...newContacts];
  }

  if (action.type === "UPDATE_CONTACTS") {
    const contact = action.payload;
    const contactIndex = state.findIndex((c) => c.id === contact.id);

    if (contactIndex !== -1) {
      state[contactIndex] = contact;
      return [...state];
    } else {
      return [contact, ...state];
    }
  }

  if (action.type === "DELETE_CONTACT") {
    const contactId = action.payload;

    const contactIndex = state.findIndex((c) => c.id === contactId);
    if (contactIndex !== -1) {
      state.splice(contactIndex, 1);
    }
    return [...state];
  }

  if (action.type === "RESET") {
    return [];
  }
};

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
}));

const Contacts = () => {
  const classes = useStyles();
  const history = useHistory();

  const { user } = useContext(AuthContext);

  const [loading, setLoading] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [searchParam, setSearchParam] = useState("");
  const [contacts, dispatch] = useReducer(reducer, []);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [canImportPhoneContacts, setCanImportPhoneContacts] = useState(true);
  const [csvImporting, setCsvImporting] = useState(false);
  const fileInputId = "contacts-csv-file";

  useEffect(() => {
    // Determine feature availability based on backend provider.
    // In Evolution mode, /contacts/import (phone contacts via WWebJS) is not supported.
    const fetchProvider = async () => {
      try {
        const { data } = await api.get("/health");
        const provider = String(data?.provider || "").toUpperCase();
        setCanImportPhoneContacts(provider !== "EVOLUTION");
      } catch {
        // if we can't fetch, keep enabled to avoid blocking the UI
      }
    };
    fetchProvider();
  }, []);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);
  }, [searchParam]);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const fetchContacts = async () => {
        try {
          const { data } = await api.get("/contacts/", {
            params: { searchParam, pageNumber },
          });
          dispatch({ type: "LOAD_CONTACTS", payload: data.contacts });
          setHasMore(data.hasMore);
          setLoading(false);
        } catch (err) {
          toastError(err);
        }
      };
      fetchContacts();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchParam, pageNumber]);

  useEffect(() => {
    const socket = openSocket();

    socket.on("contact", (data) => {
      if (data.action === "update" || data.action === "create") {
        dispatch({ type: "UPDATE_CONTACTS", payload: data.contact });
      }

      if (data.action === "delete") {
        dispatch({ type: "DELETE_CONTACT", payload: +data.contactId });
      }
    });

    return () => {
      socket.off();
    };
  }, []);

  const handleSearch = (event) => {
    setSearchParam(event.target.value.toLowerCase());
  };

  const handleOpenContactModal = () => {
    setSelectedContactId(null);
    setContactModalOpen(true);
  };

  const handleCloseContactModal = () => {
    setSelectedContactId(null);
    setContactModalOpen(false);
  };

  const handleSaveTicket = async (contactId) => {
    if (!contactId) return;
    setLoading(true);
    try {
      const { data: ticket } = await api.post("/tickets", {
        contactId: contactId,
        userId: user?.id,
        status: "open",
      });
      history.push(`/tickets/${ticket.id}`);
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  };

  const hadleEditContact = (contactId) => {
    setSelectedContactId(contactId);
    setContactModalOpen(true);
  };

  const handleDeleteContact = async (contactId) => {
    try {
      await api.delete(`/contacts/${contactId}`);
      toast.success(i18n.t("contacts.toasts.deleted"));
    } catch (err) {
      toastError(err);
    }
    setDeletingContact(null);
    setSearchParam("");
    setPageNumber(1);
  };

  const handleimportContact = async () => {
    try {
      await api.post("/contacts/import");
      history.go(0);
    } catch (err) {
      toastError(err);
    }
  };

  const handleCsvFile = async (file) => {
    if (!file) return;
    setCsvImporting(true);
    try {
      const text = await file.text();
      const contacts = parseCsv(text);
      const { data } = await api.post("/contacts/import/csv", { contacts });
      toast.success(
        i18n.t("contacts.toasts.imported") +
          ` (${data?.createdOrUpdated || 0} ok, ${data?.skipped || 0} skip, ${data?.errors || 0} err)`
      );
      history.go(0);
    } catch (err) {
      toastError(err);
    }
    setCsvImporting(false);
  };

  const loadMore = () => {
    setPageNumber((prevState) => prevState + 1);
  };

  const handleScroll = (e) => {
    if (!hasMore || loading) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + 100) < clientHeight) {
      loadMore();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0f1117]">
      <ContactModal
        open={contactModalOpen}
        onClose={handleCloseContactModal}
        aria-labelledby="form-dialog-title"
        contactId={selectedContactId}
      />
      <ConfirmationModal
        title={
          deletingContact
            ? `${i18n.t("contacts.confirmationModal.deleteTitle")} ${deletingContact.name}?`
            : `${i18n.t("contacts.confirmationModal.importTitlte")}`
        }
        open={confirmOpen}
        onClose={setConfirmOpen}
        onConfirm={() =>
          deletingContact ? handleDeleteContact(deletingContact.id) : handleimportContact()
        }
      >
        {deletingContact
          ? `${i18n.t("contacts.confirmationModal.deleteMessage")}`
          : `${i18n.t("contacts.confirmationModal.importMessage")}`}
      </ConfirmationModal>

      <input
        id={fileInputId}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handleCsvFile(file);
        }}
      />

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-white">Contactos</h1>
          <p className="mt-0.5 text-xs text-white/40">Base de leads y clientes del CRM</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon style={{ fontSize: 16 }} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              type="search"
              placeholder="Buscar contacto..."
              value={searchParam}
              onChange={handleSearch}
              className="h-9 w-56 rounded-lg border border-white/[0.1] bg-[#1a1f2e] pl-8 pr-3 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-amber-400/40"
            />
          </div>
          <button
            disabled={csvImporting}
            onClick={() => { const el = document.getElementById(fileInputId); if (el) el.click(); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1a1f2e] px-3 text-sm text-white/70 hover:bg-white/[0.06] disabled:opacity-40 transition-colors"
          >
            {csvImporting ? "Importando…" : "Importar CSV"}
          </button>
          {canImportPhoneContacts && (
            <button
              onClick={() => setConfirmOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#1a1f2e] px-3 text-sm text-white/70 hover:bg-white/[0.06] transition-colors"
            >
              {i18n.t("contacts.buttons.import")}
            </button>
          )}
          <button
            onClick={handleOpenContactModal}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-400 px-4 text-sm font-bold text-black hover:bg-amber-300 transition-colors"
          >
            + Nuevo contacto
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4" onScroll={handleScroll}>
        <div className="rounded-xl border border-white/[0.08] bg-[#171b26] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="w-12 px-4 py-3" />
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Nombre</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">WhatsApp</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40">Email</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/40 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      {contact.profilePicUrl ? (
                        <img src={contact.profilePicUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/15 text-xs font-bold text-amber-400">
                          {(contact.name || "?").charAt(0).toUpperCase()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{contact.name}</td>
                    <td className="px-4 py-3 text-white/60">{contact.number}</td>
                    <td className="px-4 py-3 text-white/40 text-xs">{contact.email || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSaveTicket(contact.id)}
                        title="Nuevo ticket"
                        className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-green-500/20 hover:text-green-400 transition-colors"
                      >
                        <WhatsAppIcon style={{ fontSize: 16 }} />
                      </button>
                      <button
                        onClick={() => hadleEditContact(contact.id)}
                        title="Editar"
                        className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.08] hover:text-white/80 transition-colors"
                      >
                        <EditIcon style={{ fontSize: 16 }} />
                      </button>
                      <Can
                        role={user.profile}
                        perform="contacts-page:deleteContact"
                        yes={() => (
                          <button
                            onClick={() => { setConfirmOpen(true); setDeletingContact(contact); }}
                            title="Eliminar"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                          >
                            <DeleteOutlineIcon style={{ fontSize: 16 }} />
                          </button>
                        )}
                      />
                    </td>
                  </tr>
                ))}
                {loading && <TableRowSkeleton avatar columns={3} />}
                {!loading && contacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-16 text-center">
                      <p className="text-sm text-white/30">No hay contactos.</p>
                      <p className="mt-1 text-xs text-white/20">Importá desde CSV o creá uno manualmente.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contacts;
