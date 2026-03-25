import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode.react";
import openSocket from "../../services/socket-io";
import toastError from "../../errors/toastError";

import {
	Dialog,
	DialogContent,
	Paper,
	Typography,
	makeStyles,
} from "@material-ui/core";
import { i18n } from "../../translate/i18n";
import api from "../../services/api";

const useStyles = makeStyles(theme => ({
	dialogPaper: {
		width: "min(92vw, 420px)",
		maxWidth: 420,
		margin: theme.spacing(2),
		borderRadius: 18,
		overflow: "visible",
	},
	content: {
		padding: theme.spacing(2.5),
		overflow: "visible",
	},
	container: {
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		gap: theme.spacing(2),
		padding: theme.spacing(1),
		minWidth: 0,
	},
	message: {
		textAlign: "center",
		fontWeight: 600,
	},
	qrShell: {
		width: "min(78vw, 320px)",
		height: "min(78vw, 320px)",
		maxWidth: 320,
		maxHeight: 320,
		minWidth: 220,
		minHeight: 220,
		padding: theme.spacing(1.5),
		borderRadius: 16,
		background: theme.palette.common.white,
		boxSizing: "border-box",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		overflow: "visible",
		"& svg, & canvas": {
			display: "block",
			width: "100% !important",
			height: "100% !important",
			maxWidth: "100%",
			maxHeight: "100%",
		},
	},
	placeholder: {
		textAlign: "center",
		opacity: 0.8,
	},
}));

const QrcodeModal = ({ open, onClose, whatsAppId }) => {
	const classes = useStyles();
	const [qrCode, setQrCode] = useState("");

	useEffect(() => {
		const fetchSession = async () => {
			if (!whatsAppId || !open) return;

			try {
				const { data } = await api.get(`/whatsapp/${whatsAppId}`);
				setQrCode(data.qrcode || "");
			} catch (err) {
				toastError(err);
			}
		};
		fetchSession();
	}, [whatsAppId, open]);

	useEffect(() => {
		if (!whatsAppId || !open) return;
		const socket = openSocket();

		socket.on("whatsappSession", data => {
			if (data.action === "update" && data.session.id === whatsAppId) {
				setQrCode(data.session.qrcode || "");
			}

			if (data.action === "update" && data.session.id === whatsAppId && data.session.qrcode === "") {
				onClose();
			}
		});

		return () => {
			socket.off("whatsappSession");
		};
	}, [whatsAppId, onClose, open]);

	const qrSize = useMemo(() => 288, []);

	return (
		<Dialog
			open={open}
			onClose={onClose}
			maxWidth="sm"
			fullWidth={false}
			scroll="body"
			PaperProps={{ className: classes.dialogPaper }}
		>
			<DialogContent className={classes.content}>
				<Paper elevation={0} className={classes.container}>
					<Typography color="primary" gutterBottom className={classes.message}>
						{i18n.t("qrCode.message")}
					</Typography>
					<div className={classes.qrShell}>
						{qrCode ? (
							<QRCode
								value={qrCode}
								size={qrSize}
								renderAs="svg"
								includeMargin
								level="M"
							/>
						) : (
							<Typography variant="body2" className={classes.placeholder}>
								Waiting for QR Code
							</Typography>
						)}
					</div>
				</Paper>
			</DialogContent>
		</Dialog>
	);
};

export default React.memo(QrcodeModal);
