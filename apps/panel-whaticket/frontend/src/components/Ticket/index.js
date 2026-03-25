import React, { useState, useEffect, useRef } from "react";
import { useParams, useHistory } from "react-router-dom";

import { toast } from "react-toastify";
import openSocket from "../../services/socket-io";
import { Button, makeStyles } from "@material-ui/core";
import ArrowBackIos from "@material-ui/icons/ArrowBackIos";

import ContactDrawer from "../ContactDrawer";
import MessageInput from "../MessageInput/";
import MessagesList from "../MessagesList";
import ImprovedTicketChat from "../ImprovedTicketChat";
import SlideOver from "../SlideOver";
import LeadPanelAutos from "../LeadPanelAutos";
import api from "../../services/api";
import { ReplyMessageProvider } from "../../context/ReplyingMessage/ReplyingMessageContext";
import toastError from "../../errors/toastError";

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    height: "100%",
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    background: "transparent",
  },
  classicWrapper: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  mobileBackBar: {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
    background: "rgba(255,255,255,0.96)",
  },
  mobileBackButton: {
    minWidth: 0,
    borderRadius: 999,
    textTransform: "none",
  },
  desktopSwitch: {
    marginLeft: "auto",
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },
}));

const Ticket = () => {
  const { ticketId } = useParams();
  const history = useHistory();
  const classes = useStyles();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState(1);
  const [proView, setProView] = useState(true);
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState({});
  const [ticket, setTicket] = useState({});

  const prevBotMode = useRef(null);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const fetchTicket = async () => {
        try {
          const { data } = await api.get("/tickets/" + ticketId);
          setContact(data.contact || {});
          setTicket(data || {});
        } catch (err) {
          toastError(err);
        } finally {
          setLoading(false);
        }
      };
      fetchTicket();
    }, 250);
    return () => clearTimeout(delayDebounceFn);
  }, [ticketId, history]);

  useEffect(() => {
    if (!ticket || typeof ticket.botMode === "undefined") return;
    const currentMode = String(ticket.botMode || "ON").toUpperCase();
    const previous = prevBotMode.current;
    if (previous && currentMode !== previous) {
      if (currentMode === "HUMAN_ONLY") {
        toast.info("El bot ha derivado la conversación a un asesor humano.");
      } else if (currentMode === "OFF") {
        toast.info("El bot está apagado para este ticket.");
      }
    }
    prevBotMode.current = currentMode;
  }, [ticket?.botMode]);

  useEffect(() => {
    const socket = openSocket();
    const join = () => socket.emit("joinChatBox", ticketId);

    if (socket.connected) join();
    socket.on("connect", join);

    socket.on("ticket", (data) => {
      if (data.action === "update") {
        setTicket(data.ticket || {});
      }

      if (data.action === "delete") {
        toast.success("Ticket deleted sucessfully.");
        history.push("/tickets");
      }
    });

    socket.on("contact", (data) => {
      if (data.action === "update") {
        setContact((prevState) => {
          if (prevState.id === data.contact?.id) {
            return { ...prevState, ...data.contact };
          }
          return prevState;
        });
      }
    });

    return () => {
      socket.emit("leaveChatBox", ticketId);
      socket.off("connect", join);
      socket.off("ticket");
      socket.off("contact");
    };
  }, [ticketId, history]);

  const handleDrawerOpen = (tab = 1) => {
    setDrawerTab(typeof tab === "number" ? tab : 1);
    setDrawerOpen(true);
  };
  const handleDrawerClose = () => setDrawerOpen(false);

  return (
    <div className={classes.root} id="drawer-container">
      <div className={classes.classicWrapper}>
        <ReplyMessageProvider>
          {proView ? (
            <>
              <ImprovedTicketChat
                loading={loading}
                ticketId={ticketId}
                ticket={ticket}
                contact={contact}
                onOpenContact={handleDrawerOpen}
                onToggleView={() => setProView(false)}
              />

              <SlideOver
                open={drawerOpen}
                onClose={handleDrawerClose}
                title={contact?.name ? `Gestión · ${contact.name}` : "Gestión del lead"}
                widthClass="w-[420px] lg:w-[460px]"
              >
                <LeadPanelAutos ticketId={ticketId} />
              </SlideOver>
            </>
          ) : (
            <>
              <div className={classes.mobileBackBar}>
                <Button
                  color="primary"
                  onClick={() => history.push("/tickets")}
                  className={classes.mobileBackButton}
                  startIcon={<ArrowBackIos />}
                >
                  Volver
                </Button>
                <Button
                  color="primary"
                  onClick={() => setProView(true)}
                  className={classes.mobileBackButton}
                >
                  Vista avanzada
                </Button>
                <Button
                  color="primary"
                  onClick={() => setProView(true)}
                  className={classes.desktopSwitch}
                >
                  Cambiar a vista avanzada
                </Button>
              </div>
              <MessagesList ticketId={ticketId} isGroup={ticket?.isGroup} />
              <MessageInput ticketStatus={ticket?.status} />
            </>
          )}
        </ReplyMessageProvider>
      </div>

      {!proView ? (
        <ContactDrawer
          open={drawerOpen}
          handleDrawerClose={handleDrawerClose}
          contact={contact}
          ticket={ticket}
          loading={loading}
          initialTab={drawerTab}
          onTicketPatched={(patch) => setTicket((prev) => ({ ...prev, ...(patch || {}) }))}
        />
      ) : null}
    </div>
  );
};

export default Ticket;
