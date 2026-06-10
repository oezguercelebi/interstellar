/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents_codegen from "../agents/codegen.js";
import type * as agents_designSystem from "../agents/designSystem.js";
import type * as agents_prompt from "../agents/prompt.js";
import type * as agents_starterKit from "../agents/starterKit.js";
import type * as codegen from "../codegen.js";
import type * as codegenWorkflow from "../codegenWorkflow.js";
import type * as files from "../files.js";
import type * as lib___fixtures___minimalExpoApp from "../lib/__fixtures__/minimalExpoApp.js";
import type * as lib_sandbox_daytona from "../lib/sandbox/daytona.js";
import type * as lib_sandbox_index from "../lib/sandbox/index.js";
import type * as lib_sandbox_typecheckRepair from "../lib/sandbox/typecheckRepair.js";
import type * as lib_sandbox_types from "../lib/sandbox/types.js";
import type * as lib_styles from "../lib/styles.js";
import type * as lib_validate from "../lib/validate.js";
import type * as lib_webcompat from "../lib/webcompat.js";
import type * as preview from "../preview.js";
import type * as projects from "../projects.js";
import type * as studio from "../studio.js";
import type * as testHelpers from "../testHelpers.js";
import type * as versions from "../versions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agents/codegen": typeof agents_codegen;
  "agents/designSystem": typeof agents_designSystem;
  "agents/prompt": typeof agents_prompt;
  "agents/starterKit": typeof agents_starterKit;
  codegen: typeof codegen;
  codegenWorkflow: typeof codegenWorkflow;
  files: typeof files;
  "lib/__fixtures__/minimalExpoApp": typeof lib___fixtures___minimalExpoApp;
  "lib/sandbox/daytona": typeof lib_sandbox_daytona;
  "lib/sandbox/index": typeof lib_sandbox_index;
  "lib/sandbox/typecheckRepair": typeof lib_sandbox_typecheckRepair;
  "lib/sandbox/types": typeof lib_sandbox_types;
  "lib/styles": typeof lib_styles;
  "lib/validate": typeof lib_validate;
  "lib/webcompat": typeof lib_webcompat;
  preview: typeof preview;
  projects: typeof projects;
  studio: typeof studio;
  testHelpers: typeof testHelpers;
  versions: typeof versions;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
};
