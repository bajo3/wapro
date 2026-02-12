import React from "react";
import { useParams } from "react-router-dom";
import Grid from "@material-ui/core/Grid";
import Paper from "@material-ui/core/Paper";

import TicketsManager from "../../components/TicketsManager/";
import Ticket from "../../components/Ticket/";

import { i18n } from "../../translate/i18n";
import Hidden from "@material-ui/core/Hidden";

const Chat = () => {
  const { ticketId } = useParams();

  return (
    <div className="h-[calc(100%-48px)] flex-1 overflow-y-hidden bg-ticket-surface">
      <div className="flex h-full bg-ticket-panel">
        <Grid container spacing={0}>
          <Grid
            item
            xs={12}
            md={4}
            className={
              ticketId
                ? "hidden h-full flex-col overflow-y-hidden md:flex"
                : "flex h-full flex-col overflow-y-hidden"
            }
          >
            <TicketsManager />
          </Grid>
          <Grid item xs={12} md={8} className="flex h-full flex-col">
            {ticketId ? (
              <>
                <Ticket />
              </>
            ) : (
              <Hidden only={["sm", "xs"]}>
                <Paper className="flex h-full items-center justify-evenly rounded-none bg-ticket-panel text-center">
                  <span>{i18n.t("chat.noTicketMessage")}</span>
                </Paper>
              </Hidden>
            )}
          </Grid>
        </Grid>
      </div>
    </div>
  );
};

export default Chat;
