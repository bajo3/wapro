import express from "express";
import isAuth from "../middleware/isAuth";

import * as TicketController from "../controllers/TicketController";
import * as TicketNotesController from "../controllers/TicketNotesController";
import * as TicketTagsController from "../controllers/TicketTagsController";

const ticketRoutes = express.Router();

// Small/fast endpoint used by the new Tickets UI to render counters.
ticketRoutes.get("/tickets/counts", isAuth, TicketController.counts);

ticketRoutes.get("/tickets", isAuth, TicketController.index);

ticketRoutes.get("/tickets/:ticketId", isAuth, TicketController.show);

ticketRoutes.post("/tickets", isAuth, TicketController.store);

ticketRoutes.put("/tickets/:ticketId", isAuth, TicketController.update);

// Bot/Operator handoff controls
ticketRoutes.put(
  "/tickets/:ticketId/bot-mode",
  isAuth,
  TicketController.updateBotMode
);

// Seller feedback for the agent suggestions
ticketRoutes.post(
  "/tickets/:ticketId/agent-feedback",
  isAuth,
  TicketController.createAgentFeedback
);


// Agent feedback management
ticketRoutes.get(
  "/agent-feedbacks/stats",
  isAuth,
  TicketController.agentFeedbackStats
);

ticketRoutes.get(
  "/agent-feedbacks",
  isAuth,
  TicketController.listAgentFeedback
);

ticketRoutes.get(
  "/agent-feedbacks/:feedbackId",
  isAuth,
  TicketController.getAgentFeedbackDetail
);

ticketRoutes.post(
  "/agent-feedbacks/:feedbackId/export-example",
  isAuth,
  TicketController.exportAgentFeedbackToExample
);

ticketRoutes.post(
  "/agent-feedbacks/:feedbackId/export-test-case",
  isAuth,
  TicketController.exportAgentFeedbackToTestCase
);

// Internal notes (not sent to the customer)
ticketRoutes.get(
  "/tickets/:ticketId/notes",
  isAuth,
  TicketNotesController.index
);
ticketRoutes.post(
  "/tickets/:ticketId/notes",
  isAuth,
  TicketNotesController.store
);
ticketRoutes.delete(
  "/tickets/:ticketId/notes/:noteId",
  isAuth,
  TicketNotesController.remove
);

// Ticket tags
ticketRoutes.get(
  "/tickets/:ticketId/tags",
  isAuth,
  TicketTagsController.index
);
ticketRoutes.put(
  "/tickets/:ticketId/tags",
  isAuth,
  TicketTagsController.update
);

ticketRoutes.delete("/tickets/:ticketId/conversation", isAuth, TicketController.clearConversation);

ticketRoutes.delete("/tickets/:ticketId", isAuth, TicketController.remove);

export default ticketRoutes;
