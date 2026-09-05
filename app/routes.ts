import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),
  route("raw", "routes/raw.tsx"),
  route("census", "routes/census.tsx"),
  route("s/:section", "routes/section.tsx"),
  route("sections", "routes/sections.tsx"),
  route("live", "routes/live.tsx"),
  route("story/:id", "routes/story.tsx"),
  route("api/frontpage.json", "routes/api.frontpage.ts"),
  route("websub", "routes/websub.ts"),
] satisfies RouteConfig;
