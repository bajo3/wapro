import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { getWbot } from "../../libs/wbot";
import AppError from "../../errors/AppError";

/**
 * Retrieve a WhatsApp profile picture URL.  If the WhatsApp session is
 * unavailable the function falls back to returning an empty string so
 * that contact creation/update does not fail.  Consumers can choose to
 * ignore an empty URL or provide a default avatar in the UI.
 *
 * @param number Numeric string for a contact
 * @returns A URL string or empty string if not available
 */
const GetProfilePicUrl = async (number: string): Promise<string> => {
  try {
    const defaultWhatsapp = await GetDefaultWhatsApp();
    const wbot = getWbot(defaultWhatsapp.id);
    const profilePicUrl = await wbot.getProfilePicUrl(`${number}@c.us`);
    return profilePicUrl;
  } catch (err: any) {
    // If WhatsApp is not initialized, just return empty string.
    if (err instanceof AppError && err.message === "ERR_WAPP_NOT_INITIALIZED") {
      return "";
    }
    // Re-throw other errors so they propagate normally.
    throw err;
  }
};

export default GetProfilePicUrl;