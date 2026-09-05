import type { Config } from "@react-router/dev/config";

export default {
  // Server-rendered: this is a news portal, so pages must paint without
  // waiting on a JS bundle, and must be indexable and shareable.
  ssr: true,
} satisfies Config;
