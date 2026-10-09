import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { routes } from "./App";
import { SessionProvider } from "./auth/SessionProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./i18n";
import "./index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html must carry a #root element");

const router = createBrowserRouter(routes);

// Theme outermost: it paints before anything asks the server a question, so a
// slow `GET /api/auth/me` is a blank page in the right colours rather than a
// white flash. The session sits outside the router: it reads no route, and
// every route reads it.
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
