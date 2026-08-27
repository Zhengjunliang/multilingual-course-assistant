import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { SessionProvider } from "./auth/SessionProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./i18n";
import "./index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html must carry a #root element");

// Theme outermost: it paints before anything asks the server a question, so a
// slow `GET /api/auth/me` is a blank page in the right colours rather than a
// white flash.
createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
