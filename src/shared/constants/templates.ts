import type { AgentConfig, KnowledgeEntry, SiteProfile, SkillConfig } from '../types/config';
import { uid } from '../utils';
import { BUILT_IN_TOOL_IDS, READ_ONLY_TOOL_IDS } from './tools';

/**
 * Ready-made setups the user can add from Agents → New. Everything they create is ordinary,
 * editable configuration — app knowledge lives in skills and instructions, not in code.
 */

const CAREFLOW_SITES = ['localhost:5173', '127.0.0.1:5173'];

const CAREFLOW_SKILL = `How to work in CareFlow PMS:
- If the Sign in page shows, click "Sign in" — the demo account is already filled in.
- Open the patient first: go to Patients (left menu, or http://localhost:5173/patients), find the patient's row by name (type the name into the search box, or use find_element), and click that row's "Select" button. The Summary page opens and the left panel shows the patient you are working on.
- Records live on the Summary page tabs: Medications, Diagnoses, Tasks, Recalls, Appointments. Open the right tab, then click its "Add …" button ("Add medication", "Add diagnosis", "Add task", "Add recall", "Add appointment").
- The form opens in a dialog with the patient already chosen. Fill only the fields your task gives values for, plus required ones; leave every other field as it is — never guess a code, severity or other value.
- Dropdowns are custom: click the field, read the page, then click the option you want.
- Dates: type them like "Oct 13, 2026" into the date field, then press Escape to close the calendar. Times: type like "3:00 PM", then press Escape. Never press Enter inside a date or time field.
- Save with the dialog's Save button (e.g. "Save Medication"). Then check that the new row appears in the tab's list before saying it is done.
- For several records of the same kind, add them one at a time: open "Add …" again after the previous one is saved.`;

interface Specialist {
  name: string;
  icon: string;
  color: string;
  description: string;
  instructions: string;
}

const SPECIALISTS: Specialist[] = [
  {
    name: 'Medication agent',
    icon: 'ClipboardList',
    color: '#10b981',
    description: 'Adds medications to a patient’s chart in CareFlow — name, dosage, frequency, route and duration.',
    instructions:
      'You only add medications. Form fields: Medication Name, Dosage (e.g. "500 mg"), Route (e.g. Oral), Frequency (Once daily, Twice daily, Three times daily, Four times daily, Every 8 hours, At bedtime, As needed…), Duration (e.g. "30 days"), Start Date. Add each medication in its own form. Leave out anything the task does not give.',
  },
  {
    name: 'Diagnosis agent',
    icon: 'Stethoscope',
    color: '#8b5cf6',
    description: 'Adds diagnoses (problems) to a patient’s chart in CareFlow — name, status, severity and onset.',
    instructions:
      'You only add diagnoses. Form fields: Diagnosis (e.g. "Hypertension"), ICD-10 Code (only if the task gives one), Status (Active, Chronic, Resolved, Inactive), Severity (Mild, Moderate, Severe), Onset Date. Use Status "Active" when the task doesn’t say.',
  },
  {
    name: 'Task agent',
    icon: 'ListChecks',
    color: '#0ea5e9',
    description: 'Creates tasks for a patient in CareFlow — what to do, category, due date and priority.',
    instructions:
      'You only create tasks. Form fields: Task (the title, e.g. "Blood pressure monitoring"), Category (Follow-up, Monitoring, Referral, Documentation, Medication Review, Lab Follow-up, Patient Education, Other), Due Date (required — use today when the task gives none), Priority (Low, Normal, High, Urgent).',
  },
  {
    name: 'Recall agent',
    icon: 'Compass',
    color: '#f59e0b',
    description: 'Recalls a patient in CareFlow — the reason, recall type and when the patient is due back.',
    instructions:
      'You only add recalls. Form fields: Reason (e.g. "Neck pain"), Recall Type (Follow-up, Screening, Vaccination, Lab Test, Medication Review, Chronic Care Review, Other), Due Date (required), Priority (Normal, High).',
  },
  {
    name: 'Appointment agent',
    icon: 'Briefcase',
    color: '#ec4899',
    description: 'Schedules appointments for a patient in CareFlow — date, time, type, reason and provider.',
    instructions:
      'You only schedule appointments. Form fields: Provider (keep the signed-in provider unless the task names another), Date, Time (e.g. "3:00 PM"), Duration (minutes, default 30), Appointment Type (New Patient, Follow-up, Consultation, Procedure, Telehealth…), Reason for Visit (required — e.g. "Follow-up").',
  },
];

