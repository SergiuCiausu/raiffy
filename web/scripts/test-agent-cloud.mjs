import assert from 'node:assert/strict';
import { createClerkClient } from '@clerk/backend';
import { chromium } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { mkdir, writeFile } from 'node:fs/promises';

// Explicit live-test opt-in: uses the configured dev model keys, never mocks or anonymous auth.
assert.equal(process.env.RAIFFY_LIVE_AGENT_TEST, '1', 'Set RAIFFY_LIVE_AGENT_TEST=1 for this paid cloud test');
process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
assert.ok(url?.startsWith('https://') && process.env.CLERK_SECRET_KEY?.startsWith('sk_test_'), 'Development configuration is required');
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const syntheticEmail = 'raiffy.integration+clerk_test@example.com';
const users = await clerk.users.getUserList({ emailAddress: [syntheticEmail] });
const user = users.data[0] ?? await clerk.users.createUser({ emailAddress: [syntheticEmail], firstName: 'Agent', lastName: 'Test', skipPasswordRequirement: true });
const ticket = await clerk.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const results = [];
const base = process.env.RAIFFY_WEB_TEST_URL ?? 'http://localhost:3004';
const api = new ConvexHttpClient(url);
const listThreads = makeFunctionReference('agent:listThreads');
const listMessages = makeFunctionReference('agent:listMessages');
try {
 await page.goto(`${base}/sign-in`);
 await page.waitForFunction(() => window.Clerk?.loaded, { timeout: 30000 });
 await page.evaluate(async token => {
   const result = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket: token });
   await window.Clerk.setActive({ session: result.createdSessionId });
 }, ticket.token);
 await page.goto(`${base}/chat`);
 await page.locator('#input').waitFor({ timeout: 30000 });
 const jwt = await page.evaluate(() => window.Clerk.session.getToken({ template: 'convex' }));
 assert.ok(jwt, 'Clerk must issue a real Convex JWT');
 api.setAuth(jwt);
 const questions = [
   { text: 'What documents do I need for a Raiffeisen personal loan?', handler: 'answer', sourced: true },
   { text: 'For my personal loan, do I also need to provide proof of income?', handler: 'answer', sourced: true },
   { text: 'Compare the documents needed for a Raiffeisen Flexicredit personal loan and a BCR George personal loan.', handler: 'orchestrator', sourced: true, comparison: true },
   { text: 'A scammer has stolen my card details and is asking me for a security code. What should I do?', handler: 'fraud', sourced: false },
 ];
 for (const q of questions) {
   const start = Date.now();
   const previous = await page.locator('#thread .msg-raiffy').count();
   await page.locator('#input').fill(q.text);
   await page.locator('#input').press('Enter');
   await page.waitForFunction(n => document.querySelectorAll('#thread .msg-raiffy').length > n, previous);
   await page.locator('#thread .msg-raiffy').last().getByRole('button', { name: 'Copy answer' }).waitFor({ timeout: 120000 });
   // Only verified text is revealed, with citations settling after the word animation.
   await page.locator('#thread .msg-raiffy').last().locator('.caret').waitFor({ state: 'detached', timeout: 15000 });
   api.setAuth(await page.evaluate(() => window.Clerk.session.getToken({ template: 'convex' })));
   const threads = await api.query(listThreads, {});
   const messages = await api.query(listMessages, { threadId: threads[0]._id });
   const last = messages.at(-1);
   assert.equal(last.status, 'done');
   assert.equal(last.answer.routing.classifierModel, 'jev-1.14.0');
   assert.equal(last.answer.routing.handler, q.handler);
   if (q.sourced) {
     assert.equal(last.answer.status, 'answered');
     assert.ok(last.answer.sources.length > 0, 'Answer must carry actual source citations');
     assert.equal(last.answer.verification.checks.ungroundedNumbers.length, 0);
     if (q.comparison) {
       assert.ok(last.answer.sources.some(s => s.url.includes('raiffeisen.ro')));
       assert.ok(last.answer.sources.some(s => s.url.includes('bcr.ro')));
     }
   } else {
     assert.equal(last.answer.model, 'deterministic');
     assert.equal(last.answer.ui.flags.suppressOffers, true);
   }
   results.push({ question: q.text, handler: last.answer.routing.handler, confidence: last.answer.routing.confidence,
     model: last.answer.model, sources: last.answer.sources.map(s => s.url), elapsedMs: Date.now() - start });
   await writeFile('../.convex/acceptance/cloud-chat-results.json', JSON.stringify({ results, complete: false }, null, 2));
 }
 await page.reload();
 await page.locator('#input').waitFor({ timeout: 30000 });
 await page.locator('#conv-list .conv').first().click();
 await page.locator('#thread .msg-user').nth(3).waitFor({ timeout: 15000 });
 assert.equal(await page.locator('#thread .msg-user').count(), 4, 'History must persist after reload');
 const anonymous = new ConvexHttpClient(url);
 await assert.rejects(() => anonymous.query(listThreads, {}), /authentication_required/);
 await page.setViewportSize({ width: 390, height: 844 });
 await page.waitForFunction(() => getComputedStyle(document.querySelector('#side')).visibility === 'hidden' && getComputedStyle(document.querySelector('#ctx')).visibility === 'hidden');
 await page.locator('#scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
 await page.screenshot({ path: '../.convex/acceptance/cloud-chat-mobile.png', fullPage: true });
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Mobile must not overflow');
 await page.setViewportSize({ width: 1360, height: 900 });
 await page.screenshot({ path: '../.convex/acceptance/cloud-chat-desktop.png', fullPage: true });
 assert.deepEqual(errors, [], 'No browser runtime errors');
 await mkdir('../.convex/acceptance', { recursive: true });
 await writeFile('../.convex/acceptance/cloud-chat-results.json', JSON.stringify({ results, persistence: true, anonymousDenied: true, browserErrors: errors }, null, 2));
 console.log(JSON.stringify({ passed: results.length, persistence: true, anonymousDenied: true, results }, null, 2));
} catch (e) {
 await page.screenshot({ path: '../.convex/acceptance/cloud-chat-failure.png', fullPage: true });
 console.error('Cloud UI test failed:', e.message?.slice(0, 1200));
 process.exitCode = 1;
} finally { await browser.close(); }
