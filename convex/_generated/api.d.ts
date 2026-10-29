/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent from "../agent.js";
import type * as agentAuth from "../agentAuth.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as embeddings from "../embeddings.js";
import type * as handoff from "../handoff.js";
import type * as jev from "../jev.js";
import type * as jevTransport from "../jevTransport.js";
import type * as knowledge from "../knowledge.js";
import type * as memory from "../memory.js";
import type * as memoryAuth from "../memoryAuth.js";
import type * as memoryDemo from "../memoryDemo.js";
import type * as memoryValidators from "../memoryValidators.js";
import type * as openai from "../openai.js";
import type * as rag from "../rag.js";
import type * as regulatoryLimits from "../regulatoryLimits.js";
import type * as retrievalEval from "../retrievalEval.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agent: typeof agent;
  agentAuth: typeof agentAuth;
  conversations: typeof conversations;
  crons: typeof crons;
  embeddings: typeof embeddings;
  handoff: typeof handoff;
  jev: typeof jev;
  jevTransport: typeof jevTransport;
  knowledge: typeof knowledge;
  memory: typeof memory;
  memoryAuth: typeof memoryAuth;
  memoryDemo: typeof memoryDemo;
  memoryValidators: typeof memoryValidators;
  openai: typeof openai;
  rag: typeof rag;
  regulatoryLimits: typeof regulatoryLimits;
  retrievalEval: typeof retrievalEval;
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
