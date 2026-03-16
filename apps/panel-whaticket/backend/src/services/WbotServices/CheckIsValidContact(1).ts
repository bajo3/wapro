import AppError from "../../errors/AppError";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";

/**
 * Ensure a number is a registered WhatsApp user.  When the underlying
 * WhatsApp session is unavailable (e.g. disconnected or not yet
 * initialized) this check is silently skipped so that contacts can be
 * created or updated without a running WhatsApp instance.  This avoids
 * returning ERR_WAPP_NOT_INITIALIZED back to the client.
 *
 * @param number Numeric string for a contact
 * @throws AppError("ERR_WAPP_INVALID_CONTACT") when the number is not
 *         registered.  Throws AppError("ERR_WAPP_CHECK_CONTACT") on
 *         unexpected errors.
 */
const CheckIsValidContact = async (number: string): Promise<void> => {
  try {
    const defaultWhatsapp = await GetDefaultWhatsApp();
    const wbot = getWbot(defaultWhatsapp.id);
    const isValidNumber = await wbot.isRegisteredUser(`${number}@c.us`);
    if (!isValidNumber) {
      throw new AppError("ERR_WAPP_INVALID_CONTACT");
    }
  } catch (err: any) {
    // Skip validation entirely if the WhatsApp session hasn't been
    // initialized.  This allows contacts to be saved even when the bot
    // isn't connected.
    if (err instanceof AppError && err.message === "ERR_WAPP_NOT_INITIALIZED") {
      return;
    }
    if (err instanceof AppError && err.message === "ERR_WAPP_INVALID_CONTACT") {
      // Re-throw invalid contact errors unchanged to propagate proper HTTP
      // status codes from controllers.
      throw err;
    }
    // For any other error, wrap as a generic WhatsApp check failure.
    throw new AppError("ERR_WAPP_CHECK_CONTACT");
  }
};

export default CheckIsValidContact;