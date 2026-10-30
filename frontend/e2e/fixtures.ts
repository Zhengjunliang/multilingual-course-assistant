/**
 * What the API answers in the browser tests, typed by the client's mirrors of
 * the server's shapes (`src/api/*.ts`), which `tests/test_qa_contract.py`,
 * `tests/test_catalog_contract.py` and `tests/test_admin_contract.py` hold to
 * the Python side: a field renamed on
 * the server breaks `tsc` here before it can make a test pass for nothing.
 * Which endpoint answers which of them is written in `e2e/api.ts`.
 */

import type { Account, AccountSession, Session } from "@/api/account";
import type { ManagedUser } from "@/api/admin";
import type {
  Course,
  CourseMaterial,
  Edition,
  Invitation,
  InvitationGrant,
  Programme,
  ReadingItem,
  StaffMember,
  StudyPlanCourse,
  Syllabus,
} from "@/api/catalog";
import type { AnswerEvent, Citation, RouteDecision } from "@/api/contract";
import type { ConversationDetail } from "@/api/conversations";
import { uuidOf } from "@/test/conversations";

// --- who is calling ------------------------------------------------------------

export const VISITOR: Session = { authenticated: false, user: null };

export const STUDENT: Account = {
  id: 1,
  username: "demo-student",
  locale: "it",
  is_superuser: false,
  roles: [],
};

/** Secretariat of a programme and teacher of an edition: every staff page has something to show. */
export const STAFF: Account = {
  id: 2,
  username: "demo-staff",
  locale: "it",
  is_superuser: false,
  roles: [
    { role: "secretariat", programme: "B060" },
    { role: "teacher", edition: 11 },
  ],
};

/** The superuser, who also has the accounts' page. */
export const ADMIN: Account = {
  id: 3,
  username: "demo-admin",
  locale: "it",
  is_superuser: true,
  roles: [],
};

/** The student's devices: this one, and a phone. */
export const SESSIONS: AccountSession[] = [
  {
    id: "3b5d5c3712955042212316173ccd37be",
    current: true,
    user_agent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    ip: "203.0.113.5",
    authenticated_at: "2026-10-27T08:00:00Z",
    last_activity: "2026-10-28T09:30:00Z",
  },
  {
    id: "e3b0c44298fc1c149afbf4c8996fb924",
    current: false,
    user_agent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    ip: "198.51.100.7",
    authenticated_at: "2026-10-21T18:12:00Z",
    last_activity: "2026-10-26T21:04:00Z",
  },
];

// --- the accounts the superuser manages ---------------------------------------

function managed(account: Account, changes: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: account.id,
    username: account.username,
    is_active: true,
    is_superuser: account.is_superuser,
    last_login: "2026-10-28T08:00:00Z",
    date_joined: "2026-09-01T08:00:00Z",
    roles: account.roles,
    ...changes,
  };
}

/** One of each: the reader, staff, a student, and a deactivated account that never signed in. */
export const USERS: ManagedUser[] = [
  managed(ADMIN),
  managed(STAFF),
  managed(STUDENT),
  managed(
    { id: 4, username: "demo-gone", locale: "it", is_superuser: false, roles: [] },
    { is_active: false, last_login: null },
  ),
];

// --- links handed out ----------------------------------------------------------

/** The fragment of a reset link's or an invitation's address. */
export const LINK_TOKEN = "QmFzZTY0LXVybCB0b2tlbg";

/** Who a reset link resets. */
export const RESET_FOR = { username: "demo-forgetful" };

