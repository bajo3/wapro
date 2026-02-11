import React, { useContext, useEffect, useRef, useState } from "react";

import MenuItem from "@material-ui/core/MenuItem";
import Menu from "@material-ui/core/Menu";

import { i18n } from "../../translate/i18n";
import api from "../../services/api";
import ConfirmationModal from "../ConfirmationModal";
import TransferTicketModal from "../TransferTicketModal";
import toastError from "../../errors/toastError";
import { Can } from "../Can";
import { AuthContext } from "../../context/Auth/AuthContext";

// This component renders the ticket options menu shown when the user clicks
// the three-dot button on a ticket. It has been extended to provide a more
// comprehensive set of actions similar to modern messaging apps. Users can
// resolve tickets without sending a farewell, return or postpone tickets,
// open the contact drawer, keep the ticket assigned to themselves, turn off
// the bot, transfer tickets and delete tickets. The new actions call the
// appropriate backend APIs to update ticket status or bot mode.
const TicketOptionsMenu = ({
  ticket,
  menuOpen,
  handleClose,
  anchorEl,
  onOpenContact = () => {},
}) => {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [transferTicketModalOpen, setTransferTicketModalOpen] = useState(false);
  const isMounted = useRef(true);
  const { user } = useContext(AuthContext);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleDeleteTicket = async () => {
    try {
      await api.delete(`/tickets/${ticket.id}`);
    } catch (err) {
      toastError(err);
    }
  };

  const handleOpenConfirmationModal = () => {
    setConfirmationOpen(true);
    handleClose();
  };

  const handleOpenTransferModal = () => {
    setTransferTicketModalOpen(true);
    handleClose();
  };

  const handleCloseTransferTicketModal = () => {
    if (isMounted.current) {
      setTransferTicketModalOpen(false);
    }
  };

  // New action handlers for extended menu
  const handleReturnTicket = async () => {
    handleClose();
    try {
      await api.put(`/tickets/${ticket.id}`, { status: "pending", userId: null });
    } catch (err) {
      toastError(err);
    }
  };

  const handleResolveWithoutFarewell = async () => {
    handleClose();
    try {
      await api.put(`/tickets/${ticket.id}`, { status: "closed", userId: user?.id });
    } catch (err) {
      toastError(err);
    }
  };

  const handlePostponeTicket = async () => {
    handleClose();
    try {
      const currentUserId = ticket.userId || user?.id || null;
      await api.put(`/tickets/${ticket.id}`, { status: "pending", userId: currentUserId });
    } catch (err) {
      toastError(err);
    }
  };

  const handleKeepWithMe = async () => {
    handleClose();
    try {
      await api.put(`/tickets/${ticket.id}`, { status: "open", userId: user?.id });
    } catch (err) {
      toastError(err);
    }
  };

  const handleBotOff = async () => {
    handleClose();
    try {
      await api.put(`/tickets/${ticket.id}/bot-mode`, { botMode: "OFF" });
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <>
      <Menu
        id="menu-appbar"
        anchorEl={anchorEl}
        getContentAnchorEl={null}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        keepMounted
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
        open={menuOpen}
        onClose={handleClose}
      >
        <MenuItem onClick={handleResolveWithoutFarewell}>
          {i18n.t("ticketOptionsMenu.resolveWithoutFarewell")}
        </MenuItem>
        <MenuItem onClick={handleReturnTicket}>
          {i18n.t("ticketOptionsMenu.return")}
        </MenuItem>
        <MenuItem onClick={handlePostponeTicket}>
          {i18n.t("ticketOptionsMenu.postpone")}
        </MenuItem>
        <MenuItem onClick={onOpenContact}>
          {i18n.t("ticketOptionsMenu.contactDetails")}
        </MenuItem>
        <MenuItem onClick={handleKeepWithMe}>
          {i18n.t("ticketOptionsMenu.keep")}
        </MenuItem>
        <MenuItem onClick={handleBotOff}>
          {i18n.t("ticketOptionsMenu.turnOffBot")}
        </MenuItem>
        <MenuItem onClick={handleOpenTransferModal}>
          {i18n.t("ticketOptionsMenu.transfer")}
        </MenuItem>
        <Can
          role={user.profile}
          perform="ticket-options:deleteTicket"
          yes={() => (
            <MenuItem onClick={handleOpenConfirmationModal}>
              {i18n.t("ticketOptionsMenu.delete")}
            </MenuItem>
          )}
        />
      </Menu>
      <ConfirmationModal
        title={`${i18n.t("ticketOptionsMenu.confirmationModal.title")}${ticket.id} ${i18n.t(
          "ticketOptionsMenu.confirmationModal.titleFrom"
        )} ${ticket.contact.name}?`}
        open={confirmationOpen}
        onClose={setConfirmationOpen}
        onConfirm={handleDeleteTicket}
      >
        {i18n.t("ticketOptionsMenu.confirmationModal.message")}
      </ConfirmationModal>
      <TransferTicketModal
        modalOpen={transferTicketModalOpen}
        onClose={handleCloseTransferTicketModal}
        ticketid={ticket.id}
        ticketWhatsappId={ticket.whatsappId}
      />
    </>
  );
};

export default TicketOptionsMenu;