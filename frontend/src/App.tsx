import type { RouteObject } from "react-router-dom";

import { RequireSession } from "@/auth/RequireSession";
import { RequireStaff } from "@/auth/RequireStaff";
import AccountPage from "@/routes/AccountPage";
import ChatPage from "@/routes/ChatPage";
import CoursePage from "@/routes/CoursePage";
import EditionPage from "@/routes/EditionPage";
import FeedbackDetailPage from "@/routes/FeedbackDetailPage";
import FeedbackPage from "@/routes/FeedbackPage";
import ForgotPage from "@/routes/ForgotPage";
import InvitePage from "@/routes/InvitePage";
import LoginPage from "@/routes/LoginPage";
import MinePage from "@/routes/MinePage";
import NotFoundPage from "@/routes/NotFoundPage";
import PageLayout from "@/routes/PageLayout";
import ProgrammePage from "@/routes/ProgrammePage";
import ProgrammesPage from "@/routes/ProgrammesPage";
import RegisterPage from "@/routes/RegisterPage";
import ResetPage from "@/routes/ResetPage";
import RouteError from "@/routes/RouteError";
import ShellLayout from "@/routes/ShellLayout";
import StaffLanding, { StaffNotFound } from "@/routes/StaffLanding";
import StyleguidePage from "@/routes/StyleguidePage";
import UsersPage from "@/routes/UsersPage";
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
 * Before a session, the two forms and the three pages of what to do about a
 * forgotten password, a reset link and an invitation; then the chat, at two
 * addresses that are the same page, the account's page, the staff pages,
 * and a page for every other address.
 *
 * `/` and `/chat/:conversationId` both render the chat because a new conversation
 * and a stored one differ only in whether the thread starts empty — the page
 * itself, the composer and the sidebar are one thing, and splitting them would
 * be two components to keep identical. A reader's first question moves from
 * one to the other while its answer is still being written, and React keeps
 * the page mounted across that move only because the two routes are siblings
 * of the same shape: neither may gain a parent, a wrapper or an
 * `errorElement` the other lacks (ChatPage.routing.test.tsx fails if the page
 * is rebuilt).
 *
 * `/styleguide` sits outside `RequireSession` with the public routes: it
 * renders the component layer against no data at all, so a session would gate
 * nothing and its test would have to forge one. `/invite` is public too, and
 * answers a signed-in reader as well as one without an account.
 *
 * Every signed-in page sits in one layout route, `ShellLayout`: the chat, the
 * account's page and the staff pages share its sidebar, whose "Gestione" group
 * opens the staff pages; every one but the chat in `PageLayout`'s column. A reader without an account gets `/` alone, in `VisitorLayout`, and
 * the login page for every other address; one guard decides both, so `/` and
 * `/chat/:conversationId` stay one route tree. `/staff/*` is open to an account
 * holding a role or the superuser (`RequireStaff`); `/staff` lands on the
 * account's first Gestione item, and the pages are objects — programmes,
 * courses, editions, and the superuser's accounts and ratings — not roles.
 */
export const routes: RouteObject[] = [
  {
    errorElement: <RouteError full />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/forgot", element: <ForgotPage /> },
      { path: "/reset", element: <ResetPage /> },
      { path: "/invite", element: <InvitePage /> },
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
              { path: "/chat/:conversationId", element: <ChatPage /> },
              {
                path: "/account",
                element: <PageLayout />,
                children: [{ index: true, element: <AccountPage /> }],
              },
              {
                path: "/staff",
                element: (
                  <RequireStaff>
                    <PageLayout />
                  </RequireStaff>
                ),
                children: [
                  { index: true, element: <StaffLanding /> },
                  { path: "programmes", element: <ProgrammesPage /> },
                  { path: "programmes/:code", element: <ProgrammePage /> },
                  { path: "courses/:code", element: <CoursePage /> },
                  { path: "editions/:id", element: <EditionPage /> },
                  { path: "mine", element: <MinePage /> },
                  { path: "users", element: <UsersPage /> },
                  { path: "feedback", element: <FeedbackPage /> },
                  { path: "feedback/:id", element: <FeedbackDetailPage /> },
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
