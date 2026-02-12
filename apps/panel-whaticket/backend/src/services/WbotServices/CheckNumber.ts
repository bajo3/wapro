import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";
import AppError from "../../errors/AppError";

/**
 * Validate a WhatsApp number via the underlying wbot session.  When the
 * WhatsApp session is not yet initialized this function falls back to
 * returning the raw number so that contacts can still be created or
 * updated.  Without this guard the call to `getWbot()` will throw
 * `ERR_WAPP_NOT_INITIALIZED` which propagates as a 400 response and
 * prevents contact management from working when WhatsApp is offline.
 *
 * @param number Raw numeric string for a contact
 * @returns A sanitized WhatsApp user ID (string) or the raw number when
 *          the session is unavailable
 */
const CheckContactNumber = async (number: string): Promise<string> => {
  try {
    const defaultWhatsapp = await GetDefaultWhatsApp();
    const wbot = getWbot(defaultWhatsapp.id);
    const validNumber: any = await wbot.getNumberId(`${number}@c.us`);
    return validNumber.user;
  } catch (err: any) {
    // If WhatsApp isn't ready yet, skip validation and just return the
    // original number.  This prevents ERR_WAPP_NOT_INITIALIZED from
    // blocking contact creation or update flows.
    if (err instanceof AppError && err.message === "ERR_WAPP_NOT_INITIALIZED") {
      return number;
    }
    throw err;
  }
};

export default CheckContactNumber;