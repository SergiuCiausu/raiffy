/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as adminViews from "../adminViews.js";
import type * as advice from "../advice.js";
import type * as agent from "../agent.js";
import type * as agentAuth from "../agentAuth.js";
import type * as analytics from "../analytics.js";
import type * as audit from "../audit.js";
import type * as bookings from "../bookings.js";
import type * as calculator from "../calculator.js";
import type * as catalog from "../catalog.js";
import type * as catalogQuery from "../catalogQuery.js";
import type * as compare from "../compare.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as embeddings from "../embeddings.js";
import type * as fallbackModel from "../fallbackModel.js";
import type * as handoff from "../handoff.js";
import type * as jev from "../jev.js";
import type * as jevTransport from "../jevTransport.js";
import type * as knowledge from "../knowledge.js";
import type * as memory from "../memory.js";
import type * as memoryAuth from "../memoryAuth.js";
import type * as memoryDemo from "../memoryDemo.js";
import type * as memoryValidators from "../memoryValidators.js";
import type * as openai from "../openai.js";
import type * as plans from "../plans.js";
import type * as pricing from "../pricing.js";
import type * as rag from "../rag.js";
import type * as regulatoryLimits from "../regulatoryLimits.js";
import type * as retrievalEval from "../retrievalEval.js";
import type * as roles from "../roles.js";
import type * as seed_demoPersonas from "../seed/demoPersonas.js";
import type * as seed_pricing from "../seed/pricing.js";
import type * as sentiment from "../sentiment.js";
import type * as trace from "../trace.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  adminViews: typeof adminViews;
  advice: typeof advice;
  agent: typeof agent;
  agentAuth: typeof agentAuth;
  analytics: typeof analytics;
  audit: typeof audit;
  bookings: typeof bookings;
  calculator: typeof calculator;
  catalog: typeof catalog;
  catalogQuery: typeof catalogQuery;
  compare: typeof compare;
  conversations: typeof conversations;
  crons: typeof crons;
  embeddings: typeof embeddings;
  fallbackModel: typeof fallbackModel;
  handoff: typeof handoff;
  jev: typeof jev;
  jevTransport: typeof jevTransport;
  knowledge: typeof knowledge;
  memory: typeof memory;
  memoryAuth: typeof memoryAuth;
  memoryDemo: typeof memoryDemo;
  memoryValidators: typeof memoryValidators;
  openai: typeof openai;
  plans: typeof plans;
  pricing: typeof pricing;
  rag: typeof rag;
  regulatoryLimits: typeof regulatoryLimits;
  retrievalEval: typeof retrievalEval;
  roles: typeof roles;
  "seed/demoPersonas": typeof seed_demoPersonas;
  "seed/pricing": typeof seed_pricing;
  sentiment: typeof sentiment;
  trace: typeof trace;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
