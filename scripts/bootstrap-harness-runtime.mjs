import path from "node:path";
import { bootstrapHarnessRuntime } from "./harness-runtime-utils.mjs";

/**
 * Install the bundled DeepSeek Harness runtime from scratch into
 * vendor/HarnessRuntimeManaged (or GOBUDDY_HARNESS_RUNTIME_BUILD).
 *
 * Use this on machines that have no pre-existing GoBuddy install to copy a
 * runtime from — e.g. a fresh macOS machine or a CI runner. The runtime is
 * fully installed via npm, so the resulting vendor tree carries the native
 * prebuilds for the current platform (darwin-x64 on an Intel Mac, etc.).
 *
 * Usage: node scripts/bootstrap-harness-runtime.mjs
 */
const vendorRoot = path.join(process.cwd(), "vendor");
const target = process.env.GOBUDDY_HARNESS_RUNTIME_BUILD
  || path.join(vendorRoot, "HarnessRuntimeManaged");

bootstrapHarnessRuntime(target);
