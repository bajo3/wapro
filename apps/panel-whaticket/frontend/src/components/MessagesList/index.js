import React, { useState, useEffect, useReducer, useRef } from "react";

import { isSameDay, parseISO, format } from "date-fns";
import openSocket from "../../services/socket-io";
import clsx from "clsx";

import { green } from "@material-ui/core/colors";
import {
  Button,
  CircularProgress,
  Divider,
  IconButton,
  makeStyles,
} from "@material-ui/core";
import {
  AccessTime,
  Block,
  Done,
  DoneAll,
  ExpandMore,
  GetApp,
} from "@material-ui/icons";

import MarkdownWrapper from "../MarkdownWrapper";
import VcardPreview from "../VcardPreview";
import LocationPreview from "../LocationPreview";
import ModalImageCors from "../ModalImageCors";
import MessageOptionsMenu from "../MessageOptionsMenu";
import whatsBackground from "../../assets/wa-background.png";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import Audio from "../Audio";

const useStyles = makeStyles((theme) => ({
  messagesListWrapper: {
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    height: "100%",
    background: "#0d111a",
  },

  messagesList: {
    backgroundImage: `linear-gradient(rgba(5, 8, 15, 0.72), rgba(5, 8, 15, 0.72)), url(${whatsBackground})`,
    backgroundColor: "#0d111a",
    backgroundPosition: "center",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
    padding: "18px 18px 24px",
    overflowY: "auto",
    scrollBehavior: "smooth",
    [theme.breakpoints.down("sm")]: {
      padding: "14px 12px 90px",
    },
    ...theme.scrollbarStyles,
  },

  circleLoading: {
    color: green[500],
    position: "absolute",
    opacity: "70%",
    top: 0,
    left: "50%",
    marginTop: 12,
    transform: "translateX(-50%)",
  },

  // ── Mensaje del cliente (izquierda, gris azulado) ───────────────────────
  messageLeft: {
    marginRight: "auto",
    marginTop: 4,
    minWidth: 120,
    maxWidth: "min(72%, 680px)",
    height: "auto",
    display: "block",
    position: "relative",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    "&:hover #messageActionsButton": {
      display: "flex",
      position: "absolute",
      top: 2,
      right: 2,
    },
    whiteSpace: "pre-wrap",
    backgroundColor: "#1e2840",
    color: "#dde4f0",
    alignSelf: "flex-start",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.40)",
    overflow: "hidden",
  },

  quotedContainerLeft: {
    margin: "0 0 8px",
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 10,
    display: "flex",
    position: "relative",
  },

  quotedMsg: {
    padding: 10,
    maxWidth: 320,
    height: "auto",
    display: "block",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    fontSize: 12,
    lineHeight: 1.45,
    color: "rgba(255, 255, 255, 0.75)",
  },

  quotedSideColorLeft: {
    flex: "none",
    width: 3,
    backgroundColor: "#6bcbef",
  },

  // ── Mensaje propio / operador (derecha, azul/teal) ─────────────────────
  messageRight: {
    marginLeft: "auto",
    marginTop: 4,
    minWidth: 120,
    maxWidth: "min(72%, 680px)",
    height: "auto",
    display: "block",
    position: "relative",
    border: "1px solid rgba(52, 211, 153, 0.18)",
    "&:hover #messageActionsButton": {
      display: "flex",
      position: "absolute",
      top: 2,
      right: 2,
    },
    whiteSpace: "pre-wrap",
    backgroundColor: "#0f3020",
    color: "#d1fae5",
    alignSelf: "flex-end",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 4,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.40)",
    overflow: "hidden",
  },

  quotedContainerRight: {
    margin: "0 0 8px",
    overflowY: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 10,
    display: "flex",
    position: "relative",
  },

  quotedMsgRight: {
    padding: 10,
    maxWidth: 320,
    height: "auto",
    whiteSpace: "pre-wrap",
  },

  quotedSideColorRight: {
    flex: "none",
    width: 3,
    backgroundColor: "#35cd96",
  },

  messageActionsButton: {
    display: "none",
    position: "relative",
    color: "#94a3b8",
    zIndex: 1,
    backgroundColor: "transparent",
    opacity: "90%",
    "&:hover, &.Mui-focusVisible": { backgroundColor: "transparent" },
  },

  messageContactName: {
    display: "flex",
    color: "#34d399",
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 6,
  },

  // ── Badge "Bot" visible y diferenciado ────────────────────────────────
  senderBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.03em",
    backgroundColor: "rgba(139, 92, 246, 0.18)",
    border: "1px solid rgba(139, 92, 246, 0.30)",
    color: "#a78bfa",
    marginBottom: 6,
  },

  textContentItem: {
    overflowWrap: "break-word",
    padding: "10px 12px 28px 12px",
    fontSize: 14,
    lineHeight: 1.55,
    // Explicit fallback color — visible on all dark bubble backgrounds.
    // The bubble class (messageLeft/messageRight/messageBotLeft) sets the
    // definitive color, but if inheritance fails this prevents invisible text.
    color: "#e2e8f0",
  },

  // When a bubble has media but no text body, collapse the text area to just enough
  // height for the absolute-positioned timestamp — avoids the empty colored bar below media.
  textContentItemMediaOnly: {
    padding: "0 12px 22px 12px",
  },

  textContentItemDeleted: {
    fontStyle: "italic",
    color: "rgba(255, 255, 255, 0.45)",
    overflowWrap: "break-word",
    padding: "10px 12px 28px 12px",
    // Links en mensajes eliminados también visibles
    "& a": { color: "rgba(147, 197, 253, 0.6)" },
  },

  messageMedia: {
    objectFit: "cover",
    width: 280,
    maxWidth: "100%",
    height: 220,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },

  // ── Timestamp: al fondo del bubble, legible ────────────────────────────
  timestamp: {
    fontSize: 11,
    position: "absolute",
    bottom: 7,
    right: 9,
    color: "rgba(255, 255, 255, 0.52)",
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    userSelect: "none",
  },

  // ── Separador de día ──────────────────────────────────────────────────
  dailyTimestamp: {
    alignItems: "center",
    textAlign: "center",
    alignSelf: "center",
    width: "auto",
    backgroundColor: "rgba(20, 28, 46, 0.92)",
    margin: "14px auto",
    borderRadius: 999,
    boxShadow: "0 1px 6px rgba(0, 0, 0, 0.45)",
    border: "1px solid rgba(255, 255, 255, 0.09)",
  },

  dailyTimestampText: {
    color: "#94a3b8",
    padding: "5px 14px",
    alignSelf: "center",
    marginLeft: 0,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },

  ackIcons: {
    fontSize: 15,
    verticalAlign: "middle",
    marginLeft: 3,
    opacity: 0.7,
  },

  deletedIcon: {
    fontSize: 15,
    verticalAlign: "middle",
    marginRight: 4,
  },

  ackDoneAllIcon: {
    color: green[500],
    fontSize: 15,
    verticalAlign: "middle",
    marginLeft: 3,
  },

  downloadMedia: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "inherit",
    padding: 12,
  },

  // ── Mensaje del bot: variante izquierda con acento púrpura ────────────
  messageBotLeft: {
    marginRight: "auto",
    marginTop: 4,
    minWidth: 120,
    maxWidth: "min(72%, 680px)",
    height: "auto",
    display: "block",
    position: "relative",
    border: "1px solid rgba(139, 92, 246, 0.22)",
    "&:hover #messageActionsButton": {
      display: "flex",
      position: "absolute",
      top: 2,
      right: 2,
    },
    whiteSpace: "pre-wrap",
    backgroundColor: "#1a1535",
    color: "#e9e4ff",
    alignSelf: "flex-start",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.40)",
    overflow: "hidden",
  },
}));

