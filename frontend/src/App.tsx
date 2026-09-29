import { Navigate, Route, Routes } from "react-router-dom";

import { RequireSession } from "@/auth/RequireSession";
import { RequireStaff } from "@/auth/RequireStaff";
import { NotFound } from "@/features/staff/NotFound";
import ChatPage from "@/routes/ChatPage";
import EditionPage from "@/routes/EditionPage";
import EditionsPage from "@/routes/EditionsPage";
import LoginPage from "@/routes/LoginPage";
import ProgrammePage from "@/routes/ProgrammePage";
import ProgrammesPage from "@/routes/ProgrammesPage";
import RegisterPage from "@/routes/RegisterPage";
import StaffLayout from "@/routes/StaffLayout";
import StyleguidePage from "@/routes/StyleguidePage";

/**
 * Five routes and the staff area; two of the five are the same page.
 *
 * `/` and `/c/:conversationId` both render the chat because a new conversation
 * and a stored one differ only in whether the thread starts empty — the page
 * itself, the composer and the sidebar are one thing, and splitting them would
 * be two components to keep identical.
 *
 * `/styleguide` sits outside `RequireSession` with the two public routes: it
 * renders the component layer against no data at all, so a session would gate
 * nothing and its test would have to forge one.
 *
 * `/staff/*` is the staff area, in its own layout, open to an account holding
 * a role or the superuser (`RequireStaff`); it opens on the list of editions,
 * and its pages are objects — editions, programmes — not roles.
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
      <Route
        path="/staff"
        element={
          <RequireSession>
            <RequireStaff>
              <StaffLayout />
            </RequireStaff>
          </RequireSession>
        }
      >
        <Route index element={<Navigate to="editions" replace />} />
        <Route path="editions" element={<EditionsPage />} />
        <Route path="editions/:id" element={<EditionPage />} />
        <Route path="programmes" element={<ProgrammesPage />} />
        <Route path="programmes/:code" element={<ProgrammePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
