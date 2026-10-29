import { redirect } from "next/navigation";

/* The console's home: the review queue, which checks the role itself. */
export default function ConsoleHome() { redirect("/console/reviews"); }
