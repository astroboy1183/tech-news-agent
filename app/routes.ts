import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),
  route("raw", "routes/raw.tsx"),
  route("census", "routes/census.tsx"),
  route("websub", "routes/websub.ts"),
] satisfies RouteConfig;
