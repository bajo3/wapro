import React from "react";

import { Card, Button } from "@material-ui/core";
import TicketHeaderSkeleton from "../TicketHeaderSkeleton";
import ArrowBackIos from "@material-ui/icons/ArrowBackIos";
import { useHistory } from "react-router-dom";

const TicketHeader = ({ loading, children }) => {
  const history = useHistory();
  const handleBack = () => {
    history.push("/tickets");
  };

  return (
    <>
      {loading ? (
        <TicketHeaderSkeleton />
      ) : (
        <Card
          square
          className="flex flex-none border-b border-ticket-border bg-ticket-surface sm:flex-wrap"
        >
          <Button color="primary" onClick={handleBack} className="mr-ticket-sm">
            <ArrowBackIos />
          </Button>
          {children}
        </Card>
      )}
    </>
  );
};

export default TicketHeader;