function sortByCreatedAtAsc(messages) {
  return (messages || []).slice().sort((a, b) => {
    const ta = new Date(a?.createdAt || a?.created_at || 0).getTime();
    const tb = new Date(b?.createdAt || b?.created_at || 0).getTime();
    if (ta !== tb) return ta - tb;
    // Tie-breaker: id (Message.id is a string in this project)
    const ia = String(a?.id ?? "");
    const ib = String(b?.id ?? "");
    return ia.localeCompare(ib);
  });
}

const reducer = (state, action) => {
  if (action.type === "LOAD_MESSAGES") {
    const messages = action.payload;
    const newMessages = [];

    messages.forEach((message) => {
      const messageIndex = state.findIndex((m) => m.id === message.id);
      if (messageIndex !== -1) {
        state[messageIndex] = message;
      } else {
        newMessages.push(message);
      }
    });

    // Keep chronological order stable (oldest -> newest). The API order can
    // vary between installs (ASC/DESC) and pagination can prepend/append.
    return sortByCreatedAtAsc([...newMessages, ...state]);
  }

  if (action.type === "ADD_MESSAGE") {
    const newMessage = action.payload;
    const messageIndex = state.findIndex((m) => m.id === newMessage.id);

    if (messageIndex !== -1) {
      state[messageIndex] = newMessage;
    } else {
      state.push(newMessage);
    }

    return sortByCreatedAtAsc([...state]);
  }

  if (action.type === "UPDATE_MESSAGE") {
    const messageToUpdate = action.payload;
    const messageIndex = state.findIndex((m) => m.id === messageToUpdate.id);

    if (messageIndex !== -1) {
      state[messageIndex] = messageToUpdate;
    }

    return sortByCreatedAtAsc([...state]);
  }

  if (action.type === "RESET") {
    return [];
  }
};

