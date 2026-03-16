import React from "react";

import { Avatar, CardHeader } from "@material-ui/core";

import { i18n } from "../../translate/i18n";

/**
 * TicketInfo renders the contact name and assigned user for a ticket.
 *
 * We extend the original implementation by optionally displaying the
 * origin of the lead (for example, Instagram or Facebook) when this
 * information is available on the contact.  The lead source can be
 * provided either directly on the contact object via a `leadSource`
 * property or via the contact's extraInfo list with a name matching
 * "lead source" (case‑insensitive).
 */
const TicketInfo = ({ contact, ticket, onClick }) => {
  // Determine the lead source.  Prefer a dedicated property if present.
  const leadSource = contact?.leadSource ||
    (contact?.extraInfo && Array.isArray(contact.extraInfo)
      ? (contact.extraInfo.find(
          info => String(info.name || "").toLowerCase() === "lead source"
        )?.value)
      : null);

  // Build the title.  Show the lead source in parentheses after the
  // contact name and ticket id if available.
  const baseTitle = `${contact.name} #${ticket.id}`;
  const title = leadSource ? `${baseTitle} (${leadSource})` : baseTitle;

  // Build the subheader.  Preserve the assigned user display from
  // the original implementation.
  const subheaderParts = [];
  if (ticket.user) {
    subheaderParts.push(
      `${i18n.t("messagesList.header.assignedTo")} ${ticket.user.name}`
    );
  }
  const subheader = subheaderParts.join(" • ");

  return (
    <CardHeader
      onClick={onClick}
      style={{ cursor: "pointer" }}
      titleTypographyProps={{ noWrap: true }}
      subheaderTypographyProps={{ noWrap: true }}
      avatar={<Avatar src={contact.profilePicUrl} alt="contact_image" />}
      title={title}
      subheader={subheader}
    />
  );
};

export default TicketInfo;