/** What an invitation makes its holder: a teacher of the edition the staff pages show. */
export const INVITATION: InvitationGrant = {
  role: "teacher",
  edition: {
    id: 11,
    course: { code: "B028451", name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE", locale: "it" },
    academic_year: "2025-2026",
  },
  programme: null,
};

// --- answers ---------------------------------------------------------------------

const CAMPUS_ROUTE: RouteDecision = {
  target: "unifi_web",
  query: "iscrizione esami",
  fresh: false,
  reason: "La domanda riguarda l'ateneo.",
};

const WEB_CITATION: Citation = {
  marker: "[Excerpt 1]",
  kind: "web",
  text: "Ci si iscrive agli appelli su Sol, entro cinque giorni dalla data.",
  heading_path: ["Studenti", "Esami"],
  course: "",
  academic_year: null,
  locale: "it",
  score: 0.82,
  source_file: "",
  source_sha256: null,
  page: 0,
  url: "https://www.unifi.it/esami",
  fetch_date: "2026-09-30",
};

export const CAMPUS_QUESTION = "Come mi iscrivo a un esame?";
const CAMPUS_ANSWER = "Ci si iscrive su Sol, entro cinque giorni dall'appello.";

/** The campus answer's id: its stream's, and its row's once stored (apps/qa/conversations.py). */
const CAMPUS_ANSWER_ID = uuidOf(2);

/** A whole answer: `queued`, `start`, the text in two tokens, `end`. */
function stream(
  id: string,
  question: string,
  answer: string,
  route: RouteDecision,
  citation: Citation,
  conversation: string | null,
): AnswerEvent[] {
  const half = Math.floor(answer.length / 2);
  return [
    { name: "queued", data: { answer_id: id, conversation_id: conversation, question } },
    {
      name: "start",
      data: {
        question,
        conversation_id: conversation,
        locale: "it",
        route,
        citations: [citation],
        search_ms: 2400,
      },
    },
    { name: "token", data: { text: answer.slice(0, half) } },
    { name: "token", data: { text: `${answer.slice(half)} ${citation.marker}` } },
    { name: "end", data: {} },
  ];
}

export const campusStream = (conversation: string | null) =>
  stream(
    CAMPUS_ANSWER_ID,
    CAMPUS_QUESTION,
    CAMPUS_ANSWER,
    CAMPUS_ROUTE,
    WEB_CITATION,
    conversation,
  );

/** The campus exchange, stored: what `/chat/<id>` reopens. */
export const CONVERSATION: ConversationDetail = {
  id: uuidOf(7),
  locale: "it",
  created_at: "2026-10-08T10:00:00Z",
  last_message_at: "2026-10-08T10:00:02Z",
  title: CAMPUS_QUESTION,
  title_locale: "it",
  // Pinned, so that every floor judges the sidebar's «Fissate» group too.
  pinned: true,
  last_source: { courses: [], web: true },
  messages: [
    {
      id: uuidOf(1),
      role: "user",
      text: CAMPUS_QUESTION,
      locale: "it",
      complete: true,
      citations: [],
      route: null,
      search_ms: null,
      created_at: "2026-10-08T10:00:00Z",
    },
    {
      id: CAMPUS_ANSWER_ID,
      role: "assistant",
      text: `${CAMPUS_ANSWER} ${WEB_CITATION.marker}`,
      locale: "it",
      complete: true,
      citations: [WEB_CITATION],
      route: CAMPUS_ROUTE,
      search_ms: 2400,
      created_at: "2026-10-08T10:00:02Z",
    },
  ],
  answering: null,
};

// --- the catalogue the staff pages read ------------------------------------------

const STAFF_MEMBER: StaffMember = { id: STAFF.id, username: STAFF.username, name: "Giulia Neri" };

export const COURSE: Course = {
  code: "B003",
  name: "Basi di dati",
  locale: "it",
  code_source: "moodle",
  entries: [
    {
      programme: { code: "B060", name: "Ingegneria informatica", locale: "it" },
      curriculum: "",
      year_of_study: 2,
      ad_code: "B003",
    },
  ],
};

export const PROGRAMME: Programme = {
  code: "B060",
  name: "Ingegneria informatica",
  locale: "it",
  curricula: [],
  course_count: 1,
  secretariat: [STAFF_MEMBER],
  permissions: ["programme.view", "programme.assign_secretariat"],
};

export const EDITION: Edition = {
  id: 11,
  course: COURSE,
  academic_year: "2025-2026",
  teaching_starts: "2025-09-15",
  period: "first_semester",
  is_current: true,
  teachers: [STAFF_MEMBER],
  permissions: [
    "edition.view",
    "edition.assign_teacher",
    "edition.edit_content",
    "edition.manage_materials",
  ],
};

/** An edition the staff account teaches, and so edits, but may not assign teachers on. */
export const EDITION_READ: Edition = {
  id: 12,
  course: COURSE,
  academic_year: "2024-2025",
  teaching_starts: "2024-09-16",
  period: "first_semester",
  is_current: false,
  teachers: [STAFF_MEMBER],
  permissions: ["edition.view", "edition.edit_content", "edition.manage_materials"],
};

/** The edition's invitations not accepted yet: one still good, one expired. */
export const PENDING: Invitation[] = [
  {
    id: 21,
    role: "teacher",
    edition: {
      id: EDITION.id,
      course: { code: COURSE.code, name: COURSE.name, locale: COURSE.locale },
      academic_year: EDITION.academic_year,
    },
    programme: null,
    created_by: STAFF.username,
    created_at: "2026-10-28T09:00:00Z",
    expires_at: "2099-10-31T09:00:00Z",
  },
  {
    id: 22,
    role: "teacher",
    edition: {
      id: EDITION.id,
      course: { code: COURSE.code, name: COURSE.name, locale: COURSE.locale },
      academic_year: EDITION.academic_year,
    },
    programme: null,
    created_by: STAFF.username,
    created_at: "2026-10-20T09:00:00Z",
    expires_at: "2026-10-23T09:00:00Z",
  },
];

/** Two sections written, in Italian, one with a bold phrase and a list; the other five are empty. */
export const SYLLABUS: Syllabus = {
  locale: "it",
  sections: [
    {
      section: "obiettivi_formativi",
      text: "Progettare un **sistema multimediale**:\n\n- la codifica;\n- la trasmissione.",
    },
    { section: "prerequisiti", text: "Programmazione." },
  ],
};

export const READINGS: ReadingItem[] = [
  {
    id: 41,
    locale: "it",
    title: "Multimedia Systems",
    authors: "Steinmetz, Nahrstedt",
    year: 2004,
    isbn: "978-3540408673",
    url: "",
    importance: "recommended",
  },
];

/** One file of each settled state: a list on its way would be read again every few seconds. */
export const MATERIALS: CourseMaterial[] = [
  {
    id: 51,
    source_file: "02-Scansione.pdf",
    status: "failed",
    failure: "unreadable",
    uploaded_by: STAFF.username,
    created_at: "2026-10-30T09:05:00Z",
    started_at: "2026-10-30T09:05:01Z",
    finished_at: "2026-10-30T09:05:04Z",
  },
  {
    id: 50,
    source_file: "01-Introduzione.pdf",
    status: "ready",
    failure: "",
    uploaded_by: null,
    created_at: "2026-10-30T09:00:00Z",
    started_at: "2026-10-30T09:00:01Z",
    finished_at: "2026-10-30T09:00:31Z",
  },
];

export const STUDY_PLAN: StudyPlanCourse[] = [
  {
    course: COURSE,
    current_edition: {
      id: EDITION.id,
      academic_year: EDITION.academic_year,
      teachers: [STAFF_MEMBER],
    },
  },
];