const MessagesList = ({ ticketId, isGroup }) => {
  const classes = useStyles();

  const [messagesList, dispatch] = useReducer(reducer, []);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastMessageRef = useRef();

  const [selectedMessage, setSelectedMessage] = useState({});
  const [anchorEl, setAnchorEl] = useState(null);
  const messageOptionsMenuOpen = Boolean(anchorEl);
  const currentTicketId = useRef(ticketId);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);

    currentTicketId.current = ticketId;
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const fetchMessages = async () => {
        try {
          const { data } = await api.get("/messages/" + ticketId, {
            params: { pageNumber },
          });

          if (currentTicketId.current === ticketId) {
            dispatch({ type: "LOAD_MESSAGES", payload: data.messages });
            setHasMore(data.hasMore);
            setLoading(false);
          }

          if (pageNumber === 1 && data.messages.length > 1) {
            scrollToBottom();
          }
        } catch (err) {
          setLoading(false);
          toastError(err);
        }
      };
      fetchMessages();
    }, 500);
    return () => {
      clearTimeout(delayDebounceFn);
    };
  }, [pageNumber, ticketId]);

  useEffect(() => {
    const socket = openSocket();

    // FIX: join immediately (socket may already be connected on mount)
    // AND re-join on every reconnect so we never miss messages.
    socket.emit("joinChatBox", `${ticketId}`);
    socket.on("connect", () => socket.emit("joinChatBox", `${ticketId}`));

    socket.on("appMessage", (data) => {
      if (data.action === "create") {
        dispatch({ type: "ADD_MESSAGE", payload: data.message });
        scrollToBottom();
      }

      if (data.action === "update") {
        dispatch({ type: "UPDATE_MESSAGE", payload: data.message });
      }
    });

    return () => {
      socket.emit("leaveChatBox", `${ticketId}`);
      socket.off("connect");
      socket.off("appMessage");
    };
  }, [ticketId]);

  const loadMore = () => {
    setPageNumber((prevPageNumber) => prevPageNumber + 1);
  };

  const scrollToBottom = () => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  };

  const handleScroll = (e) => {
    if (!hasMore) return;
    const { scrollTop } = e.currentTarget;

    if (scrollTop === 0) {
      document.getElementById("messagesList").scrollTop = 1;
    }

    if (loading) {
      return;
    }

    if (scrollTop < 50) {
      loadMore();
    }
  };

  const handleOpenMessageOptionsMenu = (e, message) => {
    setAnchorEl(e.currentTarget);
    setSelectedMessage(message);
  };

  const handleCloseMessageOptionsMenu = (e) => {
    setAnchorEl(null);
  };

  const checkMessageMedia = (message) => {
    if (message.mediaType === "location" && message.body.split('|').length >= 2) {
      let locationParts = message.body.split('|')
      let imageLocation = locationParts[0]
      let linkLocation = locationParts[1]

      let descriptionLocation = null

      if (locationParts.length > 2)
        descriptionLocation = message.body.split('|')[2]

      return <LocationPreview image={imageLocation} link={linkLocation} description={descriptionLocation} />
    }
    else if (message.mediaType === "vcard") {
      //console.log("vcard")
      //console.log(message)
      let array = message.body.split("\n");
      let obj = [];
      let contact = "";
      for (let index = 0; index < array.length; index++) {
        const v = array[index];
        let values = v.split(":");
        for (let ind = 0; ind < values.length; ind++) {
          if (values[ind].indexOf("+") !== -1) {
            obj.push({ number: values[ind] });
          }
          if (values[ind].indexOf("FN") !== -1) {
            contact = values[ind + 1];
          }
        }
      }
      return <VcardPreview contact={contact} numbers={obj[0]?.number} />
    }
    /*else if (message.mediaType === "multi_vcard") {
      console.log("multi_vcard")
      console.log(message)
    	
      if(message.body !== null && message.body !== "") {
        let newBody = JSON.parse(message.body)
        return (
          <>
            {
            newBody.map(v => (
              <VcardPreview contact={v.name} numbers={v.number} />
            ))
            }
          </>
        )
      } else return (<></>)
    }*/
    else if ( /^.*\.(jpe?g|png|gif)?$/i.exec(message.mediaUrl) && message.mediaType === "image") {
      return <ModalImageCors imageUrl={message.mediaUrl} />;
    } else if (message.mediaType === "audio") {
      return <Audio url={message.mediaUrl} />
    } else if (message.mediaType === "video") {
      return (
        <video
          className={classes.messageMedia}
          src={message.mediaUrl}
          controls
        />
      );
    } else {
      return (
        <>
          <div className={classes.downloadMedia}>
            <Button
              startIcon={<GetApp />}
              color="primary"
              variant="outlined"
              target="_blank"
              href={message.mediaUrl}
            >
              Download
            </Button>
          </div>
          <Divider />
        </>
      );
    }
  };

  const renderMessageAck = (message) => {
    if (message.ack === 0) {
      return <AccessTime fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 1) {
      return <Done fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 2) {
      return <DoneAll fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 3 || message.ack === 4) {
      return <DoneAll fontSize="small" className={classes.ackDoneAllIcon} />;
    }
  };

  const renderDailyTimestamps = (message, index) => {
    if (index === 0) {
      return (
        <span
          className={classes.dailyTimestamp}
          key={`timestamp-${message.id}`}
        >
          <div className={classes.dailyTimestampText}>
            {format(parseISO(messagesList[index].createdAt), "dd/MM/yyyy")}
          </div>
        </span>
      );
    }
    if (index < messagesList.length - 1) {
      let messageDay = parseISO(messagesList[index].createdAt);
      let previousMessageDay = parseISO(messagesList[index - 1].createdAt);

      if (!isSameDay(messageDay, previousMessageDay)) {
        return (
          <span
            className={classes.dailyTimestamp}
            key={`timestamp-${message.id}`}
          >
            <div className={classes.dailyTimestampText}>
              {format(parseISO(messagesList[index].createdAt), "dd/MM/yyyy")}
            </div>
          </span>
        );
      }
    }
    if (index === messagesList.length - 1) {
      return (
        <div
          key={`ref-${message.createdAt}`}
          ref={lastMessageRef}
          style={{ float: "left", clear: "both" }}
        />
      );
    }
  };

  const renderMessageDivider = (message, index) => {
    if (index < messagesList.length && index > 0) {
      let messageUser = messagesList[index].fromMe;
      let previousMessageUser = messagesList[index - 1].fromMe;

      if (messageUser !== previousMessageUser) {
        return (
          <span style={{ marginTop: 16 }} key={`divider-${message.id}`}></span>
        );
      }
    }
  };

  const renderQuotedMessage = (message) => {
    return (
      <div
        className={clsx(classes.quotedContainerLeft, {
          [classes.quotedContainerRight]: message.fromMe,
        })}
      >
        <span
          className={clsx(classes.quotedSideColorLeft, {
            [classes.quotedSideColorRight]: message.quotedMsg?.fromMe,
          })}
        ></span>
        <div className={classes.quotedMsg}>
          {!message.quotedMsg?.fromMe && (
            <span className={classes.messageContactName}>
              {message.quotedMsg?.contact?.name}
            </span>
          )}
          {message.quotedMsg?.body}
        </div>
      </div>
    );
  };

  const renderMessages = () => {
    if (messagesList.length > 0) {
      const viewMessagesList = messagesList.map((message, index) => {
        // Detectar mensaje de bot: fromMe=true y (flag explícito o prefijo de id)
        const isBotMessage =
          !!message.fromMe &&
          (message.fromBot === true ||
            message.agent === true ||
            String(message.id || "").startsWith("bot-"));

        // Si el mensaje tiene media pero sin texto legible en el body, el área de texto
        // solo necesita espacio para el timestamp — evita la barra de color vacía debajo del media.
        const hasReadableBody = Boolean(
          message.body &&
          !message.body.includes("BEGIN:VCARD") &&
          !message.body.includes("data:image/")
        );
        const hasMedia = Boolean(
          message.mediaUrl ||
          message.mediaType === "location" ||
          message.mediaType === "vcard"
        );
        const isMediaOnly = hasMedia && !hasReadableBody && !message.quotedMsg && !message.isDeleted;

        if (!message.fromMe) {
          return (
            <React.Fragment key={message.id}>
              {renderDailyTimestamps(message, index)}
              {renderMessageDivider(message, index)}
              <div className={classes.messageLeft}>
                <IconButton
                  variant="contained"
                  size="small"
                  id="messageActionsButton"
                  disabled={message.isDeleted}
                  className={classes.messageActionsButton}
                  onClick={(e) => handleOpenMessageOptionsMenu(e, message)}
                >
                  <ExpandMore />
                </IconButton>
                {isGroup && (
                  <span className={classes.messageContactName}>
                    {message.contact?.name}
                  </span>
                )}
                {hasMedia && checkMessageMedia(message)}
                <div className={clsx(classes.textContentItem, isMediaOnly && classes.textContentItemMediaOnly)}>
                  {message.quotedMsg && renderQuotedMessage(message)}
                  <MarkdownWrapper>{message.body || ""}</MarkdownWrapper>
                  <span className={classes.timestamp}>
                    {format(parseISO(message.createdAt), "HH:mm")}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        } else {
          // fromMe=true → operador humano o bot
          const bubbleClass = isBotMessage ? classes.messageBotLeft : classes.messageRight;
          return (
            <React.Fragment key={message.id}>
              {renderDailyTimestamps(message, index)}
              {renderMessageDivider(message, index)}
              <div className={bubbleClass}>
                <IconButton
                  variant="contained"
                  size="small"
                  id="messageActionsButton"
                  disabled={message.isDeleted}
                  className={classes.messageActionsButton}
                  onClick={(e) => handleOpenMessageOptionsMenu(e, message)}
                >
                  <ExpandMore />
                </IconButton>
                {hasMedia && checkMessageMedia(message)}
                <div
                  className={clsx(classes.textContentItem, {
                    [classes.textContentItemDeleted]: message.isDeleted,
                    [classes.textContentItemMediaOnly]: isMediaOnly && !isBotMessage,
                  })}
                >
                  {isBotMessage && (
                    <span className={classes.senderBadge}>Bot</span>
                  )}
                  {message.isDeleted && (
                    <Block
                      color="disabled"
                      fontSize="small"
                      className={classes.deletedIcon}
                    />
                  )}
                  {message.quotedMsg && renderQuotedMessage(message)}
                  <MarkdownWrapper>{message.body || ""}</MarkdownWrapper>
                  <span className={classes.timestamp}>
                    {format(parseISO(message.createdAt), "HH:mm")}
                    {renderMessageAck(message)}
                  </span>
                </div>
              </div>
            </React.Fragment>
          );
        }
      });
      return viewMessagesList;
    } else {
      return (
        <div
          ref={lastMessageRef}
          style={{
            textAlign: "center",
            color: "rgba(148, 163, 184, 0.70)",
            padding: "32px 0",
            fontSize: 13,
          }}
        >
          Todavía no hay mensajes en esta conversación.
        </div>
      );
    }
  };

  return (
    <div className={classes.messagesListWrapper}>
      <MessageOptionsMenu
        message={selectedMessage}
        anchorEl={anchorEl}
        menuOpen={messageOptionsMenuOpen}
        handleClose={handleCloseMessageOptionsMenu}
      />
      <div
        id="messagesList"
        className={classes.messagesList}
        onScroll={handleScroll}
      >
        {renderMessages()}
      </div>
      {loading && (
        <div>
          <CircularProgress className={classes.circleLoading} />
        </div>
      )}
    </div>
  );
};

export default MessagesList;