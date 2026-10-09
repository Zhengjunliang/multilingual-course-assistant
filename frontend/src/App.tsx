import type { RouteObject } from "react-router-dom";

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
import RouteError from "@/routes/RouteError";
import ShellLayout from "@/routes/ShellLayout";
import StaffLanding, { StaffNotFound } from "@/routes/StaffLanding";
import StaffLayout from "@/routes/StaffLayout";
import StyleguidePage from "@/routes/StyleguidePage";
import VisitorLayout from "@/routes/VisitorLayout";

/**
 * The route tree, as data. `main.tsx` builds the browser's router from it and
 * the routing tests build a memory router from the same array, so what a test
 * walks is what a reader walks.
 *
 * A page that throws is caught at two depths (RouteError.tsx). Inside the
 * frame, a route with no path and no element holds every page under the
 * shell: its error takes the page's place and the sidebar stays. The route
 * around the whole tree catches the rest, the frame itself included, over the
 * whole window. Moving to another address clears either.
 *
 * Five routes, the staff pages, and a page for every other address; two of the
 * five are the same page.
 *
 * `/` and `/c/:conversationId` both render the chat because a new conversation
 * and a stored one differ only in whether the thread starts empty — the page
 * itself, the composer and the sidebar are one thing, and splitting them would
 * be two components to keep identical. A reader's first question moves from
 * one to the other while its answer is still being written, and React keeps
 * the page mounted across that move only because the two routes are siblings
 * of the same shape: neither may gain a parent, a wrapper or an
 * `errorElement` the other lacks (ChatPage.routing.test.tsx fails if the page
 * is rebuilt).
 *
 * `/styleguide` sits outside `RequireSession` with the two public routes: it
 * renders the component layer against no data at all, so a session would gate
 * nothing and its test would have to forge one.
 *
 * Every signed-in page sits in one layout route, `ShellLayout`: the chat and
 * the staff pages share its sidebar, whose "Gestione" group opens the staff
 * pages. A reader without an account gets `/` alone, in `VisitorLayout`, and
 * the login page for every other address; one guard decides both, so `/` and
 * `/c/:conversationId` stay one route tree. `/staff/*` is open to an account
 * holding a role or the superuser (`RequireStaff`); `/staff` lands on the
 * account's first Gestione item, and the pages are objects — programmes,
 * courses, editions — not roles.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteError full />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/styleguide", element: <StyleguidePage /> },
      {
        element: (
          <RequireSession visitor={<VisitorLayout />}>
            <ShellLayout />
          </RequireSession>
        ),
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { path: "/", element: <ChatPage /> },
              { path: "/c/:conversationId", element: <ChatPage /> },
              {
                path: "/staff",
                element: (
                  <RequireStaff>
                    <StaffLayout />
                  </RequireStaff>
                ),
                children: [
                  { index: true, element: <StaffLanding /> },
                  { path: "programmes", element: <ProgrammesPage /> },
                  { path: "programmes/:code", element: <ProgrammePage /> },
                  { path: "courses/:code", element: <CoursePage /> },
                  { path: "editions/:id", element: <EditionPage /> },
                  { path: "mine", element: <MinePage /> },
                  { path: "*", element: <StaffNotFound /> },
                ],
              },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
