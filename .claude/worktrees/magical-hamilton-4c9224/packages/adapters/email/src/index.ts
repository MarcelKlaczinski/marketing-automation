export { sendEmail, sendMagicLinkEmail, PLATFORM_PROJECT_ID } from "./client.ts";
export {
  type SendEmailInput,
  type SendEmailResult,
  type SendMagicLinkInput,
  EmailError,
} from "./types.ts";

import { sendEmail as _sendEmail, sendMagicLinkEmail as _sendMagicLinkEmail } from "./client.ts";
export const email = {
  sendEmail: _sendEmail,
  sendMagicLinkEmail: _sendMagicLinkEmail,
};
