import { Route, Routes } from "react-router-dom";

import { RequireSession } from "@/auth/RequireSession";
import { RequireStaff } from "@/auth/RequireStaff";
import ChatPage from "@/routes/ChatPage";
import CoursePage from "@/routes/CoursePage";
import EditionPage from "@/routes/EditionPage";
import LoginPage from "@/routes/LoginPage";
import MinePage from "@/routes/MinePage";
import NotFoundPage from "@/routes/NotFoundPage";
import ProgrammePage from "@/routes/ProgrammePage";
import ProgrammesPage from "@/routes/ProgrammesPage";
import RegisterPage from "@/routes/RegisterPage";
import ShellLayout from "@/routes/ShellLayout";
import StaffLanding, { StaffNotFound } from "@/routes/StaffLanding";
import StaffLayout from "@/routes/StaffLayout";
import StyleguidePage from "@/routes/StyleguidePage";

/**
 * Five routes, the staff pages, and a page for every other address; two of the
 * five are the same page.
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
 * Every signed-in page sits in one layout route, `ShellLayout`: the chat and
 * the staff pages share its sidebar, whose "Gestione" group opens the staff
 * pages. `/staff/*` is open to an account holding a role or the superuser
 * (`RequireStaff`); `/staff` lands on the account's first Gestione item, and
 * the pages are objects — programmes, courses, editions — not roles.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/styleguide" element={<StyleguidePage />} />
      <Route
        element={
          <RequireSession>
            <ShellLayout />
          </RequireSession>
        }
      >
        <Route path="/" element={<ChatPage />} />
        <Route path="/c/:conversationId" element={<ChatPage />} />
        <Route
          path="/staff"
          element={
            <RequireStaff>
              <StaffLayout />
            </RequireStaff>
          }
        >
          <Route index element={<StaffLanding />} />
          <Route path="programmes" element={<ProgrammesPage />} />
          <Route path="programmes/:code" element={<ProgrammePage />} />
          <Route path="courses/:code" element={<CoursePage />} />
          <Route path="editions/:id" element={<EditionPage />} />
          <Route path="mine" element={<MinePage />} />
          <Route path="*" element={<StaffNotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
