import { defineApp } from "convex/server";
import resend from "@convex-dev/resend/convex.config.js";

/** Components: Resend queues and retries the answer-check e-mails (convex/answerCheckEmails.ts). */
const app = defineApp();
app.use(resend);
export default app;
