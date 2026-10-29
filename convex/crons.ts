import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("remove expired private memory and provenance", { hours: 1 }, internal.memory.removeExpired, {});
crons.interval("release booked calls not confirmed a day ahead", { minutes: 15 }, internal.bookings.releaseUnconfirmed, {});
crons.interval("remove expired sentiment labels and votes", { hours: 1 }, internal.sentiment.removeExpired, {});
crons.interval("remove expired answer traces", { hours: 1 }, internal.analytics.removeExpired, {});
export default crons;
