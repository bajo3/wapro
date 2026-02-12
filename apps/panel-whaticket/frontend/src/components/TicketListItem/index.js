import React, { useState, useEffect, useRef, useContext } from "react";

import { useHistory, useParams } from "react-router-dom";
import { parseISO, format, isSameDay } from "date-fns";
import clsx from "clsx";

import { green } from "@material-ui/core/colors";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import ListItemAvatar from "@material-ui/core/ListItemAvatar";
import Typography from "@material-ui/core/Typography";
import Avatar from "@material-ui/core/Avatar";
import Divider from "@material-ui/core/Divider";
import Badge from "@material-ui/core/Badge";

import { i18n } from "../../translate/i18n";

import api from "../../services/api";
import ButtonWithSpinner from "../ButtonWithSpinner";
import MarkdownWrapper from "../MarkdownWrapper";
import { Tooltip } from "@material-ui/core";
import { AuthContext } from "../../context/Auth/AuthContext";
import toastError from "../../errors/toastError";

const TicketListItem = ({ ticket }) => {
  const history = useHistory();
  const [loading, setLoading] = useState(false);
  const { ticketId } = useParams();
  const isMounted = useRef(true);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleAcepptTicket = async (id) => {
    setLoading(true);
    history.push(`/tickets/${id}`);
    try {
      await api.put(`/tickets/${id}`, {
        status: "open",
        userId: user?.id,
      });
    } catch (err) {
      toastError(err);
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  const handleSelectTicket = (id) => {
    history.push(`/tickets/${id}`);
  };

  return (
    <React.Fragment key={ticket.id}>
      <ListItem
        button
        onClick={(e) => {
          if (ticket.status === "pending") return;
          handleSelectTicket(ticket.id);
        }}
        selected={ticketId && +ticketId === ticket.id}
        className={clsx("relative py-ticket-sm", {
          "cursor-default": ticket.status === "pending",
        })}
      >
        <Tooltip arrow placement="right" title={ticket.queue?.name || "Sem fila"}>
          <span
            style={{ backgroundColor: ticket.queue?.color || "#7C7C7C" }}
            className="absolute left-0 top-0 h-full w-2"
          ></span>
        </Tooltip>
        <ListItemAvatar>
          <Avatar src={ticket?.contact?.profilePicUrl} />
        </ListItemAvatar>
        <ListItemText
          disableTypography
          primary={
            <span className="flex justify-between">
              <Typography noWrap component="span" variant="body2" color="textPrimary">
                {ticket.contact.name}
              </Typography>

              {ticket?.contact?.leadSource && (
                <div
                  className="absolute bottom-[5px] right-[5px] rounded-full border border-[#CCC] bg-ticket-accent px-1.5 py-[1px] text-[0.9em] text-white"
                  title="Lead source"
                >
                  {String(ticket.contact.leadSource).toUpperCase()}
                </div>
              )}

              {String(ticket?.botMode || "ON").toUpperCase() === "HUMAN_ONLY" && (
                <div
                  className="absolute bottom-[5px] right-[5px] rounded-full border border-[#CCC] bg-ticket-accent px-1.5 py-[1px] text-[0.9em] text-white"
                  title="Derivado a humano"
                >
                  HUMANO
                </div>
              )}
              {ticket.status === "closed" && (
                <Badge className="ml-auto mr-8 self-center" badgeContent={"closed"} color="primary" />
              )}
              {ticket.lastMessage && (
                <Typography
                  className="justify-self-end text-ticket-muted"
                  component="span"
                  variant="body2"
                  color="textSecondary"
                >
                  {isSameDay(parseISO(ticket.updatedAt), new Date()) ? (
                    <>{format(parseISO(ticket.updatedAt), "HH:mm")}</>
                  ) : (
                    <>{format(parseISO(ticket.updatedAt), "dd/MM/yyyy")}</>
                  )}
                </Typography>
              )}
              {ticket.whatsappId && (
                <div
                  className="absolute bottom-[5px] right-[5px] rounded-full border border-[#CCC] bg-ticket-accent px-1.5 py-[1px] text-[0.9em] text-white"
                  title={i18n.t("ticketsList.connectionTitle")}
                >
                  {ticket.whatsapp?.name}
                </div>
              )}
            </span>
          }
          secondary={
            <span className="flex justify-between">
              <Typography
                className="pr-5"
                noWrap
                component="span"
                variant="body2"
                color="textSecondary"
              >
                {ticket.lastMessage ? <MarkdownWrapper>{ticket.lastMessage}</MarkdownWrapper> : <br />}
              </Typography>

              <Badge
                className="ml-auto mr-2 self-center"
                badgeContent={ticket.unreadMessages}
                classes={{
                  badge: "text-white",
                }}
                style={{ color: "white", backgroundColor: green[500] }}
              />
            </span>
          }
        />
        {ticket.status === "pending" && (
          <ButtonWithSpinner
            color="primary"
            variant="contained"
            className="absolute left-1/2"
            size="small"
            loading={loading}
            onClick={(e) => handleAcepptTicket(ticket.id)}
          >
            {i18n.t("ticketsList.buttons.accept")}
          </ButtonWithSpinner>
        )}
      </ListItem>
      <Divider variant="inset" component="li" />
    </React.Fragment>
  );
};

export default TicketListItem;
