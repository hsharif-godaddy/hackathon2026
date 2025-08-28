
// Files Imports
import * as configure from "@api/configure";
import * as API_000 from "@api/root/src/api/health.ts";
import * as API_001 from "@api/root/src/api/users.ts";

// Public RESTful API Methods and Paths
// This section describes the available HTTP methods and their corresponding endpoints (paths).
// USE    /api/health    src/api/health.ts?fn=default
// USE    /api/health    src/api/health.ts?fn=USE
// GET    /api/health    src/api/health.ts?fn=GET
// POST   /api/health    src/api/health.ts?fn=POST
// PATCH  /api/health    src/api/health.ts?fn=PATCH
// PUT    /api/health    src/api/health.ts?fn=PUT
// DELETE /api/health    src/api/health.ts?fn=DELETE
// USE    /api/users     src/api/users.ts?fn=default
// USE    /api/users     src/api/users.ts?fn=USE
// GET    /api/users     src/api/users.ts?fn=GET
// POST   /api/users     src/api/users.ts?fn=POST
// PATCH  /api/users     src/api/users.ts?fn=PATCH
// PUT    /api/users     src/api/users.ts?fn=PUT
// DELETE /api/users     src/api/users.ts?fn=DELETE

const internal  = [
  API_000.default  && { cb: API_000.default , method: "use"    , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=default" },
  API_000.USE      && { cb: API_000.USE     , method: "use"    , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=USE"     },
  API_000.GET      && { cb: API_000.GET     , method: "get"    , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=GET"     },
  API_000.POST     && { cb: API_000.POST    , method: "post"   , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=POST"    },
  API_000.PATCH    && { cb: API_000.PATCH   , method: "patch"  , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=PATCH"   },
  API_000.PUT      && { cb: API_000.PUT     , method: "put"    , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=PUT"     },
  API_000.DELETE   && { cb: API_000.DELETE  , method: "delete" , route: "/health" , url: "/api/health" , source: "src/api/health.ts?fn=DELETE"  },
  API_001.default  && { cb: API_001.default , method: "use"    , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=default"  },
  API_001.USE      && { cb: API_001.USE     , method: "use"    , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=USE"      },
  API_001.GET      && { cb: API_001.GET     , method: "get"    , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=GET"      },
  API_001.POST     && { cb: API_001.POST    , method: "post"   , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=POST"     },
  API_001.PATCH    && { cb: API_001.PATCH   , method: "patch"  , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=PATCH"    },
  API_001.PUT      && { cb: API_001.PUT     , method: "put"    , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=PUT"      },
  API_001.DELETE   && { cb: API_001.DELETE  , method: "delete" , route: "/users"  , url: "/api/users"  , source: "src/api/users.ts?fn=DELETE"   }
].filter(it => it);

export const routers = internal.map((it) => {
  const { method, route, url, source } = it;
  return { method, url, route, source };
});

export const endpoints = internal.map(
  (it) => it.method?.toUpperCase() + "\t" + it.url
);

export const applyRouters = (applyRouter) => {
  internal.forEach((it) => {
    it.cb = configure.callbackBefore?.(it.cb, it) || it.cb;
    applyRouter(it);
  });
};

