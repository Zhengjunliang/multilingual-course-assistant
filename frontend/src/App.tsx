import { Navigate, Route, Routes } from "react-router-dom";

import { RequireSession } from "@/auth/RequireSession";
import ChatPage from "@/routes/ChatPage";
import LoginPage from "@/routes/LoginPage";
import RegisterPage from "@/routes/RegisterPage";
import StyleguidePage from "@/routes/StyleguidePage";

/**
 * Five routes, two of which are the same page.
 *
 * `/` and `/c/:conversationId` both render the chat because a new conversation
 * and a stored one differ only in whether the thread starts empty — the page
 * itself, the composer and the sidebar are one thing, and splitting them would
 * be two components to keep identical.
 *
 * `/styleguide` sits outside `RequireSession` with the two public routes: it
 * renders the component layer against no data at all, so a session would gate
 * nothing and its test would have to forge one.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/styleguide" element={<StyleguidePage />} />
      <Route
        path="/"
        element={
          <RequireSession>
            <ChatPage />
          </RequireSession>
        }
      />
      <Route
        path="/c/:conversationId"
        element={
          <RequireSession>
            <ChatPage />
          </RequireSession>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
