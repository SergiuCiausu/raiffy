/*
 * Whether "Build my plan" may fall back to the figures a simulation cited (lib/plan/cited.ts). Only for the demo:
 * RAIFFY_DEMO_PLANS must be "true" and RAIFFY_DEMO_PLANS_DEPLOYMENT_URL must name this very deployment, as with
 * customer memory, so copying the environment to another deployment doesn't turn it on there.
 */
export type DemoPlansEnvironment = { cloudUrl?: string; enabled?: string; deploymentUrl?: string };

export function demoPlansAllowed(env: DemoPlansEnvironment): boolean {
  return env.enabled === "true" && !!env.cloudUrl && !!env.deploymentUrl && env.cloudUrl.replace(/\/+$/, "") === env.deploymentUrl.replace(/\/+$/, "");
}
