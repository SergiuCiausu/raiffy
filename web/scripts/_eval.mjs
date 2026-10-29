import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
const [file, expr] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" })).newPage();
const [f, h] = file.split("#"); await p.goto(pathToFileURL(f).href + (h ? "#" + h : "")); await p.waitForTimeout(1500);
console.log(await p.evaluate(expr));
await b.close();
