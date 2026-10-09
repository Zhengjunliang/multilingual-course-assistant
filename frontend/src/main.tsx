import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { routes } from "./App";
import { SessionProvider } from "./auth/SessionProvider";
import { AppCrash } from "./components/AppCrash";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./i18n";
import "./index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html must carry a #root element");

const router = createBrowserRouter(routes);

// Theme outermost: it paints before anything asks the server a question, so a
// slow `GET /api/auth/me` is a blank page in the right colours rather than a
// white flash. The session sits outside the router: it reads no route, and
// every route reads it. `AppCrash` is outermost of all: the routes catch
// their own errors, so it draws only when a provider throws.
createRoot(container).render(
  <StrictMode>
    <AppCrash>
      <ThemeProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </ThemeProvider>
    </AppCrash>
  </StrictMode>,
);
