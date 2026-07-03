/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as audit from "../audit.js";
import type * as auditActions from "../auditActions.js";
import type * as auth from "../auth.js";
import type * as clientIntelligence from "../clientIntelligence.js";
import type * as clients from "../clients.js";
import type * as compliance from "../compliance.js";
import type * as complianceDashboard from "../complianceDashboard.js";
import type * as crons from "../crons.js";
import type * as emailEvents from "../emailEvents.js";
import type * as env from "../env.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as invoices from "../invoices.js";
import type * as jobRuns from "../jobRuns.js";
import type * as nigeria from "../nigeria.js";
import type * as paymentCapabilities from "../paymentCapabilities.js";
import type * as paymentCollection from "../paymentCollection.js";
import type * as payments from "../payments.js";
import type * as productIntelligence from "../productIntelligence.js";
import type * as products from "../products.js";
import type * as recurring from "../recurring.js";
import type * as reminderPolicy from "../reminderPolicy.js";
import type * as reminders from "../reminders.js";
import type * as reports from "../reports.js";
import type * as revenueReporting from "../revenueReporting.js";
import type * as rls from "../rls.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  audit: typeof audit;
  auditActions: typeof auditActions;
  auth: typeof auth;
  clientIntelligence: typeof clientIntelligence;
  clients: typeof clients;
  compliance: typeof compliance;
  complianceDashboard: typeof complianceDashboard;
  crons: typeof crons;
  emailEvents: typeof emailEvents;
  env: typeof env;
  http: typeof http;
  integrations: typeof integrations;
  invoices: typeof invoices;
  jobRuns: typeof jobRuns;
  nigeria: typeof nigeria;
  paymentCapabilities: typeof paymentCapabilities;
  paymentCollection: typeof paymentCollection;
  payments: typeof payments;
  productIntelligence: typeof productIntelligence;
  products: typeof products;
  recurring: typeof recurring;
  reminderPolicy: typeof reminderPolicy;
  reminders: typeof reminders;
  reports: typeof reports;
  revenueReporting: typeof revenueReporting;
  rls: typeof rls;
  workspaces: typeof workspaces;
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

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
