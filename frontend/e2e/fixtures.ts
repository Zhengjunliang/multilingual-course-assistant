/**
 * What the API answers in the browser tests, typed by the client's mirrors of
 * the server's shapes (`src/api/*.ts`), which `tests/test_qa_contract.py` and
 * `tests/test_catalog_contract.py` hold to the Python side: a field renamed on
 * the server breaks `tsc` here before it can make a test pass for nothing.
 * Which endpoint answers which of them is written in `e2e/api.ts`.
 */

import type { Account, Session } from "@/api/account";
import type {
  Course,
  Edition,
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

/** A whole answer: `start`, the text in two tokens, `end`. */
function stream(
  question: string,
  answer: string,
  route: RouteDecision,
  citation: Citation,
  conversation: string | null,
): AnswerEvent[] {
  const half = Math.floor(answer.length / 2);
  return [
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
  stream(CAMPUS_QUESTION, CAMPUS_ANSWER, CAMPUS_ROUTE, WEB_CITATION, conversation);

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
      id: uuidOf(2),
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
  permissions: ["edition.view", "edition.assign_teacher", "edition.edit_content"],
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
  permissions: ["edition.view", "edition.edit_content"],
};

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