/** The CareFlow team: five specialists, a coordinator that runs them at the same time, and the shared skill. */
export function careflowTeam(providerId: string | null): { skill: SkillConfig; agents: AgentConfig[]; coordinator: AgentConfig } {
  const now = Date.now();
  const skill: SkillConfig = {
    id: uid('skill_'),
    name: 'CareFlow PMS',
    description: 'How to open patients and add records in CareFlow.',
    instructions: CAREFLOW_SKILL,
    activation: 'always',
    sites: CAREFLOW_SITES,
    createdAt: now,
    updatedAt: now,
  };
  const agents: AgentConfig[] = SPECIALISTS.map((s) => ({
    id: uid('agent_'),
    name: s.name,
    description: s.description,
    avatar: { icon: s.icon, color: s.color },
    instructions: s.instructions,
    providerId,
    model: '',
    temperature: 0.1,
    maxSteps: 40,
    confirmation: 'smart',
    toolIds: [...BUILT_IN_TOOL_IDS],
    skillIds: [skill.id],
    createdAt: now,
    updatedAt: now,
  }));
  const coordinator: AgentConfig = {
    id: uid('agent_'),
    name: 'CareFlow team',
    description: 'Splits a patient-chart request between the specialist agents and runs them at the same time.',
    avatar: { icon: 'Stethoscope', color: '#14b8a6' },
    instructions: 'Every task must name the patient, so each specialist can open the right chart.',
    providerId,
    model: '',
    temperature: 0.1,
    maxSteps: 20,
    confirmation: 'smart',
    toolIds: [...READ_ONLY_TOOL_IDS],
    skillIds: [skill.id],
    team: { memberIds: agents.map((a) => a.id), parallel: true, maxParallel: 5, tidyUp: true },
    createdAt: now,
    updatedAt: now,
  };
  return { skill, agents, coordinator };
}

// ---------- Site-based setups (Configuration → Sites → From a template) ----------

const entry = (kind: KnowledgeEntry['kind'], title: string, content: string, trigger?: string): KnowledgeEntry => {
  const now = Date.now();
  return { id: uid('kb_'), kind, title, content, ...(trigger ? { trigger } : {}), enabled: true, createdAt: now, updatedAt: now };
};

const site = (name: string, color: string, sites: string[], description: string, knowledge: KnowledgeEntry[]): SiteProfile => {
  const now = Date.now();
  return { id: uid('site_'), name, description, color, sites, enabled: true, providerId: null, model: '', agentIds: [], skillIds: [], disabledSkillIds: [], customToolIds: [], disabledToolIds: [], neverClick: [], knowledge, createdAt: now, updatedAt: now };
};

export interface SiteTemplate {
  key: string;
  name: string;
  description: string;
  /** The address is the user's own (e.g. their practice's Indici address). */
  needsAddress: boolean;
  make: () => SiteProfile;
}

export const SITE_TEMPLATES: SiteTemplate[] = [
  {
    key: 'indici',
    name: 'Indici PMS',
    description: 'Hover menus, Patient Search (Search & List), opening a patient by name.',
    needsAddress: true,
    make: () =>
      site('Indici', '#0e7490', [], 'Indici practice management system.', [
        entry(
          'navigation',
          'Top navigation menus open on hover',
          'The menus in the top navigation bar (Patients and the others) open when the mouse is over them — clicking the top item does not open the list. Use open_menu with the path, e.g. ["Patients", "Search & List"], then click the item you want from what it returns.',
        ),
        entry(
          'page',
          'Patient Search page (Patients › Search & List)',
          [
            '- Search fields: Patient Name (format "Surname First Name"), DOB, NHI, Street.',
            '- Buttons: Search, Search Vault, Reset, Clear, Show Adv. Search. To search, use **Search** — not Search Vault.',
            '- Results table columns: Name, DOB, Age, Gender, NHI, Chart No, Address, Phone, Mobile, Provider, Fund., Enrol., Balance, Actions.',
            '- The Actions column has icons for other jobs (patient details, edit, billing $, book appointment calendar, family members, print…). They do not select the patient.',
            '- Struck-through rows are inactive patients.',
          ].join('\n'),
        ),
        entry(
          'rule',
          'Open a patient by clicking the name — never an icon',
          'Patient names in the Name column are plain text. Open a patient with click_text on the name — one click. If the same name appears more than once, add near with the DOB or NHI from the right row. Never click an icon in the Actions column to open or select a patient. The patient’s consult opens in a new tab: continue there.',
        ),
        entry(
          'workflow',
          'Select a patient from Search & List',
          [
            '1. open_menu ["Patients", "Search & List"], then click "Search & List". The Patient Search page opens.',
            '2. Type the patient’s name into the Patient Name field (e.g. "STARK Arya" or "Arya STARK").',
            '3. Click the Search button and wait for the results table.',
            '4. click_text on the patient’s name in the Name column (near: their DOB if the name is listed twice).',
            '5. The patient’s consult opens in a new tab — you are now working there. Read the page to confirm it is the right patient.',
            '6. Tell the user which patient is open: name, DOB and NHI.',
          ].join('\n'),
          'Goto Patients and select Search & List and select Arya Stark',
        ),
      ]),
  },
  {
    key: 'careflow',
    name: 'CareFlow PMS',
    description: 'Sign-in, opening a patient, the Summary tabs and their Add forms.',
    needsAddress: false,
    make: () =>
      site('CareFlow', '#10b981', [...CAREFLOW_SITES], 'CareFlow practice management (local demo).', [
        entry('workflow', 'Add records to a patient (medication, diagnosis, task, recall, appointment)', CAREFLOW_SKILL, 'Add medication Amoxicillin 500 mg twice daily for Ali Khan'),
        entry('rule', 'Never guess form values', 'Fill only the fields the request gives values for, plus required ones. If a required value is missing (dose, frequency, date…), ask the user instead of choosing one.'),
      ]),
  },
];
