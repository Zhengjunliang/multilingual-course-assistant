/**
 * What the API answers in the browser tests, typed by the client's mirrors of
 * the server's shapes (`src/api/*.ts`), which `tests/test_qa_contract.py` and
 * `tests/test_catalog_contract.py` hold to the Python side: a field renamed on
 * the server breaks `tsc` here before it can make a test pass for nothing.
 */

import type { Account, Session } from "@/api/account";
import type { Course, Edition, Programme, StaffMember, StudyPlanCourse } from "@/api/catalog";
import type { AnswerEvent, Citation, RouteDecision } from "@/api/contract";
import type { ConversationDetail } from "@/api/conversations";

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

const SLIDES_ROUTE: RouteDecision = {
  target: "slides",
  query: "chiave primaria",
  fresh: false,
  reason: "La domanda riguarda il corso.",
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

export const SLIDES_CITATION: Citation = {
  marker: "[Excerpt 1]",
  kind: "slides",
  text: "Una chiave primaria identifica ogni riga della tabella.",
  heading_path: ["Chiavi"],
  course: "B003",
  academic_year: "2025-2026",
  locale: "it",
  score: 0.77,
  source_file: "basi-di-dati-05.pdf",
  source_sha256: "ab".repeat(32),
  page: 12,
  url: null,
  fetch_date: null,
};

export const CAMPUS_QUESTION = "Come mi iscrivo a un esame?";
const CAMPUS_ANSWER = "Ci si iscrive su Sol, entro cinque giorni dall'appello.";
export const SLIDES_QUESTION = "Cos'è una chiave primaria?";
const SLIDES_ANSWER = "È il campo che distingue una riga da ogni altra.";

/** A whole answer: `start`, the text in two tokens, `end`. */
function stream(
  question: string,
  answer: string,
  route: RouteDecision,
  citation: Citation,
  conversation: number | null,
): AnswerEvent[] {
  const half = Math.floor(answer.length / 2);
  return [
    {
      name: "start",
      data: { question, conversation_id: conversation, locale: "it", route, citations: [citation] },
    },
    { name: "token", data: { text: answer.slice(0, half) } },
    { name: "token", data: { text: `${answer.slice(half)} ${citation.marker}` } },
    { name: "end", data: {} },
  ];
}

export const campusStream = (conversation: number | null) =>
  stream(CAMPUS_QUESTION, CAMPUS_ANSWER, CAMPUS_ROUTE, WEB_CITATION, conversation);

export const slidesStream = (conversation: number | null) =>
  stream(SLIDES_QUESTION, SLIDES_ANSWER, SLIDES_ROUTE, SLIDES_CITATION, conversation);

/** The campus exchange, stored: what `/c/7` reopens. */
export const CONVERSATION: ConversationDetail = {
  id: 7,
  locale: "it",
  created_at: "2026-10-08T10:00:00Z",
  title: CAMPUS_QUESTION,
  messages: [
    {
      id: 1,
      role: "user",
      text: CAMPUS_QUESTION,
      locale: "it",
      complete: true,
      citations: [],
      route: null,
    },
    {
      id: 2,
      role: "assistant",
      text: `${CAMPUS_ANSWER} ${WEB_CITATION.marker}`,
      locale: "it",
      complete: true,
      citations: [WEB_CITATION],
      route: CAMPUS_ROUTE,
    },
  ],
};

// --- the catalogue the staff pages read ------------------------------------------

const STAFF_MEMBER: StaffMember = { id: STAFF.id, username: STAFF.username };

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
  is_current: true,
  teachers: [STAFF_MEMBER],
  permissions: ["edition.view", "edition.set_current", "edition.assign_teacher"],
  can_set_current: true,
};

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
