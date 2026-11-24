import type { ElementRisk } from '@/shared/types/page';

/**
 * Decides whether acting on an element is consequential (purchase, send, delete, submit…).
 * Purely generic: it looks at what the control says and the form it belongs to — never at
 * which website it is.
 */

export interface RiskVerdict {
  consequential: boolean;
  /** Plain-language consequence, e.g. “make a purchase”. */
  consequence?: string;
}

interface Rule {
  pattern: RegExp;
  consequence: string;
  /** Applies to links as well as buttons. */
  links: boolean;
}

const RULES: Rule[] = [
  { pattern: /\b(place (your |my )?order|buy( it)?( now)?|purchase|check ?out|pay( now)?|complete (purchase|order|payment)|confirm (order|purchase|payment|booking)|book now|reserve now|donate|subscribe now|start (my |your )?subscription)\b/i, consequence: 'make a purchase or payment', links: true },
  { pattern: /\b(transfer|withdraw|send money|wire)\b/i, consequence: 'move money', links: true },
  { pattern: /\b(delete|remove|discard|erase|destroy|trash|empty (trash|bin)|clear all|wipe)\b/i, consequence: 'delete something', links: true },
  { pattern: /\b(deactivate|close (my |your )?account|cancel (my |your )?(subscription|membership|order|account|plan)|unsubscribe|change password|reset password)\b/i, consequence: 'change your account', links: true },
  { pattern: /\b(send|reply( all)?|forward|post|publish|tweet|submit (review|comment|feedback|application))\b/i, consequence: 'send or publish something', links: false },
  { pattern: /\b(save|submit|update profile|save changes|confirm|sign (the )?(document|form|contract)|approve|authori[sz]e)\b/i, consequence: 'save or submit changes', links: false },
  // A form's own “Create” (the Smart Inbox's quick task) — not “Create Task”, which opens a form.
  { pattern: /^create$/i, consequence: 'save or submit changes', links: false },
  { pattern: /\b(complete( (the |this |these )?(selected )?tasks?)?|mark (it |them )?(as )?(done|complete)|finali[sz]e|sign off|file( as normal)?|un ?file)\b(?!\s+(audit|log|upload|name|size|type)\b)/i, consequence: 'complete or file a record', links: false },
  // Taking a record off its list without deleting it (Indici's recall “delete” is its “Inactive” icon).
  { pattern: /\b(inactive|inactivate|deactivate|archive|void|cancel (the |this )?(recall|appointment|task|order|prescription|referral|booking)s?|click to cancel)\b/i, consequence: 'cancel or deactivate a record', links: true },
];

/** “Yes” / “OK” in a confirm pop-up: it does what the pop-up asks (“complete the selected task?”). */
const CONFIRMS = /^(yes|ok|okay|confirm|continue|proceed|yes,? .{0,30})$/i;
/** A pop-up warning before something goes on — what saying yes to it accepts. */
const WARNING = /\b(do you want to continue|want to proceed|will not be (funded|saved|sent|claimed)|not be funded)\b/i;

const BUTTONISH = new Set(['button', 'clickable', 'menuitem', 'option', 'gridcell', 'image']);

export function classifyClick(info: ElementRisk): RiskVerdict {
  const name = info.name.trim();
  const isLink = info.role === 'link';
  const isSubmit = info.type === 'submit' || (info.tag === 'button' && info.type === 'submit');
  // Long names are usually cards or rows of content, not commands: only the strongest rules apply.
  const candidates = name.length > 60 ? RULES.slice(0, 3) : RULES;
  // Leaving a form saves nothing — even when its Cancel is a submit button (a <button> in a <form> is one).
  if (/^(cancel|close|back|no|×|✕)$/i.test(name)) return { consequential: false };
  // Opening a dropdown only shows its options, whatever its name says (“File (All)”, “Status (All)”).
  if (info.opensList) return { consequential: false };

  if ((BUTTONISH.has(info.role) || isSubmit) && CONFIRMS.test(name) && info.dialogText) {
    for (const rule of RULES) if (rule.pattern.test(info.dialogText)) return { consequential: true, consequence: rule.consequence };
    // A warning to go past (“… will not be funded. Do you want to continue?”): the user's call, not the agent's.
    if (WARNING.test(info.dialogText)) return { consequential: true, consequence: 'go on past the warning in this pop-up' };
  }
  // “OK” under a form that has been filled in (Indici's Add to Patient Inbox): it saves what was entered.
  if ((BUTTONISH.has(info.role) || isSubmit) && CONFIRMS.test(name) && (info.formValues ?? []).filter((v) => v.value.trim()).length >= 2) {
    return { consequential: true, consequence: 'save or submit changes' };
  }
  if (BUTTONISH.has(info.role) || isLink || isSubmit) {
    for (const rule of candidates) {
      if (isLink && !rule.links) continue;
      if (rule.pattern.test(name)) return { consequential: true, consequence: rule.consequence };
    }
  }
  if (isSubmit && !info.formIsSearch) return verdictForForm(info);
  return { consequential: false };
}

/** Pressing Enter in a field submits its form. */
export function classifySubmit(info: ElementRisk): RiskVerdict {
  if (info.formIsSearch) return { consequential: false };
  if (!info.formSubmitLabels.length && !info.formHasPassword && !info.formHasPayment) return { consequential: false };
  return verdictForForm(info);
}

function verdictForForm(info: ElementRisk): RiskVerdict {
  if (info.formHasPayment) return { consequential: true, consequence: 'submit payment details' };
  if (info.formHasPassword) return { consequential: true, consequence: 'submit a sign-in or account form' };
  for (const label of info.formSubmitLabels) {
    for (const rule of RULES) if (rule.pattern.test(label)) return { consequential: true, consequence: rule.consequence };
  }
  return { consequential: false };
}

/** Typing into password or payment-card fields always deserves a look from the user. */
export function classifyTyping(info: ElementRisk): RiskVerdict {
  if (info.type === 'password') return { consequential: true, consequence: 'enter a password' };
  if (/card|cvc|cvv|security code|expir|iban|account number/i.test(info.name)) return { consequential: true, consequence: 'enter payment details' };
  return { consequential: false };
}
