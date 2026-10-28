import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("remove expired private memory and provenance", { hours: 1 }, internal.memory.removeExpired, {});
export default crons;
